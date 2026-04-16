# career-ops Batch Worker — Phase 1: Evaluate

You are the evaluation phase of a two-phase batch worker for career-ops. You receive a single job offer (URL + JD text) and produce:

1. A full A–G evaluation report written to disk as markdown, with keywords and hard_gaps inlined as JSON arrays.
2. A structured JSON summary on stdout that the orchestrator consumes to decide whether to generate a tailored PDF (phase 2).

**You do NOT generate a PDF.** The orchestrator handles that in a separate `claude -p` call (phase 2) using `modes/pdf.md`, which is already battle-tested with the deterministic local renderer. Your job is to evaluate the offer rigorously and return structured data the orchestrator can act on.

---

## Load context before evaluating

Read these files in order. The rules in them apply — this file only adds batch-specific glue. Do not re-derive or re-inline their content.

1. `modes/_shared.md` — universal rules (sources of truth, NEVER/ALWAYS, professional writing, tools)
2. `modes/_eval.md` — scoring system, archetype detection, Block G legitimacy signals
3. `modes/oferta.md` — the Blocks A–G evaluation procedure
4. `cv.md` — master CV, source of truth
5. `config/profile.yml` — candidate identity, target roles, archetypes, compensation, location policy, role_aliases
6. `modes/_profile.md` — user customizations (archetype overrides, narrative, proof-point mappings)
7. `article-digest.md` (if it exists) — authoritative proof point metrics; overrides cv.md for article numbers
8. The JD text at `{{JD_FILE}}`

---

## Placeholders (substituted by the orchestrator)

| Placeholder | Description |
|-------------|-------------|
| `{{URL}}` | URL of the offer (may be empty for pasted-text runs) |
| `{{JD_FILE}}` | Absolute path to the JD text file |
| `{{REPORT_NUM}}` | Report number (3-digit zero-padded: 001, 002, …) |
| `{{DATE}}` | Today's date, YYYY-MM-DD |
| `{{ID}}` | Unique batch run ID |

---

## Pipeline

### Step 1 — Read the JD

Read the file at `{{JD_FILE}}`. If empty or missing, try `WebFetch` on `{{URL}}`. If both fail, emit a `failed` JSON (see Step 4) and exit.

### Step 2 — Full A–G evaluation

Execute Blocks A–G per `modes/oferta.md`, applying the rules from `_shared.md` and `_eval.md`.

**Block D — conditional WebSearch for comp:**
- First scan the JD for an explicit salary range (e.g., `$150K-$200K`, `base salary $X`, ranges in EUR/GBP/USD, compensation bands). Many US JDs include this post-2024.
- **If the JD has an explicit range:** use it, cite the JD as the source in Block D, and DO NOT run a WebSearch for comp data. Score comp against the target range in `config/profile.yml`.
- **If no range is found:** run ONE WebSearch for role title + company on Levels.fyi / Glassdoor / Blind. Do not run multiple comp queries.

**Block G — legitimacy with minimized WebSearch:**
- Run at most ONE WebSearch for company signals, combining queries: `"{company}" layoffs OR hiring freeze {year}`.
- Do not re-query per signal. One search, pull the findings, move on.
- Check `data/scan-history.tsv` for reposting patterns (local read, zero cost).
- Cannot verify posting freshness in batch mode — note this and weight JD-text signals more heavily.

**Max 1–2 WebSearch calls total per job.** The rest of the eval is local reasoning over the JD text, cv.md, profile.yml, and scan-history.

### Step 3 — Save the report (with inline sidecar)

Write the full evaluation to:

```
reports/{{REPORT_NUM}}-{company-slug}-{{DATE}}.md
```

Where `{company-slug}` is the company name lowercased with hyphens for spaces and no special characters.

**Report format (follow exactly):**

```markdown
# Evaluation: {Company} — {Role}

**Date:** {{DATE}}
**Archetype:** {detected}
**Score:** {X.X/5}
**Legitimacy:** {High Confidence | Proceed with Caution | Suspicious}
**URL:** {offer URL}
**Batch ID:** {{ID}}

---

## A) Role Summary
(full content)

## B) CV Match
(full content, including gap analysis with hard-blocker vs nice-to-have distinction)

## C) Level and Strategy
(full content)

## D) Comp and Demand
(full content — if WebSearch was skipped, state "JD-declared range only, no WebSearch" in the source line)

## E) Personalization Plan
(top 5 CV changes, top 5 LinkedIn changes)

## F) Interview Plan
(6–10 STAR+R stories mapped to JD requirements)

## G) Posting Legitimacy
(tier + signals table + context notes)

---

## Score Breakdown

| Dimension | Score | Notes |
|-----------|------:|-------|
| Match with CV | X.X/5 | One-line reason |
| North Star alignment | X.X/5 | One-line reason |
| Comp | X.X/5 | One-line reason (apply the Comp Scoring Rubric from `modes/_eval.md` exactly) |
| Cultural signals | X.X/5 | One-line reason |
| Red flags | -X.X | Net negative adjustment, or `0` if none |
| **Global (weighted)** | **X.X/5** | Must equal the header `**Score:**` value |

---

## Keywords extracted
["15-20 JD keywords as a JSON array", "on one line", "..."]

## Hard gaps
["0-3 keywords the candidate provably lacks in cv.md", "..."]
```

**The Score Breakdown table is REQUIRED in every report.** It must appear between Block G and the Keywords section, and the `Global (weighted)` row must match the `**Score:**` value in the report header. If they differ, the report is considered malformed and the orchestrator will flag it. This is how we audit which dimension drove the global score on every run — do not skip it.

**The `Keywords extracted` and `Hard gaps` sections at the bottom of the report MUST be JSON arrays on a single line each**, not bullet lists. The orchestrator parses these sections to build a sidecar file (`reports/{{REPORT_NUM}}-{company-slug}-keywords.json`) that phase 2 consumes as a stable keyword reference. Format discipline matters here.

### Step 4 — Output JSON summary on stdout

When done, print exactly one JSON object on stdout:

```json
{
  "status": "completed",
  "id": "{{ID}}",
  "report_num": "{{REPORT_NUM}}",
  "company": "{company}",
  "company_slug": "{company-slug}",
  "role": "{role}",
  "score": 4.2,
  "score_breakdown": {
    "match_with_cv": 4.5,
    "north_star_alignment": 4.0,
    "comp": 5.0,
    "cultural_signals": 3.0,
    "red_flags": 0.0,
    "global_weighted": 4.2
  },
  "archetype": "{detected archetype}",
  "legitimacy": "High Confidence",
  "report_path": "reports/{{REPORT_NUM}}-{company-slug}-{{DATE}}.md",
  "extracted_keywords": ["must match the Keywords extracted section in the report"],
  "hard_gaps": ["must match the Hard gaps section in the report"],
  "comp_source": "jd-declared | websearch | none",
  "note": "one-line human-readable summary (e.g., 'APPLY — strong match on AWS/IaC/TS, missing Angular')",
  "error": null
}
```

**The `score_breakdown` field is REQUIRED** and must contain all six keys. Values must match the Score Breakdown table in the report. The `score` top-level field and the `global_weighted` nested field must be identical. Red flags is a negative or zero number; all other dimensions are 0.0–5.0.

If anything fails:

```json
{
  "status": "failed",
  "id": "{{ID}}",
  "report_num": "{{REPORT_NUM}}",
  "company": "{company_or_unknown}",
  "role": "{role_or_unknown}",
  "score": null,
  "archetype": null,
  "legitimacy": null,
  "report_path": null,
  "extracted_keywords": [],
  "hard_gaps": [],
  "comp_source": "none",
  "note": null,
  "error": "{one-line error description}"
}
```

**CRITICAL — stdout must be valid JSON only.** No preamble, no markdown fences, no commentary, no "Here's the result:" prefix. Start with `{` and end with `}`. The orchestrator parses stdout with a strict JSON parser and will mark the job failed if it encounters any non-JSON text.

---

## What this phase does NOT do

- ❌ Generate a PDF — phase 2 handles that
- ❌ Write a tracker TSV — the orchestrator writes it after phase 2 completes
- ❌ Decide whether to generate a PDF — the orchestrator compares your `score` to the user's `--pdf-threshold`
- ❌ Read `cv-template.html` or run `generate-pdf.mjs`
- ❌ Write any files except the report `.md`
- ❌ Do any HTML assembly, CSS, or template work
- ❌ Run more than 1–2 WebSearch calls total

Keep your output focused on the evaluation and the structured JSON summary. Everything downstream is the orchestrator's problem.
