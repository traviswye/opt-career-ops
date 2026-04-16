#!/usr/bin/env node

import { spawn } from 'child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'fs';
import { availableParallelism } from 'os';
import { dirname, extname, resolve } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

function defaultParallelWorkers() {
  try {
    const concurrency = availableParallelism();
    return Math.max(2, Math.min(6, Math.floor(concurrency / 2)));
  } catch {
    return 3;
  }
}

const DEFAULT_PARALLEL = defaultParallelWorkers();

const DEFAULTS = {
  jobs: resolve(__dirname, 'jds/normalized'),
  pack: resolve(__dirname, 'data/candidate-pack.json'),
  outDir: resolve(__dirname, 'data/triage'),
  prompt: resolve(__dirname, 'batch/triage-prompt.md'),
  parallel: DEFAULT_PARALLEL,
  chunkSize: 12,
  force: false,
  dryRun: false,
  // Haiku is the default for high-volume triage. Override with --model.
  model: 'claude-haiku-4-5-20251001',
};

function printHelp() {
  console.log(`career-ops triage

Run low-cost lite scoring against normalized JD artifacts.

Usage:
  node triage-lite.mjs [options]

Options:
  --jobs PATH        Directory of normalized JD JSON files or an index.json manifest
  --pack PATH        Candidate pack JSON (default: data/candidate-pack.json)
  --out-dir PATH     Output directory (default: data/triage)
  --prompt PATH      System prompt file (default: batch/triage-prompt.md)
  --parallel N       Concurrent worker batches (default: ${DEFAULT_PARALLEL})
  --chunk-size N     Jobs per Claude scoring batch (default: 12)
  --model ID         Claude model id (default: claude-haiku-4-5-20251001)
                     Common options: claude-haiku-4-5-20251001, claude-sonnet-4-6, claude-opus-4-6
  --force            Re-run jobs even if item results already exist
  --dry-run          Show which jobs would run without invoking Claude
  -h, --help         Show help
`);
}

function parseArgs(argv) {
  const args = { ...DEFAULTS };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    switch (arg) {
      case '--jobs':
        args.jobs = resolve(argv[++index]);
        break;
      case '--pack':
        args.pack = resolve(argv[++index]);
        break;
      case '--out-dir':
        args.outDir = resolve(argv[++index]);
        break;
      case '--prompt':
        args.prompt = resolve(argv[++index]);
        break;
      case '--parallel':
        args.parallel = Math.max(1, Number.parseInt(argv[++index], 10) || 1);
        break;
      case '--chunk-size':
        args.chunkSize = Math.max(1, Number.parseInt(argv[++index], 10) || 1);
        break;
      case '--model':
        args.model = String(argv[++index] || '').trim();
        if (!args.model) throw new Error('--model requires a value');
        break;
      case '--force':
        args.force = true;
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

function collectJobFiles(inputPath) {
  if (!existsSync(inputPath)) {
    throw new Error(`Jobs input not found: ${inputPath}`);
  }

  const extension = extname(inputPath).toLowerCase();
  if (extension === '.json') {
    const payload = JSON.parse(readFileSync(inputPath, 'utf-8'));
    if (Array.isArray(payload)) return payload;
    if (Array.isArray(payload.items)) {
      return payload.items.map((item) => item.job_file || item.path).filter(Boolean);
    }
    throw new Error(`Unsupported manifest shape: ${inputPath}`);
  }

  return readdirSync(inputPath)
    .filter((entry) => entry.endsWith('.json') && entry !== 'index.json')
    .map((entry) => resolve(inputPath, entry))
    .sort();
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf-8'));
}

function tryParseJson(stdout) {
  const trimmed = stdout.trim();
  if (!trimmed) throw new Error('Worker returned empty output');

  try {
    return JSON.parse(trimmed);
  } catch {
    const arrayMatches = trimmed.match(/\[[\s\S]*\]/g);
    if (arrayMatches && arrayMatches.length > 0) {
      return JSON.parse(arrayMatches[arrayMatches.length - 1]);
    }

    const objectMatches = trimmed.match(/\{[\s\S]*\}/g);
    if (!objectMatches || objectMatches.length === 0) {
      throw new Error('Worker output did not contain JSON');
    }
    return JSON.parse(objectMatches[objectMatches.length - 1]);
  }
}

function normalizeBucket(bucket, score) {
  const normalized = String(bucket || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
  if (['strong_include', 'include', 'borderline', 'exclude'].includes(normalized)) {
    return normalized;
  }

  const numericScore = Number(score || 0);
  if (numericScore >= 4.2) return 'strong_include';
  if (numericScore >= 3.4) return 'include';
  if (numericScore >= 2.8) return 'borderline';
  return 'exclude';
}

function classificationFromBucket(bucket) {
  switch (bucket) {
    case 'strong_include':
    case 'include':
      return 'apply';
    case 'borderline':
      return 'maybe';
    default:
      return 'reject';
  }
}

function bucketRank(bucket) {
  switch (bucket) {
    case 'strong_include':
      return 0;
    case 'include':
      return 1;
    case 'borderline':
      return 2;
    default:
      return 3;
  }
}

function chunkItems(items, chunkSize) {
  const chunks = [];
  for (let index = 0; index < items.length; index += chunkSize) {
    chunks.push(items.slice(index, index + chunkSize));
  }
  return chunks;
}

function normalizeWorkerResult(workerResult, artifact, jobFile, timestamp) {
  const bucket = normalizeBucket(workerResult.bucket, workerResult.score);
  return {
    ...workerResult,
    id: artifact.id || jobFile,
    bucket,
    classification: workerResult.classification || classificationFromBucket(bucket),
    company: workerResult.company || artifact.job?.company || null,
    role: workerResult.role || artifact.job?.title || null,
    top_concerns: workerResult.top_concerns || workerResult.top_gaps || [],
    url: artifact.source?.final_url || artifact.source?.input_ref || null,
    job_file: jobFile,
    markdown_path: artifact.content?.markdown_path || null,
    liveness: artifact.status?.liveness || null,
    generated_at: timestamp,
  };
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

async function processJob(jobFile, args, paths) {
  const artifact = readJson(jobFile);
  const id = artifact.id || jobFile;
  const itemPath = resolve(paths.itemsDir, `${id}.json`);
  const logPath = resolve(paths.logsDir, `triage-${id}.log`);

  if (existsSync(itemPath) && !args.force) {
    return { status: 'cached', result: readJson(itemPath) };
  }

  const userPrompt = [
    'Triage this role for promotion.',
    `candidate pack: ${args.pack}`,
    `job file: ${jobFile}`,
    `job id: ${id}`,
    'Return JSON only.',
  ].join('\n');

  const workerResult = await runClaude(args.prompt, userPrompt, logPath, args.model);
  const mergedResult = normalizeWorkerResult(workerResult, artifact, jobFile, new Date().toISOString());
  writeFileSync(itemPath, `${JSON.stringify(mergedResult, null, 2)}\n`, 'utf-8');
  return { status: 'scored', result: mergedResult };
}

async function processChunk(jobFiles, args, paths) {
  const prepared = jobFiles.map((jobFile) => {
    const artifact = readJson(jobFile);
    const id = artifact.id || jobFile;
    const itemPath = resolve(paths.itemsDir, `${id}.json`);
    return { artifact, id, itemPath, jobFile };
  });

  const cachedResults = [];
  const pending = [];

  for (const item of prepared) {
    if (existsSync(item.itemPath) && !args.force) {
      cachedResults.push({ status: 'cached', result: readJson(item.itemPath) });
    } else {
      pending.push(item);
    }
  }

  if (pending.length === 0) {
    return cachedResults;
  }

  if (pending.length === 1) {
    const single = await processJob(pending[0].jobFile, args, paths);
    return [...cachedResults, single];
  }

  const logPath = resolve(paths.logsDir, `triage-batch-${pending[0].id}-${pending[pending.length - 1].id}.log`);
  const userPrompt = [
    'Lite-score these roles for promotion as one batch.',
    `candidate pack: ${args.pack}`,
    'job files:',
    ...pending.map((item) => `- ${item.id}: ${item.jobFile}`),
    'Return JSON array only. One object per job id.',
  ].join('\n');

  try {
    const workerResult = await runClaude(args.prompt, userPrompt, logPath, args.model);
    if (!Array.isArray(workerResult)) {
      throw new Error('Batch worker did not return a JSON array');
    }

    const byId = new Map();
    for (const item of workerResult) {
      const id = String(item?.id || '').trim();
      if (!id) continue;
      byId.set(id, item);
    }

    const timestamp = new Date().toISOString();
    const batchResults = [];

    for (const item of pending) {
      const workerItem = byId.get(item.id);
      if (!workerItem) {
        throw new Error(`Batch worker omitted result for ${item.id}`);
      }

      const mergedResult = normalizeWorkerResult(workerItem, item.artifact, item.jobFile, timestamp);
      writeFileSync(item.itemPath, `${JSON.stringify(mergedResult, null, 2)}\n`, 'utf-8');
      batchResults.push({ status: 'scored', result: mergedResult });
    }

    return [...cachedResults, ...batchResults];
  } catch {
    const fallbackResults = [...cachedResults];
    for (const item of pending) {
      fallbackResults.push(await processJob(item.jobFile, args, paths));
    }
    return fallbackResults;
  }
}

async function runPool(items, parallel, handler) {
  const results = new Array(items.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      results[currentIndex] = await handler(items[currentIndex], currentIndex);
    }
  }

  const workers = Array.from({ length: Math.min(parallel, items.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }

  if (!existsSync(args.pack)) {
    throw new Error(`Candidate pack not found: ${args.pack}`);
  }
  if (!existsSync(args.prompt)) {
    throw new Error(`Prompt not found: ${args.prompt}`);
  }

  const jobFiles = collectJobFiles(args.jobs);
  if (jobFiles.length === 0) {
    console.log('No normalized job files found.');
    return;
  }

  const paths = {
    itemsDir: resolve(args.outDir, 'items'),
    logsDir: resolve(__dirname, 'batch/logs'),
  };

  mkdirSync(args.outDir, { recursive: true });
  mkdirSync(paths.itemsDir, { recursive: true });
  mkdirSync(paths.logsDir, { recursive: true });

  if (args.dryRun) {
    console.log(`Would triage ${jobFiles.length} jobs with pack ${args.pack}`);
    console.log(`Parallel workers: ${args.parallel}`);
    console.log(`Chunk size: ${args.chunkSize}`);
    return;
  }

  console.log(`Running triage with ${args.parallel} worker${args.parallel === 1 ? '' : 's'} and chunk size ${args.chunkSize}.`);

  const outcomes = [];
  const failures = [];
  const jobChunks = chunkItems(jobFiles, args.chunkSize);

  await runPool(jobChunks, args.parallel, async (jobChunk) => {
    try {
      const chunkOutcomes = await processChunk(jobChunk, args, paths);
      for (const outcome of chunkOutcomes) {
        outcomes.push(outcome.result);
        console.log(`${outcome.status === 'cached' ? 'cached' : 'scored'} ${outcome.result.job_file}`);
      }
    } catch (error) {
      for (const jobFile of jobChunk) {
        failures.push({ job_file: jobFile, error: error.message });
        console.log(`failed ${jobFile}`);
      }
      console.log(`  ${error.message}`);
    }
  });

  const sorted = outcomes.sort((left, right) => {
    const bucketDiff = bucketRank(left.bucket) - bucketRank(right.bucket);
    if (bucketDiff !== 0) return bucketDiff;

    const scoreDiff = Number(right.score || 0) - Number(left.score || 0);
    if (scoreDiff !== 0) return scoreDiff;
    return String(left.company || '').localeCompare(String(right.company || ''));
  });

  const payload = {
    generated_at: new Date().toISOString(),
    candidate_pack: args.pack,
    total_jobs: jobFiles.length,
    scored_jobs: sorted.length,
    failed_jobs: failures.length,
    parallel_workers: args.parallel,
    chunk_size: args.chunkSize,
    results: sorted,
    failures,
  };

  writeFileSync(resolve(args.outDir, 'results.json'), `${JSON.stringify(payload, null, 2)}\n`, 'utf-8');

  const tsvLines = [
    'id\tcompany\trole\tscore\tbucket\tclassification\tarchetype\tjob_file\turl',
    ...sorted.map((item) => [
      item.id,
      item.company || '',
      item.role || '',
      item.score ?? '',
      item.bucket || '',
      item.classification || '',
      item.archetype || '',
      item.job_file || '',
      item.url || '',
    ].join('\t')),
  ];
  writeFileSync(resolve(args.outDir, 'results.tsv'), `${tsvLines.join('\n')}\n`, 'utf-8');

  console.log('');
  console.log(`Scored jobs: ${sorted.length}`);
  console.log(`Failed jobs: ${failures.length}`);
  console.log(`Results:     ${resolve(args.outDir, 'results.json')}`);
}

main().catch((error) => {
  console.error(`Fatal: ${error.message}`);
  process.exit(1);
});
