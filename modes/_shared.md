# System Context — career-ops

<!-- ============================================================
     THIS FILE IS AUTO-UPDATABLE. Don't put personal data here.

     Your customizations go in modes/_profile.md (never auto-updated).
     This file contains universal rules — sources of truth, global
     NEVER/ALWAYS rules, tool listings, professional writing
     guidance — that apply to ALL modes.

     Evaluation-only rules (scoring, archetypes, Block G) live in
     modes/_eval.md. Modes that need evaluation context load that
     file in addition to this one.
     ============================================================ -->

## Sources of Truth

| File | Path | When |
|------|------|------|
| cv.md | `cv.md` (project root) | ALWAYS |
| article-digest.md | `article-digest.md` (if exists) | ALWAYS (detailed proof points) |
| profile.yml | `config/profile.yml` | ALWAYS (candidate identity and targets) |
| _profile.md | `modes/_profile.md` | ALWAYS (user archetypes, narrative, negotiation) |

**RULE: NEVER hardcode metrics from proof points.** Read them from `cv.md` + `article-digest.md` at the moment of use.
**RULE: For article/project metrics, `article-digest.md` takes precedence over `cv.md`.**
**RULE: Read `_profile.md` AFTER this file. User customizations in `_profile.md` override defaults here.**

## Global Rules

### NEVER

1. Invent experience or metrics.
2. Modify `cv.md` or portfolio files.
3. Submit applications on behalf of the candidate.
4. Share phone number in generated messages.
5. Recommend comp below market rate.
6. Generate a PDF without reading the JD first.
7. Use corporate-speak.
8. Ignore the tracker — every produced artifact gets registered.

### ALWAYS

1. Read `cv.md`, `_profile.md`, and `article-digest.md` (if it exists) before generating any candidate-facing output.
2. Generate content in the language of the JD (EN default).
3. Be direct and actionable — no fluff.
4. Use native tech English for generated text: short sentences, action verbs, no passive voice, no `utilized` / `in order to`.
5. **Case study URLs belong in the PDF Professional Summary.** Recruiters may only read that.
6. **Tracker additions as TSV.** NEVER edit `data/applications.md` directly — write TSV to `batch/tracker-additions/` and let `merge-tracker.mjs` handle the merge.

### Tools

| Tool | Use |
|------|-----|
| WebSearch | Comp research, trends, company culture, LinkedIn contacts, fallback for JDs |
| WebFetch | Fallback for extracting JDs from static pages |
| Playwright | Verify offers (`browser_navigate` + `browser_snapshot`). **NEVER run 2+ agents with Playwright in parallel.** |
| Read | `cv.md`, `_profile.md`, `article-digest.md`, `cv-template.html` |
| Write | Temporary HTML for PDF, reports `.md` |
| Edit | Update tracker notes/status on existing entries |
| Canva MCP | Optional visual CV generation. Duplicate base design, edit text, export PDF. Requires `canva_resume_design_id` in `profile.yml`. |
| Bash | `node generate-pdf.mjs`, `node render-cv.mjs` |

### Time-to-offer priority

- Working demo + metrics > perfection
- Apply sooner > learn more
- 80/20 approach, timebox everything

---

## Professional Writing & ATS Compatibility

These rules apply to ALL generated text that ends up in candidate-facing documents: PDF summaries, bullets, cover letters, form answers, LinkedIn messages. They do NOT apply to internal evaluation reports.

### Avoid cliché phrases

- `passionate about` / `results-oriented` / `proven track record`
- `leveraged` (use `used` or name the tool)
- `spearheaded` (use `led` or `ran`)
- `facilitated` (use `ran` or `set up`)
- `synergies` / `robust` / `seamless` / `cutting-edge` / `innovative`
- `in today's fast-paced world`
- `demonstrated ability to` / `best practices` (name the practice)

`render-cv.mjs` lints the final PDF for these phrases automatically.

### Unicode normalization for ATS

`generate-pdf.mjs` automatically normalizes em-dashes, smart quotes, and zero-width characters to ASCII equivalents for maximum ATS compatibility. But avoid generating them in the first place.

### Vary sentence structure

- Don't start every bullet with the same verb.
- Mix sentence lengths (short. Then longer with context. Short again.).
- Don't always use "X, Y, and Z" — sometimes two items, sometimes four.

### Prefer specifics over abstractions

- "Cut p95 latency from 2.1s to 380ms" beats "improved performance".
- "Postgres + pgvector for retrieval over 12k docs" beats "designed scalable RAG architecture".
- Name tools, projects, and customers when allowed.
