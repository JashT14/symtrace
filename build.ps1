#!/usr/bin/env pwsh
# Production build script for symtrace
# Portable across Windows via PowerShell

param(
    [ValidateSet('build', 'release', 'test', 'check', 'clean', 'fmt', 'lint', 'install', 'production', 'help')]
    [string]$Target = 'help'
)

function Show-Help {
    Write-Host "symtrace — Build Script (PowerShell)"
    Write-Host ""
    Write-Host "Usage: .\build.ps1 -Target [target]"
    Write-Host ""
    Write-Host "Targets:"
    Write-Host "  build       — Build debug binary"
    Write-Host "  release     — Build optimized release binary"
    Write-Host "  test        — Run all tests"
    Write-Host "  check       — Run cargo check"
    Write-Host "  clean       — Remove build artifacts"
    Write-Host "  fmt         — Format code"
    Write-Host "  fmt-check   — Check formatting"
    Write-Host "  lint        — Run clippy linter"
    Write-Host "  install     — Install binary globally"
    Write-Host "  production  — Full production build + tests + lint"
    Write-Host "  help        — Show this message"
}

switch ($Target) {
    'build' {
        Write-Host "Building debug binary..."
        cargo build
    }
    'release' {
        Write-Host "Building optimized release binary..."
        cargo build --release
    }
    'test' {
        Write-Host "Running tests..."
        cargo test --all
    }
    'check' {
        Write-Host "Running cargo check..."
        cargo check
    }
    'clean' {
        Write-Host "Cleaning build artifacts..."
        cargo clean
    }
    'fmt' {
        Write-Host "Formatting code..."
        cargo fmt --all
    }
    'fmt-check' {
        Write-Host "Checking code formatting..."
        cargo fmt --all -- --check
    }
    'lint' {
        Write-Host "Running clippy linter..."
        cargo clippy --all-targets --all-features -- -D warnings
    }
    'install' {
        Write-Host "Installing binary globally..."
        cargo install --path .
    }
    'production' {
        Write-Host "🔨 Running production build..."
        Write-Host ""
        
        Write-Host "Step 1: Clean..."
        cargo clean
        
        Write-Host "Step 2: Format check..."
        cargo fmt --all -- --check
        if ($LASTEXITCODE -ne 0) {
            Write-Host "❌ Format check failed. Run: cargo fmt --all"
            exit 1
        }
        
        Write-Host "Step 3: Lint..."
        cargo clippy --all-targets --all-features -- -D warnings
        if ($LASTEXITCODE -ne 0) {
            Write-Host "❌ Lint failed."
            exit 1
        }
        
        Write-Host "Step 4: Tests..."
        cargo test --all
        if ($LASTEXITCODE -ne 0) {
            Write-Host "❌ Tests failed."
            exit 1
        }
        
        Write-Host "Step 5: Release build..."
        cargo build --release
        if ($LASTEXITCODE -ne 0) {
            Write-Host "❌ Release build failed."
            exit 1
        }
        
        Write-Host ""
        Write-Host "✅ Production build ready!"
        Write-Host ""
        Write-Host "📦 Binary location:"
        Write-Host "   .\target\release\symtrace.exe"
        Write-Host ""
        Write-Host "🚀 To install globally: .\build.ps1 -Target install"
    }
    'help' {
        Show-Help
    }
    default {
        Show-Help
    }
}
