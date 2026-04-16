# Mode: triage — Haiku fast-scoring over prefiltered JDs

Run low-cost Claude Haiku 4.5 lite scoring against a set of JD artifacts. Triage is the cost boundary: everything before it (scan → filter → extract → prefilter → candidate-pack) is zero-token and deterministic; triage is the first stage that spends tokens, so it's gated by this slash command.

## When to use

- After `/career-ops scan` has produced `data/prefilter/kept.json` (typically a few hundred to a few thousand JD artifacts).
- Before `/career-ops shortlist` and `/career-ops customize` — triage results drive the shortlist.

## Prerequisites

- `data/prefilter/kept.json` — from the prefilter stage.
- `data/candidate-pack.json` — from the candidate-pack stage.
- `batch/triage-prompt.md` — the triage system prompt (includes must-have / deal-breaker fast paths).

## What this mode does

1. Read user's approval threshold and the candidate pack.
2. Tell the user how many jobs will be triaged and the estimated cost (Haiku at ~$0.80 per 1M input tokens; 1000 jobs ≈ $0.70 total at chunk-size 12).
3. Wait for explicit user approval.
4. Run:

   ```bash
   node triage-lite.mjs --jobs data/prefilter/kept.json
   ```

5. Summarize bucket distribution (`strong_include` / `include` / `borderline` / `exclude`) and top 10 scoring jobs.
6. Report JSON parse failures separately — Haiku occasionally returns malformed JSON for 5–15% of chunks. Offer a `--force` retry pass on failures only.

## Flags you may need

| Flag | Purpose |
|---|---|
| `--jobs PATH` | Override default input (default: `jds/normalized/`). Prefer `data/prefilter/kept.json` when coming from the scan pipeline. |
| `--chunk-size N` | Jobs per Claude call (default 12). Lower if hitting rate limits. |
| `--parallel N` | Concurrent workers (default: half of CPU cores, clamped 2–6). |
| `--model ID` | Override model. Default is `claude-haiku-4-5-20251001`. Use Sonnet for a stricter re-triage if the user wants to confirm borderline results. |
| `--force` | Re-run jobs even if cached results exist — use sparingly, costs tokens. |
| `--dry-run` | Preview which jobs would be scored without calling Claude. |

## Output

- `data/triage/results.json` — full scored set with score, bucket, classification, top strengths/concerns, rationale.
- `data/triage/results.tsv` — human-readable summary.
- `data/triage/items/{id}.json` — per-job cache (reused on next run unless `--force`).
- `data/triage/failures.tsv` — JD files whose workers failed to parse JSON.

## After triage

Point the user at `/career-ops shortlist` next — it promotes triage results into a per-user-approval shortlist consumed by `/career-ops customize`.
