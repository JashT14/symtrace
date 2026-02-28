# Contributing to symtrace

Thank you for your interest in contributing to symtrace.

## Getting Started

1. Fork and clone the repository
2. Install [Rust](https://www.rust-lang.org/tools/install) (edition 2021+) and a C compiler
3. Run `cargo build` to verify your setup
4. Run `cargo test --all` to ensure all tests pass

See [DEVELOPMENT.md](DEVELOPMENT.md) for build system details, build targets, and release configuration.

## Making Changes

1. Create a feature branch from `main`
2. Make your changes in small, focused commits
3. Add or update tests for any new functionality
4. Run the full validation before submitting:

```bash
# Format + lint + test + release build
./build.sh production     # macOS/Linux
.\build.ps1 -Target production   # Windows
```

## Code Standards

- **Formatting** — all code must pass `cargo fmt --all -- --check`
- **Linting** — all clippy warnings are errors: `cargo clippy --all-targets --all-features -- -D warnings`
- **Testing** — all tests must pass: `cargo test --all`
- **No unsafe** — `unsafe_code = "deny"` is enforced in `Cargo.toml`
- **Pinned dependencies** — new dependencies must use exact version pinning (`=x.y.z`)

## Pull Requests

- Keep PRs focused on a single change
- Include a clear description of what changed and why
- Reference any related issues
- Ensure CI checks pass before requesting review

## Reporting Issues

- Use GitHub Issues for bug reports and feature requests
- Include steps to reproduce for bugs
- Include the output of `symtrace --version` and your OS

## Security

See [SECURITY.md](SECURITY.md) for security policy and vulnerability reporting.

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](LICENSE).
