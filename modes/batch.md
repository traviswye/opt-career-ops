# Mode: batch — Bulk Offer Processing

Two usage modes: **conductor --chrome** (navigates portals live) or **standalone** (script for URLs already collected).

## Architecture

```
Claude Conductor (claude --chrome --dangerously-skip-permissions)
  │
  │  Chrome: navigates portals (logged-in sessions)
  │  Reads the DOM directly — the user sees everything in real time
  │
  ├─ Offer 1: reads JD from DOM + URL
  │    └─► claude -p worker → report .md + PDF + tracker-line
  │
  ├─ Offer 2: clicks next, reads JD + URL
  │    └─► claude -p worker → report .md + PDF + tracker-line
  │
  └─ End: merge tracker-additions → applications.md + summary
```

Every worker is a child `claude -p` with a clean 200K-token context. The conductor only orchestrates.

## Files

```
batch/
  batch-input.tsv               # URLs (via conductor or manual)
  batch-state.tsv               # Progress (auto-generated, gitignored)
  batch-runner.sh               # Standalone orchestrator script
  batch-prompt.md               # Prompt template for workers
  logs/                         # One log per offer (gitignored)
  tracker-additions/            # Tracker lines (gitignored)
```

## Mode A: Conductor --chrome

1. **Read state**: `batch/batch-state.tsv` → know what's already been processed
2. **Navigate portal**: Chrome → search URL
3. **Extract URLs**: Read the results DOM → pull the list of URLs → append to `batch-input.tsv`
4. **For each pending URL**:
   a. Chrome: click the offer → read the JD text from the DOM
   b. Save the JD to `/tmp/batch-jd-{id}.txt`
   c. Compute the next sequential REPORT_NUM
   d. Run via Bash:
      ```bash
      claude -p --dangerously-skip-permissions \
        --append-system-prompt-file batch/batch-prompt.md \
        "Process this offer. URL: {url}. JD: /tmp/batch-jd-{id}.txt. Report: {num}. ID: {id}"
      ```
   e. Update `batch-state.tsv` (completed/failed + score + report_num)
   f. Log to `logs/{report_num}-{id}.log`
   g. Chrome: go back → next offer
5. **Pagination**: If there are no more offers → click "Next" → repeat
6. **End**: Merge `tracker-additions/` → `applications.md` + summary

## Mode B: Standalone script

```bash
batch/batch-runner.sh [OPTIONS]
```

Options:
- `--dry-run` — list pending items without running
- `--retry-failed` — only retry failed ones
- `--start-from N` — start from ID N
- `--parallel N` — N workers in parallel
- `--max-retries N` — attempts per offer (default: 2)

## batch-state.tsv format

```
id	url	status	started_at	completed_at	report_num	score	error	retries
1	https://...	completed	2026-...	2026-...	002	4.2	-	0
2	https://...	failed	2026-...	2026-...	-	-	Error msg	1
3	https://...	pending	-	-	-	-	-	0
```

## Resumability

- If it dies → re-run → reads `batch-state.tsv` → skips completed
- Lock file (`batch-runner.pid`) prevents double execution
- Each worker is independent: a failure on offer #47 doesn't affect the others

## Workers (claude -p)

Each worker receives `batch-prompt.md` as its system prompt. It's self-contained.

The worker produces:
1. A `.md` report in `reports/`
2. A PDF in `output/`
3. A tracker line in `batch/tracker-additions/{id}.tsv`
4. A result JSON on stdout

## Error handling

| Error | Recovery |
|-------|----------|
| URL unreachable | Worker fails → conductor marks `failed`, moves on |
| JD behind login | Conductor tries to read the DOM. If it fails → `failed` |
| Portal changes layout | Conductor reasons over the HTML and adapts |
| Worker crashes | Conductor marks `failed`, moves on. Retry with `--retry-failed` |
| Conductor dies | Re-run → reads state → skips completed |
| PDF fails | The .md report is still saved. PDF stays pending |
