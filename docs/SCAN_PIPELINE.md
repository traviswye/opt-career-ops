# Scan Pipeline — Data Flow Reference

The pipeline from portal discovery to triage. Every stage before triage is
**zero-token** (no Claude API calls). Triage is the first stage that spends
tokens, and it defaults to Haiku.

```
portals.yml
    │
    ▼
scan.mjs / scan-local.mjs          Zero-token. ATS API hits + Playwright.
    │                                Output: data/pipeline.md, data/scan-results.json
    ▼
scan-filter.mjs                     Zero-token. Title/seniority/location metadata filter + company cap.
    │                                Output: data/scan-filter/kept.md
    ▼
extract-jd.mjs                     Zero-token (Playwright, not Claude). Normalize JDs to artifacts.
    │                                Output: jds/normalized/{id}.json + jds/{id}.md
    ▼
build-prefilter-policy.mjs          Zero-token. Reads config/profile.yml, writes data/prefilter-policy.json
    │
    ▼
prefilter-jobs.mjs                  Zero-token. Body-aware location + title + seniority filtering.
    │                                Uses lib/location-match.mjs (shared location helpers).
    │                                Output: data/prefilter/kept.json, rejected.json
    ▼
candidate-pack.mjs                  Zero-token. Builds data/candidate-pack.json from cv.md + profile.
    │
    ▼
triage-lite.mjs                     FIRST TOKEN STAGE. Haiku by default (--model override available).
    │                                Scores each job against candidate-pack.
    │                                Output: data/triage/results.json
    ▼
shortlist.mjs / review-shortlist    Local ranking of triage results.
    │                                Output: data/triage/shortlist.json
    ▼
full-customize.mjs                  2-phase orchestrator (Sonnet+thinking eval, Sonnet pdf).
                                     Phase 1: eval → report + keyword sidecar
                                     Phase 2: pdf → tailoring JSON → render-cv.mjs → PDF
                                     Output: reports/, output/, batch/tracker-additions/
```

## File paths

| Stage | Input | Output |
|-------|-------|--------|
| scan.mjs | portals.yml | data/pipeline.md, data/scan-history.tsv |
| scan-local.mjs | portals.yml | data/pipeline.md, data/scan-results.json, data/scan-history.tsv |
| scan-filter.mjs | data/scan-results.json OR data/pipeline.md + data/prefilter-policy.json | data/scan-filter/{kept.md, kept.json, rejected.json, summary.json} |
| extract-jd.mjs | data/scan-filter/kept.md OR direct URLs | jds/normalized/{id}.json, jds/{id}.md |
| build-prefilter-policy.mjs | config/profile.yml | data/prefilter-policy.json |
| prefilter-jobs.mjs | jds/normalized/ + data/prefilter-policy.json | data/prefilter/{kept.json, rejected.json, summary.tsv} |
| candidate-pack.mjs | cv.md + config/profile.yml | data/candidate-pack.json |
| triage-lite.mjs | data/prefilter/kept.json + data/candidate-pack.json | data/triage/{results.json, results.tsv, items/} |
| full-customize.mjs | data/triage/shortlist.json | reports/, output/, batch/tracker-additions/ |

## Shared modules

| Module | Used by | What it provides |
|--------|---------|-----------------|
| lib/location-match.mjs | scan-filter, prefilter-jobs, build-prefilter-policy | US state constants, country/state detection, modality detection, tiered location evidence extraction, foreign city/country indicators |

## Configuration

All filtering behavior is driven by `config/profile.yml` → `data/prefilter-policy.json`.

Key tunable settings in profile.yml's `prefilter:` section:

| Setting | Default | Effect |
|---------|---------|--------|
| `location.allowed_countries` | `["United States"]` | Only keep roles in these countries |
| `location.allow_remote` | `true` | Keep remote roles |
| `location.allow_hybrid` | `true` | Keep hybrid roles (if in allowed state) |
| `location.allow_onsite` | `false` | Reject pure onsite |
| `location.willing_to_relocate` | `false` | If false, reject foreign/out-of-region |
| `seniority.include` | `["Senior", "Staff", "Mid-Senior"]` | Seniority terms to look for |
| `seniority.require_match` | `false` | If true, reject roles without seniority match |
| `role_keywords.exclude` | `["Sales", "Marketing", ...]` | Hard reject on these title words |
| `company_balance.max_per_company` | `10` | Cap roles per company in scan-filter |
| `hard_title_excludes` | `["Analyst", "Compliance", ...]` | Hard reject on these title words |
| `blocked_text_keywords` | `["TS/SCI", ...]` | Hard reject if found in JD body |

## Typical numbers (Travis's profile, April 2026)

```
Portals scanned:     ~45 companies
Raw scan results:    ~2,500 postings
After scan-filter:   ~400 (company cap + title/seniority/location)
After extraction:    ~380 (some fail to extract)
After prefilter:     ~300 (body-aware location + blocked text)
Triage (Haiku):      ~300 scored, ~7% apply, ~17% maybe, ~76% reject
Full-customize:      top 20-30 shortlisted
```

## Running the pipeline end-to-end

```bash
# 1. Build policy from profile
npm run prefilter-policy

# 2. Scan portals (zero-token)
npm run scan

# 3. Filter scan results (zero-token)
npm run scan-filter

# 4. Extract JDs (zero-token, but Playwright-slow)
npm run extract -- --from data/scan-filter/kept.md

# 5. Prefilter normalized JDs (zero-token)
npm run prefilter -- --jobs jds/normalized --policy data/prefilter-policy.json

# 6. Build candidate pack (zero-token)
npm run candidate-pack

# 7. Triage (Haiku tokens — first token stage)
npm run triage -- --jobs data/prefilter/kept.json --pack data/candidate-pack.json

# 8. Analyze results (zero-token)
npm run analyze-triage
npm run analyze-triage-concerns

# 9. Build shortlist
npm run shortlist -- --from data/triage/results.json --top 25

# 10. Full customize (Sonnet tokens — the expensive part)
npm run full-customize -- --from data/triage/shortlist.json --top 10 --approve
```
