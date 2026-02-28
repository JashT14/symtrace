.PHONY: help build release test check clean fmt lint run install

# Default target
help:
	@echo "symtrace — Makefile targets"
	@echo ""
	@echo "Build targets:"
	@echo "  make build      — Build debug binary"
	@echo "  make release    — Build optimized release binary"
	@echo ""
	@echo "Testing & validation:"
	@echo "  make test       — Run all tests"
	@echo "  make check      — Run cargo check (faster than build)"
	@echo ""
	@echo "Code quality:"
	@echo "  make fmt        — Format code with rustfmt"
	@echo "  make fmt-check  — Check code formatting"
	@echo "  make lint       — Run clippy linter"
	@echo ""
	@echo "Maintenance:"
	@echo "  make clean      — Remove build artifacts"
	@echo "  make run        — Build and run (debug mode)"
	@echo "  make install    — Install binary to ~/.cargo/bin"
	@echo ""
	@echo "Benchmarks:"
	@echo "  make bench      — Run benchmarks"

# Debug build
build:
	cargo build

# Release build (optimized)
release:
	cargo build --release

# Run tests
test:
	cargo test --all

# Quick compilation check (no binary)
check:
	cargo check

# Format code
fmt:
	cargo fmt --all

# Check formatting without modifying
fmt-check:
	cargo fmt --all -- --check

# Lint with clippy
lint:
	cargo clippy --all-targets --all-features -- -D warnings

# Clean build artifacts
clean:
	cargo clean

# Build and run in debug mode
run: build
	cargo run -- --help

# Install binary globally
install: release
	cargo install --path .

# Run benchmarks (if benches exist)
bench:
	cargo bench

# All checks before commit
pre-commit: fmt-check lint test check
	@echo "✓ All pre-commit checks passed"

# Production build verification
production: clean release test lint
	@echo "✓ Production build ready"
	@echo ""
	@echo "Binary location:"
	@echo "  ./target/release/symtrace"
	@echo ""
	@echo "Use 'make install' to install globally, or distribute the binary."
