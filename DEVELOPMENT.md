# Development Guide

This document describes the production-ready build and development workflow for symtrace.

## Build System

The project is configured for **maximum portability** and **production quality** across Windows, macOS, and Linux.

### Build Scripts

Three ways to build, all with identical targets and no system-specific hardcoding:

#### 1. **Windows (PowerShell)**
```powershell
.\build.ps1 -Target production    # Full production build
.\build.ps1 -Target release       # Release binary only
.\build.ps1 -Target test          # Run tests
.\build.ps1 -Target lint          # Run clippy
.\build.ps1 -Target fmt           # Format code
.\build.ps1 -Target help          # Show all targets
```

#### 2. **macOS / Linux (Bash)**
```bash
./build.sh production    # Full production build
./build.sh release       # Release binary only
./build.sh test          # Run tests
./build.sh lint          # Run clippy
./build.sh fmt           # Format code
./build.sh help          # Show all targets
```

#### 3. **Direct Cargo** (all platforms)
```bash
cargo build                    # Debug build
cargo build --release         # Release build (optimized)
cargo test --all              # Run tests
cargo clippy --all-targets    # Lint
cargo fmt --all               # Format
cargo install --path .        # Install binary globally
```

### GNU Make (optional)

If `make` is installed on your system (Linux/macOS):
```bash
make release      # Make targets are identical to build scripts
make test
make lint
make production
make help         # Show all targets
```

## Production Build

### Recommended: Full Validation

```powershell
# Windows
.\build.ps1 -Target production

# Linux/macOS
./build.sh production

# Or any platform
cargo clean && cargo fmt --all -- --check && \
  cargo clippy --all-targets --all-features -- -D warnings && \
  cargo test --all && cargo build --release
```

This runs:
1. ✓ Clean build directory
2. ✓ Format check (rustfmt)
3. ✓ Linter (clippy with warnings-as-errors)
4. ✓ Test suite
5. ✓ Release build (optimized)

### Binary Location

After a successful build, the binary is located at:
- **Windows:** `target\release\symtrace.exe`
- **macOS/Linux:** `target/release/symtrace`

### Release Build Configuration

All release builds use production-optimized settings from `.cargo/config.toml`:

| Setting | Value | Purpose |
|---------|-------|---------|
| `opt-level` | 3 | Maximum optimization (LLVM -O3) |
| `lto` | true | Link-Time Optimization |
| `codegen-units` | 1 | Single codegen unit (slower compile, faster binary) |
| `strip` | true | Strip symbols (smaller binary) |
| `panic` | abort | Smaller runtime (abort instead of unwind) |
| `jobs` | -1 | Use all available CPU cores |

Result: Fast, small, production-grade binary with minimal runtime overhead.

## Code Quality Standards

### Pre-commit checks

Run before committing:
```powershell
# Windows
.\build.ps1 -Target production

# Linux/macOS
./build.sh production
```

### Code formatting

All code **must** be formatted with `rustfmt`:
```bash
cargo fmt --all
```

This is enforced by CI. Run this before committing to avoid CI failures.

### Linting

All clippy warnings are treated as errors:
```bash
cargo clippy --all-targets --all-features -- -D warnings
```

Fix any warnings reported before committing.

### Testing

All tests must pass:
```bash
cargo test --all
```

Add tests for new functionality.

## Dependency Management

| Crate | Version | Purpose |
|-------|---------|---------|
| `clap` | =4.5.60 | CLI argument parsing |
| `git2` | =0.19.0 | libgit2 bindings |
| `tree-sitter` | =0.25.10 | Parser framework |
| `tree-sitter-{rust,javascript,typescript,python,java}` | pinned | Language grammars |
| `blake3` | =1.8.3 | BLAKE3 hashing |
| `serde` / `serde_json` | =1.0.228 / =1.0.149 | JSON serialization |
| `bincode` | =1.3.3 | Binary serialization (AST cache) |
| `rayon` | =1.11.0 | Data parallelism |
| `lru` | =0.12.5 | In-memory LRU cache |
| `bumpalo` | =3.20.2 | Arena allocator |
| `colored` | =2.2.0 | Terminal colors |
| `anyhow` | =1.0.102 | Error handling |

All versions are exactly pinned (`=x.y.z`) in `Cargo.toml`. `Cargo.lock` is committed for reproducible builds.

## Installation for Development

```bash
# 1. Clone
git clone https://github.com/nicktretyakov/symtrace.git
cd symtrace

# 2. Install Rust (if needed)
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh

# 3. Build
cargo build --release

# 4. Test
cargo test --all

# 5. Install binary
cargo install --path .
```

The binary is now available as `symtrace` from any terminal.

## Troubleshooting

### Build failures

1. **Missing C compiler:** Install a C compiler (MSVC on Windows, GCC/Clang on Linux/macOS)
2. **libgit2 not found:** Part of build process; ensure internet access during first build
3. **Out of disk space:** Release build can use several GB; `cargo clean` frees ~200 MB

### Test failures

Run with backtrace:
```bash
RUST_BACKTRACE=1 cargo test --all -- --nocapture
```

### Lint failures

Full clippy output:
```bash
cargo clippy --all-targets --all-features --message-format=short
```

## Distribution

### Building for distribution

Ensure reproducible builds:
```bash
cargo clean
cargo build --release
```

The binary at `target/release/symtrace` (or `.exe` on Windows) is production-ready.

### Portable binary

The binary is statically linked (except system libraries). It requires only:
- **Windows:** Windows 7+ (64-bit x86_64)
- **macOS:** macOS 10.13+ (Intel or Apple Silicon)
- **Linux:** glibc 2.17+ (most distributions)

## System Independence

All build configuration is portable:
- ✓ No hardcoded paths
- ✓ No system-specific settings in `.cargo/config.toml` or build scripts
- ✓ No environment-variable dependencies (except `RUST_BACKTRACE` for debugging)
- ✓ `.gitignore` blocks personal files (`.env`, editor config, OS files)

Safe to push to GitHub without exposing personal systems information.
