# opt-career-ops

[English](README.md) | [Español](README.es.md) | [Português (Brasil)](README.pt-BR.md) | [한국어](README.ko-KR.md) | [日本語](README.ja.md) | [Русский](README.ru.md) | [繁體中文](README.zh-TW.md)

> **This repo is a fork of [santifer/career-ops](https://github.com/santifer/career-ops).** The original system by [Santiago](https://santifer.io) is a fully-working end-to-end job search agent that he used to evaluate 740+ offers and land his Head of Applied AI role. This fork introduces a staged, cost-optimized discovery pipeline (scan → Haiku triage → Sonnet customize), a deterministic local CV renderer, a shared location-matching library, and a slimmer `_shared` / `_eval` mode split. Both systems produce tailored CVs end-to-end; this fork optimizes for running at higher volume at lower cost per offer.
>
> **Attribution notes.** The Discord invite, upstream author contact links, banner image, and demo GIF below all point at the original project by santifer — credit belongs with the original work. This README inherits santifer's formatting and structure; it's been rewritten only where the fork's behavior diverges from upstream. For the full list of what this fork adds or changes, see [CHANGELOG.md](CHANGELOG.md).
>
> **Canonical URLs** — this fork: [`github.com/traviswye/opt-career-ops`](https://github.com/traviswye/opt-career-ops) · upstream: [`github.com/santifer/career-ops`](https://github.com/santifer/career-ops).

<p align="center">
  <a href="https://x.com/santifer"><img src="docs/hero-banner.jpg" alt="Career-Ops — Multi-Agent Job Search System" width="800"></a>
</p>

<p align="center">
  <em>I spent months applying to jobs the hard way. So I engineered the system I wish I had.</em><br>
  Companies use AI to filter candidates. <strong>I gave candidates AI to <em>choose</em> companies.</strong><br>
  <em>Now it's open source.</em>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Claude_Code-000?style=flat&logo=anthropic&logoColor=white" alt="Claude Code">
  <img src="https://img.shields.io/badge/OpenCode-111827?style=flat&logo=terminal&logoColor=white" alt="OpenCode">
  <img src="https://img.shields.io/badge/Codex_(soon)-6B7280?style=flat&logo=openai&logoColor=white" alt="Codex">
  <img src="https://img.shields.io/badge/Node.js-339933?style=flat&logo=node.js&logoColor=white" alt="Node.js">
  <img src="https://img.shields.io/badge/Go-00ADD8?style=flat&logo=go&logoColor=white" alt="Go">
  <img src="https://img.shields.io/badge/Playwright-2EAD33?style=flat&logo=playwright&logoColor=white" alt="Playwright">
  <img src="https://img.shields.io/badge/License-MIT-blue.svg" alt="MIT">
  <a href="https://discord.gg/8pRpHETxa4"><img src="https://img.shields.io/badge/Discord-5865F2?style=flat&logo=discord&logoColor=white" alt="Discord"></a>
  <br>
  <img src="https://img.shields.io/badge/EN-blue?style=flat" alt="EN">
  <img src="https://img.shields.io/badge/ES-red?style=flat" alt="ES">
  <img src="https://img.shields.io/badge/DE-grey?style=flat" alt="DE">
  <img src="https://img.shields.io/badge/FR-blue?style=flat" alt="FR">
  <img src="https://img.shields.io/badge/PT--BR-green?style=flat" alt="PT-BR">
  <img src="https://img.shields.io/badge/KO-white?style=flat" alt="KO">
  <img src="https://img.shields.io/badge/JA-red?style=flat" alt="JA">
  <img src="https://img.shields.io/badge/ZH--TW-blue?style=flat" alt="ZH-TW">
</p>

---

<p align="center">
  <img src="docs/demo.gif" alt="Career-Ops Demo" width="800">
</p>

<p align="center"><strong>740+ job listings evaluated · 100+ personalized CVs · 1 dream role landed</strong></p>

<p align="center"><a href="https://discord.gg/8pRpHETxa4"><img src="https://img.shields.io/badge/Join_the_community-Discord-5865F2?style=for-the-badge&logo=discord&logoColor=white" alt="Discord (upstream)"></a></p>

## Why this fork exists — token economics

This fork's reason for being is cost. The upstream system is excellent but the moment you try to run it at portfolio-scale (hundreds of JDs per week), the monolithic batch prompt becomes the limiting factor — every JD pays the full heavy-prompt cost at whatever model you've configured, whether that stage actually needed that much reasoning or not. Every change here traces back to one question: *how many tokens does this send, and how many can we drop without losing quality?*

### Headline numbers

| Metric | santifer upstream | opt-career-ops |
|---|---:|---:|
| Cost per tailored CV (end-to-end) | ~$0.60 | ~$0.05 |
| ATS quality (JobScan, held-out JD) | 50% | 62% |
| Keyword coverage per CV (lint-enforced) | ~75–85% (no lint gate) | ≥80% floor enforced, typical 85–100% |
| Wall-clock for a 2,400-job scan extract | ~95 min | ~25 min |
| Output tokens per CV on HTML generation | ~3,000 | 0 |

### Where the savings come from

1. **Staged model ladder instead of single-model monoliths.** Upstream runs one big prompt per job against whatever Claude model the user's Claude Code is configured with — that works, but every JD pays the full prompt cost at that model's rate regardless of how much reasoning the specific stage actually needs. Here the workload is split: **Haiku 4.5** for triage (12-job chunks, ~$0.001/job), **Sonnet 4.6 + thinking** for evaluation on jobs that survived triage, **Sonnet 4.6** for PDF tailoring gated by a score threshold. Each stage uses the cheapest model that still produces the quality that stage needs.
2. **Deterministic local renderer.** Upstream, the LLM writes the HTML for the PDF — 3,000+ output tokens per CV of deterministic boilerplate. Here `modes/pdf.md` emits a JSON object and `render-cv.mjs` fills `templates/cv-template.html` locally. Lint (coverage / cliché / page budget) runs without a round-trip.
3. **Prompt context split (`_shared.md` / `_eval.md`).** Upstream `_shared.md` carries ~500 lines including scoring, archetype detection, and posting-legitimacy rules. Every mode loads it. Here the eval-only content moved to `_eval.md`. Non-eval modes (`pdf`, `contacto`, `apply`, `scan`, `triage`, `customize`) load ~40% less context per invocation with zero behavior change.
4. **Zero-token prefilter before triage.** `lib/location-match.mjs` + `prefilter-jobs.mjs` apply tiered location evidence matching (metadata → header zone → phrase) to drop foreign, onsite-outside-allowed, seniority-wrong, and non-target-title jobs before triage ever sees them. Typical funnel: 3,200 scanned → ~800 kept. Everything else rejected for $0.
5. **Skip-thresholds + one retry instead of regenerate.** Two thresholds gate expensive output. `full-customize.mjs --pdf-threshold 4.0` means low-fit jobs don't pay for a PDF. Inside Phase 1, **Block F (Interview Plan) is also gated on score ≥ 4.0** — sub-threshold evals emit a one-line deferred stub instead of 6–10 STAR+R stories, saving ~1–2k output tokens per job you wouldn't have applied to anyway. When PDF lint fails (coverage < 80%, cliché found, page overflow), the renderer hands the specific lint output back to the LLM for one targeted fix — not a full regen from scratch.
6. **Structured sidecar handoff.** Phase 1 (eval) writes 15–20 JD keywords to `reports/{NNN}-{slug}-keywords.json`. Phase 2 (PDF) reads the sidecar instead of re-extracting from the JD body — one list, written once, consumed by both the lint and the tailoring prompt.
7. **Parallelized extraction.** `extract-jd.mjs --parallel N` (default 4) runs Playwright + ATS-API body extraction concurrently. Cuts a 2,400-job extract from ~95 min sequential to ~25 min. No token savings, but it makes the "run overnight, triage over morning coffee" pattern actually viable.
8. **English-standardized system prompts.** Mixed-language prompts are tokenizer-expensive. Anthropic-reported overhead for Spanish / French / German prose mixed into an English system prompt is roughly **15–25% more tokens** than the equivalent all-English version, because the tokenizer vocabulary is optimized for English and non-English words routinely split into multiple sub-word tokens. Upstream's default `modes/` files are largely in Spanish, which hits this penalty on every invocation. This fork standardizes every file that loads into a model call — mode files, batch prompts, candidate-pack framing — to English. **The user-facing output language is independent** of this: the language-specific mode directories (`modes/de/`, `modes/fr/`, `modes/ja/`, `modes/pt/`, `modes/ru/`) remain intact for candidates targeting those markets, and the eval/PDF modes still emit content in the JD's language.

### Not a replacement — a different tradeoff

Upstream is tuned for candidates who hand-pick each offer and use the tool as a workflow assistant. This fork is tuned for volume: scan thousands of listings, funnel through progressively more expensive stages, tailor CVs only for the top ~5% that survive the gates. If you're running fewer than ~30 applications total, upstream is simpler and the cost savings don't matter. If you're scanning dozens of portals and evaluating hundreds of offers a month, the math on this fork compounds.

For the full per-stage walkthrough, see [`docs/STAGED_PIPELINE.md`](docs/STAGED_PIPELINE.md).

## What Is This

Career-Ops turns any AI coding CLI into a full job search command center. Instead of manually tracking applications in a spreadsheet, you get an AI-powered pipeline that:

- **Evaluates offers** with a structured A-F scoring system (10 weighted dimensions)
- **Generates tailored PDFs** -- ATS-optimized CVs customized per job description
- **Scans portals** automatically (Greenhouse, Ashby, Lever, company pages)
- **Processes in batch** -- evaluate 10+ offers in parallel with sub-agents
- **Tracks everything** in a single source of truth with integrity checks

> **Important: This is NOT a spray-and-pray tool.** Career-ops is a filter -- it helps you find the few offers worth your time out of hundreds. The system strongly recommends against applying to anything scoring below 4.0/5. Your time is valuable, and so is the recruiter's. Always review before submitting.

Career-ops is agentic: Claude Code navigates career pages with Playwright, evaluates fit by reasoning about your CV vs the job description (not keyword matching), and adapts your resume per listing.

> **Heads up: the first evaluations won't be great.** The system doesn't know you yet. Feed it context -- your CV, your career story, your proof points, your preferences, what you're good at, what you want to avoid. The more you nurture it, the better it gets. Think of it as onboarding a new recruiter: the first week they need to learn about you, then they become invaluable.

Built by someone who used it to evaluate 740+ job offers, generate 100+ tailored CVs, and land a Head of Applied AI role. [Read the full case study](https://santifer.io/career-ops-system).

## Features

| Feature | Description |
|---------|-------------|
| **Auto-Pipeline (single-JD)** | Paste a URL or JD, get a full evaluation + tailored PDF + tracker entry |
| **Staged discovery pipeline** | Zero-token scan → Haiku triage → per-user-approved shortlist → Sonnet 2-phase customize — built to run at thousands-of-offers scale |
| **7-Block Evaluation (A–G)** | Role summary, CV match, level strategy, comp research, personalization, interview prep (STAR+R), posting legitimacy |
| **Deterministic CV renderer** | `render-cv.mjs` fills the HTML template from a JSON tailoring schema — LLM never produces HTML, saving ~3k output tokens/run |
| **Coverage + cliché + page-budget lint** | Every PDF is linted for ATS keyword coverage (≥80% adjusted floor), banned clichés, and page overflow; one auto-retry on failure |
| **Shared location-matching library** | `lib/location-match.mjs` with tiered evidence (metadata → header zone → phrase), foreign country/city patterns, ambiguous-abbreviation disambiguation, and camelCase ATS-text normalization |
| **ATS umbrella-term rule** | Automatically pairs specifics (Git, AWS CDK, Docker, Pytest) with the umbrella categories ATS parsers search for (`version control`, `AWS services`, `containerization`, `automated testing`) |
| **Interview Story Bank** | Accumulates STAR+Reflection stories across evaluations — 5–10 master stories that answer any behavioral question |
| **Negotiation Scripts** | Salary negotiation frameworks, geographic discount pushback, competing offer leverage |
| **Portal Scanner** | 45+ companies pre-configured + custom queries across Ashby, Greenhouse, Lever, Wellfound — parallel extraction (~25 min for ~2,400 jobs at `--parallel 4`) |
| **Batch / Customize** | Parallel 2-phase orchestrator with skip-threshold gate on Phase 2 to skip PDFs for sub-threshold jobs |
| **Dashboard TUI** | Terminal UI to browse, filter, and sort your pipeline |
| **Human-in-the-Loop** | AI evaluates and recommends, you decide and act. The system never submits an application — you always have the final call |
| **Pipeline Integrity** | Automated merge, dedup, status normalization, health checks |

## Quick Start

```bash
# 1. Clone and install
git clone https://github.com/traviswye/opt-career-ops.git   # or santifer/career-ops for upstream
cd opt-career-ops && npm install
npx playwright install chromium   # required for Playwright extraction + PDF rendering

# 2. Check setup
npm run doctor                     # validates prerequisites and directory layout

# 3. Configure
cp config/profile.example.yml config/profile.yml     # edit with your details
cp templates/portals.example.yml portals.yml         # customize portals + title keywords
cp modes/_profile.template.md modes/_profile.md      # your narrative + customizations
cp interview-prep/story-bank.template.md interview-prep/story-bank.md

# 4. Add your CV
# Create cv.md in the project root with your CV in markdown

# 5. Personalize with Claude
claude                              # open Claude Code in this directory
# Then ask Claude to adapt the system to you:
#   "Change the archetypes to backend engineering roles"
#   "Add these companies to portals.yml"
#   "Tune prefilter.location.allow_unknown_location to false"

# 6. Two ways to use it
# A) Single-JD: paste a URL or JD into the chat — auto-pipeline runs end-to-end.
# B) Discovery at scale:
#    /career-ops scan       # populate jds/normalized + data/prefilter/kept.json
#    /career-ops triage     # Haiku lite-scoring
#    /career-ops shortlist  # review + promote
#    /career-ops customize  # Sonnet eval + tailored PDFs
```

> **The system is designed to be customized by Claude itself.** Modes, archetypes, scoring weights, negotiation scripts -- just ask Claude to change them. It reads the same files it uses, so it knows exactly what to edit.

See [docs/SETUP.md](docs/SETUP.md) for the full setup guide.

## Usage

Career-ops is a single slash command with multiple modes. Everything below is also available as `npm run <mode>` for headless / CI use.

### Single-JD workflow (paste a URL or JD)

```
/career-ops {paste a JD}   → Full auto-pipeline (evaluate + PDF + tracker)
/career-ops pipeline       → Process pending URLs from inbox (data/pipeline.md)
/career-ops oferta         → Evaluation only A–G (no auto PDF)
/career-ops pdf            → PDF only, ATS-optimized CV
```

### Staged discovery pipeline (built for scale)

```
/career-ops scan           → Portals → filter → extract → prefilter → candidate-pack
                             All zero-token, idempotent. Ready for triage.
/career-ops triage         → Haiku lite-scoring (first token spend, ~$0.70 per 1k jobs)
/career-ops shortlist      → Review triage results and promote selections
/career-ops customize      → 2-phase Sonnet eval + tailored PDF on the shortlist
```

### Application and relationship

```
/career-ops apply          → Live application assistant (reads form + drafts answers)
/career-ops contacto       → LinkedIn outreach: find contacts + draft message
/career-ops followup       → Follow-up cadence tracker: flag overdue, draft nudges
```

### Comparison, research, overview

```
/career-ops ofertas        → Compare and rank multiple offers
/career-ops deep           → Deep company research
/career-ops training       → Evaluate a course/cert against your North Star
/career-ops project        → Evaluate a portfolio project idea
/career-ops tracker        → Application status overview
/career-ops patterns       → Analyze rejection patterns and improve targeting
/career-ops batch          → Legacy monolithic pipeline (kept under batch/legacy/)
```

Paste a URL or JD directly — career-ops auto-detects it and runs the full single-JD pipeline.

## How It Works

### Single-JD flow (auto-pipeline)

```
You paste a job URL or JD
        │
        ▼
┌──────────────────┐
│  Phase 1: Eval   │  Sonnet 4.6 + thinking → Blocks A–G + score + keyword sidecar
│  (reads cv.md,   │
│   profile.yml,   │
│   _eval.md)      │
└────────┬─────────┘
         │ score ≥ pdf-threshold (default 4.0)
┌────────▼─────────┐
│  Phase 2: PDF    │  Sonnet emits JSON tailoring → render-cv.mjs fills template
│  (deterministic) │  → lint (coverage / cliche / overflow) → auto-retry once
└────────┬─────────┘
         │
    ┌────┼────┐
    ▼    ▼    ▼
 Report  PDF  Tracker
```

### Staged discovery flow (scan → triage → customize)

```
┌─ scan ──────────────────────────────────────────────────────────── zero token ──┐
│ 1. build-prefilter-policy      → data/prefilter-policy.json                    │
│ 2. scan-local                  → data/scan-results.json (ATS APIs)             │
│ 3. scan-filter                 → data/scan-filter/candidates.json              │
│ 4. extract-jd --parallel N     → jds/normalized/{id}.json (Playwright + ATS)   │
│ 5. prefilter-jobs              → data/prefilter/{kept,rejected}.json           │
│ 6. candidate-pack              → data/candidate-pack.json                      │
└─────────────────────────────────────────────────────────────────────────────────┘
                                          │
                              consent boundary (first tokens)
                                          │
┌─ triage ─────────────────────────────────────────────── Claude Haiku 4.5 ──────┐
│ triage-lite --jobs data/prefilter/kept.json                                    │
│ → data/triage/results.json (buckets: strong_include / include / borderline /    │
│   exclude) + per-job rationale cache                                           │
└─────────────────────────────────────────────────────────────────────────────────┘
                                          │
                              user review  ↓
┌─ shortlist ─────────────────────────────────────────────────── deterministic ──┐
│ shortlist / review-shortlist                                                   │
│ → data/triage/shortlist.json (user-approved set)                               │
└─────────────────────────────────────────────────────────────────────────────────┘
                                          │
                              spending gate (Sonnet)
                                          │
┌─ customize ─────────────────────────────────────── Claude Sonnet 4.6 + thinking ┐
│ full-customize --from shortlist.json --approve                                 │
│   Phase 1 (eval)  → reports/{NNN}-{slug}-{date}.md + keywords.json             │
│   Phase 2 (pdf)   → output/cv-{you}-{company}-{role}-{date}.pdf (via renderer) │
│   Tracker TSV     → batch/tracker-additions/                                    │
└─────────────────────────────────────────────────────────────────────────────────┘
```

### Cost envelope — 2,400-listing daily run

| Stage | opt-career-ops | santifer/career-ops equivalent |
|---|---:|---:|
| Scan + filter + extract + prefilter + candidate-pack | **$0** (local, deterministic) | **$0** — upstream also has a zero-cost scan (`scan.mjs` with Playwright + ATS APIs + WebSearch-driven discovery). Filtering is prompt-guided (company max-JDs, title keywords) rather than deterministic prefilter, but the discovery step itself is free in both systems. |
| Triage (~700 jobs survive prefilter; chunk size 12) | **~$2** (Haiku 4.5) | No dedicated triage stage — upstream's filtering happens inside the scan prompts (company caps, title relevance) and through manual curation. Effective but not a separate token-spend boundary. |
| Customize Phase 1 (Sonnet + thinking eval on ~30 shortlisted) | **~$1.50** | ~$15–20 for the same 30 — upstream's monolithic batch runs the full A–G prompt at whatever model is configured; if it's Sonnet 4.6 that's ~$0.50–0.60/job, if it's Opus that's roughly 5× that. |
| Customize Phase 2 (Sonnet PDF on ~15 clearing the 4.0 threshold) | **~$0.75** | No separate PDF gate — the upstream batch writes the PDF for every job it evaluates regardless of score, including ones you wouldn't apply to. |
| **Daily total** | **~$4–6** | **~$15–20 for 30 tailored CVs** |

**Context on the comparison:**
- Both systems have a zero-cost discovery step. The difference is that upstream's scan is Playwright + prompt-guided filtering (effective for smaller portal lists), while this fork adds a deterministic prefilter layer with tiered location-evidence matching that scales to thousands of listings without token spend.
- Upstream's prompt-level filtering (company caps, title keywords in the scan mode) serves a similar purpose to this fork's `triage` stage — just without a dedicated Haiku pass. For a user scanning 10–30 companies, upstream's approach is simpler and works well. The dedicated triage stage pays off when the listing volume exceeds what prompt-guided curation can handle efficiently.
- The apples-to-apples number — **per-tailored-CV cost at the generation step**, the one stage both systems have — is in the Headline Numbers table above: **~$0.05/CV here vs ~$0.60/CV upstream**. The ~12× reduction holds regardless of which end of the funnel you enter at.

## Pre-configured Portals

The scanner comes with **45+ companies** ready to scan and **19 search queries** across major job boards. Copy `templates/portals.example.yml` to `portals.yml` and add your own:

**AI Labs:** Anthropic, OpenAI, Mistral, Cohere, LangChain, Pinecone
**Voice AI:** ElevenLabs, PolyAI, Parloa, Hume AI, Deepgram, Vapi, Bland AI
**AI Platforms:** Retool, Airtable, Vercel, Temporal, Glean, Arize AI
**Contact Center:** Ada, LivePerson, Sierra, Decagon, Talkdesk, Genesys
**Enterprise:** Salesforce, Twilio, Gong, Dialpad
**LLMOps:** Langfuse, Weights & Biases, Lindy, Cognigy, Speechmatics
**Automation:** n8n, Zapier, Make.com
**European:** Factorial, Attio, Tinybird, Clarity AI, Travelperk

**Job boards searched:** Ashby, Greenhouse, Lever, Wellfound, Workable, RemoteFront

## Dashboard TUI

The built-in terminal dashboard lets you browse your pipeline visually:

```bash
cd dashboard
go build -o career-dashboard .
./career-dashboard --path ..
```

Features: 6 filter tabs, 4 sort modes, grouped/flat view, lazy-loaded previews, inline status changes.

## Project Structure

```
career-ops/
├── CLAUDE.md                    # Agent instructions
├── cv.md                        # Your CV (create this — gitignored)
├── article-digest.md            # Your proof points (optional — gitignored)
├── config/
│   └── profile.example.yml      # Template for your profile
├── lib/
│   └── location-match.mjs       # Shared location-matching library
├── modes/                       # Skill modes (entry points for /career-ops)
│   ├── _shared.md               # Universal rules (all modes)
│   ├── _eval.md                 # Evaluation-only rules (scoring, legitimacy)
│   ├── _profile.template.md     # User customization scaffold
│   ├── auto-pipeline.md         # Single-JD auto flow (Phase 1 + Phase 2)
│   ├── oferta.md                # Single evaluation (Blocks A–G)
│   ├── pdf.md                   # Tailored CV — JSON output to renderer
│   ├── scan.md                  # Discovery pipeline orchestrator
│   ├── triage.md                # Haiku lite-scoring
│   ├── shortlist.md             # Triage promotion UI
│   ├── customize.md             # 2-phase eval + PDF orchestrator
│   ├── pipeline.md              # Inbox URL processor
│   ├── batch.md                 # Legacy monolithic pipeline
│   └── ... (contacto, deep, training, project, tracker, apply, patterns, followup)
├── templates/
│   ├── cv-template.html         # ATS-optimized CV template
│   ├── portals.example.yml      # Scanner config template
│   └── states.yml               # Canonical statuses
├── batch/
│   ├── eval-prompt.md           # Phase 1 system prompt (customize)
│   ├── triage-prompt.md         # Haiku triage system prompt
│   └── legacy/                  # Archived pre-split monolithic pipeline
├── dashboard/                   # Go TUI pipeline viewer
├── data/                        # Your tracking + pipeline outputs (gitignored)
├── reports/                     # Evaluation reports (gitignored)
├── output/                      # Generated PDFs (gitignored)
├── interview-prep/              # Accumulated STAR+R story bank (gitignored)
├── jds/normalized/              # Extracted JD artifacts (gitignored)
├── fonts/                       # Space Grotesk + DM Sans
├── docs/                        # Setup, architecture, scan/staged pipelines
└── examples/                    # Sample CV, report, proof points
```

### Key scripts (run via `npm run <name>` or the corresponding `/career-ops <mode>`)

| Script | Stage | What it does |
|---|---|---|
| `run-pipeline.mjs` | scan | Orchestrator chaining build-prefilter-policy → scan-local → scan-filter → extract-jd → prefilter-jobs → candidate-pack |
| `scan-local.mjs` | scan | ATS API scrape (Greenhouse, Ashby, Lever) |
| `scan-filter.mjs` | scan | Title + metadata-level location filter |
| `extract-jd.mjs` | scan | Parallel Playwright + ATS-API body extraction |
| `build-prefilter-policy.mjs` | scan | Derives deterministic filter rules from profile.yml |
| `prefilter-jobs.mjs` | scan | Strict prefilter: tiered location evidence + modality policy |
| `candidate-pack.mjs` | scan | Compact JSON pack for triage and customize |
| `triage-lite.mjs` | triage | Haiku lite-scoring with parallel workers |
| `shortlist.mjs` | shortlist | Promote triage results into a per-user-approved shortlist |
| `review-shortlist.mjs` | shortlist | Interactive per-job review walk |
| `full-customize.mjs` | customize | 2-phase orchestrator: Sonnet eval + deterministic PDF render |
| `render-cv.mjs` | customize | Deterministic JSON → HTML → PDF renderer with coverage + cliché + budget lint |
| `merge-tracker.mjs` | tracker | Merge `batch/tracker-additions/` TSVs into `data/applications.md` |
| `analyze-triage.mjs` | analysis | Post-run analysis of triage score distributions and bucket shifts |

## Tech Stack

![Claude Code](https://img.shields.io/badge/Claude_Code-000?style=flat&logo=anthropic&logoColor=white)
![Node.js](https://img.shields.io/badge/Node.js-339933?style=flat&logo=node.js&logoColor=white)
![Playwright](https://img.shields.io/badge/Playwright-2EAD33?style=flat&logo=playwright&logoColor=white)
![Go](https://img.shields.io/badge/Go-00ADD8?style=flat&logo=go&logoColor=white)
![Bubble Tea](https://img.shields.io/badge/Bubble_Tea-FF75B5?style=flat&logo=go&logoColor=white)

- **Agent**: Claude Code (Opus 4.6 / Sonnet 4.6 / Haiku 4.5) with custom skills and modes
- **Models**: Haiku 4.5 for triage, Sonnet 4.6 + thinking for eval + PDF tailoring; Opus reserved for high-stakes re-scoring
- **PDF**: `render-cv.mjs` deterministic renderer + Playwright/Puppeteer + HTML template
- **Scanner**: `run-pipeline.mjs` orchestrator + Greenhouse/Ashby/Lever APIs + Playwright body extraction
- **Prefilter**: `lib/location-match.mjs` shared library (tiered evidence + foreign-pattern matching)
- **Dashboard**: Go + Bubble Tea + Lipgloss (Catppuccin Mocha theme)
- **Data**: Markdown tables + YAML config + TSV batch files + JSON manifests

<!--
## Star History

Commented out until this fork has enough stars for the chart to read usefully.
The upstream chart lives on santifer/career-ops. To re-enable here, uncomment
the block below:

<a href="https://www.star-history.com/#santifer/career-ops&traviswye/opt-career-ops&Timeline">
 <picture>
   <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/svg?repos=santifer/career-ops,traviswye/opt-career-ops&type=Timeline&theme=dark" />
   <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/svg?repos=santifer/career-ops,traviswye/opt-career-ops&type=Timeline" />
   <img alt="Star History Chart" src="https://api.star-history.com/svg?repos=santifer/career-ops,traviswye/opt-career-ops&type=Timeline" />
 </picture>
</a>
-->

## Disclaimer

**career-ops is a local, open-source tool — NOT a hosted service.** By using this software, you acknowledge:

1. **You control your data.** Your CV, contact info, and personal data stay on your machine and are sent directly to the AI provider you choose (Anthropic, OpenAI, etc.). We do not collect, store, or have access to any of your data.
2. **You control the AI.** The default prompts instruct the AI not to auto-submit applications, but AI models can behave unpredictably. If you modify the prompts or use different models, you do so at your own risk. **Always review AI-generated content for accuracy before submitting.**
3. **You comply with third-party ToS.** You must use this tool in accordance with the Terms of Service of the career portals you interact with (Greenhouse, Lever, Workday, LinkedIn, etc.). Do not use this tool to spam employers or overwhelm ATS systems.
4. **No guarantees.** Evaluations are recommendations, not truth. AI models may hallucinate skills or experience. The authors are not liable for employment outcomes, rejected applications, account restrictions, or any other consequences.

See [LEGAL_DISCLAIMER.md](LEGAL_DISCLAIMER.md) for full details. This software is provided under the [MIT License](LICENSE) "as is", without warranty of any kind.

## Contributors

Upstream contributors (santifer/career-ops — this fork stands on their work):

<a href="https://github.com/santifer/career-ops/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=santifer/career-ops" />
</a>

Fork contributors (traviswye/opt-career-ops):

<a href="https://github.com/traviswye/opt-career-ops/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=traviswye/opt-career-ops" />
</a>

Got hired using opt-career-ops or career-ops? [Share your story upstream](https://github.com/santifer/career-ops/issues/new?template=i-got-hired.yml) — santifer maintains the original "I got hired" template and credit belongs with the original system.

## License

MIT

## Upstream Author Links

The original author of career-ops is Santiago ([santifer/career-ops](https://github.com/santifer/career-ops)). For questions about the upstream project, community Discord, or the case study behind the 740+ offers / Head of Applied AI story, his contact points are below:

[![Website](https://img.shields.io/badge/santifer.io-000?style=for-the-badge&logo=safari&logoColor=white)](https://santifer.io)
[![LinkedIn](https://img.shields.io/badge/LinkedIn-0A66C2?style=for-the-badge&logo=linkedin&logoColor=white)](https://linkedin.com/in/santifer)
[![X](https://img.shields.io/badge/X-000?style=for-the-badge&logo=x&logoColor=white)](https://x.com/santifer)
[![Discord](https://img.shields.io/badge/Discord-5865F2?style=for-the-badge&logo=discord&logoColor=white)](https://discord.gg/8pRpHETxa4)
[![Email](https://img.shields.io/badge/Email-EA4335?style=for-the-badge&logo=gmail&logoColor=white)](mailto:hi@santifer.io)
