# batch/legacy — archive of the pre-split batch pipeline

This directory holds the monolithic batch worker that shipped before the
2026-04 split into phase-1 (eval) and phase-2 (pdf). Kept for A/B testing
and reference, not for active use.

## What's here

| File | Original location | Purpose |
|---|---|---|
| `full-customize.mjs` | project root | Monolithic orchestrator — one `claude -p` spawn per job, did eval + PDF + tracker in a single call |
| `batch-prompt.md` | `batch/batch-prompt.md` | 379-line self-contained system prompt that drove the monolithic worker |

## Why it was replaced

1. **Cost.** The monolithic prompt was bloated (~3,500 input tokens per call,
   inlined what's now in `modes/_shared.md` + `modes/_eval.md` + `modes/pdf.md`).
   Running it on Opus 4.6 was ~$0.60–1.00 per job. The new split runs on
   Sonnet 4.6 with thinking mode and costs ~$0.05–0.08 per job — a ~12×
   reduction.

2. **Model leverage.** One big call can't use different models for different
   phases. The split lets us run eval on Sonnet+thinking (judgment-heavy) and
   pdf on plain Sonnet (structured generation), or escalate either phase to
   Opus via `--eval-model` / `--pdf-model` flags when a specific run warrants
   it.

3. **Skip-threshold.** The old worker always generated a PDF, even for jobs
   that scored 2.8/5. The new orchestrator skips PDF generation when the eval
   score is below `--pdf-threshold` (default 4.0), cutting cost further on
   realistic batches where ~40% of jobs fall below the APPLY floor.

4. **Deterministic rendering.** The old worker had the LLM emit HTML from
   scratch each time, which was expensive and non-reproducible. The new split
   has the LLM emit a tailored JSON that a deterministic local renderer
   (`render-cv.mjs`) consumes. Same JSON always produces the same PDF.

5. **Keyword sidecar.** The old worker re-extracted keywords in both the
   eval phase and the PDF phase. The new orchestrator extracts them once in
   eval (writing them to both the report `.md` and a `reports/{num}-{slug}-keywords.json`
   sidecar) and the pdf phase consumes them as a stable reference. This
   makes the coverage lint meaningful instead of LLM-self-scored.

6. **ATS linting.** The new pipeline has a post-generation lint that reports
   page count, char budget, keyword coverage, hard gaps, and cliché phrases.
   The old worker had none of this — it just generated and shipped.

## How to revert to the legacy path (emergency only)

```bash
cp batch/legacy/full-customize.mjs full-customize.mjs
cp batch/legacy/batch-prompt.md batch/batch-prompt.md
```

Then run the old way:
```bash
node full-customize.mjs --from data/triage/shortlist.json --top 10 --approve
```

The legacy path does NOT know about `--pdf-threshold`, `--eval-model`,
`--pdf-model`, `--skip-pdf`, or `--force-pdf`. It will run everything on
whatever your `claude` CLI default model is, always generate a PDF, and
write HTML directly.

## A/B testing

The legacy files here are runnable as-is for head-to-head comparisons.
Suggested pattern:
1. Copy both legacy files to their original locations temporarily
2. Run one shortlist through the legacy path
3. Restore the new files, run the same shortlist through the new path
4. Diff the reports, PDFs, and per-job token counts

Don't edit the files in this directory — treat them as a snapshot.
