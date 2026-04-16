#!/usr/bin/env node

import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));

const DEFAULTS = {
  from: resolve(__dirname, 'data/triage/shortlist.json'),
  prompt: resolve(__dirname, 'batch/batch-prompt.md'),
  outManifest: resolve(__dirname, 'data/triage/promotion-manifest.json'),
  parallel: 1,
  approve: false,
  dryRun: false,
  top: null,
  ids: [],
  ranks: [],
  // Pin the model explicitly. Sonnet is the default because the full-customize
  // worker now uses focused prompts + a deterministic local renderer
  // (render-cv.mjs), so Opus is no longer justified. Override with --model.
  model: 'claude-sonnet-4-6',
};

function printHelp() {
  console.log(`career-ops full-customize

Run the expensive full customization pipeline only for an approved shortlisted set.

Usage:
  node full-customize.mjs [options]

Options:
  --from PATH         Shortlist JSON or triage results JSON (default: data/triage/shortlist.json)
  --top N             Promote the top N ranked jobs
  --ranks VALUES      Comma-separated shortlist ranks to promote
  --ids VALUES        Comma-separated job ids to promote
  --parallel N        Concurrent workers (default: 1)
  --prompt PATH       Full customization prompt (default: batch/batch-prompt.md)
  --out-manifest PATH Promotion manifest path (default: data/triage/promotion-manifest.json)
  --model ID          Claude model id (default: claude-sonnet-4-6)
                      Common options: claude-sonnet-4-6, claude-opus-4-6, claude-haiku-4-5-20251001
  --approve           Required to execute the selected jobs
  --dry-run           Preview selection without running workers
  -h, --help          Show help

Examples:
  node full-customize.mjs --from data/triage/results.json --top 10
  node full-customize.mjs --from data/triage/results.json --top 10 --approve
  node full-customize.mjs --from data/triage/shortlist.json --ranks 1,3,5 --approve
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
      case '--prompt':
        args.prompt = resolve(argv[++i]);
        break;
      case '--out-manifest':
        args.outManifest = resolve(argv[++i]);
        break;
      case '--model':
        args.model = String(argv[++i] || '').trim();
        if (!args.model) throw new Error('--model requires a value');
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

function tryParseJson(stdout) {
  const trimmed = stdout.trim();
  if (!trimmed) throw new Error('Worker returned empty output');

  try {
    return JSON.parse(trimmed);
  } catch {
    const matches = trimmed.match(/\{[\s\S]*\}/g);
    if (!matches || matches.length === 0) {
      throw new Error('Worker output did not contain JSON');
    }
    return JSON.parse(matches[matches.length - 1]);
  }
}

function runClaude(promptFile, userPrompt, logPath, model) {
  return new Promise((resolvePromise, rejectPromise) => {
    const claudeArgs = [
      '-p',
      '--dangerously-skip-permissions',
      '--append-system-prompt-file',
      promptFile,
    ];
    if (model) {
      claudeArgs.push('--model', model);
    }
    claudeArgs.push(userPrompt);

    const child = spawn('claude', claudeArgs, {
      cwd: __dirname,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    child.on('error', (error) => {
      rejectPromise(error);
    });

    child.on('close', (code) => {
      writeFileSync(logPath, `${stdout}${stderr ? `\n[stderr]\n${stderr}` : ''}`, 'utf-8');

      if (code !== 0) {
        rejectPromise(new Error(`claude exited with code ${code}`));
        return;
      }

      try {
        resolvePromise(tryParseJson(stdout));
      } catch (error) {
        rejectPromise(error);
      }
    });
  });
}

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

async function processItem(item, context) {
  if (!item.job_file || !existsSync(item.job_file)) {
    throw new Error(`Missing normalized job file for ${item.id || item.rank}`);
  }

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
  const resolvedPromptPath = resolve(context.tempDir, `resolved-${batchId}.md`);
  const promptText = resolvePromptTemplate(context.promptPath, {
    URL: item.url || artifact.source?.final_url || artifact.source?.input_ref || '',
    JD_FILE: jdFile,
    REPORT_NUM: reportNum,
    DATE: date,
    ID: batchId,
  });
  writeFileSync(resolvedPromptPath, promptText, 'utf-8');

  const logPath = resolve(context.logsDir, `full-${reportNum}-${batchId}.log`);
  const userPrompt = [
    'Procesa esta oferta de empleo. Ejecuta el pipeline completo: evaluación A-F + report .md + PDF + tracker line.',
    `URL: ${item.url || artifact.source?.final_url || artifact.source?.input_ref || ''}`,
    `JD file: ${jdFile}`,
    `Report number: ${reportNum}`,
    `Date: ${date}`,
    `Batch ID: ${batchId}`,
  ].join(' ');

  try {
    const result = await runClaude(resolvedPromptPath, userPrompt, logPath, context.model);
    return {
      ...result,
      id: item.id,
      rank: item.rank,
      report_num: result.report_num || reportNum,
      batch_id: batchId,
      job_file: item.job_file,
      url: item.url || artifact.source?.final_url || artifact.source?.input_ref || null,
    };
  } finally {
    // Keep temp files in place for debugging only if the run crashes before cleanup.
  }
}

async function runMergeAndVerify() {
  const { default: mergeModule } = await import('./merge-tracker.mjs').catch(() => ({ default: null }));
  if (mergeModule) {
    return;
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }

  if (!existsSync(args.prompt)) {
    throw new Error(`Prompt file not found: ${args.prompt}`);
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
    console.log(`  npm run full-customize -- --from ${args.from.replace(/\\/g, '/')} --top 10`);
    console.log(`  npm run full-customize -- --from ${args.from.replace(/\\/g, '/')} --ranks 1,2,5`);
    console.log(`  npm run full-customize -- --from ${args.from.replace(/\\/g, '/')} --ids job-a,job-b`);
    process.exit(1);
  }

  printSelectionTable(selected, `Selected ${selected.length} jobs for full customization`);

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
    jobs: selected,
  };

  mkdirSync(dirname(args.outManifest), { recursive: true });
  writeFileSync(args.outManifest, `${JSON.stringify(manifest, null, 2)}\n`, 'utf-8');

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
    promptPath: args.prompt,
    tempDir,
    logsDir,
    reportNumbers,
    indexMap,
    batchBaseId: Date.now(),
    model: args.model,
  };

  console.log(`Model pinned: ${args.model}`);

  const results = [];
  const failures = [];

  await runPool(selected, args.parallel, async (item) => {
    try {
      const result = await processItem(item, context);
      results.push(result);
      console.log(`✓ #${item.rank} ${item.company} | ${item.role}`);
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
  console.log(`Completed jobs: ${results.length}`);
  console.log(`Failed jobs:    ${failures.length}`);
  console.log(`Manifest:       ${args.outManifest}`);
}

main().catch((error) => {
  console.error(`Fatal: ${error.message}`);
  process.exit(1);
});
