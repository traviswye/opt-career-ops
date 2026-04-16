# Staged Pipeline

This document introduces the cost-efficient staged workflow for large job batches.

It is additive. The existing single-job full pipeline still works for one-off evaluations where the richer report/PDF path is desirable immediately.

## Why

The legacy batch path treats every job like a finalist:

1. Read shared candidate context again
2. Evaluate deeply
3. Write a full report
4. Generate a tailored PDF
5. Write tracker output

That is great for a single role, but too expensive for runs with 100+ job descriptions.

## New Flow

```text
scan -> prefilter-policy -> scan-filter -> extract -> prefilter -> candidate-pack -> triage -> shortlist -> full customize
```

## Commands

```bash
npm run scan
npm run prefilter-policy
npm run scan-filter -- --from data/pipeline.md --policy data/prefilter-policy.json
npm run extract -- --from data/scan-filter/kept.md
npm run prefilter -- --jobs jds/normalized/index.json --policy data/prefilter-policy.json
npm run candidate-pack
npm run triage -- --jobs data/prefilter/kept.json --pack data/candidate-pack.json
npm run shortlist -- --from data/triage/results.json --top 25
npm run review-shortlist -- --from data/triage/results.json --limit 25
npm run full-customize -- --from data/triage/results.json --top 10
npm run full-customize -- --from data/triage/results.json --top 10 --approve
```

## Stages

### 1. Scan

Use the low-token scanner to collect URLs into `data/pipeline.md`.

The staged default is:

- ATS API when available
- local Playwright against `careers_url` when no API is available
- no discovery-time WebSearch by default

### 1b. Scan Filter

`scan-filter.mjs` applies deterministic metadata-only rules before extraction.

This stage is intentionally cheap. It works from scan metadata such as:

- title
- company
- URL
- location metadata when available

It can also balance the queue so one company does not dominate extraction. By default, the generated policy keeps the top `5` metadata matches per company unless overridden.

It writes:

- `data/scan-filter/kept.md`
- `data/scan-filter/rejected.json`
- `data/scan-filter/summary.json`

### 2. Extract

`extract-jd.mjs` converts the filtered scan list or local `jds/*` references into normalized disk artifacts:

- `jds/normalized/*.json`
- `jds/*.md`

These artifacts are reusable and prevent repeated fetch/extraction work.

Use `jds/normalized/index.json` for downstream steps when you want only the most recent extract run instead of every artifact accumulated in `jds/normalized/`.

### 3. Candidate Pack

`candidate-pack.mjs` compacts:

- `config/profile.yml`
- `cv.md`
- `modes/_profile.md`
- `article-digest.md`

into `data/candidate-pack.json`.

This pack is intended to replace repeated re-reading of the full candidate context during triage.

### 3b. Prefilter Policy

`build-prefilter-policy.mjs` derives a reusable zero-token filter policy from `config/profile.yml`.

It is meant for obvious blockers:

- country / geo mismatch
- state / local-region mismatch for onsite or hybrid roles
- remote vs hybrid vs onsite mismatch
- junior / intern / new grad filtering
- obvious non-target title families

### 3c. Prefilter

`prefilter-jobs.mjs` applies that policy to normalized JD artifacts and writes:

- `data/prefilter/kept.json`
- `data/prefilter/rejected.json`
- `data/prefilter/summary.tsv`

This stage is deterministic and local. It should cut the job pool before any triage tokens are spent.

### 4. Triage / Lite Scorer

`triage-lite.mjs` runs the cheap screening worker that reads only:

- `data/candidate-pack.json`
- prefiltered normalized JDs, typically via `data/prefilter/kept.json`

It does not generate reports, PDFs, or tracker entries. It returns compact screening output with bucketed decisions such as `strong_include`, `include`, `borderline`, and `exclude`, plus compatibility classifications for the existing shortlist flow.

Outputs:

- `data/triage/results.json`
- `data/triage/results.tsv`
- `data/triage/items/*.json`

### 5. Shortlist

`shortlist.mjs` promotes the top-ranked triage results into:

- `data/triage/shortlist.json`
- `data/triage/shortlist.tsv`

### 5b. Review And Approval

`review-shortlist.mjs` prints the ranked jobs with scores so the user can choose how many to promote.

`full-customize.mjs` will preview the selected jobs and refuse to execute unless `--approve` is passed.

### 6. Full Customize

This stage is intentionally separate and should run only on shortlisted jobs.

The current repo still uses the richer legacy prompt for this path, but only after an explicit user-approved promotion decision.

## Design Principle

Not every job should be treated like a finalist.

Most jobs should stay cheap until they earn additional spend.
