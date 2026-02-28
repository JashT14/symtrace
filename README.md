# symtrace

A **deterministic semantic diff engine** written in Rust that compares two Git commits using **AST-based structural analysis** instead of traditional line-based text diff.

Where `git diff` shows you *lines that changed*, `symtrace` shows you *what semantically changed* — functions moved, classes deleted, variables renamed, code blocks inserted — at the AST node level, with no false positives from formatting or comment edits.

```
━━━ src/handler.rs
  + [INSERT] function_item 'handle_request' inserted (L42)
  ~ [MODIFY] function_item 'parse_body' modified (L10 → L10) [75% similarity, medium]
  ✎ [RENAME] function_item renamed from 'process' to 'execute' (L5 → L5) [98% similarity, low]
  - [DELETE] function_item 'deprecated_fn' deleted (L88)
  ↔ [MOVE]   function_item 'helper' moved (L20 → L35) [100% similarity, low]
  ── Refactor Patterns ──
    ▸ 'process' renamed to 'execute' (confidence: 100%)
```

## Features

- **Semantic operations** — MOVE, RENAME, MODIFY, INSERT, DELETE detected at the AST node level
- **5-phase matching algorithm** — exact hash match → structural match → similarity scoring → leftovers
- **4-hash BLAKE3 node identity** — structural, content, identity, and context hashes per node
- **Refactor pattern detection** — extract method, move method, rename variable
- **Cross-file symbol tracking** — detects symbols that move, rename, or change API across files
- **Commit classification** — automatically labels commits (feature, bugfix, refactor, cleanup, formatting_only, etc.)
- **Semantic similarity scoring** — per-operation similarity percentage with intensity rating (low / medium / high)
- **Incremental parsing** — tree-sitter tree reuse + BLAKE3 hash reuse for unchanged subtrees
- **AST caching** — two-tier cache (in-memory LRU + on-disk) keyed by blob hash
- **Parallel processing** — files parsed and diffed in parallel via rayon
- **Arena allocation** — bumpalo arena for zero-overhead AST construction
- **Comment/whitespace filtering** — `--logic-only` mode ignores non-logic changes
- **Machine-readable output** — `--json` for CI/CD pipelines and tooling integration
- **Parser resource limits** — configurable file size, node count, recursion depth, and timeout guards
- **Zero network access** — fully offline, no telemetry, no data collection

## Supported Languages

| Language   | Extensions                          |
|------------|-------------------------------------|
| Rust       | `.rs`                               |
| JavaScript | `.js`, `.jsx`, `.mjs`, `.cjs`       |
| TypeScript | `.ts`, `.tsx`                       |
| Python     | `.py`, `.pyi`                       |
| Java       | `.java`                             |

Files with unsupported extensions are silently skipped.

## Quick Start

```bash
# Build
cargo build --release

# Compare the last two commits
symtrace . HEAD~1 HEAD

# Compare two specific commits
symtrace /path/to/repo a1b2c3d 9f8e7d6

# JSON output for scripting
symtrace . HEAD~1 HEAD --json

# Ignore comment/whitespace changes
symtrace . HEAD~1 HEAD --logic-only
```

## Installation

Requires [Rust](https://www.rust-lang.org/tools/install) (edition 2021+) and a C compiler (for libgit2 and tree-sitter native code).

```bash
# From source
git clone https://github.com/nicktretyakov/symtrace.git
cd symtrace
cargo install --path .

# Or build directly
cargo build --release
# Binary at target/release/symtrace (or .exe on Windows)
```

### Build Scripts

```bash
# Production build (clean + fmt + lint + test + release)
./build.sh production     # macOS/Linux
.\build.ps1 -Target production   # Windows
make production           # GNU Make
```

See [DEVELOPMENT.md](DEVELOPMENT.md) for full build system documentation.

## Usage

```
symtrace <REPO_PATH> <COMMIT_A> <COMMIT_B> [OPTIONS]
```

### Arguments

| Argument      | Description |
|---------------|-------------|
| `REPO_PATH` | Path to a local Git repository (the folder containing `.git/`) |
| `COMMIT_A`  | Older commit reference — hash, `HEAD~1`, branch name, tag |
| `COMMIT_B`  | Newer commit reference — hash, `HEAD`, branch name, tag |

### Options

| Flag | Default | Description |
|------|---------|-------------|
| `--logic-only` | off | Ignore comments and whitespace-only nodes |
| `--json` | off | Emit machine-readable JSON instead of colored CLI output |
| `--no-incremental` | off | Disable incremental parsing (force full re-parse) |
| `--max-file-size <BYTES>` | 5242880 | Skip files larger than this (5 MiB default) |
| `--max-ast-nodes <N>` | 200000 | Skip files with more AST nodes than this |
| `--max-recursion-depth <N>` | 2048 | Maximum parser recursion depth |
| `--parse-timeout-ms <MS>` | 2000 | Per-file parse timeout (0 = no timeout) |
| `--help` | | Print help |
| `--version` | | Print version |

### Examples

```bash
# Compare feature branch against main
symtrace /repos/project main feature/my-feature

# Compare two tags
symtrace /repos/project v1.0.0 v2.0.0

# JSON output piped to jq
symtrace . HEAD~1 HEAD --json | jq '.summary'

# Logic-only JSON for CI
symtrace . HEAD~5 HEAD --logic-only --json

# Strict resource limits for untrusted repos
symtrace . HEAD~1 HEAD --max-file-size 1048576 --max-ast-nodes 50000 --parse-timeout-ms 500
```

---

## How It Works

```
Repository commits
       │
       ▼
   git layer          ← libgit2: resolve refs, extract file blobs
       │
       ▼
  blob hash check     ← short-circuit: skip files with identical content
       │
       ▼
  AST parsing         ← tree-sitter: parallel, cached, incremental
       │                  (arena-allocated, resource-guarded)
       ▼
   BLAKE3 hashing     ← 4-hash identity per node (with incremental reuse)
       │
       ▼
  tree diffing        ← 5-phase matching algorithm (parallel per file)
       │
       ▼
  symbol tracking     ← cross-file move/rename/API-change detection
       │
       ▼
  classification      ← auto-classify commit type
       │
       ▼
   output             ← colored CLI  OR  structured JSON
```

### Architecture

| Module | Responsibility |
|--------|----------------|
| `main.rs` | Pipeline orchestration, parallel dispatch, timing |
| `cli.rs` | CLI argument definitions via clap |
| `git_layer.rs` | Opens repo with libgit2, resolves commits, reads blobs |
| `language.rs` | File extension → language mapping, tree-sitter grammar provider |
| `ast_builder.rs` | Tree-sitter parsing (full + incremental), arena-allocated AST construction |
| `ast_cache.rs` | Two-tier AST cache — in-memory LRU + on-disk with versioned envelope |
| `incremental_parse.rs` | TreeCache (in-memory LRU for tree-sitter Trees), edit computation |
| `node_identity.rs` | BLAKE3 4-hash computation per node (with incremental hash reuse) |
| `tree_diff.rs` | 5-phase matching algorithm, produces operation records |
| `semantic_similarity.rs` | Composite similarity scoring with complexity analysis |
| `refactor_detection.rs` | Pattern matching for extract/move/rename refactors |
| `symbol_tracking.rs` | Cross-file symbol tracking (moves, renames, API changes) |
| `commit_classification.rs` | Automatic commit classification by type and confidence |
| `output.rs` | Colored CLI renderer and JSON serializer |
| `types.rs` | All shared types (AstNode, OperationRecord, DiffOutput, ...) |

### Hashing Strategy

Every AST node receives **four** independent BLAKE3 hashes:

| Hash | Input | Purpose |
|------|-------|---------|
| `structural_hash` | `node_kind + child structural_hashes` | Tree shape — detects moves regardless of content |
| `content_hash` | `actual leaf tokens` | Real content — detects any text change |
| `identity_hash` | `node_kind + <IDENTIFIER> placeholders` | Shape sans names — detects renames |
| `context_hash` | `parent_structural_hash + depth` | Position in tree — detects re-parenting |

### Matching Phases

```
Phase 1 — EXACT MATCH  (structural + content hash)
  └─ same path → silent  /  different path → MOVE

Phase 2 — STRUCTURAL MATCH  (structural hash only, different content)
  ├─ same name → MODIFY
  ├─ only identifiers changed → RENAME
  └─ otherwise → MODIFY

Phase 3 — SIMILARITY SCORING
  3a. Same kind + name → MODIFY
  3b. identity_hash match + ≥90% → RENAME
  3c. Composite ≥70% → MODIFY

Phase 4 — LEFTOVER OLD  → DELETE
Phase 5 — LEFTOVER NEW  → INSERT
```

### Operation Types

| Operation | Symbol | Meaning |
|-----------|--------|---------|
| MOVE | `↔` | Same content, different position in the tree |
| RENAME | `✎` | Same structure, different identifier names |
| MODIFY | `~` | Same kind/name, changed body |
| INSERT | `+` | Exists only in the new commit |
| DELETE | `-` | Exists only in the old commit |

### Similarity Scoring

Every matched operation carries a similarity breakdown:

$$\text{score} = 0.5 \times \text{structure} + 0.3 \times \text{tokens} + 0.2 \times \text{complexity}$$

| Similarity | Intensity | Meaning |
|------------|-----------|---------|
| ≥ 80% | `low` | Minor change — safe to auto-approve |
| 50–79% | `medium` | Non-trivial — worth focused review |
| < 50% | `high` | Near-total rewrite — treat as new code |

### Incremental Parsing

When comparing commits, symtrace parses the old version of each file first, then uses tree-sitter's incremental parsing to reparse the new version:

1. **Edit computation** — common prefix/suffix byte comparison → minimal `InputEdit`
2. **Tree reuse** — tree-sitter internally reuses all unchanged subtrees
3. **Hash reuse** — BLAKE3 hashes copied from the old AST for nodes outside the changed region

This delivers up to **46% parse time reduction** on files with localised changes. Disable with `--no-incremental` if needed.

---

## Output Formats

### CLI (default)

```
━━━ symtrace  Semantic Diff ━━━
Repository : /repos/project
Comparing  : HEAD~1 → HEAD

━━━ src/server.rs
  + [INSERT] function_item 'handle_request' inserted (L42)
  ~ [MODIFY] function_item 'parse_body' modified (L10 → L10) [75% similarity, medium]
  ✎ [RENAME] function_item renamed from 'old_name' to 'new_name' (L5 → L5) [98% similarity, low]
  - [DELETE] function_item 'deprecated_fn' deleted (L88)
  ↔ [MOVE]   function_item 'helper' moved (L20 → L35) [100% similarity, low]
  ── Refactor Patterns ──
    ▸ 'old_name' renamed to 'new_name' (confidence: 100%)

━━━ Summary ━━━
  Files          : 1
  Moves          : 1
  Renames        : 1
  Inserts        : 1
  Deletes        : 1
  Modifications  : 1

━━━ Cross-File Symbol Tracking ━━━
  Symbols tracked : 42
  ↔ [cross_file_move] variable 'config' moved from 'old.js' to 'new.js' (similarity: 100%)

━━━ Commit Classification ━━━
  Class          : refactor
  Confidence     : 85%

━━━ Performance ━━━
  Files processed   : 1
  Nodes compared    : 312
  Parse time        : 2.14 ms
  Diff time         : 0.38 ms
  Total time        : 12.05 ms
  Incremental       : 1 file(s), 156 nodes reused
```

### JSON (`--json`)

```json
{
  "repository": "/repos/project",
  "commit_a": "HEAD~1",
  "commit_b": "HEAD",
  "files": [
    {
      "file_path": "src/server.rs",
      "operations": [
        {
          "type": "MODIFY",
          "entity_type": "function",
          "old_location": "L10",
          "new_location": "L10",
          "details": "function_item 'parse_body' modified",
          "similarity": {
            "structure_similarity": 0.84,
            "token_similarity": 0.61,
            "node_count_delta": 3,
            "cyclomatic_delta": 1,
            "control_flow_changed": true,
            "similarity_percent": 75.2,
            "change_intensity": "medium"
          }
        }
      ],
      "refactor_patterns": []
    }
  ],
  "summary": { "total_files": 1, "moves": 1, "renames": 1, "inserts": 1, "deletes": 1, "modifications": 1 },
  "cross_file_tracking": { ... },
  "commit_classification": { "classification": "refactor", "confidence": 0.85 },
  "performance": { "total_files_processed": 1, "total_nodes_compared": 312, "parse_time_ms": 2.14, "diff_time_ms": 0.38, "total_time_ms": 12.05 }
}
```

**JSON notes:**
- `old_location` omitted on INSERT; `new_location` omitted on DELETE
- `similarity` omitted on INSERT and DELETE
- `entity_type`: `"function"`, `"class"`, `"variable"`, `"block"`, `"other"`
- `change_intensity`: `"low"`, `"medium"`, `"high"`

---

## Performance

Benchmarks on [expressjs/express](https://github.com/expressjs/express) (JavaScript, ~21k LOC), release build, 10-run average on Windows:

| Scenario | `git diff` | `symtrace` | Ratio |
|----------|-----------|-------------|-------|
| 2 JS files, 6k nodes | 42.85 ms | **40.61 ms** | symtrace **1.06× faster** |
| 8 JS files, 21k nodes | 44.57 ms | 67.70 ms | git diff 1.52× faster |
| 11 JS files, 26k nodes | 44.55 ms | 74.01 ms | git diff 1.66× faster |

`symtrace` beats `git diff` on small file sets. On larger ranges, the overhead of full AST parsing + 5-phase matching is the cost of semantic understanding. Scaling is sub-linear: 4.4× more nodes → only 1.8× more time.

See [benchmarks_v5.md](benchmarks_v5.md) for complete data, historical progression (v1–v5), and internal timing breakdowns.

---

## Security

- **No network access** — zero HTTP/TCP/DNS dependencies
- **No telemetry** — no analytics, tracking, or data collection
- **No unsafe Rust** — `unsafe_code = "deny"` enforced in `Cargo.toml`
- **No external process spawning** — no `std::process::Command`
- **Bounded deserialization** — AST cache limited to 20 MiB with version/integrity checks
- **Pinned dependencies** — all versions exactly pinned (`=x.y.z`)
- **Supply chain hardening** — `cargo-deny` configuration in [deny.toml](deny.toml)

See [SECURITY.md](SECURITY.md) for the full security audit.

---

## Dependencies

| Crate | Purpose |
|-------|---------|
| `clap` | CLI argument parsing |
| `git2` | libgit2 bindings for repository access |
| `tree-sitter` | Parser framework |
| `tree-sitter-{rust,javascript,typescript,python,java}` | Language grammars |
| `blake3` | SIMD-optimised hashing for node identity |
| `serde` / `serde_json` | JSON serialization |
| `bincode` | Binary serialization for AST cache |
| `rayon` | Data parallelism |
| `lru` | In-memory LRU cache |
| `bumpalo` | Arena allocator |
| `colored` | Terminal colors |
| `anyhow` | Error handling |

All versions are exactly pinned. See [Cargo.toml](Cargo.toml) for specifics.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

## License

[MIT](LICENSE)
