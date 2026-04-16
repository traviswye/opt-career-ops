# Mode: shortlist — Promote triage results into a reviewable shortlist

Shortlist is the consent boundary between triage and customize. Triage scores every prefiltered job; shortlist is where the user picks which ones to spend the Sonnet eval+PDF budget on.

## When to use

- After `/career-ops triage` has produced `data/triage/results.json`.
- Before `/career-ops customize` — customize reads the shortlist as its input.

## Prerequisites

- `data/triage/results.json` — from the triage stage.

## What this mode does

1. Read `data/triage/results.json` and filter by score threshold (default: jobs with `bucket = strong_include` or `score >= 4.0`).
2. Present a ranked table with: rank, score, bucket, company, role, one-line rationale, liveness, and URL.
3. Offer to:
   - Accept the top N (default 10).
   - Trim by company (cap per company post-triage — content-aware, unlike the upstream scan-filter cap).
   - Reject specific ranks by number.
   - Re-view a specific report before promoting.
4. Run:

   ```bash
   node shortlist.mjs --from data/triage/results.json --top N --out data/triage/shortlist.json
   ```

5. For deeper interactive review before promoting:

   ```bash
   node review-shortlist.mjs --from data/triage/results.json
   ```

   (Walks the user one job at a time with full rationale, strengths, and concerns. Slower but catches surprises before spending tokens.)

## Flags you may need

| Flag | Purpose |
|---|---|
| `--top N` | Promote the top N by score. |
| `--min-score FLOAT` | Minimum score (default 4.0). |
| `--buckets LIST` | Comma-separated bucket names to include (default: `strong_include,include`). |
| `--max-per-company N` | Cap per company (post-triage, content-aware). |
| `--exclude-ids LIST` | Drop specific job IDs by ID. |

## Output

- `data/triage/shortlist.json` — promoted set with ranks, scores, and pointers back to JD artifacts and triage rationales.

## After shortlist

`/career-ops customize` runs the 2-phase eval+PDF orchestrator on the shortlist. This is where Sonnet tokens get spent, so the user should have reviewed the shortlist before proceeding.
