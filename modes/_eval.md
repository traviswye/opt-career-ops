# Evaluation Context — career-ops

<!-- ============================================================
     THIS FILE IS AUTO-UPDATABLE. It contains scoring rules,
     archetype detection, and posting legitimacy signals — the
     stuff only the evaluation path needs.

     Modes that load this file:
     - oferta       (full evaluation A-G)
     - ofertas      (multi-offer comparison)
     - auto-pipeline Phase 1 only
     - batch        (via batch-prompt.md)

     Modes that do NOT load this file:
     - pdf, contacto, apply, scan, tracker, deep, etc.

     If your mode doesn't need scoring or legitimacy analysis,
     don't read this file. It's pure context bloat for you.
     ============================================================ -->

## Scoring System

The evaluation uses 6 blocks (A–F) with a global score of 1–5:

| Dimension | What it measures |
|-----------|-----------------|
| Match with CV | Skills, experience, proof points alignment |
| North Star alignment | How well the role fits the user's target archetypes (from `modes/_profile.md`) |
| Comp | Salary vs target (see rubric below) |
| Cultural signals | Company culture, growth, stability, remote policy |
| Red flags | Blockers, warnings (negative adjustments) |
| **Global** | Weighted average of the above |

**Score interpretation:**
- 4.5+ → Strong match, recommend applying immediately
- 4.0–4.4 → Good match, worth applying
- 3.5–3.9 → Decent but not ideal, apply only if there's a specific reason
- Below 3.5 → Recommend against applying (see Ethical Use in `CLAUDE.md`)

### Avoid Double-Counting Gaps

A gap in the candidate's coverage should only be penalized **ONCE** in the scoring. Do not penalize the same gap in multiple dimensions.

**The rules:**

1. **Hard gaps are declared, not scored.** If a requirement is listed in the `hard_gaps` array (things the candidate provably lacks in `cv.md`), it must NOT also drag down the Match with CV dimension, AND it must NOT also appear as a Red Flag. Declaring a hard gap is the penalty — the user sees the gap list and decides for themselves.

2. **Match with CV is scored on coverage of NON-hard-gap requirements.** Look at what the candidate actually brings to the role, excluding items already declared as hard gaps. If the candidate has strong evidence for 80%+ of the non-hard-gap requirements, Match with CV is 4.5 or higher. If 60–80%, score 4.0–4.5. Below 60% means the role is a genuinely poor fit even ignoring the explicit gaps — reconsider whether it should even be in scope.

3. **Red Flags are for signals OUTSIDE the candidate's profile**, not for CV gaps:
   - ✅ Valid red flags: recent mass layoffs at the company, vague/boilerplate JD language, contradictions in requirements (e.g., "entry level" with "10+ years"), hostile-culture markers, ghost-posting signals, comp floor below walk-away minimum
   - ❌ Invalid red flags: "candidate doesn't have Angular" (that's a hard gap), "JD mentions Kubernetes and CV doesn't" (hard gap), "no dbt experience" (hard gap)
   - If you find yourself typing "candidate lacks X" as a red flag, stop — it belongs in `hard_gaps`, not Red Flags.

**Why this matters:**

Triple-counting a single gap (hard_gaps + Match drag + Red flag) produces a score that's punitively low relative to the candidate's actual fit. A role where the candidate covers 80% of what's asked, flags a couple of hard gaps honestly, and has no company-external red flags should score 4.0+ — not 3.5 because three different dimensions all ate the same Angular gap.

**Example (Rithum case, before vs after this rule):**

*Before* (triple-counted):
- hard_gaps: `["Angular", "AWS serverless stack"]` (declared)
- Match with CV: 3.8 (dragged by the same two things)
- Red flags: −0.3 (dragged AGAIN by Angular)
- Global: 3.7 → skipped

*After* (counted once):
- hard_gaps: `["Angular", "AWS serverless stack"]` (declared — that's the penalty)
- Match with CV: 4.5 (scored on what the candidate DOES cover: 80%+ of JS/TS/React/Node/AWS/Python/SQL Server/REST/mentoring)
- Red flags: 0 (no signals outside the CV itself)
- Global: ~4.3 → ships

### Comp Scoring Rubric

The Comp dimension measures how well the role's declared or researched compensation aligns with the candidate's target range from `config/profile.yml` (`compensation.target_range`, `compensation.minimum`).

Score based on where the candidate's **target range** sits relative to the JD's declared range (or, if no range is declared, against WebSearch market data):

| Situation | Score |
|-----------|------:|
| Target fits comfortably within JD range AND JD top ≥ candidate target ceiling | **5.0** |
| Target overlaps JD range AND JD top is within 10% of candidate target ceiling | **4.5** |
| Target overlaps JD range but JD top is 10–25% below target ceiling (hard cap under target) | **4.0** |
| Target exceeds JD top (JD ceiling < target floor) but JD top ≥ candidate minimum | **3.0** |
| JD top < candidate minimum (walk-away) | **1.0** |
| No salary disclosed AND WebSearch shows market range aligns with target | **4.0** |
| No salary disclosed AND WebSearch inconclusive or not run | **3.5** |
| No salary disclosed AND WebSearch shows market is below target | **2.5** |

**Rules of application:**

1. **DO NOT penalize wide ranges on their own.** Many JDs publish $50k–$100k spreads for legitimate reasons (multi-level posting, geographic adjustment, pay transparency compliance). A wide range with target in the upper half is NOT a red flag — it's an opportunity to negotiate up. Score by where the target lands within the range, not by the width of the range.

2. **DO NOT penalize low floors automatically.** The JD's low floor only matters if the candidate might actually land there. If the JD discloses level (Senior vs Staff vs Principal) and the candidate has strong senior-scope signals (match ≥ 4, senior-level CV), score based on expected landing (upper half), not worst case.

3. **DO score by the negotiation anchor.** If a reasonable negotiation ($target base) lands inside the JD range AND above target minimum, that's at least 4.0, regardless of the low floor.

4. **Only score ≤ 3.0 when the candidate would genuinely need to compromise.** If the JD ceiling is below target ceiling, or if WebSearch data shows the company underpays market, that's a real drag. A wide published range with target in it is not.

**Example (Rithum case):**
- JD declared: $100k–$185k base + 10% bonus ($110k–$203.5k total)
- Candidate target: $150k–$200k
- Candidate minimum: $120k
- Analysis: Target fits in upper half of JD range. JD top of $203.5k total ≥ target ceiling of $200k. Candidate minimum of $120k is above JD floor of $110k (close but above).
- **Score: 5.0** (target fits comfortably, ceiling hit cleanly)
- **Not 3.5.** The wide range is irrelevant — target landing is what matters.

## Posting Legitimacy (Block G)

Block G assesses whether a posting is likely a real, active opening. It does NOT affect the 1–5 global score — it is a separate qualitative assessment.

**Three tiers:**
- **High Confidence** — Real, active opening (most signals positive)
- **Proceed with Caution** — Mixed signals, worth noting
- **Suspicious** — Multiple ghost indicators, user should investigate first

**Key signals (weighted by reliability):**

| Signal | Source | Reliability | Notes |
|--------|--------|-------------|-------|
| Posting age | Page snapshot | High | Under 30d = good, 30–60d = mixed, 60d+ = concerning (adjust for role type) |
| Apply button active | Page snapshot | High | Direct observable fact |
| Tech specificity in JD | JD text | Medium | Generic JDs correlate with ghost postings but also with poor writing |
| Requirements realism | JD text | Medium | Contradictions are a strong signal; vagueness is weaker |
| Recent layoff news | WebSearch | Medium | Consider department, timing, company size |
| Reposting pattern | scan-history.tsv | Medium | Same role reposted 2+ times in 90 days is concerning |
| Salary transparency | JD text | Low | Jurisdiction-dependent, many legitimate reasons to omit |
| Role–company fit | Qualitative | Low | Subjective, use only as a supporting signal |

**Ethical framing (MANDATORY):**
- Present observations, not accusations of dishonesty.
- Every signal has legitimate explanations — note them.
- The user decides how to weigh the findings.

## Archetype Detection

Classify every offer into one of these types (or a hybrid of two). The archetype determines which proof points to prioritize in Block B, how to frame the summary in Block E, and which STAR stories to prepare in Block F. **The specific archetype catalog lives in `modes/_profile.md`** — read that file for the user's actual target archetypes and proof-point mappings. The defaults below are AI/ML-focused; if the user has customized `_profile.md` with different archetypes (e.g. platform, backend, data), those override this list.

**Default archetypes (signals in JD):**
- **AI Platform / LLMOps** — observability, evals, pipelines, monitoring, reliability
- **Agentic / Automation** — agent, HITL, orchestration, workflow, multi-agent
- **Technical AI PM** — PRD, roadmap, discovery, stakeholder, product manager
- **AI Solutions Architect** — architecture, enterprise, integration, design, systems
- **AI Forward Deployed** — client-facing, deploy, prototype, fast delivery, field
- **AI Transformation** — change management, adoption, enablement, transformation

After detecting the archetype, read `modes/_profile.md` for the user-specific framing and proof points for that archetype.

## Evaluation-specific rules

These rules apply **only when running an evaluation**. Non-evaluation modes (pdf, contacto, apply, scan) should not enforce these.

### ALWAYS (during evaluation)

1. **First evaluation of each session:** Run `node cv-sync-check.mjs`. If warnings, notify the user.
2. Detect the role archetype and adapt framing per `modes/_profile.md`.
3. Cite exact lines from `cv.md` when matching requirements in Block B.
4. Use WebSearch for comp data and company signals (Block D + Block G).
5. Include `**URL:**` in every report header saved to `reports/`.
6. Include `**Legitimacy:** {tier}` in every report header, per Block G.
