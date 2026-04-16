# Changelog

## [2.0.0] — fork: staged discovery pipeline + deterministic CV renderer (2026-04-16)

Major refactor introducing a staged, cost-optimized scan → triage → customize pipeline alongside the existing single-JD auto-pipeline. Published as a fork of [santifer/career-ops](https://github.com/santifer/career-ops).

### Features

- **Staged discovery pipeline** — `/career-ops scan` orchestrates six zero-token stages (build-prefilter-policy → scan-local → scan-filter → extract-jd → prefilter-jobs → candidate-pack) with explicit consent boundaries before any token spend.
- **Shared location-matching library** — `lib/location-match.mjs` with tiered evidence extraction (metadata → header zone → phrase), foreign country/city pattern matching, ambiguous-abbreviation disambiguation, camelCase ATS-text normalization, and a strict work-model detector that rejects "distributed systems" and similar technical-phrase false positives.
- **Haiku triage (`/career-ops triage`)** — `triage-lite.mjs` with parallel Haiku 4.5 workers over prefiltered jobs, ~10× cheaper than the prior Opus-based triage.
- **Shortlist promotion (`/career-ops shortlist`)** — `shortlist.mjs` / `review-shortlist.mjs` let the user pick which jobs are worth spending Sonnet budget on before Phase 1 runs.
- **2-phase customize orchestrator (`/career-ops customize`)** — `full-customize.mjs` separates eval (Sonnet 4.6 + thinking) from PDF tailoring (Sonnet 4.6) with a score-based skip threshold on Phase 2, per-model/effort overrides, retry loop on lint failure, and a keyword sidecar handoff between phases.
- **Deterministic CV renderer** — `render-cv.mjs` consumes a JSON tailoring schema, fills the HTML template, normalizes Unicode for ATS, runs coverage (≥ 80% adjusted) / cliché / page-budget lint, and emits PDF — no LLM tokens spent on HTML generation.
- **Parallelized extraction** — `extract-jd.mjs --parallel N` (default 4). ~4× throughput vs prior sequential run (95 min → 25 min on a 2,400-job set).
- **`_shared.md` / `_eval.md` split** — evaluation-only rules (scoring, archetype detection, posting legitimacy Block G, comp rubric, gap double-counting prevention) moved out of the universal `_shared.md` so non-eval modes don't carry ~500 lines of irrelevant context.
- **Focused PDF mode** — `modes/pdf.md` rewritten as a JSON-schema emitter with explicit per-page char budget, 80% working-budget rule, hard_gaps declaration, verbatim keyword-form rule, ATS umbrella-term pairing table, and role_aliases-gated title matching (Summary-only).

### Architecture / cost

- End-to-end cost per tailored CV: ~$0.60/run (Opus monolith) → ~$0.05/run (Haiku + Sonnet staged).
- ATS quality on a held-out JD (JobScan): 50% → 62%.
- Full daily loop (2,400 raw listings → dozen tailored CVs): under $10/day.

### New slash commands

| Command | Maps to |
|---|---|
| `/career-ops scan` | `run-pipeline.mjs` |
| `/career-ops triage` | `triage-lite.mjs` |
| `/career-ops shortlist` | `shortlist.mjs` / `review-shortlist.mjs` |
| `/career-ops customize` | `full-customize.mjs` |

The `npm run <name>` aliases remain for CI / headless use.

### Repository hygiene

- `.gitignore` hardened for public release: `cv.md`, `article-digest.md`, `reports/*.json`, `data/prefilter-*/`, `batch/tmp/`, `tmp/`, `tmp-jd-*.txt`, `testpdfs/`, `interview-prep/*` (with template exception).
- `interview-prep/story-bank.md` → `story-bank.template.md` (follows the `_profile.template.md` pattern).

### Legacy preservation

- `batch/legacy/` archives the pre-split monolithic `full-customize.mjs` + `batch-prompt.md` for A/B reference per its README.

## [1.4.0](https://github.com/santifer/career-ops/compare/v1.3.0...v1.4.0) (2026-04-13)


### Features

* add GitHub Actions CI + auto-labeler + welcome bot + /run skill ([2ddf22a](https://github.com/santifer/career-ops/commit/2ddf22a6a2731b38bcaed5786c4855c4ab9fe722))
* **dashboard:** add Catppuccin Latte light theme with auto-detection ([ff686c8](https://github.com/santifer/career-ops/commit/ff686c8af97a7bf93565fe8eeac677f998cc9ece))
* **dashboard:** add progress analytics screen ([623c837](https://github.com/santifer/career-ops/commit/623c837bf3155fd5b7413554240071d40585dd7e))
* **dashboard:** add vim motions to pipeline screen ([#262](https://github.com/santifer/career-ops/issues/262)) ([d149e54](https://github.com/santifer/career-ops/commit/d149e541402db0c88161a71c73899cd1836a1b2d))
* **dashboard:** aligned tables and markdown syntax rendering in viewer ([dbd1d3f](https://github.com/santifer/career-ops/commit/dbd1d3f7177358d0384d6e661d1b0dfc1f60bd4e))


### Bug Fixes

* **ci:** use pull_request_target for labeler on fork PRs ([#260](https://github.com/santifer/career-ops/issues/260)) ([2ecf572](https://github.com/santifer/career-ops/commit/2ecf57206c2eb6e35e2a843d6b8365f7a04c53d6))
* correct _shared.md → _profile.md reference in CUSTOMIZATION.md (closes [#137](https://github.com/santifer/career-ops/issues/137)) ([a91e264](https://github.com/santifer/career-ops/commit/a91e264b6ea047a76d8c033aa564fe01b8f9c1d9))
* replace grep -P with POSIX-compatible grep in batch-runner.sh ([637b39e](https://github.com/santifer/career-ops/commit/637b39e383d1174c8287f42e9534e9e3cdfabb19))
* test-all.mjs scans only git-tracked files, avoids false positives ([47c9f98](https://github.com/santifer/career-ops/commit/47c9f984d8ddc70974f15c99b081667b73f1bb9a))
* use execFileSync to prevent shell injection in test-all.mjs ([c99d5a6](https://github.com/santifer/career-ops/commit/c99d5a6526f923b56c3790b79b0349f402fa00e2))
