# Changelog

## 1.0.0 (2026-04-17)


### Features

* adapt contacto mode by contact type (recruiter/HM/peer/interviewer) ([9fd5a90](https://github.com/traviswye/opt-career-ops/commit/9fd5a90896f20020f48455cd079b64fed491b89f))
* add --min-score flag to batch runner ([#249](https://github.com/traviswye/opt-career-ops/issues/249)) ([cb0c7f7](https://github.com/traviswye/opt-career-ops/commit/cb0c7f7d7d3b9f3f1c3dc75ccac0a08d2737c01e))
* add Block G — posting legitimacy assessment ([3a636ac](https://github.com/traviswye/opt-career-ops/commit/3a636ac586659bb798ef46a0a9798478a1e28b0a))
* add follow-up cadence tracker mode ([4308c37](https://github.com/traviswye/opt-career-ops/commit/4308c375033c6df430308235f4324658a8353b81))
* add GitHub Actions CI + auto-labeler + welcome bot + /run skill ([2ddf22a](https://github.com/traviswye/opt-career-ops/commit/2ddf22a6a2731b38bcaed5786c4855c4ab9fe722))
* add Nix flake devshell with Playwright support ([c579fcd](https://github.com/traviswye/opt-career-ops/commit/c579fcddebf793f00cfad8534fd74085c09017fb))
* add OpenCode slash commands for career-ops ([#67](https://github.com/traviswye/opt-career-ops/issues/67)) ([93caaed](https://github.com/traviswye/opt-career-ops/commit/93caaed49cbc9f3214f9beb66fb2281c3f2370e6))
* add scan.mjs — zero-token portal scanner ([8c19b2b](https://github.com/traviswye/opt-career-ops/commit/8c19b2b59f7087689e004f3d48e912f291911373))
* **dashboard:** add Catppuccin Latte light theme with auto-detection ([ff686c8](https://github.com/traviswye/opt-career-ops/commit/ff686c8af97a7bf93565fe8eeac677f998cc9ece))
* **dashboard:** add manual refresh shortcut ([#246](https://github.com/traviswye/opt-career-ops/issues/246)) ([4b5093a](https://github.com/traviswye/opt-career-ops/commit/4b5093a8ef1733c449ec0821f722f996625fcb84))
* **dashboard:** add progress analytics screen ([623c837](https://github.com/traviswye/opt-career-ops/commit/623c837bf3155fd5b7413554240071d40585dd7e))
* **dashboard:** add vim motions to pipeline screen ([#262](https://github.com/traviswye/opt-career-ops/issues/262)) ([d149e54](https://github.com/traviswye/opt-career-ops/commit/d149e541402db0c88161a71c73899cd1836a1b2d))
* **dashboard:** aligned tables and markdown syntax rendering in viewer ([dbd1d3f](https://github.com/traviswye/opt-career-ops/commit/dbd1d3f7177358d0384d6e661d1b0dfc1f60bd4e))
* **eval:** gate Block F interview plan on score &gt;= 4.0 ([b66ec4f](https://github.com/traviswye/opt-career-ops/commit/b66ec4f6e995d1303ac595c1f12c667f60afb6bc))
* expand portals.example.yml with 8 dev-tools companies + 23 search queries ([#140](https://github.com/traviswye/opt-career-ops/issues/140)) ([b7f555d](https://github.com/traviswye/opt-career-ops/commit/b7f555d7b9a7b23c875fa0d35584df534961dabe))
* **i18n:** add Japanese README + language modes for Japan market ([20a2c81](https://github.com/traviswye/opt-career-ops/commit/20a2c817486968ca42a534aa86838c797d599c10))
* **modes:** split _shared/_eval, focused pdf prompt, template updates ([18c6ebf](https://github.com/traviswye/opt-career-ops/commit/18c6ebfd5306d159c5a7991e32ff2d66014d5364))
* scan→triage→customize pipeline + shared location-match lib + deterministic pdf renderer ([a2e419a](https://github.com/traviswye/opt-career-ops/commit/a2e419a15d56e8f3e86f91281647e76b6547f63b))
* **skill:** slash-command parity for scan/triage/shortlist/customize ([74dbfde](https://github.com/traviswye/opt-career-ops/commit/74dbfdeb013efb7673e56d6883cc5e17001b2a3d))


### Bug Fixes

* 10 bug fixes — resource leaks, command injection, Unicode, navigation ([cb01a2c](https://github.com/traviswye/opt-career-ops/commit/cb01a2c2e3b7fc334b1c4594749ea40b0da8fc62))
* add data/ fallback to UpdateApplicationStatus ([#55](https://github.com/traviswye/opt-career-ops/issues/55)) ([3512b8e](https://github.com/traviswye/opt-career-ops/commit/3512b8ef4eb8ca967bc967664f8798af42b58a52))
* add stopword filtering and overlap ratio to roleMatch ([#248](https://github.com/traviswye/opt-career-ops/issues/248)) ([4da772d](https://github.com/traviswye/opt-career-ops/commit/4da772d3a4996bc9ecbe2d384d1e9d2ed75b9819))
* align portals.example.yml indentation for new companies ([26a6751](https://github.com/traviswye/opt-career-ops/commit/26a675173e64dac09fd1524ff9a7c7061520e057))
* **ci:** use pull_request_target for labeler on fork PRs ([#260](https://github.com/traviswye/opt-career-ops/issues/260)) ([2ecf572](https://github.com/traviswye/opt-career-ops/commit/2ecf57206c2eb6e35e2a843d6b8365f7a04c53d6))
* correct _shared.md → _profile.md reference in CUSTOMIZATION.md (closes [#137](https://github.com/traviswye/opt-career-ops/issues/137)) ([a91e264](https://github.com/traviswye/opt-career-ops/commit/a91e264b6ea047a76d8c033aa564fe01b8f9c1d9))
* correct dashboard launch path in docs ([#80](https://github.com/traviswye/opt-career-ops/issues/80)) ([2b969ee](https://github.com/traviswye/opt-career-ops/commit/2b969eea5f6bbc8f29b9e42bedb59312379e9f02))
* ensure data/ and output/ dirs exist before writing in scripts ([#261](https://github.com/traviswye/opt-career-ops/issues/261)) ([4b834f6](https://github.com/traviswye/opt-career-ops/commit/4b834f6f7f8f1b647a6bf76e43b017dcbe9cd52f))
* filter expired WebSearch links before they reach the pipeline ([#57](https://github.com/traviswye/opt-career-ops/issues/57)) ([ce1c5a3](https://github.com/traviswye/opt-career-ops/commit/ce1c5a3c7eea6ebce2c90aebba59d6e26b790d3f))
* improve default PDF readability ([#85](https://github.com/traviswye/opt-career-ops/issues/85)) ([10034ec](https://github.com/traviswye/opt-career-ops/commit/10034ec3304c1c79ff9c9678c7826ab77c0bcbf7))
* liveness checks ignore nav/footer Apply text, expired signals win ([3a3cb95](https://github.com/traviswye/opt-career-ops/commit/3a3cb95bdf09235509df72e30b3077623f571ea1))
* replace grep -P with POSIX-compatible grep in batch-runner.sh ([637b39e](https://github.com/traviswye/opt-career-ops/commit/637b39e383d1174c8287f42e9534e9e3cdfabb19))
* test-all.mjs scans only git-tracked files, avoids false positives ([47c9f98](https://github.com/traviswye/opt-career-ops/commit/47c9f984d8ddc70974f15c99b081667b73f1bb9a))
* use candidate name from profile.yml in PDF filename ([7bcbc08](https://github.com/traviswye/opt-career-ops/commit/7bcbc08ca6184362398690234e49df0ac157567f))
* use execFileSync to prevent shell injection in test-all.mjs ([c99d5a6](https://github.com/traviswye/opt-career-ops/commit/c99d5a6526f923b56c3790b79b0349f402fa00e2))
* use fileURLToPath for cross platform compatible paths in tracker scripts ([#32](https://github.com/traviswye/opt-career-ops/issues/32)) ([#58](https://github.com/traviswye/opt-career-ops/issues/58)) ([ab77510](https://github.com/traviswye/opt-career-ops/commit/ab775102f4586ae4663a593b519927531be27122))
* use hi@santifer.io in English README ([5518d3d](https://github.com/traviswye/opt-career-ops/commit/5518d3dd07716137b97bb4d8c7b5264b94e2b9e9))


### Performance Improvements

* compress hero banner from 5.7MB to 671KB ([dac4259](https://github.com/traviswye/opt-career-ops/commit/dac425913620fe0a66916dda7ba8d8fc4c427d51))

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

- End-to-end cost per tailored CV: ~$0.60/run on upstream's single-model monolithic prompt (measured on Opus 4.6; would be lower on Sonnet but still single-model-for-every-stage) → ~$0.05/run on this fork's Haiku + Sonnet staged pipeline.
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
