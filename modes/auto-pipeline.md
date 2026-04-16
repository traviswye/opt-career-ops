# Mode: auto-pipeline — Full Sequential Run

**Required context:** Load `modes/_shared.md` + `modes/_eval.md` once before starting. Phase 1 uses both; Phase 2 only needs `_shared.md` but there's no harm in having `_eval.md` already loaded.

When the user pastes a JD (text or URL) without a sub-command, run the three phases **sequentially and independently**. Each phase has its own sources of truth and its own token footprint. If the user wants only one phase, they should invoke that mode directly (`/career-ops oferta` for evaluation only, `/career-ops pdf` for CV only).

## Phase 0 — Extract the JD

If the input is a URL, prefer Playwright (`browser_navigate` + `browser_snapshot`) for SPA portals (Lever, Ashby, Greenhouse, Workday). Fall back to WebFetch for static pages, then WebSearch as last resort. If the input is already JD text, skip the fetch entirely.

Save the extracted JD text to `/tmp/jd-{company-slug}.txt` — the PDF phase and the renderer both need a JD file path.

## Phase 1 — Evaluate (delegates to `modes/oferta.md`)

Load `modes/_shared.md` + `modes/_eval.md` + `modes/oferta.md`. Execute Blocks A–G. This phase **includes** Block D (WebSearch for comp) and Block G (posting legitimacy), which are the expensive parts. **Skip this phase if the user only wants a CV.**

Output: a full A–G report saved to `reports/{###}-{company-slug}-{YYYY-MM-DD}.md` with `**URL:**` and `**Legitimacy:**` in the header. Include a `## Keywords extracted` section with 15–20 JD keywords — the PDF phase will consume this instead of re-extracting.

## Phase 2 — PDF (delegates to `modes/pdf.md`)

Load `modes/pdf.md` only. Do NOT re-load `modes/oferta.md` — this phase does zero evaluation, zero WebSearch, zero archetype detection. It only produces a tailored CV.

1. Read `cv.md`, `config/profile.yml`, `article-digest.md` (if exists), and the JD text.
2. Emit a single JSON object matching the schema in `modes/pdf.md`.
3. Write it to `/tmp/cv-tailoring-{company-slug}.json`.
4. Run:
   ```bash
   node render-cv.mjs \
     --cv cv.md \
     --profile config/profile.yml \
     --jd /tmp/jd-{company-slug}.txt \
     --tailoring /tmp/cv-tailoring-{company-slug}.json \
     --output output/cv-{candidate-slug}-{company-slug}-{YYYY-MM-DD}.pdf \
     --json
   ```
5. Parse the stdout JSON. If `coverage_pct < 70` or `cliches_found.length > 0`, revise the tailoring JSON once and re-run. Otherwise, proceed.

The renderer handles HTML assembly, template filling, paper format detection (US/CA → letter, else → a4), language detection, unicode normalization, PDF invocation, and coverage lint. **Do not output HTML yourself — that is the renderer's job and doing it manually burns output tokens for zero quality gain.**

## Phase 3 — Draft Application Answers (only if eval score ≥ 4.5)

Only runs if Phase 1 happened and the global score is ≥ 4.5. Extract form questions via Playwright if possible, or use the generic question set. Generate answers per the tone rules (confident, selective, specific, no fluff). Save as `## H) Draft Application Answers` appended to the report from Phase 1.

## Phase 4 — Tracker

Write one TSV line to `batch/tracker-additions/{###}-{company-slug}.tsv` with 9 tab-separated columns (see `CLAUDE.md` for the exact format). Run `node merge-tracker.mjs` afterward to merge into `data/applications.md`.

## Failure handling

If any phase fails, continue with the remaining phases and mark the failed phase as pending in the tracker notes. A failed PDF phase does not block the evaluation report from being saved.

## Token footprint (why this mode is expensive)

| Phase | Sources loaded | Model work | When to skip |
|---|---|---|---|
| Phase 1 Evaluate | `_shared.md` + `_eval.md` + `oferta.md` + `cv.md` + `profile.yml` + `_profile.md` + JD | A–G generation + WebSearch (comp) + legitimacy analysis | User already decided to apply — skip, use `/career-ops pdf` |
| Phase 2 PDF | `pdf.md` + `cv.md` + `profile.yml` + JD | JSON schema output only (no HTML) | User only wants the report — skip, use `/career-ops oferta` |
| Phase 3 Draft Answers | Inherits from Phase 1 | Form question answers | Score < 4.5, no form available |
| Phase 4 Tracker | TSV write only | None (no model call) | Never — always log |

Phases 1 and 2 are independent. Running them separately costs the same as running them together, but **running only the one you need** is the real saving.
