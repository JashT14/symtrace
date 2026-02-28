mod ast_builder;
mod ast_cache;
mod cli;
mod commit_classification;
mod git_layer;
mod incremental_parse;
mod language;
mod node_identity;
mod output;
mod refactor_detection;
mod semantic_similarity;
mod symbol_tracking;
mod tree_diff;
mod types;

use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Instant;

use anyhow::{Context, Result};
use clap::Parser;
use rayon::prelude::*;

use ast_cache::{AstCache, CacheEntry, CacheKey};
use incremental_parse::TreeCache;
use types::*;

fn main() -> Result<()> {
    let args = cli::Args::parse();
    let total_start = Instant::now();

    // ── Canonical path enforcement (prevents path spoofing) ──────────
    let canonical_repo = std::fs::canonicalize(&args.repo_path)
        .with_context(|| format!("Failed to resolve repository path: '{}'", args.repo_path))?;
    // On Windows, strip the \\?\ UNC prefix that canonicalize() adds
    let canonical_repo = strip_unc_prefix(canonical_repo);
    let repo_path_str = canonical_repo.to_string_lossy().to_string();

    // ── External cache directory (isolated from the repo tree) ─────
    let cache_dir = compute_cache_dir(&canonical_repo);
    let cache = Arc::new(AstCache::new(cache_dir));

    // ── In-memory tree-sitter Tree cache (for incremental parsing) ──
    let tree_cache = Arc::new(TreeCache::new());

    // ── Parser resource limits (configurable via CLI) ──────────────
    let limits = ParserLimits {
        max_file_size_bytes: args.max_file_size,
        max_ast_nodes: args.max_ast_nodes,
        max_recursion_depth: args.max_recursion_depth,
        parse_timeout_ms: args.parse_timeout_ms,
    };

    // ── 1. Git layer: discover changed files ─────────────────────────
    let changed_files =
        git_layer::get_changed_files(&repo_path_str, &args.commit_a, &args.commit_b)?;

    // ── 2. Parse ASTs for each changed file (parallel + cached) ──────
    let parse_start = Instant::now();

    // Filter to supported languages and collect work items
    let work_items: Vec<_> = changed_files
        .iter()
        .filter_map(|fc| {
            let lang = language::detect_language(&fc.path)?;
            Some((fc, lang))
        })
        .collect();

    // ── Blob hash short-circuit + AST cache + parallel parsing ───────
    //
    // Each file is processed independently via rayon par_iter.
    // For each file we:
    //   1. Check if old_blob_hash == new_blob_hash → skip (unchanged)
    //   2. Check the AST cache by blob hash → reuse on hit
    //   3. Parse only on cache miss, then store the result
    //   4. When an old tree-sitter Tree is available, use incremental
    //      parsing for the new side (tree reuse optimisation)
    let parsed_results: Vec<_> = work_items
        .par_iter()
        .map(|(file_change, lang)| {
            // ── Blob hash short-circuit ──────────────────────────
            if ast_cache::blobs_are_identical(
                file_change.old_blob_hash.as_deref(),
                file_change.new_blob_hash.as_deref(),
            ) {
                // File content is identical between commits — no diff needed
                return (file_change.path.clone(), None, None, 0u64, true, 0u64, false);
            }

            // Parse or retrieve from cache: old side (with tree for reuse)
            let (ast_a, nodes_a, tree_a) = parse_or_cached_with_tree(
                &cache,
                &tree_cache,
                file_change.old_content.as_deref(),
                file_change.old_blob_hash.as_deref(),
                *lang,
                args.logic_only,
                &limits,
            );

            // Parse or retrieve from cache: new side
            // Try incremental parsing if we have the old tree
            let (ast_b, nodes_b, nodes_reused, was_incremental) = {
                let try_incremental = !args.no_incremental
                    && tree_a.is_some()
                    && ast_a.is_some()
                    && file_change.old_content.is_some()
                    && file_change.new_content.is_some();

                if try_incremental {
                    let old_tree = tree_a.as_ref().unwrap();
                    let old_ast = ast_a.as_ref().unwrap();
                    let old_content = file_change.old_content.as_deref().unwrap();
                    let new_content = file_change.new_content.as_deref().unwrap();

                    match ast_builder::parse_content_incremental(
                        new_content,
                        old_content,
                        old_tree,
                        old_ast,
                        *lang,
                        args.logic_only,
                        &limits,
                    ) {
                        Ok((ast, new_tree, reused)) => {
                            let nc = tree_diff::count_nodes(&ast);
                            // Cache the new AST and tree
                            if let Some(bh) = file_change.new_blob_hash.as_deref() {
                                let key = CacheKey {
                                    blob_hash: bh.to_string(),
                                    logic_only: args.logic_only,
                                };
                                cache.put(
                                    key,
                                    CacheEntry {
                                        ast: ast.clone(),
                                        node_count: nc,
                                    },
                                );
                                tree_cache.put(bh.to_string(), new_tree);
                            }
                            (Some(ast), nc, reused, true)
                        }
                        Err(_e) => {
                            // Fallback to full parse
                            let (ast, nodes, _tree) = parse_or_cached_with_tree(
                                &cache,
                                &tree_cache,
                                file_change.new_content.as_deref(),
                                file_change.new_blob_hash.as_deref(),
                                *lang,
                                args.logic_only,
                                &limits,
                            );
                            (ast, nodes, 0, false)
                        }
                    }
                } else {
                    let (ast, nodes, _tree) = parse_or_cached_with_tree(
                        &cache,
                        &tree_cache,
                        file_change.new_content.as_deref(),
                        file_change.new_blob_hash.as_deref(),
                        *lang,
                        args.logic_only,
                        &limits,
                    );
                    (ast, nodes, 0, false)
                }
            };

            (
                file_change.path.clone(),
                ast_a,
                ast_b,
                nodes_a + nodes_b,
                false,
                nodes_reused,
                was_incremental,
            )
        })
        .collect();

    // Gather results
    let mut parsed_pairs: Vec<(String, Option<AstNode>, Option<AstNode>)> = Vec::new();
    let mut total_nodes: u64 = 0;
    let mut files_processed: usize = 0;
    let mut files_skipped_blob: usize = 0;
    let mut total_nodes_reused: u64 = 0;
    let mut total_incremental_parses: usize = 0;

    for (path, ast_a, ast_b, nodes, skipped, reused, was_inc) in parsed_results {
        if skipped {
            files_skipped_blob += 1;
            continue;
        }
        total_nodes += nodes;
        total_nodes_reused += reused;
        if was_inc {
            total_incremental_parses += 1;
        }
        files_processed += 1;
        parsed_pairs.push((path, ast_a, ast_b));
    }
    let parse_time = parse_start.elapsed();

    // ── 3. Compute semantic diff per file (parallel) ─────────────────
    let diff_start = Instant::now();

    let file_diffs: Vec<FileDiff> = parsed_pairs
        .par_iter()
        .map(|(path, ast_a, ast_b)| {
            let operations =
                tree_diff::compute_diff(ast_a.as_ref(), ast_b.as_ref(), args.logic_only);

            let refactor_patterns =
                refactor_detection::detect_patterns(&operations, ast_a.as_ref(), ast_b.as_ref());

            FileDiff {
                file_path: path.clone(),
                operations,
                refactor_patterns,
            }
        })
        .collect();

    let diff_time = diff_start.elapsed();

    // ── 4. Cross-file symbol tracking ─────────────────────────────────
    let cross_file_tracking = symbol_tracking::track_cross_file_symbols(&parsed_pairs);

    // ── 5. Build summary ─────────────────────────────────────────────
    let summary = build_summary(&file_diffs);

    // ── 6. Commit classification ─────────────────────────────────────
    let logic_only_no_changes = if !args.logic_only {
        // Only re-diff files that actually had operations (skip clean files)
        let files_with_ops: Vec<_> = parsed_pairs
            .iter()
            .zip(file_diffs.iter())
            .filter(|(_, fd)| !fd.operations.is_empty())
            .collect();

        let any_logic_ops = if files_with_ops.is_empty() {
            false
        } else {
            files_with_ops.par_iter().any(|((_, ast_a, ast_b), _)| {
                let logic_ops = tree_diff::compute_diff(ast_a.as_ref(), ast_b.as_ref(), true);
                !logic_ops.is_empty()
            })
        };
        !any_logic_ops && !file_diffs.is_empty()
    } else {
        file_diffs.iter().all(|fd| fd.operations.is_empty())
    };

    let commit_classification =
        commit_classification::classify_commit(&file_diffs, &summary, logic_only_no_changes);

    let total_time = total_start.elapsed();

    // Cache stats for diagnostics
    let (cache_mem, cache_disk) = cache.stats();

    let diff_output = DiffOutput {
        repository: repo_path_str.clone(),
        commit_a: args.commit_a.clone(),
        commit_b: args.commit_b.clone(),
        files: file_diffs,
        summary,
        cross_file_tracking: Some(cross_file_tracking),
        commit_classification: Some(commit_classification),
        performance: PerformanceMetrics {
            total_files_processed: files_processed,
            total_nodes_compared: total_nodes,
            parse_time_ms: parse_time.as_secs_f64() * 1000.0,
            diff_time_ms: diff_time.as_secs_f64() * 1000.0,
            total_time_ms: total_time.as_secs_f64() * 1000.0,
            incremental_parses: total_incremental_parses,
            nodes_reused: total_nodes_reused,
        },
    };

    // ── 7. Output ────────────────────────────────────────────────────
    if args.json {
        println!("{}", output::format_json(&diff_output)?);
    } else {
        print!("{}", output::format_cli(&diff_output));
        // Print performance extras
        if files_skipped_blob > 0 {
            eprintln!(
                "  ⚡ Blob hash short-circuit: {} file(s) skipped (unchanged content)",
                files_skipped_blob
            );
        }
        eprintln!(
            "  📦 AST cache: {} in-memory, {} on-disk entries",
            cache_mem, cache_disk
        );
        eprintln!(
            "  🌲 Tree cache: {} in-memory entries",
            tree_cache.len()
        );
        if total_incremental_parses > 0 {
            eprintln!(
                "  🔄 Incremental parsing: {} file(s), {} nodes reused",
                total_incremental_parses, total_nodes_reused
            );
        }
    }

    Ok(())
}

/// Parse file content or retrieve from the AST cache.
/// Also stores/retrieves tree-sitter Trees in the tree cache for
/// incremental parsing of subsequent versions.
/// Returns (Option<AstNode>, node_count, Option<Tree>).
fn parse_or_cached_with_tree(
    cache: &AstCache,
    tree_cache: &TreeCache,
    content: Option<&str>,
    blob_hash: Option<&str>,
    lang: SupportedLanguage,
    logic_only: bool,
    limits: &ParserLimits,
) -> (Option<AstNode>, u64, Option<tree_sitter::Tree>) {
    let content = match content {
        Some(c) => c,
        None => return (None, 0, None),
    };

    // Try AST cache lookup by blob hash
    if let Some(bh) = blob_hash {
        let key = CacheKey {
            blob_hash: bh.to_string(),
            logic_only,
        };
        if let Some(entry) = cache.get(&key) {
            // AST cached — also try to get the tree-sitter Tree
            let tree = tree_cache.get(bh);
            return (Some(entry.ast), entry.node_count, tree);
        }
    }

    // Cache miss — full parse with tree
    match ast_builder::parse_content_with_tree(content, lang, logic_only, limits) {
        Ok((ast, tree)) => {
            let node_count = tree_diff::count_nodes(&ast);

            // Store in both caches
            if let Some(bh) = blob_hash {
                let key = CacheKey {
                    blob_hash: bh.to_string(),
                    logic_only,
                };
                cache.put(
                    key,
                    CacheEntry {
                        ast: ast.clone(),
                        node_count,
                    },
                );
                tree_cache.put(bh.to_string(), tree.clone());
            }

            (Some(ast), node_count, Some(tree))
        }
        Err(e) => {
            eprintln!("  warning: parse failed: {}", e);
            (None, 0, None)
        }
    }
}

fn build_summary(file_diffs: &[FileDiff]) -> DiffSummary {
    let mut summary = DiffSummary {
        total_files: file_diffs.len(),
        moves: 0,
        renames: 0,
        inserts: 0,
        deletes: 0,
        modifications: 0,
    };

    for fd in file_diffs {
        for op in &fd.operations {
            match op.op_type {
                OperationType::Move => summary.moves += 1,
                OperationType::Rename => summary.renames += 1,
                OperationType::Insert => summary.inserts += 1,
                OperationType::Delete => summary.deletes += 1,
                OperationType::Modify => summary.modifications += 1,
            }
        }
    }

    summary
}

// ── Canonical path + cache isolation helpers ─────────────────────────

/// Compute the external cache directory for a repository.
///
/// Location: `<cache_base>/symtrace/<blake3(canonical_repo_path)>/`
///
/// This isolates each repository's cache into a unique directory outside
/// the repo tree, preventing cache injection and accidental commits.
fn compute_cache_dir(canonical_repo: &Path) -> Option<PathBuf> {
    let path_str = canonical_repo.to_string_lossy();
    let repo_hash = blake3::hash(path_str.as_bytes());
    let hex = repo_hash.to_hex();

    let base = cache_base_dir()?;
    Some(base.join("symtrace").join(hex.as_str()))
}

/// Determine the platform-appropriate cache base directory.
///
/// Resolution order:
/// 1. `$XDG_CACHE_HOME` (cross-platform, respects user config)
/// 2. `%LOCALAPPDATA%` (Windows-specific)
/// 3. `$HOME/.cache` (Unix fallback)
/// 4. `%USERPROFILE%/.cache` (Windows last resort)
fn cache_base_dir() -> Option<PathBuf> {
    if let Ok(xdg) = std::env::var("XDG_CACHE_HOME") {
        if !xdg.is_empty() {
            return Some(PathBuf::from(xdg));
        }
    }

    #[cfg(target_os = "windows")]
    {
        if let Ok(local) = std::env::var("LOCALAPPDATA") {
            if !local.is_empty() {
                return Some(PathBuf::from(local));
            }
        }
    }

    if let Ok(home) = std::env::var("HOME") {
        if !home.is_empty() {
            return Some(PathBuf::from(home).join(".cache"));
        }
    }

    #[cfg(target_os = "windows")]
    {
        if let Ok(profile) = std::env::var("USERPROFILE") {
            if !profile.is_empty() {
                return Some(PathBuf::from(profile).join(".cache"));
            }
        }
    }

    None
}

/// Strip the `\\?\` UNC prefix that `std::fs::canonicalize()` adds on Windows.
/// On non-Windows platforms this is a no-op.
fn strip_unc_prefix(path: PathBuf) -> PathBuf {
    #[cfg(target_os = "windows")]
    {
        let s = path.to_string_lossy();
        if let Some(stripped) = s.strip_prefix(r"\\?\") {
            return PathBuf::from(stripped);
        }
    }
    path
}
