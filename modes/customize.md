# Mode: customize — 2-phase eval + PDF orchestrator

Runs the staged evaluation and CV tailoring pipeline on an approved shortlist. Each job gets a Sonnet-powered Phase 1 (evaluation A–G report) and, if the score clears a threshold, a Phase 2 (tailored CV PDF). This mode is where ~90% of the total token budget gets spent — it only runs on jobs the user has already reviewed via `/career-ops shortlist`.

## When to use

- After `/career-ops shortlist` has produced `data/triage/shortlist.json`.
- When you have a concrete list of jobs to apply to and want tailored outputs for each.

## Prerequisites

- `data/triage/shortlist.json` (or any compatible JSON with job entries + ids) — from the shortlist stage.
- `cv.md`, `config/profile.yml`, and optionally `article-digest.md`.
- `modes/_eval.md` + `modes/_shared.md` + `modes/oferta.md` load automatically in Phase 1. `modes/pdf.md` loads automatically in Phase 2.

## What this mode does

1. Read shortlist + per-job JD artifacts.
2. Confirm selection with the user and show estimated cost (Sonnet 4.6 with thinking: ~$0.05–$0.10 per job for Phase 1, ~$0.04 per job for Phase 2).
3. Wait for explicit approval (`--approve`).
4. Run:

   ```bash
   node full-customize.mjs \
     --from data/triage/shortlist.json \
     --top N \
     --approve
   ```

5. For each job:
   - Phase 1 (eval): Sonnet 4.6 + thinking writes `reports/{###}-{slug}-{date}.md` + a `{###}-{slug}-{date}-keywords.json` sidecar.
   - Threshold gate: if score < `--pdf-threshold` (default 4.0), Phase 2 is skipped.
   - Phase 2 (pdf): Sonnet 4.6 emits a tailoring JSON, `render-cv.mjs` fills the template deterministically and runs lint (coverage ≥ 80%, no clichés, page count within budget). On lint failure, retries once with feedback.
   - Tracker TSV written to `batch/tracker-additions/`.
6. Merge tracker: `node merge-tracker.mjs`.
7. Summarize: per-job scores, PDF status, any lint warnings.

## Flags you may need

### Selection
| Flag | Purpose |
|---|---|
| `--from PATH` | Input JSON (default `data/triage/shortlist.json`). Accepts triage results JSON too. |
| `--top N` | Promote top N by rank. |
| `--ranks LIST` | Comma-separated shortlist ranks to promote. |
| `--ids LIST` | Comma-separated job ids to promote. |

### Phase 1 — Eval
| Flag | Purpose |
|---|---|
| `--eval-model ID` | Default `claude-sonnet-4-6`. |
| `--eval-thinking MODE` | `enabled` (default) / `adaptive` / `disabled`. |
| `--eval-effort LEVEL` | `low` / `medium` / `high` (default) / `max`. |

### Phase 2 — PDF
| Flag | Purpose |
|---|---|
| `--pdf-model ID` | Default `claude-sonnet-4-6`. |
| `--pdf-threshold FLOAT` | Minimum eval score to trigger Phase 2 (default 4.0). |
| `--force-pdf IDS` | Comma-separated job ids that always run Phase 2 regardless of threshold. |
| `--skip-pdf` | Never run Phase 2 — useful for reports-only runs. |

### Orchestration
| Flag | Purpose |
|---|---|
| `--parallel N` | Concurrent workers (default 1). Raise to 3–4 for larger shortlists. |
| `--approve` | Required — acts as a spend confirmation. |
| `--dry-run` | Preview selection without running. |

## Output

- `reports/{###}-{slug}-{date}.md` — evaluation reports.
- `reports/{###}-{slug}-{date}-keywords.json` — keyword sidecar per report.
- `output/cv-{candidate-slug}-{company-slug}-{role-slug}-{date}.pdf` — tailored CVs.
- `batch/tracker-additions/{###}-{slug}.tsv` — tracker rows (merged into `data/applications.md` via `merge-tracker.mjs`).
- `data/triage/promotion-manifest.json` — per-run manifest with phase timings, scores, lint metrics.

## Good practices

- Run `--skip-pdf` first on a large shortlist to cap spend at Phase-1-only, then spot-check reports before committing to full PDF generation.
- Use `--force-pdf` sparingly — the threshold exists for a reason.
- After a batch, inspect `promotion-manifest.json` to understand which jobs spent how much and which ones hit the retry path.
