use clap::Parser;

#[derive(Parser, Debug)]
#[command(name = "symtrace")]
#[command(version = env!("CARGO_PKG_VERSION"))]
#[command(about = "Semantic diff engine using AST-based structural analysis")]
#[command(long_about = "SymTrace compares two commits of the same repository using \
    AST-based structural analysis instead of line-based text diff. \
    It detects moves, renames, inserts, deletes, and modifications \
    at the semantic node level.")]
pub struct Args {
    /// Path to local git repository
    pub repo_path: String,

    /// Older commit reference (hash, HEAD~1, branch, tag, etc.)
    pub commit_a: String,

    /// Newer commit reference (hash, HEAD, branch, tag, etc.)
    pub commit_b: String,

    /// Ignore comments and whitespace-only changes
    #[arg(long)]
    pub logic_only: bool,

    /// Output structured JSON instead of formatted CLI text
    #[arg(long)]
    pub json: bool,

    /// Maximum file size in bytes before skipping (default: 5 MiB)
    #[arg(long, default_value_t = 5_242_880)]
    pub max_file_size: usize,

    /// Maximum AST nodes per file before skipping (default: 200,000)
    #[arg(long, default_value_t = 200_000)]
    pub max_ast_nodes: usize,

    /// Maximum parser recursion depth (default: 2,048)
    #[arg(long, default_value_t = 2_048)]
    pub max_recursion_depth: usize,

    /// Parse timeout in milliseconds, 0 to disable (default: 2,000)
    #[arg(long, default_value_t = 2_000)]
    pub parse_timeout_ms: u64,

    /// Disable incremental parsing (always do full parse)
    #[arg(long)]
    pub no_incremental: bool,
}
