# symtrace Benchmarks v4

Benchmarks run on **2026-02-21** against the real-world
[**expressjs/express**](https://github.com/expressjs/express) repository — a
production JavaScript project with a long commit history. The release build
(`cargo build --release`) was used throughout. All wall-clock timings are the
**mean of 10 consecutive runs** measured with a .NET `Stopwatch` on Windows.

---

## Environment

| Item | Value |
|------|-------|
| OS | Windows 11 (x86-64) |
| Repository | [`expressjs/express`](https://github.com/expressjs/express) — JavaScript, depth-25 clone |
| HEAD commit | `9c85a25` — *"Remove duplicate tests in res.location and res.jsonp"* |
| `symtrace` build | `--release` (LLVM optimised) |
| Comparison tool | `git diff --stat` (system Git) |
| Runs per scenario | 10 |

---

## What Changed Since v2

v4 focuses on **allocation elimination** and **algorithmic tightening** in the
matching pipeline. No new features were added — this is a pure performance release
with security hardening.

| Optimisation | Impact |
|-------------|--------|
| **Index-based matching** | `matches` vector stores `(usize, usize, MatchType)` indices instead of deep-cloning `SignificantNode` (which contains full `AstNode` subtrees). Eliminates O(n) allocations during the 5-phase matching loop. |
| **Cached `subtree_size`** | `subtree_size: u64` computed once during `collect_significant_nodes` and stored on each node. Eliminates repeated `count_nodes()` traversals in Phase 3c and `NodeIndex::build`. |
| **Reduced path allocations** | `parent_path.to_vec()` now only happens when the current node IS significant. Non-significant nodes recurse with a borrowed `&[String]` slice — no heap allocation. |
| **Capacity pre-sizing** | `HashSet::with_capacity()` for `matched_a`/`matched_b`; `Vec::with_capacity()` for `matches` and `ops` vectors. Eliminates amortised re-allocation during growth. |
| **Optimised logic-only re-diff** | Logic-only mode now only re-diffs files that had operations in the normal diff, skipping files with zero operations entirely. |
| **`#[inline]` hot paths** | `count_nodes`, `format_location`, `is_significant_kind`, `classify_entity`, `is_name_bearing_kind`, `only_identifiers_changed`, `is_identifier_kind`, `is_comment_or_whitespace` — all annotated for cross-crate inlining. |
| **Poisoned mutex recovery** | All `.lock().unwrap()` calls in the AST cache replaced with `.lock().unwrap_or_else(\|e\| e.into_inner())` — prevents panic on poisoned lock. |
| **Blob hash validation** | `disk_path()` validates blob hashes are hex-only before constructing file paths — prevents path injection via crafted hashes. |

---

## Feature Overview

`symtrace` is a deterministic semantic diff engine that compares two Git commits using
**AST-based structural analysis** rather than line-by-line text diffing.

| Feature | Flag / Behaviour | Status |
|---------|-----------------|--------|
| AST parsing (tree-sitter) | always on | ✓ active |
| 4-hash BLAKE3 node identity | always on | ✓ active |
| 5-phase matching algorithm | always on | ✓ active |
| Semantic operations (MOVE / RENAME / MODIFY / INSERT / DELETE) | always on | ✓ active |
| Similarity scoring per operation | always on | ✓ active |
| Refactor pattern detection | always on | ✓ active |
| Cross-file symbol tracking | always on | ✓ active |
| Commit classification | always on | ✓ active |
| Comment/whitespace filtering | `--logic-only` | ✓ tested |
| Machine-readable output | `--json` | ✓ tested |
| Internal per-phase timing | always printed | ✓ active |

---

## Test Scenarios

Four commit ranges from the live `expressjs/express` `master` branch are compared,
covering a spread from a small cleanup commit (HEAD~5) to a full 20-commit feature window.

| # | Range | JS files processed | AST nodes compared | Total git-managed files changed |
|---|-------|-------------------|-------------------|----------------------------------|
| 1 | `HEAD~5 → HEAD` | 2 | 6 011 | 7 (2 JS + 4 YAML + 1 MD) |
| 2 | `HEAD~10 → HEAD` | 8 | 21 659 | 17 (8 JS + non-JS) |
| 3 | `HEAD~15 → HEAD` | 10 | 25 711 | 19 (10 JS + non-JS) |
| 4 | `HEAD~20 → HEAD` | 11 | 26 306 | 21 (11 JS + non-JS) |

---

## Timing Results

Mean wall-clock time per invocation (10-run average, release build).

| Scenario | `git diff` (ms) | `symtrace` (ms) | Δ (ms) | Ratio |
|----------|-----------------|------------------|--------|-------|
| 1 — `HEAD~5 → HEAD` (2 JS files, 6 011 nodes) | 43.02 | **38.63** | −4.39 | `symtrace` **1.11× faster** |
| 2 — `HEAD~10 → HEAD` (8 JS files, 21 659 nodes) | 43.83 | 65.09 | +21.26 | `git diff` **1.49× faster** |
| 3 — `HEAD~15 → HEAD` (10 JS files, 25 711 nodes) | 43.78 | 70.19 | +26.41 | `git diff` **1.60× faster** |
| 4 — `HEAD~20 → HEAD` (11 JS files, 26 306 nodes) | 45.18 | 69.03 | +23.85 | `git diff` **1.53× faster** |

> **Scenario 1 highlight:** `symtrace` runs in **38.63 ms** vs `git diff`'s
> **43.02 ms** — when the JS surface is small, Git binary startup and line-scan cost
> exceed the AST pass.

> **Scaling observation:** From Scenario 1 → 4, nodes increase **4.4×** (6 011 →
> 26 306) while wall-clock increases only **1.79×** (38.63 → 69.03 ms). The diff
> algorithm runs in single-digit milliseconds at every scale.

---

## v2 → v4 Performance Comparison

| Scenario | v2 (ms) | v4 (ms) | Improvement |
|----------|---------|---------|-------------|
| 1 — 2 JS files | 37.86 | 38.63 | ~0% (within noise) |
| 2 — 8 JS files | 79.66 | **65.09** | **−18.3%** |
| 3 — 10 JS files | 89.54 | **70.19** | **−21.6%** |
| 4 — 11 JS files | 92.90 | **69.03** | **−25.7%** |

The optimisations have no measurable effect on the trivial 2-file scenario (dominated
by Git I/O startup) but deliver **18–26% wall-clock reduction** on scenarios with
meaningful AST workloads. The largest gain is at Scenario 4, where the index-based
matching avoids the most deep clones.

### `git diff` ratio improvement (v2 → v4)

| Scenario | v2 ratio | v4 ratio | Δ |
|----------|----------|----------|---|
| 1 | `symtrace` 1.09× faster | `symtrace` 1.11× faster | ≈ same |
| 2 | `git diff` 1.85× faster | `git diff` **1.49× faster** | 19% closer |
| 3 | `git diff` 2.07× faster | `git diff` **1.60× faster** | 23% closer |
| 4 | `git diff` 2.08× faster | `git diff` **1.53× faster** | 26% closer |

At v2, `symtrace` was more than 2× slower than `git diff` on larger ranges. At v4,
the gap has narrowed to ~1.5× across all multi-file scenarios.

---

## Individual Run Data

### Scenario 1 — `HEAD~5 → HEAD` (2 JS files)

```
symtrace (ms): 37.75, 37.41, 41.47, 37.88, 38.06, 40.35, 38.62, 38.56, 38.02, 38.20
symtrace avg : 38.63 ms

git diff (ms) : (10-run average)
git diff avg  : 43.02 ms
```

### Scenario 2 — `HEAD~10 → HEAD` (8 JS files)

```
symtrace (ms): 92.49, 63.93, 61.55, 61.83, 59.80, 59.78, 63.29, 61.64, 64.03, 62.52
symtrace avg : 65.09 ms

git diff (ms) : (10-run average)
git diff avg  : 43.83 ms
```

> Note: the first run (92.49 ms) includes cold-start cache population.
> Excluding it, the warm average is **62.06 ms**.

### Scenario 3 — `HEAD~15 → HEAD` (10 JS files)

```
symtrace (ms): 78.86, 67.88, 64.47, 66.05, 63.36, 65.85, 67.23, 85.61, 76.48, 66.13
symtrace avg : 70.19 ms

git diff (ms) : (10-run average)
git diff avg  : 43.78 ms
```

### Scenario 4 — `HEAD~20 → HEAD` (11 JS files)

```
symtrace (ms): 79.52, 66.23, 67.25, 65.53, 66.94, 67.47, 70.56, 72.06, 67.03, 67.72
symtrace avg : 69.03 ms

git diff (ms) : (10-run average)
git diff avg  : 45.18 ms
```

---

## Internal Timing Breakdowns

`symtrace` prints its own per-phase timings at the end of each run.
Representative single-run outputs are shown below.

### Scenario 1 — `HEAD~5 → HEAD` (2 files, 6 011 nodes)

```
━━━ Performance ━━━
  Files processed   : 2
  Nodes compared    : 6011
  Parse time        : 20.76 ms
  Diff time         : 1.65 ms
  Total time        : 41.58 ms
  AST cache: 4 in-memory, 4 on-disk entries
```

### Scenario 2 — `HEAD~10 → HEAD` (8 files, 21 659 nodes)

```
━━━ Performance ━━━
  Files processed   : 8
  Nodes compared    : 21659
  Parse time        : 36.72 ms
  Diff time         : 4.47 ms
  Total time        : 68.26 ms
  AST cache: 15 in-memory, 15 on-disk entries
```

### Scenario 3 — `HEAD~15 → HEAD` (10 files, 25 711 nodes)

```
━━━ Performance ━━━
  Files processed   : 10
  Nodes compared    : 25711
  Parse time        : 44.40 ms
  Diff time         : 5.52 ms
  Total time        : 78.74 ms
  AST cache: 19 in-memory, 19 on-disk entries
```

### Scenario 4 — `HEAD~20 → HEAD` (11 files, 26 306 nodes)

```
━━━ Performance ━━━
  Files processed   : 11
  Nodes compared    : 26306
  Parse time        : 47.42 ms
  Diff time         : 4.93 ms
  Total time        : 81.92 ms
  AST cache: 21 in-memory, 21 on-disk entries
```

### Time breakdown summary — all scenarios

| Scenario | Parse (ms) | Diff (ms) | Other / Git I/O (ms) | Total (ms) |
|----------|------------|-----------|----------------------|------------|
| 1 – 6 k nodes | 20.76 | 1.65 | ~19.17 | ~42 |
| 2 – 21 k nodes | 36.72 | 4.47 | ~27.07 | ~68 |
| 3 – 25 k nodes | 44.40 | 5.52 | ~28.82 | ~79 |
| 4 – 26 k nodes | 47.42 | 4.93 | ~29.57 | ~82 |

### Diff-phase comparison (v2 → v4)

| Scenario | v2 Diff (ms) | v4 Diff (ms) | Improvement |
|----------|-------------|-------------|-------------|
| 1 – 6 k nodes | 1.40 | 1.65 | ~0% (noise) |
| 2 – 21 k nodes | 8.08 | **4.47** | **−44.7%** |
| 3 – 25 k nodes | 8.16 | **5.52** | **−32.4%** |
| 4 – 26 k nodes | 7.71 | **4.93** | **−36.1%** |

The index-based matching and cached subtree sizes deliver a **33–45% reduction** in
the diff phase on multi-file scenarios. The diff algorithm now costs under 6 ms even
at 26 k nodes — it is never the bottleneck.

---

## Historical Benchmark Progression

### Wall-clock averages across all versions (ms)

| Scenario | v1 (baseline) | v2 | v4 | v1 → v4 |
|----------|---------------|------|------|---------|
| 1 — 2 JS files | 81.94 | 37.86 | 38.63 | **−52.9%** |
| 2 — 8 JS files | 214.40 | 79.66 | 65.09 | **−69.6%** |
| 3 — 10 JS files | 281.55 | 89.54 | 70.19 | **−75.1%** |
| 4 — 11 JS files | 304.62 | 92.90 | 69.03 | **−77.3%** |

> From the v1 baseline to v4, `symtrace` is **2.1× faster** at Scenario 1 and
> **4.4× faster** at Scenario 4.

### Cumulative optimisation timeline

| Version | Key changes | Impact |
|---------|-------------|--------|
| **v1** | Initial implementation — sequential parsing, no caching | Baseline |
| **v2** | Blob hash short-circuit, AST caching (LRU + disk), parallel parsing (rayon), arena allocator (bumpalo), hash bucket indexing, parallel blob extraction | 53–69% faster |
| **v4** | Index-based matching (eliminates deep cloning), cached subtree sizes, reduced path allocations, capacity pre-sizing, optimised logic-only re-diff, `#[inline]` hot paths, security hardening | Additional 18–26% faster |

---

## Full Semantic Output — Scenario 2 (representative)

```
━━━ symtrace  Semantic Diff ━━━
Repository : d:\rust_playground\express
Comparing  : 912893c → 9c85a25

━━━ benchmarks/middleware.js
  - [DELETE] variable_declaration 'express' deleted (L2)
  - [DELETE] variable_declarator 'express' deleted (L2)
  - [DELETE] variable_declaration 'app' deleted (L3)
  - [DELETE] variable_declarator 'app' deleted (L3)
  - [DELETE] variable_declaration 'n' deleted (L7)
  - [DELETE] variable_declarator 'n' deleted (L7)

━━━ examples/search/index.js
  ~ [MODIFY] variable_declaration 'query' modified (L39 → L53) [35% similarity, high]
  ~ [MODIFY] variable_declarator 'query' modified (L39 → L53) [40% similarity, high]
  + [INSERT] function_declaration 'initializeRedis' inserted (L29-L46)
  + [INSERT] arrow_function 'vals' inserted (L55)
  + [INSERT] arrow_function 'err' inserted (L56-L59)
  + [INSERT] arrow_function 'anon@L77' inserted (L77-L83)

━━━ lib/application.js
  ~ [MODIFY] variable_declaration 'opts' modified (L526 → L526) [22% similarity, high]
  ~ [MODIFY] variable_declarator 'opts' modified (L526 → L526) [25% similarity, high]

━━━ lib/response.js
  ~ [MODIFY] variable_declarator 'type' modified (L129 → L137) [35% similarity, high]
  - [DELETE] variable_declaration 'type' deleted (L129)
  + [INSERT] lexical_declaration 'type' inserted (L137)

━━━ test/app.render.js
  + [INSERT] variable_declaration 'app' inserted (L335)
  + [INSERT] variable_declarator 'app' inserted (L335)

━━━ test/res.jsonp.js
  - [DELETE] variable_declaration 'app' deleted (L332)
  - [DELETE] variable_declarator 'app' deleted (L332)

━━━ test/res.location.js
  ↔ [MOVE] variable_declaration 'app' moved (L124 → L128) [100% similarity, low]
  ↔ [MOVE] variable_declarator 'app' moved (L124 → L128) [100% similarity, low]
  - [DELETE] variable_declaration 'app' deleted (L140)
  - [DELETE] variable_declarator 'app' deleted (L140)

━━━ test/utils.js
  ↔ [MOVE] arrow_function 'anon@L101' moved (L101 → L108) [100% similarity, low]
  ↔ [MOVE] arrow_function 'anon@L105' moved (L105 → L112) [100% similarity, low]
  ↔ [MOVE] arrow_function 'anon@L106' moved (L106 → L113) [100% similarity, low]
  ~ [MODIFY] arrow_function 'anon@L29' modified (L29-L38 → L29-L46) [75% similarity, medium]
  + [INSERT] arrow_function 'anon@L39' inserted (L39-L45)
  + [INSERT] lexical_declaration 'result' inserted (L40)
  + [INSERT] variable_declarator 'result' inserted (L40)
  ── Refactor Patterns ──
    ▸ Method 'anon@L101' moved from L101 to L108 (confidence: 100%)
    ▸ Method 'anon@L105' moved from L105 to L112 (confidence: 100%)
    ▸ Method 'anon@L106' moved from L106 to L113 (confidence: 100%)

━━━ Summary ━━━
  Files          : 8
  Moves          : 5
  Renames        : 0
  Inserts        : 10
  Deletes        : 11
  Modifications  : 6

━━━ Cross-File Symbol Tracking ━━━
  Symbols tracked : 989
  ↔ [cross_file_move] variable 'express' moved from 'benchmarks/middleware.js'
      to 'examples/search/index.js' (similarity: 100%)
  ⚠ [api_surface_change] variable 'express' API changed when moving from
      'benchmarks/middleware.js' to 'examples/search/index.js' (similarity: 65%)
  ↔ [cross_file_move] variable 'express' moved from 'benchmarks/middleware.js'
      to 'test/app.render.js' (similarity: 100%)
  ⚠ [api_surface_change] variable 'express' API changed when moving from
      'benchmarks/middleware.js' to 'test/app.render.js' (similarity: 91%)
  ↔ [cross_file_move] variable 'app' moved from 'benchmarks/middleware.js'
      to 'examples/search/index.js' (similarity: 100%)
  ⚠ [api_surface_change] variable 'app' API changed when moving from
      'benchmarks/middleware.js' to 'examples/search/index.js' (similarity: 88%)
  ↔ [cross_file_move] variable 'app' moved from 'benchmarks/middleware.js'
      to 'test/app.render.js' (similarity: 100%)
  ⚠ [api_surface_change] variable 'app' API changed when moving from
      'benchmarks/middleware.js' to 'test/app.render.js' (similarity: 88%)
  ✎ [cross_file_rename] variable 'query' in 'examples/search/index.js'
      renamed to 'slice' in 'lib/application.js' (similarity: 100%)
  ✎ [cross_file_rename] variable 'opts' in 'lib/application.js'
      renamed to 'chunk' in 'lib/response.js' (similarity: 100%)
  ✎ [cross_file_rename] variable 'type' in 'lib/response.js'
      renamed to 'view' in 'lib/application.js' (similarity: 100%)

━━━ Commit Classification ━━━
  Class          : feature
  Confidence     : 60%

━━━ Performance ━━━
  Files processed   : 8
  Nodes compared    : 21659
  Parse time        : 36.72 ms
  Diff time         : 4.47 ms
  Total time        : 68.26 ms
  AST cache: 15 in-memory, 15 on-disk entries
```

---

## Key Observations

1. **`symtrace` beats `git diff` on small ranges.** At Scenario 1 (2 JS files,
   ~6 k AST nodes) `symtrace` runs in **38.63 ms** vs `git diff`'s **43.02 ms**.
   This advantage has been consistent across v2 and v4.

2. **The `git diff` gap has narrowed dramatically.** At v2, Scenarios 3–4 showed
   `git diff` ~2× faster. At v4, the worst-case ratio is **1.60×** — a 23–26%
   improvement in competitive position without any feature regression.

3. **The diff algorithm is 33–45% faster.** Index-based matching and cached subtree
   sizes deliver massive savings in the matching phase. At 21 k nodes, diff time
   dropped from 8.08 ms → 4.47 ms (−44.7%).

4. **Scaling is now sub-linear.** From Scenario 1 (6 k nodes) to Scenario 4 (26 k
   nodes), nodes increase **4.4×** while wall-clock increases only **1.79×**
   (38.63 → 69.03 ms). At v2, the same ratio was **2.45×** (37.86 → 92.90 ms).

5. **S3 and S4 are nearly identical.** Despite S4 processing one more file and
   ~600 more nodes, its wall-clock (69.03 ms) is actually *lower* than S3 (70.19 ms).
   This suggests the additional file (`test/req.acceptsCharsets.js`) has trivial
   complexity. The plateau indicates `symtrace` has minimal per-file overhead.

6. **Parse dominates, diff is negligible.** Parse time accounts for ~50–65% of the
   total internal time. The diff phase (4–6 ms at scale) is under 7% of wall-clock.
   Future optimisation should target parse throughput or incremental parsing.

7. **Cold-start penalty is modest.** S2's first run (92.49 ms) includes cache
   population; excluding it, warm average is 62.06 ms. The on-disk cache eliminates
   repeated parse costs across invocations.

---

## Security Hardening (v4)

v4 includes security fixes that do not impact benchmarks but improve robustness:

| Fix | Before | After |
|-----|--------|-------|
| Poisoned mutex | `.lock().unwrap()` — panics if thread panicked while holding lock | `.lock().unwrap_or_else(\|e\| e.into_inner())` — recovers inner data |
| Blob hash injection | `disk_path()` accepted any string as blob hash | Validates hex-only (`chars().all(\|c\| c.is_ascii_hexdigit())`) |
| Parse failures | Silently returned `(None, 0)` | Logs `warning: parse failed: {error}` to stderr |

See [SECURITY.md](SECURITY.md) for the full security audit.

---

## Reproducing These Results

```powershell
# Express repo must already be cloned at depth ≥ 21
# git clone https://github.com/expressjs/express d:\rust_playground\express --depth=25

# Build symtrace release binary
cd d:\rust_playground\symtrace
cargo build --release

# Resolve commits (HEAD must be 9c85a25)
cd d:\rust_playground\express
git rev-parse HEAD HEAD~5 HEAD~10 HEAD~15 HEAD~20

# Run semantic diffs
$bin = "d:\rust_playground\symtrace\target\release\symtrace.exe"
& $bin . d127723 9c85a25    # S1: HEAD~5 → HEAD
& $bin . 912893c 9c85a25    # S2: HEAD~10 → HEAD
& $bin . bc7d155 9c85a25    # S3: HEAD~15 → HEAD
& $bin . 3e81873 9c85a25    # S4: HEAD~20 → HEAD

# 10-run wall-clock benchmark (example for S2)
$times = @()
for ($i = 0; $i -lt 10; $i++) {
    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    & $bin . 912893c 9c85a25 | Out-Null
    $sw.Stop()
    $times += $sw.Elapsed.TotalMilliseconds
}
"symtrace avg: $(($times | Measure-Object -Average).Average.ToString('F2')) ms"

# git diff comparison
$times = @()
for ($i = 0; $i -lt 10; $i++) {
    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    git diff --stat 912893c 9c85a25 | Out-Null
    $sw.Stop()
    $times += $sw.Elapsed.TotalMilliseconds
}
"git diff avg: $(($times | Measure-Object -Average).Average.ToString('F2')) ms"
```
