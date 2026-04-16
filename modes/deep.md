# Mode: deep — Deep Research Prompt

Generates a structured prompt for Perplexity/Claude/ChatGPT across 6 axes:

```
## Deep Research: [Company] — [Role]

Context: I'm evaluating a candidacy for [role] at [company]. I need actionable information for the interview.

### 1. AI strategy
- Which products/features use AI/ML?
- What's their AI stack? (models, infra, tools)
- Do they have an engineering blog? What do they publish?
- What papers or talks have they given on AI?

### 2. Recent moves (last 6 months)
- Notable hires in AI/ML/product?
- Acquisitions or partnerships?
- Product launches or pivots?
- Funding rounds or leadership changes?

### 3. Engineering culture
- How do they ship? (deploy cadence, CI/CD)
- Mono-repo or multi-repo?
- Which languages/frameworks do they use?
- Remote-first or office-first?
- Glassdoor/Blind reviews on eng culture?

### 4. Likely challenges
- What scaling problems do they have?
- Reliability, cost, latency challenges?
- Are they migrating anything? (infra, models, platforms)
- What pain points do reviews mention?

### 5. Competitors and differentiation
- Who are their main competitors?
- What's their moat/differentiator?
- How do they position against the competition?

### 6. Candidate angle
Given my profile (read from cv.md and profile.yml for specific experience):
- What unique value do I bring to this team?
- Which of my projects are most relevant?
- What story should I tell in the interview?
```

Tailor each section to the specific context of the offer being evaluated.
