#!/usr/bin/env node

/**
 * full-customize.mjs — 2-phase batch orchestrator
 *
 * Phase 1 (Evaluate): spawn Sonnet 4.6 with thinking+effort enabled and
 *   batch/eval-prompt.md. Worker reads JD + cv.md + profile + mode files,
 *   writes the report .md to disk, and emits structured JSON on stdout.
 *   Orchestrator parses the JSON, writes a keyword sidecar file, and decides
 *   whether to run phase 2 based on score vs --pdf-threshold.
 *
 * Phase 2 (PDF): if phase 1 score >= threshold (or job id is in --force-pdf),
 *   spawn Sonnet 4.6 with modes/pdf.md. Worker emits a tailoring JSON.
 *   Orchestrator invokes render-cv.mjs locally, which consumes the tailoring +
 *   keyword sidecar, fills the HTML template, runs generate-pdf.mjs, and
 *   returns lint results (coverage, cliches, page budget, overflow).
 *   If lint fails, retry phase 2 once with feedback; then accept.
 *
 * Phase 3 (Tracker): orchestrator writes the batch/tracker-additions/ TSV
 *   from the accumulated eval + pdf results. No LLM call.
 *
 * The old monolithic worker lives at batch/legacy/ for reference and A/B.
 */

import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { spawn, spawnSync } from 'child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));

const DEFAULTS = {
  from: resolve(__dirname, 'data/triage/shortlist.json'),
  evalPrompt: resolve(__dirname, 'batch/eval-prompt.md'),
  pdfPrompt: resolve(__dirname, 'modes/pdf.md'),
  outManifest: resolve(__dirname, 'data/triage/promotion-manifest.json'),
  parallel: 1,
  approve: false,
  dryRun: false,
  top: null,
  ids: [],
  ranks: [],
  // Eval phase uses Sonnet with thinking mode enabled and high effort.
  // This gets Opus-competitive judgment on archetype detection, Block G
  // legitimacy analysis, and borderline scoring without Opus pricing.
  // Override with --eval-model, --eval-thinking, --eval-effort.
  evalModel: 'claude-sonnet-4-6',
  evalThinking: 'enabled',  // enabled | adaptive | disabled
  evalEffort: 'high',        // low | medium | high | max
  // PDF phase uses plain Sonnet — structured JSON generation doesn't need
  // extended thinking. Override with --pdf-model.
  pdfModel: 'claude-sonnet-4-6',
  // Jobs with eval score >= pdfThreshold trigger phase 2. Below this, the
  // eval report still ships but no PDF is generated.
  pdfThreshold: 4.0,
  // IDs in forcePdfIds always get phase 2 regardless of score.
  forcePdfIds: [],
  // If true, phase 2 never runs regardless of score or force list.
  skipPdf: false,
};

function printHelp() {
  console.log(`career-ops full-customize (2-phase orchestrator)

Run the evaluation + tailored PDF pipeline on an approved shortlisted set.
Each job runs phase 1 (eval) and optionally phase 2 (pdf), with per-phase
model selection and a score-based skip threshold for phase 2.

Usage:
  node full-customize.mjs [options]

Selection:
  --from PATH              Shortlist JSON or triage results JSON (default: data/triage/shortlist.json)
  --top N                  Promote the top N ranked jobs
  --ranks VALUES           Comma-separated shortlist ranks to promote
  --ids VALUES             Comma-separated job ids to promote

Phase 1 — Eval:
  --eval-prompt PATH       Eval system prompt (default: batch/eval-prompt.md)
  --eval-model ID          Model for eval phase (default: claude-sonnet-4-6)
  --eval-thinking MODE     enabled | adaptive | disabled (default: enabled)
  --eval-effort LEVEL      low | medium | high | max (default: high)

Phase 2 — PDF:
  --pdf-prompt PATH        PDF system prompt (default: modes/pdf.md)
  --pdf-model ID           Model for pdf phase (default: claude-sonnet-4-6)
  --pdf-threshold FLOAT    Min eval score to trigger phase 2 (default: 4.0)
  --force-pdf IDS          Comma-separated job ids that always run phase 2,
                           regardless of threshold (use for manual overrides)
  --skip-pdf               Never run phase 2 for any job (eval only)

Orchestration:
  --parallel N             Concurrent workers (default: 1)
  --out-manifest PATH      Promotion manifest path (default: data/triage/promotion-manifest.json)
  --approve                Required to execute the selected jobs
  --dry-run                Preview selection without running workers
  -h, --help               Show help

Examples:
  # Standard run with defaults (Sonnet+thinking eval, Sonnet pdf, threshold 4.0)
  node full-customize.mjs --from data/triage/shortlist.json --top 10 --approve

  # Escalate eval to Opus for a high-stakes batch
  node full-customize.mjs --top 5 --eval-model claude-opus-4-6 --approve

  # Force PDF for a specific below-threshold job
  node full-customize.mjs --top 10 --force-pdf job-42,job-17 --approve

  # Eval only, skip all pdfs
  node full-customize.mjs --top 20 --skip-pdf --approve
`);
}

function parseArgs(argv) {
  const args = { ...DEFAULTS };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    switch (arg) {
      case '--from':
        args.from = resolve(argv[++i]);
        break;
      case '--top':
        args.top = Math.max(1, Number.parseInt(argv[++i], 10) || 1);
        break;
      case '--ranks':
        args.ranks = argv[++i]
          .split(',')
          .map((item) => Number.parseInt(item.trim(), 10))
          .filter((item) => Number.isFinite(item));
        break;
      case '--ids':
        args.ids = argv[++i]
          .split(',')
          .map((item) => item.trim())
          .filter(Boolean);
        break;
      case '--parallel':
        args.parallel = Math.max(1, Number.parseInt(argv[++i], 10) || 1);
        break;
      case '--eval-prompt':
        args.evalPrompt = resolve(argv[++i]);
        break;
      case '--pdf-prompt':
        args.pdfPrompt = resolve(argv[++i]);
        break;
      case '--out-manifest':
        args.outManifest = resolve(argv[++i]);
        break;
      case '--eval-model':
        args.evalModel = String(argv[++i] || '').trim();
        if (!args.evalModel) throw new Error('--eval-model requires a value');
        break;
      case '--eval-thinking':
        args.evalThinking = String(argv[++i] || '').trim();
        if (!['enabled', 'adaptive', 'disabled'].includes(args.evalThinking)) {
          throw new Error('--eval-thinking must be one of: enabled, adaptive, disabled');
        }
        break;
      case '--eval-effort':
        args.evalEffort = String(argv[++i] || '').trim();
        if (!['low', 'medium', 'high', 'max'].includes(args.evalEffort)) {
          throw new Error('--eval-effort must be one of: low, medium, high, max');
        }
        break;
      case '--pdf-model':
        args.pdfModel = String(argv[++i] || '').trim();
        if (!args.pdfModel) throw new Error('--pdf-model requires a value');
        break;
      case '--pdf-threshold':
        args.pdfThreshold = Number.parseFloat(argv[++i]);
        if (!Number.isFinite(args.pdfThreshold)) {
          throw new Error('--pdf-threshold must be a number');
        }
        break;
      case '--force-pdf':
        args.forcePdfIds = argv[++i]
          .split(',')
          .map((item) => item.trim())
          .filter(Boolean);
        break;
      case '--skip-pdf':
        args.skipPdf = true;
        break;
      case '--approve':
        args.approve = true;
        break;
      case '--dry-run':
        args.dryRun = true;
        break;
      case '-h':
      case '--help':
        args.help = true;
        break;
      default:
        throw new Error(`Unknown option: ${arg}`);
    }
  }

  return args;
}

// ---------------------------------------------------------------------------
// Shortlist loading and selection — unchanged from legacy orchestrator
// ---------------------------------------------------------------------------

function loadItems(path) {
  if (!existsSync(path)) {
    throw new Error(`Input file not found: ${path}`);
  }

  const payload = JSON.parse(readFileSync(path, 'utf-8'));
  const items = Array.isArray(payload.results)
    ? payload.results
    : Array.isArray(payload.jobs)
      ? payload.jobs
      : Array.isArray(payload)
        ? payload
        : null;

  if (!items) {
    throw new Error(`Unsupported selection file shape: ${path}`);
  }

  return items.map((item, index) => ({
    rank: Number(item.rank || index + 1),
    id: String(item.id || ''),
    company: item.company || '',
    role: item.role || '',
    score: item.score == null ? null : Number(item.score),
    bucket: item.bucket || '',
    classification: item.classification || '',
    archetype: item.archetype || '',
    url: item.url || null,
    job_file: item.job_file || null,
    markdown_path: item.markdown_path || null,
  }));
}

function selectItems(items, args) {
  const hasSelector = args.top != null || args.ids.length > 0 || args.ranks.length > 0;
  if (!hasSelector) return [];

  const selected = [];
  const seen = new Set();

  const addItem = (item) => {
    if (!item) return;
    const key = item.id || `rank-${item.rank}`;
    if (seen.has(key)) return;
    seen.add(key);
    selected.push(item);
  };

  if (args.top != null) {
    items
      .slice()
      .sort((a, b) => a.rank - b.rank)
      .slice(0, args.top)
      .forEach(addItem);
  }

  for (const rank of args.ranks) {
    addItem(items.find((item) => item.rank === rank));
  }

  for (const id of args.ids) {
    addItem(items.find((item) => item.id === id));
  }

  return selected.sort((a, b) => a.rank - b.rank);
}

function formatScore(score) {
  if (score == null || Number.isNaN(Number(score))) return '-';
  return Number(score).toFixed(2);
}

function truncate(value, max) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (text.length <= max) return text;
  return `${text.slice(0, max - 3)}...`;
}

function pad(value, width, align = 'left') {
  const text = String(value ?? '');
  if (text.length >= width) return text;
  if (align === 'right') return `${' '.repeat(width - text.length)}${text}`;
  return `${text}${' '.repeat(width - text.length)}`;
}

function printSelectionTable(items, title) {
  console.log(title);
  console.log('');

  const header = [
    pad('Rank', 5, 'right'),
    pad('Score', 6, 'right'),
    pad('Bucket', 14),
    pad('Class', 8),
    pad('Company', 18),
    pad('Role', 32),
  ].join('  ');

  console.log(header);
  console.log('-'.repeat(header.length));

  for (const item of items) {
    console.log([
      pad(item.rank, 5, 'right'),
      pad(formatScore(item.score), 6, 'right'),
      pad(truncate(item.bucket, 14), 14),
      pad(truncate(item.classification, 8), 8),
      pad(truncate(item.company, 18), 18),
      pad(truncate(item.role, 32), 32),
    ].join('  '));
  }

  console.log('');
}

function resolvePromptTemplate(promptPath, values) {
  let content = readFileSync(promptPath, 'utf-8');

  for (const [key, value] of Object.entries(values)) {
    const pattern = new RegExp(`\\{\\{${key}\\}\\}`, 'g');
    content = content.replace(pattern, () => String(value ?? ''));
  }

  return content;
}

function nextReportNumbers(count) {
  const reportsDir = resolve(__dirname, 'reports');
  mkdirSync(reportsDir, { recursive: true });

  let maxNum = 0;
  for (const entry of readdirSync(reportsDir)) {
    if (!entry.endsWith('.md')) continue;
    const match = entry.match(/^(\d+)-/);
    if (!match) continue;
    maxNum = Math.max(maxNum, Number.parseInt(match[1], 10));
  }

  return Array.from({ length: count }, (_, index) => String(maxNum + index + 1).padStart(3, '0'));
}

function kebab(str) {
  return String(str || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// ---------------------------------------------------------------------------
// JSON extraction — handles Sonnet's habit of wrapping output in
// markdown fences or preamble prose.
// ---------------------------------------------------------------------------

function extractJson(stdout) {
  const trimmed = stdout.trim();
  if (!trimmed) throw new Error('Worker returned empty output');

  // First try strict parse
  try {
    return JSON.parse(trimmed);
  } catch {
    // Fall through to fuzzy extraction
  }

  // Find the first { and last } — this handles preamble like
  // "Here's the result:" and trailing commentary
  const firstBrace = trimmed.indexOf('{');
  const lastBrace = trimmed.lastIndexOf('}');
  if (firstBrace === -1 || lastBrace === -1 || lastBrace < firstBrace) {
    throw new Error('Worker output did not contain a JSON object');
  }
  const candidate = trimmed.slice(firstBrace, lastBrace + 1);
  return JSON.parse(candidate);
}

// ---------------------------------------------------------------------------
// Claude CLI invocation with model/thinking/effort options
// ---------------------------------------------------------------------------

function runClaude({ promptFile, userPrompt, logPath, model, thinking, effort }) {
  return new Promise((resolvePromise, rejectPromise) => {
    const claudeArgs = [
      '-p',
      '--dangerously-skip-permissions',
      '--append-system-prompt-file',
      promptFile,
    ];
    if (model) claudeArgs.push('--model', model);
    if (thinking && thinking !== 'disabled') claudeArgs.push('--thinking', thinking);
    if (effort) claudeArgs.push('--effort', effort);
    claudeArgs.push(userPrompt);

    const child = spawn('claude', claudeArgs, {
      cwd: __dirname,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
    child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });

    child.on('error', (error) => rejectPromise(error));

    child.on('close', (code) => {
      writeFileSync(logPath, `${stdout}${stderr ? `\n[stderr]\n${stderr}` : ''}`, 'utf-8');

      if (code !== 0) {
        rejectPromise(new Error(`claude exited with code ${code}`));
        return;
      }

      try {
        resolvePromise({ json: extractJson(stdout), raw: stdout });
      } catch (error) {
        rejectPromise(error);
      }
    });
  });
}

// ---------------------------------------------------------------------------
// Report sidecar parsing — reads the "## Keywords extracted" and "## Hard
// gaps" sections from the report .md that phase 1 wrote, and produces a
// JSON sidecar file that phase 2 consumes as a stable keyword reference.
// ---------------------------------------------------------------------------

function parseReportSidecar(reportPath) {
  if (!existsSync(reportPath)) {
    throw new Error(`Report not found at ${reportPath}`);
  }
  const md = readFileSync(reportPath, 'utf-8');

  const parseArraySection = (heading) => {
    const re = new RegExp(`^## ${heading}\\s*\\n([\\s\\S]*?)(?:\\n## |\\n?$)`, 'm');
    const match = md.match(re);
    if (!match) return [];
    const body = match[1].trim();
    // Expect a JSON array on a single line. Be tolerant of minor whitespace.
    const firstBracket = body.indexOf('[');
    const lastBracket = body.lastIndexOf(']');
    if (firstBracket === -1 || lastBracket === -1) return [];
    try {
      return JSON.parse(body.slice(firstBracket, lastBracket + 1));
    } catch {
      return [];
    }
  };

  return {
    keywords: parseArraySection('Keywords extracted'),
    hard_gaps: parseArraySection('Hard gaps'),
  };
}

function writeKeywordSidecar(reportPath, sidecarData) {
  const sidecarPath = reportPath.replace(/\.md$/, '-keywords.json');
  writeFileSync(sidecarPath, `${JSON.stringify(sidecarData, null, 2)}\n`, 'utf-8');
  return sidecarPath;
}

// ---------------------------------------------------------------------------
// Phase 1: Evaluate
// ---------------------------------------------------------------------------

async function runEvalPhase(item, context) {
  const artifact = JSON.parse(readFileSync(item.job_file, 'utf-8'));
  const jdText = artifact.content?.text || '';
  if (!jdText.trim()) {
    throw new Error(`Normalized job file has empty text: ${item.job_file}`);
  }

  const jdFile = resolve(context.tempDir, `jd-${item.id || item.rank}.txt`);
  writeFileSync(jdFile, `${jdText}\n`, 'utf-8');

  const reportNum = context.reportNumbers[context.indexMap.get(item.id || String(item.rank))];
  const batchId = String(context.batchBaseId + context.indexMap.get(item.id || String(item.rank)));
  const date = new Date().toISOString().slice(0, 10);
  const url = item.url || artifact.source?.final_url || artifact.source?.input_ref || '';

  const resolvedPromptPath = resolve(context.tempDir, `eval-${batchId}.md`);
  const promptText = resolvePromptTemplate(context.evalPromptPath, {
    URL: url,
    JD_FILE: jdFile,
    REPORT_NUM: reportNum,
    DATE: date,
    ID: batchId,
  });
  writeFileSync(resolvedPromptPath, promptText, 'utf-8');

  const logPath = resolve(context.logsDir, `eval-${reportNum}-${batchId}.log`);
  const userPrompt = [
    'Run the batch eval phase on this job.',
    `URL: ${url}`,
    `JD file: ${jdFile}`,
    `Report number: ${reportNum}`,
    `Date: ${date}`,
    `Batch ID: ${batchId}`,
    'Output ONLY a single JSON object matching the schema in your system prompt.',
  ].join('\n');

  const { json: result } = await runClaude({
    promptFile: resolvedPromptPath,
    userPrompt,
    logPath,
    model: context.evalModel,
    thinking: context.evalThinking,
    effort: context.evalEffort,
  });

  if (result.status === 'failed') {
    throw new Error(`Eval worker reported failure: ${result.error || 'unknown'}`);
  }

  const reportPath = resolve(__dirname, result.report_path || `reports/${reportNum}-${kebab(result.company)}-${date}.md`);

  // Build the keyword sidecar from the report content (source of truth)
  // falling back to the worker's JSON fields if the report sections are
  // missing or malformed.
  const reportSidecar = parseReportSidecar(reportPath);
  const sidecarData = {
    job_id: item.id,
    report_num: reportNum,
    company: result.company,
    role: result.role,
    score: result.score,
    archetype: result.archetype,
    keywords: reportSidecar.keywords.length ? reportSidecar.keywords : (result.extracted_keywords || []),
    hard_gaps: reportSidecar.hard_gaps.length ? reportSidecar.hard_gaps : (result.hard_gaps || []),
    generated_at: new Date().toISOString(),
  };
  const sidecarPath = writeKeywordSidecar(reportPath, sidecarData);

  return {
    report_num: reportNum,
    batch_id: batchId,
    jd_file: jdFile,
    date,
    url,
    company: result.company,
    company_slug: result.company_slug || kebab(result.company),
    role: result.role,
    score: Number(result.score) || 0,
    archetype: result.archetype,
    legitimacy: result.legitimacy,
    report_path: reportPath,
    sidecar_path: sidecarPath,
    extracted_keywords: sidecarData.keywords,
    hard_gaps: sidecarData.hard_gaps,
    comp_source: result.comp_source || 'unknown',
    note: result.note || '',
    raw_result: result,
  };
}

// ---------------------------------------------------------------------------
// Phase 2: PDF
// ---------------------------------------------------------------------------

async function runPdfPhase(item, evalResult, context, attempt = 1, previousFeedback = null) {
  const candidateName = context.candidateSlug;
  const companySlug = evalResult.company_slug;
  const date = evalResult.date;
  const outputPdf = resolve(__dirname, 'output', `cv-${candidateName}-${companySlug}-${date}.pdf`);
  const tailoringPath = resolve(context.tempDir, `tailoring-${evalResult.batch_id}-a${attempt}.json`);

  const resolvedPromptPath = resolve(context.tempDir, `pdf-${evalResult.batch_id}-a${attempt}.md`);
  const promptText = readFileSync(context.pdfPromptPath, 'utf-8');
  writeFileSync(resolvedPromptPath, promptText, 'utf-8');

  const baseUserPrompt = [
    'Generate a tailored CV JSON for this job.',
    '',
    'Read these files now:',
    '- cv.md (master CV)',
    '- config/profile.yml (identity, resume.max_pages, role_aliases)',
    `- ${evalResult.jd_file} (the JD text)`,
    `- ${evalResult.sidecar_path} (authoritative keyword reference from phase 1 eval)`,
    '',
    'Use the keyword list in the sidecar as your `keywords` array verbatim. Use the hard_gaps from the sidecar for your `hard_gaps` field. Do NOT re-extract keywords — phase 1 already did that.',
    '',
    'Respect resume.max_pages. Apply the ATS umbrella rule and title-matching rule. Output ONLY a single valid JSON object, no preamble, no fences. Start with { and end with }.',
  ].join('\n');

  const userPrompt = previousFeedback
    ? `${baseUserPrompt}\n\n---\n\nPrevious attempt failed the lint with: ${previousFeedback}\nFix the specific issues above on this attempt.`
    : baseUserPrompt;

  const logPath = resolve(context.logsDir, `pdf-${evalResult.report_num}-${evalResult.batch_id}-a${attempt}.log`);

  const { json: tailoring } = await runClaude({
    promptFile: resolvedPromptPath,
    userPrompt,
    logPath,
    model: context.pdfModel,
    thinking: null,  // PDF phase doesn't need thinking mode
    effort: null,
  });

  writeFileSync(tailoringPath, `${JSON.stringify(tailoring, null, 2)}\n`, 'utf-8');

  // Invoke render-cv.mjs with --json to capture the lint summary
  const render = spawnSync(
    'node',
    [
      resolve(__dirname, 'render-cv.mjs'),
      '--cv', resolve(__dirname, 'cv.md'),
      '--profile', resolve(__dirname, 'config/profile.yml'),
      '--jd', evalResult.jd_file,
      '--tailoring', tailoringPath,
      '--output', outputPdf,
      '--json',
    ],
    {
      cwd: __dirname,
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );

  if (render.status !== 0) {
    writeFileSync(logPath + '.render', render.stderr?.toString() || '', 'utf-8');
    throw new Error(`render-cv.mjs failed with code ${render.status}`);
  }

  let lint;
  try {
    lint = JSON.parse(render.stdout.toString().trim());
  } catch (err) {
    throw new Error(`render-cv.mjs returned non-JSON: ${err.message}`);
  }

  // Retry decision: retry once if coverage below floor OR page overflow
  const needsRetry = attempt === 1 && (
    lint.overflow === true
    || (typeof lint.coverage_pct === 'number' && lint.coverage_pct < (lint.coverage_floor || 80))
  );

  if (needsRetry) {
    const feedbackParts = [];
    if (lint.overflow) {
      feedbackParts.push(`pages ${lint.pages}/${lint.max_pages} (overflow by ${lint.pages - lint.max_pages}). Trim one project or tighten experience bullets.`);
    }
    if (lint.budget && !lint.budget.within_budget) {
      feedbackParts.push(`char budget +${lint.budget.overshoot_pct}% over target. Tighten the summary and cut redundant bullets.`);
    }
    if (typeof lint.coverage_pct === 'number' && lint.coverage_pct < (lint.coverage_floor || 80)) {
      feedbackParts.push(`adjusted coverage ${lint.coverage_pct}% < floor. Inject these missing keywords via ethical rewording: ${(lint.keywords_miss_injectable || []).join(', ')}.`);
    }
    if ((lint.cliches_found || []).length > 0) {
      feedbackParts.push(`clichés to remove: ${lint.cliches_found.join(', ')}`);
    }
    return runPdfPhase(item, evalResult, context, attempt + 1, feedbackParts.join(' '));
  }

  return {
    output: outputPdf,
    tailoring_path: tailoringPath,
    attempt,
    pages: lint.pages,
    max_pages: lint.max_pages,
    overflow: !!lint.overflow,
    coverage_pct: lint.coverage_pct,
    coverage_raw_pct: lint.coverage_raw_pct,
    coverage_ok: !!lint.coverage_ok,
    keywords_hit: lint.keywords_hit,
    keywords_miss_injectable: lint.keywords_miss_injectable || [],
    keywords_miss_hard_gap: lint.keywords_miss_hard_gap || [],
    cliches_found: lint.cliches_found || [],
    budget: lint.budget,
  };
}

// ---------------------------------------------------------------------------
// Phase 3: Tracker TSV (local, no LLM)
// ---------------------------------------------------------------------------

function writeTrackerTsv(evalResult, pdfResult, context) {
  const trackerDir = resolve(__dirname, 'batch/tracker-additions');
  mkdirSync(trackerDir, { recursive: true });

  const trackerNum = context.batchBaseId + context.indexMap.get(evalResult.batch_id)
    ? Number(evalResult.report_num)
    : Number(evalResult.report_num);

  const pdfEmoji = pdfResult && pdfResult.output && existsSync(pdfResult.output) ? '✅' : '❌';
  const scoreStr = `${evalResult.score.toFixed(2)}/5`;
  const reportLink = `[${evalResult.report_num}](reports/${evalResult.report_num}-${evalResult.company_slug}-${evalResult.date}.md)`;
  const status = 'Evaluated';

  const note = (evalResult.note || '').replace(/\t/g, ' ').slice(0, 200);

  const line = [
    trackerNum,
    evalResult.date,
    evalResult.company,
    evalResult.role,
    status,
    scoreStr,
    pdfEmoji,
    reportLink,
    note,
  ].join('\t');

  const tsvPath = resolve(trackerDir, `${evalResult.report_num}-${evalResult.company_slug}.tsv`);
  writeFileSync(tsvPath, `${line}\n`, 'utf-8');
  return tsvPath;
}

// ---------------------------------------------------------------------------
// processItem — 2-phase per-job orchestrator
// ---------------------------------------------------------------------------

async function processItem(item, context) {
  if (!item.job_file || !existsSync(item.job_file)) {
    throw new Error(`Missing normalized job file for ${item.id || item.rank}`);
  }

  // Phase 1: Evaluate
  const evalResult = await runEvalPhase(item, context);

  // Decide whether to run phase 2
  const forceList = context.forcePdfIds || [];
  const forced = forceList.includes(item.id) || forceList.includes(String(item.rank));
  const meetsThreshold = evalResult.score >= context.pdfThreshold;
  const shouldRunPdf = !context.skipPdf && (forced || meetsThreshold);

  let pdfResult = null;
  let pdfSkipReason = null;
  if (shouldRunPdf) {
    try {
      pdfResult = await runPdfPhase(item, evalResult, context);
    } catch (err) {
      pdfSkipReason = `pdf_phase_failed: ${err.message}`;
    }
  } else if (context.skipPdf) {
    pdfSkipReason = 'skip-pdf flag set';
  } else {
    pdfSkipReason = `score ${evalResult.score.toFixed(2)} < threshold ${context.pdfThreshold}`;
  }

  // Phase 3: Tracker TSV
  const tsvPath = writeTrackerTsv(evalResult, pdfResult, context);

  return {
    id: item.id,
    rank: item.rank,
    report_num: evalResult.report_num,
    batch_id: evalResult.batch_id,
    company: evalResult.company,
    role: evalResult.role,
    score: evalResult.score,
    archetype: evalResult.archetype,
    legitimacy: evalResult.legitimacy,
    report_path: evalResult.report_path,
    sidecar_path: evalResult.sidecar_path,
    pdf: pdfResult ? pdfResult.output : null,
    pdf_result: pdfResult,
    pdf_skipped_reason: pdfSkipReason,
    tsv_path: tsvPath,
    url: evalResult.url,
  };
}

// ---------------------------------------------------------------------------
// Concurrency pool
// ---------------------------------------------------------------------------

async function runPool(items, parallel, handler) {
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < items.length) {
      const current = nextIndex;
      nextIndex += 1;
      await handler(items[current], current);
    }
  }

  const workers = Array.from({ length: Math.min(parallel, items.length) }, () => worker());
  await Promise.all(workers);
}

function ensureCommand(command) {
  return new Promise((resolvePromise) => {
    const child = spawn(command, ['--version'], {
      cwd: __dirname,
      stdio: 'ignore',
    });
    child.on('error', () => resolvePromise(false));
    child.on('close', (code) => resolvePromise(code === 0 || code === 1));
  });
}

function loadCandidateSlug() {
  try {
    const profilePath = resolve(__dirname, 'config/profile.yml');
    if (!existsSync(profilePath)) return 'candidate';
    // Light YAML parse — just grab full_name
    const content = readFileSync(profilePath, 'utf-8');
    const match = content.match(/^\s*full_name:\s*["']?([^"'\n]+)["']?/m);
    if (!match) return 'candidate';
    return kebab(match[1].trim());
  } catch {
    return 'candidate';
  }
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }

  if (!existsSync(args.evalPrompt)) {
    throw new Error(`Eval prompt file not found: ${args.evalPrompt}`);
  }
  if (!existsSync(args.pdfPrompt)) {
    throw new Error(`PDF prompt file not found: ${args.pdfPrompt}`);
  }

  const claudeAvailable = await ensureCommand('claude');
  if (!claudeAvailable) {
    throw new Error('claude CLI not found in PATH');
  }

  const items = loadItems(args.from).sort((a, b) => a.rank - b.rank);
  const selected = selectItems(items, args);

  if (selected.length === 0) {
    printSelectionTable(items.slice(0, Math.min(20, items.length)), 'No promotion selection provided.');
    console.log('Choose one of the following and rerun:');
    console.log(`  node full-customize.mjs --from ${args.from.replace(/\\/g, '/')} --top 10`);
    console.log(`  node full-customize.mjs --from ${args.from.replace(/\\/g, '/')} --ranks 1,2,5`);
    console.log(`  node full-customize.mjs --from ${args.from.replace(/\\/g, '/')} --ids job-a,job-b`);
    process.exit(1);
  }

  printSelectionTable(selected, `Selected ${selected.length} jobs for full-customize`);

  const manifest = {
    generated_at: new Date().toISOString(),
    source: args.from,
    approved: args.approve,
    selection: {
      top: args.top,
      ranks: args.ranks,
      ids: args.ids,
      parallel: args.parallel,
    },
    config: {
      eval_model: args.evalModel,
      eval_thinking: args.evalThinking,
      eval_effort: args.evalEffort,
      pdf_model: args.pdfModel,
      pdf_threshold: args.pdfThreshold,
      force_pdf_ids: args.forcePdfIds,
      skip_pdf: args.skipPdf,
    },
    jobs: selected,
  };

  mkdirSync(dirname(args.outManifest), { recursive: true });
  writeFileSync(args.outManifest, `${JSON.stringify(manifest, null, 2)}\n`, 'utf-8');

  console.log(`Phase 1 model:    ${args.evalModel} (thinking=${args.evalThinking}, effort=${args.evalEffort})`);
  console.log(`Phase 2 model:    ${args.pdfModel}${args.skipPdf ? ' [SKIPPED]' : ''}`);
  console.log(`PDF threshold:    ${args.pdfThreshold.toFixed(2)} (score >= this triggers phase 2)`);
  if (args.forcePdfIds.length) {
    console.log(`Force PDF ids:    ${args.forcePdfIds.join(', ')}`);
  }
  console.log('');

  if (args.dryRun || !args.approve) {
    console.log(`Promotion manifest written to ${args.outManifest}`);
    if (!args.approve) {
      console.log('Approval required. Re-run the same command with --approve to execute.');
    }
    return;
  }

  const tempDir = resolve(__dirname, 'batch/tmp');
  const logsDir = resolve(__dirname, 'batch/logs');
  mkdirSync(tempDir, { recursive: true });
  mkdirSync(logsDir, { recursive: true });
  mkdirSync(resolve(__dirname, 'batch/tracker-additions'), { recursive: true });
  mkdirSync(resolve(__dirname, 'reports'), { recursive: true });
  mkdirSync(resolve(__dirname, 'output'), { recursive: true });

  const reportNumbers = nextReportNumbers(selected.length);
  const indexMap = new Map(selected.map((item, index) => [item.id || String(item.rank), index]));
  const context = {
    evalPromptPath: args.evalPrompt,
    pdfPromptPath: args.pdfPrompt,
    tempDir,
    logsDir,
    reportNumbers,
    indexMap,
    batchBaseId: Date.now(),
    evalModel: args.evalModel,
    evalThinking: args.evalThinking,
    evalEffort: args.evalEffort,
    pdfModel: args.pdfModel,
    pdfThreshold: args.pdfThreshold,
    forcePdfIds: args.forcePdfIds,
    skipPdf: args.skipPdf,
    candidateSlug: loadCandidateSlug(),
  };

  const results = [];
  const failures = [];

  await runPool(selected, args.parallel, async (item) => {
    try {
      const result = await processItem(item, context);
      results.push(result);
      const pdfNote = result.pdf
        ? `pdf ✓ (${result.pdf_result.pages}pg, ${result.pdf_result.coverage_pct}%)`
        : `pdf skipped: ${result.pdf_skipped_reason}`;
      console.log(`✓ #${item.rank} ${result.company} | ${result.role} — score ${result.score.toFixed(2)} — ${pdfNote}`);
    } catch (error) {
      failures.push({
        id: item.id,
        rank: item.rank,
        company: item.company,
        role: item.role,
        error: error.message,
      });
      console.log(`✗ #${item.rank} ${item.company} | ${item.role}`);
      console.log(`  ${error.message}`);
    }
  });

  const finalManifest = {
    ...manifest,
    executed_at: new Date().toISOString(),
    completed: results.length,
    failed: failures.length,
    pdf_generated: results.filter((r) => r.pdf).length,
    pdf_skipped: results.filter((r) => !r.pdf).length,
    results,
    failures,
  };
  writeFileSync(args.outManifest, `${JSON.stringify(finalManifest, null, 2)}\n`, 'utf-8');

  const mergeRun = spawn('node', ['merge-tracker.mjs'], {
    cwd: __dirname,
    stdio: 'inherit',
  });
  await new Promise((resolvePromise, rejectPromise) => {
    mergeRun.on('error', rejectPromise);
    mergeRun.on('close', (code) => (code === 0 ? resolvePromise() : rejectPromise(new Error(`merge failed: ${code}`))));
  });

  const verifyRun = spawn('node', ['verify-pipeline.mjs'], {
    cwd: __dirname,
    stdio: 'inherit',
  });
  await new Promise((resolvePromise) => {
    verifyRun.on('error', () => resolvePromise());
    verifyRun.on('close', () => resolvePromise());
  });

  console.log('');
  console.log(`Completed jobs:   ${results.length}`);
  console.log(`Failed jobs:      ${failures.length}`);
  console.log(`PDFs generated:   ${finalManifest.pdf_generated}`);
  console.log(`PDFs skipped:     ${finalManifest.pdf_skipped}`);
  console.log(`Manifest:         ${args.outManifest}`);
}

main().catch((error) => {
  console.error(`Fatal: ${error.message}`);
  process.exit(1);
});
