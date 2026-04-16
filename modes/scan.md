# Mode: scan — Zero-token discovery pipeline (portals → prefilter → candidate-pack)

Run the full zero-token offer-discovery chain: hit configured ATS APIs, filter by title and location, extract the JD body, apply the strict prefilter, and build a fresh candidate pack. Output is ready for `/career-ops triage`.

## When to use

- Recurring runs to catch newly-posted offers.
- Fresh machine setup: first-time population of `jds/normalized/` from configured portals.
- After portal config changes: `portals.yml` updated, `profile.yml` keywords changed, or prefilter policy re-tuned.

## Prerequisites

- `portals.yml` (copy from `templates/portals.example.yml` if missing).
- `config/profile.yml` filled in (candidate location, role keywords, must-have / deal-breakers).
- `cv.md` populated so candidate-pack has something to reason about.

## What this mode does

Stages, in order:

1. **`build-prefilter-policy.mjs`** — derives deterministic prefilter rules from `profile.yml` into `data/prefilter-policy.json`.
2. **`scan-local.mjs`** — hits Greenhouse, Ashby, Lever (and any custom ATS endpoints in `portals.yml`) and writes raw listings to `data/scan-results.json`. Parallel HTTP, zero LLM.
3. **`scan-filter.mjs`** — filters listings by title keywords, seniority, and metadata-level location. Uses the shared `lib/location-match.mjs`. Writes `data/scan-filter/candidates.json` + `data/scan-filter/summary.tsv`.
4. **`extract-jd.mjs --parallel N`** — parallel Playwright + ATS-API body extraction. Writes normalized JD artifacts to `jds/normalized/{id}.json`. Default `--parallel 4`. Each artifact contains metadata + body text + content markdown path.
5. **`prefilter-jobs.mjs`** — tiered location + modality policy. Filters artifacts into `data/prefilter/kept.json` (pass) and `data/prefilter/rejected.json` (with reasons).
6. **`candidate-pack.mjs`** — builds `data/candidate-pack.json` (compact profile + CV + digest signals). Consumed by triage and customize.

All stages are zero-token and idempotent — re-running is safe.

## Invocation

Single-shot orchestration:

```bash
node run-pipeline.mjs
```

Flags:

| Flag | Purpose |
|---|---|
| `--skip-scan` | Skip stage 2 (use existing `scan-results.json`). |
| `--from-extract` | Start from stage 4 (re-extract existing candidates). |
| `--from-prefilter` | Start from stage 5 (re-run prefilter only). |
| `--parallel N` | Extraction worker count (default 4). |
| `--dry-run` | Print what would run without executing. |

For targeted re-runs (e.g. after tuning prefilter policy), use the `--from-*` flags to skip expensive earlier stages.

## Output

| File | Purpose |
|---|---|
| `data/scan-history.tsv` | Append-only log of seen postings (dedup across runs). |
| `data/scan-results.json` | Raw portal listings. |
| `data/scan-filter/candidates.json` | Passed metadata-level filtering. |
| `jds/normalized/{id}.json` | Per-JD normalized artifact with body text. |
| `data/prefilter/kept.json` | Passed all location + title policy checks. Ready for triage. |
| `data/prefilter/rejected.json` | Rejected with reasons (useful for policy tuning). |
| `data/candidate-pack.json` | Fresh candidate pack for triage/customize. |

## After scan

Tell the user how many jobs are in `data/prefilter/kept.json` and prompt them to run `/career-ops triage` to spend the first tokens.

## Subagent delegation

Scan can be long-running (portal HTTP + Playwright). If the user wants to keep the main context clean, launch as a subagent with `run_in_background=true`:

```
Agent(
  subagent_type="general-purpose",
  prompt="[content of modes/_shared.md]\n\n[content of modes/scan.md]\n\nRun the full pipeline end-to-end and report the final kept count and any stage failures.",
  description="career-ops scan (background)",
  run_in_background=True
)
```
