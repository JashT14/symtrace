#!/bin/bash
# Production build script for symtrace
# Portable across Unix/Linux/macOS

set -e

show_help() {
    cat << EOF
symtrace — Build Script (Bash)

Usage: ./build.sh [target]

Targets:
  build       — Build debug binary
  release     — Build optimized release binary
  test        — Run all tests
  check       — Run cargo check
  clean       — Remove build artifacts
  fmt         — Format code
  fmt-check   — Check formatting
  lint        — Run clippy linter
  install     — Install binary globally
  production  — Full production build + tests + lint
  help        — Show this message
EOF
}

TARGET="${1:-help}"

case "$TARGET" in
    build)
        echo "Building debug binary..."
        cargo build
        ;;
    release)
        echo "Building optimized release binary..."
        cargo build --release
        ;;
    test)
        echo "Running tests..."
        cargo test --all
        ;;
    check)
        echo "Running cargo check..."
        cargo check
        ;;
    clean)
        echo "Cleaning build artifacts..."
        cargo clean
        ;;
    fmt)
        echo "Formatting code..."
        cargo fmt --all
        ;;
    fmt-check)
        echo "Checking code formatting..."
        cargo fmt --all -- --check
        ;;
    lint)
        echo "Running clippy linter..."
        cargo clippy --all-targets --all-features -- -D warnings
        ;;
    install)
        echo "Installing binary globally..."
        cargo install --path .
        ;;
    production)
        echo "🔨 Running production build..."
        echo ""
        
        echo "Step 1: Clean..."
        cargo clean
        
        echo "Step 2: Format check..."
        cargo fmt --all -- --check || {
            echo "❌ Format check failed. Run: cargo fmt --all"
            exit 1
        }
        
        echo "Step 3: Lint..."
        cargo clippy --all-targets --all-features -- -D warnings || {
            echo "❌ Lint failed."
            exit 1
        }
        
        echo "Step 4: Tests..."
        cargo test --all || {
            echo "❌ Tests failed."
            exit 1
        }
        
        echo "Step 5: Release build..."
        cargo build --release || {
            echo "❌ Release build failed."
            exit 1
        }
        
        echo ""
        echo "✅ Production build ready!"
        echo ""
        echo "📦 Binary location:"
        echo "   ./target/release/symtrace"
        echo ""
        echo "🚀 To install globally: ./build.sh install"
        ;;
    help)
        show_help
        ;;
    *)
        show_help
        exit 1
        ;;
esac
