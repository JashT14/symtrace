# symtrace Security Policy

**Last audited:** 2026-02-28
**Audit scope:** All 16 source files (src/*.rs) + Cargo.toml — full manual review

---

## Executive Summary

symtrace is a **local-only, offline, privacy-respecting** CLI tool.
It has **no network capabilities**, collects **no telemetry**, uses **no unsafe
Rust code**, and processes data **only as explicitly requested** by the user.

| Property | Status |
|----------|--------|
| Network access | **None** — no HTTP, TCP, or DNS crates |
| Telemetry / analytics | **None** — zero tracking or phoning home |
| Data exfiltration | **None** — all output goes to stdout/stderr only |
| Environment variable access | **Limited** — reads only `XDG_CACHE_HOME`, `LOCALAPPDATA`, `HOME`, `USERPROFILE` for cache directory resolution |
| External process spawning | **None** — no `std::process::Command` |
| Unsafe Rust code | **Denied** — `unsafe_code = "deny"` enforced in `Cargo.toml` lints |
| File writes outside cache | **None** — writes only to `$XDG_CACHE_HOME/symtrace/<repo_hash>/` |
| Cache deserialization | **Bounded** — 20 MiB limit, versioned envelope with integrity checks |
| Parser resources | **Guarded** — configurable limits on file size, node count, depth, timeout |
| Incremental parsing | **Isolated** — tree-sitter Trees cached in-memory only; no disk serialisation |

---

## 1. Ethical Data Processing

### What data does symtrace access?

symtrace reads **only** local git repository data that the user explicitly
points it to via CLI arguments:

-   Git commit trees and blob objects (via `libgit2`)
-   Source code file contents (to build ASTs via `tree-sitter`)

### What does symtrace do with the data?

1.  Parses source code into Abstract Syntax Trees (ASTs)
2.  Computes structural hashes (BLAKE3) for diff matching
3.  Outputs a semantic diff report to stdout

### What does symtrace NOT do?

-   **Does NOT transmit any data** over the network — there are zero
    networking dependencies (`reqwest`, `hyper`, `http`, `curl`, etc. are
    all absent from `Cargo.toml`)
-   **Does NOT collect telemetry** — no analytics, usage metrics, crash
    reports, or any form of tracking
-   **Does NOT spawn sub-processes** — no `std::process::Command` usage
-   **Does NOT read files outside** the specified git repository
-   **Does NOT modify** the git repository in any way (read-only access)
-   **Does NOT log sensitive information** — no credentials, tokens, or
    personal data appear in any output

### Cache data

The on-disk AST cache is stored **outside** the repository tree:
`$XDG_CACHE_HOME/symtrace/<blake3(canonical_repo_path)>/`
(Windows: `%LOCALAPPDATA%/symtrace/<hash>/`)

Cache files contain serialised AST representations wrapped in a versioned
envelope.  Cache data is:

-   Stored **externally** — not inside the repository directory
-   **Never transmitted** anywhere
-   Versioned with a schema tag — mismatched versions are rejected
-   Integrity-checked against the git blob OID
-   Bounded to 20 MiB maximum during deserialization
-   Safe to delete at any time without affecting functionality

---

## 2. Security Findings

### 2.1 Cache Deserialization Without Integrity Verification — **MITIGATED**

| Field | Value |
|-------|-------|
| **Severity** | ~~Low~~ → **Resolved** |
| **Location** | `src/ast_cache.rs` — `get()` method |
| **Description** | Cache files were deserialized via `bincode::deserialize` without checksum or version tag verification. |
| **Mitigation applied** | Cache files are now wrapped in a `CacheEnvelope` with a `version: u8` tag and `blob_oid: String` integrity field. Deserialization uses `bincode::options().with_limit(20_971_520)`. On version mismatch or OID mismatch, the stale file is removed and the entry is treated as a cache miss. |

### 2.2 Bincode v1 Allocation Limits — **MITIGATED**

| Field | Value |
|-------|-------|
| **Severity** | ~~Low~~ → **Resolved** |
| **Location** | `src/ast_cache.rs` — bounded `bincode::options()` calls |
| **Description** | `bincode` v1's `deserialize` could allocate large amounts of memory if a crafted input specified large `Vec` or `String` lengths. |
| **Mitigation applied** | All deserialization uses `bincode::options().with_limit(20_971_520)` (20 MiB cap). Payloads exceeding this limit cause a deserialization error, which is treated as a cache miss and the corrupt file is removed. |

### 2.3 Mutex `unwrap()` on Lock

| Field | Value |
|-------|-------|
| **Severity** | Low |
| **Location** | `src/ast_cache.rs` — 4 calls; `src/incremental_parse.rs` — 2 calls to `.lock().unwrap()` |
| **Description** | If a thread panics while holding a cache mutex (`AstCache` or `TreeCache`), the mutex becomes poisoned and subsequent `unwrap()` calls will panic. |
| **Impact** | Low — workload is CPU-bound parsing with structured error handling. Thread panics during cache access are unlikely. |
| **Mitigation** | Graceful recovery via `.lock().unwrap_or_else(\|e\| e.into_inner())` is planned for both caches. |

### 2.4 Repository Path — **MITIGATED**

| Field | Value |
|-------|-------|
| **Severity** | ~~Informational~~ → **Resolved** |
| **Location** | `src/main.rs` — path canonicalization |
| **Description** | `repo_path` was accepted as a raw CLI string without canonicalization. |
| **Mitigation applied** | The path is now canonicalized via `std::fs::canonicalize()` before use. On Windows, the `\\?\` UNC prefix is stripped. Cache is stored externally under a `blake3(canonical_path)` hash, preventing path spoofing and repository contamination. |

### 2.5 Silent Parse Failure — Informational

| Field | Value |
|-------|-------|
| **Severity** | Informational |
| **Location** | `src/main.rs` — `parse_or_cached_with_tree()` |
| **Description** | When `ast_builder::parse_content` returns `Err`, the error is silently discarded and the file is skipped. |
| **Impact** | No security impact. May confuse users if files are silently skipped. |

### 2.6 Incremental Parsing TreeCache — Informational

| Field | Value |
|-------|-------|
| **Severity** | Informational |
| **Location** | `src/incremental_parse.rs` — `TreeCache` |
| **Description** | The `TreeCache` stores tree-sitter `Tree` objects in a `Mutex<LruCache<String, Tree>>` (capacity 128). These trees are kept **only in process memory** and are never serialised to disk. |
| **Security properties** | (1) No disk persistence — trees exist only during program execution; (2) No deserialization surface — trees are computed via `tree-sitter::Parser`, not loaded from external storage; (3) Mutex-protected — concurrent access is serialised; (4) Bounded capacity — LRU eviction at 128 entries prevents unbounded memory growth; (5) Edit computation is pure arithmetic — `compute_edit()` performs common-prefix/suffix byte comparison with no I/O or allocations beyond a single `InputEdit` struct. |
| **Impact** | No security impact. The TreeCache introduces no new file I/O, no new environment variable access, and no new attack surface. |

---

## 3. Dependency Security Assessment

| Crate | Version | Risk | Notes |
|-------|---------|------|-------|
| `clap` | =4.5.60 | Low | Widely audited CLI parser; **version pinned** |
| `git2` | =0.19.0 | Low | Rust bindings for libgit2 (C library); mature; **pinned** |
| `tree-sitter` | =0.25.10 | Low | Parsing framework with C runtime; well-tested; **pinned** |
| `tree-sitter-*` | pinned | Low | Language grammars (generated C parsers); **pinned** |
| `blake3` | =1.8.3 | Low | Audited cryptographic hash, SIMD-optimised; **pinned** |
| `serde` | =1.0.228 | Low | De facto standard serialization; **pinned** |
| `serde_json` | =1.0.149 | Low | Standard JSON; **pinned** |
| `bincode` | =1.3.3 | Low | Bounded deserialization with `with_limit()`; **pinned** |
| `anyhow` | =1.0.102 | Low | Error handling; **pinned** |
| `colored` | =2.2.0 | Low | Terminal coloring, no security surface; **pinned** |
| `rayon` | =1.11.0 | Low | Well-maintained parallelism; **pinned** |
| `lru` | =0.12.5 | Low | Simple LRU cache; **pinned** |
| `bumpalo` | =3.20.2 | Low | Arena allocator, safe API only; **pinned** |

**Supply chain hardening:**

-   All dependency versions are **exactly pinned** (`=x.y.z`) in `Cargo.toml`
-   `unsafe_code = "deny"` enforced via `[lints.rust]` in `Cargo.toml`
-   `cargo-deny` configuration (`deny.toml`) checks advisories, licenses,
    bans, and sources
-   Run `cargo deny check` and `cargo audit` locally before publishing

**Key observations:**

-   **Zero networking crates** — no `reqwest`, `hyper`, `http`, `curl`,
    `openssl`, `rustls`, or any TLS dependency
-   **Native code surface** comes only from `git2` (libgit2), `tree-sitter`
    (C runtime), and grammar crates (generated C parsers)
-   All crate versions are current with no known CVEs at time of audit

---

## 4. File System Access Map

| Operation | File | Scope |
|-----------|------|-------|
| `Repository::open()` | `src/git_layer.rs` | Canonicalized repo path (read only) |
| `fs::canonicalize()` | `src/main.rs` | User-specified repo path → canonical |
| `fs::create_dir_all()` | `src/ast_cache.rs` | `$XDG_CACHE_HOME/symtrace/<hash>/` only |
| `fs::read()` | `src/ast_cache.rs` | Cache `.bin` files only (bounded to 20 MiB) |
| `fs::write()` | `src/ast_cache.rs` | Cache `.bin` files only |
| `fs::read_dir()` | `src/ast_cache.rs` | Cache directory listing (for stats) |
| `fs::remove_file()` | `src/ast_cache.rs` | Stale/corrupt cache files only |
| `std::env::var()` | `src/main.rs` | `XDG_CACHE_HOME`, `LOCALAPPDATA`, `HOME`, `USERPROFILE` |

**No directory traversal vulnerabilities** — all cache paths are constructed
from `git2::Oid` hex strings (40-char `[0-9a-f]` only). Cache is stored
**outside** the repository tree, preventing accidental commits.

---

## 5. Information Leakage Assessment

| Channel | Content | Classification |
|---------|---------|----------------|
| stdout | Diff report (file paths, function names, line numbers, similarity scores) | Expected output |
| stderr | Cache stats, performance metrics | Metadata only |
| Disk cache | Serialised ASTs (includes leaf source text) | Stored in user cache dir |
| JSON output | Repository path, commit hashes | Expected output |

**No unexpected information leakage.** The tool does not output credentials,
environment variables, or user PII.

---

## 6. Reporting Vulnerabilities

If you discover a security issue, please report it by opening an issue
or contacting the maintainer directly. Please include:

1.  Description of the vulnerability
2.  Steps to reproduce
3.  Potential impact assessment

---

## 7. Secure Usage Recommendations

1.  **Keep dependencies updated** — run `cargo update` periodically;
    exact-pinned versions require deliberate updates
2.  **Run security checks** — use `cargo audit` and `cargo deny check`
    (configuration in `deny.toml`)
3.  **Review cache permissions** — on shared systems, verify that
    the cache directory is not world-readable
4.  **Delete cache when needed** — the cache is stored outside the repo
    under `$XDG_CACHE_HOME/symtrace/`; delete it freely
5.  **Use on trusted repositories only** — tree-sitter parses source code
    via C grammars; parser resource guardrails (file size, node count,
    recursion depth, and timeout limits) mitigate pathological inputs
6.  **Configure resource limits** — use `--max-file-size`,
    `--max-ast-nodes`, `--max-recursion-depth`, and `--parse-timeout-ms`
    CLI flags to adjust guardrails for your workload
7.  **Disable incremental parsing if needed** — use `--no-incremental`
    to force full re-parsing of every file; useful for auditing hash
    correctness or when memory is constrained
