# Scripts Reference

All scripts live in the project root as `.mjs` modules and are exposed via `npm run <name>`.

## Quick Reference

| Command | Script | Purpose |
|---------|--------|---------|
| `npm run doctor` | `doctor.mjs` | Validate setup prerequisites |
| `npm run verify` | `verify-pipeline.mjs` | Check pipeline data integrity |
| `npm run normalize` | `normalize-statuses.mjs` | Fix non-canonical statuses |
| `npm run dedup` | `dedup-tracker.mjs` | Remove duplicate tracker entries |
| `npm run merge` | `merge-tracker.mjs` | Merge batch TSVs into applications.md |
| `npm run pdf` | `generate-pdf.mjs` | Convert HTML to ATS-optimized PDF |
| `npm run sync-check` | `cv-sync-check.mjs` | Validate CV/profile consistency |
| `npm run update:check` | `update-system.mjs check` | Check for upstream updates |
| `npm run update` | `update-system.mjs apply` | Apply upstream update |
| `npm run rollback` | `update-system.mjs rollback` | Rollback last update |
| `npm run liveness` | `check-liveness.mjs` | Test if job URLs are still active |
| `npm run scan` | `scan-local.mjs` | Zero-token portal scanner |
| `npm run scan-filter` | `scan-filter.mjs` | Filter scan metadata before extraction |
| `npm run extract` | `extract-jd.mjs` | Normalize JDs to reusable local artifacts |
| `npm run prefilter-policy` | `build-prefilter-policy.mjs` | Build deterministic pre-triage filter policy |
| `npm run prefilter` | `prefilter-jobs.mjs` | Filter normalized JDs before triage |
| `npm run candidate-pack` | `candidate-pack.mjs` | Build reusable candidate context |
| `npm run triage` | `triage-lite.mjs` | Low-cost semantic scoring for promotion |

---

## doctor

Validates that all prerequisites are in place: Node.js >= 18, dependencies installed, Playwright chromium, required files (`cv.md`, `config/profile.yml`, `portals.yml`), fonts directory, and auto-creates `data/`, `output/`, `reports/` if missing.

```bash
npm run doctor
```

**Exit codes:** `0` all checks passed, `1` one or more checks failed (fix messages printed).

---

## verify

Health check for pipeline data integrity. Validates `data/applications.md` against seven rules: canonical statuses (per `templates/states.yml`), no duplicate company+role pairs, all report links point to existing files, scores match `X.XX/5` / `N/A` / `DUP`, rows have proper pipe-delimited format, no pending TSVs in `batch/tracker-additions/`, and no markdown bold in scores.

```bash
npm run verify
```

**Exit codes:** `0` pipeline clean (zero errors), `1` errors found. Warnings (e.g. possible duplicates) do not cause a non-zero exit.

---

## normalize

Maps non-canonical statuses to their canonical equivalents and strips markdown bold and dates from the status column. Aliases like `Enviada` become `Aplicado`, `CERRADA` becomes `Descartado`, etc. DUPLICADO info is moved to the notes column.

```bash
npm run normalize             # apply changes
npm run normalize -- --dry-run  # preview without writing
```

Creates a `.bak` backup of `applications.md` before writing.

**Exit codes:** `0` always (changes or no changes).

---

## dedup

Removes duplicate entries from `applications.md` by grouping on normalized company name + fuzzy role match. Keeps the entry with the highest score. If a removed entry had a more advanced pipeline status, that status is promoted to the keeper.

```bash
npm run dedup             # apply changes
npm run dedup -- --dry-run  # preview without writing
```

Creates a `.bak` backup before writing.

**Exit codes:** `0` always.

---

## merge

Merges batch tracker additions (`batch/tracker-additions/*.tsv`) into `applications.md`. Handles 9-column TSV, 8-column TSV, and pipe-delimited markdown formats. Detects duplicates by report number, entry number, and company+role fuzzy match. Higher-scored re-evaluations update existing entries in place.

```bash
npm run merge                 # apply merge
npm run merge -- --dry-run    # preview without writing
npm run merge -- --verify     # merge then run verify-pipeline
```

Processed TSVs are moved to `batch/tracker-additions/merged/`.

**Exit codes:** `0` success, `1` verification errors (with `--verify`).

---

## pdf

Renders an HTML file to a print-quality, ATS-parseable PDF via headless Chromium. Resolves font paths from `fonts/`, normalizes Unicode for ATS compatibility (em-dashes, smart quotes, zero-width characters), and reports page count and file size.

```bash
npm run pdf -- input.html output.pdf
npm run pdf -- input.html output.pdf --format=letter   # US letter
npm run pdf -- input.html output.pdf --format=a4        # A4 (default)
```

**Exit codes:** `0` PDF generated, `1` missing arguments or generation failure.

---

## sync-check

Validates that the career-ops setup is internally consistent: `cv.md` exists and is not too short, `config/profile.yml` exists with required fields, no hardcoded metrics in `modes/_shared.md` or `batch/batch-prompt.md`, and `article-digest.md` freshness (warns if older than 30 days).

```bash
npm run sync-check
```

**Exit codes:** `0` no errors (warnings allowed), `1` errors found.

---

## update:check

Checks whether a newer version of career-ops is available upstream. Outputs JSON to stdout:

```bash
npm run update:check
```

Possible JSON responses:

| `status` | Meaning |
|----------|---------|
| `up-to-date` | Local version matches remote |
| `update-available` | Newer version exists (includes `local`, `remote`, `changelog`) |
| `dismissed` | User dismissed the update prompt |
| `offline` | Could not reach GitHub |

**Exit codes:** `0` always.

---

## update

Applies the upstream update. Creates a backup branch (`backup-pre-update-{version}`), fetches from the canonical repo, checks out only system-layer files, runs `npm install`, and commits. User-layer files (`cv.md`, `config/profile.yml`, `data/`, etc.) are never touched.

```bash
npm run update
```

**Exit codes:** `0` success, `1` lock conflict or safety violation.

---

## rollback

Restores system-layer files from the most recent backup branch created during an update.

```bash
npm run rollback
```

**Exit codes:** `0` success, `1` no backup branch found or git error.

---

## liveness

Tests whether job posting URLs are still live using headless Chromium. Detects expired patterns (e.g. "job no longer available"), HTTP 404/410, ATS redirect patterns, and apply-button presence. Supports multi-language expired patterns (English, German, French).

```bash
npm run liveness -- https://example.com/job/123
npm run liveness -- https://a.com/job/1 https://b.com/job/2
npm run liveness -- --file urls.txt
```

Each URL gets a verdict: `active`, `expired`, or `uncertain` with a reason.

**Exit codes:** `0` all URLs active, `1` any expired or uncertain.

---

## scan

Zero-token portal scanner. Hits ATS APIs (Greenhouse, Ashby, Lever) and career pages directly — no LLM tokens consumed. Reads `portals.yml` for target companies and search queries, outputs matching listings to stdout and optionally appends to `data/pipeline.md`.

```bash
npm run scan
```

**Exit codes:** `0` scan completed, `1` configuration error or no portals.yml found.

---

## scan-filter

Applies deterministic metadata-only rules to scan output before extraction. This is the cheapest place to remove obvious junk such as non-target title families, junior roles, and location blockers when scan metadata has location available.

It also applies a per-company balance cap so one employer cannot dominate the extract queue. The generated policy defaults to the top `5` scan matches per company, and you can override it per run.

Writes:

- `data/scan-filter/kept.md`
- `data/scan-filter/rejected.json`
- `data/scan-filter/summary.json`

```bash
npm run scan-filter -- --from data/pipeline.md --policy data/prefilter-policy.json
npm run scan-filter -- --from data/pipeline.md --policy data/prefilter-policy.json --max-per-company 3
npm run extract -- --from data/scan-filter/kept.md
```

**Exit codes:** `0` filter completed, `1` missing input/policy or malformed inputs.

---

## extract

Normalizes job descriptions into reusable local artifacts under `jds/normalized/*.json` plus markdown copies in `jds/*.md`.

```bash
npm run extract -- --from data/scan-filter/kept.md
```

**Exit codes:** `0` extraction completed, `1` input error or extraction failure.

---

## prefilter-policy

Builds `data/prefilter-policy.json` from `config/profile.yml`. This policy is deterministic and meant to catch obvious blockers before triage tokens are spent.

```bash
npm run prefilter-policy
```

Typical rules include:

- allowed countries
- allowed states for local onsite / hybrid screening
- remote / hybrid / onsite preferences
- seniority excludes
- target role-family keywords
- hard title excludes

**Exit codes:** `0` policy generated, `1` missing profile or parse error.

---

## prefilter

Applies the generated prefilter policy to normalized JD artifacts and writes:

- `data/prefilter/kept.json`
- `data/prefilter/rejected.json`
- `data/prefilter/summary.tsv`

`data/prefilter/kept.json` is the intended input for `npm run triage`.

```bash
npm run prefilter -- --jobs jds/normalized/index.json --policy data/prefilter-policy.json
npm run triage -- --jobs data/prefilter/kept.json --pack data/candidate-pack.json
```

**Exit codes:** `0` filter completed, `1` missing jobs/policy or malformed inputs.

---

## candidate-pack

Builds `data/candidate-pack.json` from `config/profile.yml`, `cv.md`, `modes/_profile.md`, and `article-digest.md` for reuse across all triage jobs.

```bash
npm run candidate-pack
```

**Exit codes:** `0` pack generated, `1` missing profile or parse error.

---

## triage

Runs the low-cost semantic lite scorer against normalized JDs, typically from `data/prefilter/kept.json`.

The output is intentionally compact and bucket-first:

- `strong_include`
- `include`
- `borderline`
- `exclude`

Compatibility classifications (`apply`, `maybe`, `reject`) are still emitted so the existing shortlist and promotion commands continue to work.

```bash
npm run triage -- --jobs data/prefilter/kept.json --pack data/candidate-pack.json
npm run triage -- --jobs data/prefilter/kept.json --pack data/candidate-pack.json --parallel 4
npm run triage -- --jobs data/prefilter/kept.json --pack data/candidate-pack.json --parallel 4 --chunk-size 10
```

**Exit codes:** `0` triage completed, `1` worker or input failure.
