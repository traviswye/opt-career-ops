---
name: career-ops
description: AI job search command center -- evaluate offers, generate CVs, scan portals, track applications
user_invocable: true
args: mode
argument-hint: "[scan | triage | shortlist | customize | deep | pdf | oferta | ofertas | apply | batch | tracker | pipeline | contacto | training | project | interview-prep | update]"
---

# career-ops -- Router

## Mode Routing

Determine the mode from `{{mode}}`:

| Input | Mode |
|-------|------|
| (empty / no args) | `discovery` -- Show command menu |
| JD text or URL (no sub-command) | **`auto-pipeline`** |
| `oferta` | `oferta` |
| `ofertas` | `ofertas` |
| `contacto` | `contacto` |
| `deep` | `deep` |
| `pdf` | `pdf` |
| `training` | `training` |
| `project` | `project` |
| `tracker` | `tracker` |
| `pipeline` | `pipeline` |
| `apply` | `apply` |
| `scan` | `scan` |
| `triage` | `triage` |
| `shortlist` | `shortlist` |
| `customize` | `customize` |
| `batch` | `batch` |
| `patterns` | `patterns` |
| `followup` | `followup` |

**Auto-pipeline detection:** If `{{mode}}` is not a known sub-command AND contains JD text (keywords: "responsibilities", "requirements", "qualifications", "about the role", "we're looking for", company name + role) or a URL to a JD, execute `auto-pipeline`.

If `{{mode}}` is not a sub-command AND doesn't look like a JD, show discovery.

---

## Discovery Mode (no arguments)

Show this menu:

```
career-ops -- Command Center

Available commands:

Single-JD workflow (paste a JD, get evaluation + PDF):
  /career-ops {JD}      → AUTO-PIPELINE: evaluate + report + PDF + tracker
  /career-ops pipeline  → Process pending URLs from inbox (data/pipeline.md)
  /career-ops oferta    → Evaluation only A-G (no auto PDF)
  /career-ops pdf       → PDF only, ATS-optimized CV

Staged discovery pipeline (zero-token scan → Haiku triage → Sonnet customize):
  /career-ops scan      → Scan portals → filter → extract → prefilter → candidate-pack
  /career-ops triage    → Haiku lite-score the prefiltered jobs (first token-spending step)
  /career-ops shortlist → Review triage results and promote a shortlist for customization
  /career-ops customize → 2-phase Sonnet eval + tailored PDF for the shortlisted jobs

Application and relationship:
  /career-ops apply     → Live application assistant (reads form + generates answers)
  /career-ops contacto  → LinkedIn power move: find contacts + draft message
  /career-ops followup  → Follow-up cadence tracker: flag overdue, generate drafts

Comparison and research:
  /career-ops ofertas   → Compare and rank multiple offers
  /career-ops deep      → Deep research prompt about company
  /career-ops training  → Evaluate course/cert against North Star
  /career-ops project   → Evaluate portfolio project idea

Overview and diagnostics:
  /career-ops tracker   → Application status overview
  /career-ops batch     → Batch processing with parallel workers (legacy monolithic pipeline)
  /career-ops patterns  → Analyze rejection patterns and improve targeting

Inbox: add URLs to data/pipeline.md → /career-ops pipeline
Or paste a JD directly to run the full single-JD pipeline.
Or start `/career-ops scan` to discover fresh offers at scale.
```

---

## Context Loading by Mode

After determining the mode, load the necessary files before executing. The split between `_shared.md` (universal) and `_eval.md` (evaluation-only — scoring, archetypes, Block G) is deliberate: non-eval modes should NOT load `_eval.md` because it's pure context bloat for them.

### Modes that require `_shared.md` + `_eval.md` + their mode file:
Read `modes/_shared.md` + `modes/_eval.md` + `modes/{mode}.md`

Applies to: `oferta`, `ofertas`, `auto-pipeline`

These modes perform A–G evaluation, scoring, and/or multi-offer comparison, so they need the full eval ruleset.

### Modes that require `_shared.md` + their mode file (NO `_eval.md`):
Read `modes/_shared.md` + `modes/{mode}.md`

Applies to: `pdf`, `contacto`, `apply`, `pipeline`, `scan`, `triage`, `shortlist`, `customize`, `batch`

These modes don't perform A–G evaluation inline — `pdf` generates a tailored CV, `contacto` drafts LinkedIn outreach, `apply` fills forms, `scan` crawls portals, `triage` delegates to `batch/triage-prompt.md`, `shortlist` is a promotion UI, `customize` delegates to `batch/eval-prompt.md` + `modes/pdf.md`, `batch` uses its own self-contained prompt. None of them need the scoring system or Block G signals inline.

**`customize` note:** Phase 1 of `/career-ops customize` runs the evaluation under `batch/eval-prompt.md`, which already inlines the relevant `_eval.md` rules so the spawned worker processes have everything they need without loading the full modes tree in their own context.

**Note for `auto-pipeline`:** Phase 1 (Evaluate) requires `_eval.md`; Phase 2 (PDF) does not. When running the full auto-pipeline, load `_eval.md` once up front — Phase 2 can ignore it.

### Standalone modes (only their mode file):
Read `modes/{mode}.md`

Applies to: `tracker`, `deep`, `training`, `project`, `patterns`, `followup`

### Modes delegated to subagent:
For `scan`, `apply` (with Playwright), and `pipeline` (3+ URLs): launch as Agent with the content of `_shared.md` + `modes/{mode}.md` (and `_eval.md` for `pipeline` if the inner mode is eval) injected into the subagent prompt.

```
Agent(
  subagent_type="general-purpose",
  prompt="[content of modes/_shared.md]\n\n[content of modes/{mode}.md]\n\n[invocation-specific data]",
  description="career-ops {mode}"
)
```

Execute the instructions from the loaded mode file.
