#!/usr/bin/env node

/**
 * run-pipeline.mjs — Zero-token pipeline orchestrator
 *
 * Chains all zero-token stages in order:
 *   1. build-prefilter-policy.mjs  (profile.yml → policy JSON)
 *   2. scan-local.mjs              (portal API hits → scan results)
 *   3. scan-filter.mjs             (title/location/company cap filter)
 *   4. extract-jd.mjs              (fetch full JDs → normalized artifacts)
 *   5. prefilter-jobs.mjs          (body-aware location + title filter)
 *   6. candidate-pack.mjs          (aggregate candidate context)
 *
 * STOPS HERE. Everything above is zero Claude API tokens.
 *
 * The user then explicitly runs:
 *   npm run triage     (Haiku tokens — cheap scoring)
 *   npm run customize  (Sonnet tokens — eval + PDF)
 *
 * Usage:
 *   node run-pipeline.mjs [options]
 *
 * Options:
 *   --skip-scan        Skip steps 2-3 (reuse existing scan results)
 *   --skip-extract     Skip step 4 (reuse existing normalized JDs)
 *   --from-extract     Start from step 4 (skip scan + filter, extract from kept.md)
 *   --from-prefilter   Start from step 5 (skip scan + filter + extract)
 *   --dry-run          Print what would run without executing
 *   -h, --help         Show help
 */

import { spawn } from 'child_process';
import { existsSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

function printHelp() {
  console.log(`career-ops pipeline — Zero-token data collection orchestrator

Runs all zero-token stages (scan → filter → extract → prefilter → candidate pack)
in sequence and stops before triage, which is the first stage that spends tokens.

Usage:
  node run-pipeline.mjs [options]

Options:
  --skip-scan        Skip scan + scan-filter (reuse existing scan results)
  --skip-extract     Skip extraction (reuse existing normalized JDs)
  --from-extract     Start from extraction (assumes scan-filter already ran)
  --from-prefilter   Start from prefilter (assumes JDs already extracted)
  --dry-run          Print what would run without executing
  -h, --help         Show help

After this completes, run:
  npm run triage                     (Haiku tokens — cheap scoring, ~$2-3 for 300 jobs)
  npm run full-customize -- --top 10 (Sonnet tokens — eval + PDF for shortlisted jobs)
`);
}

function parseArgs(argv) {
  const args = {
    skipScan: false,
    skipExtract: false,
    fromExtract: false,
    fromPrefilter: false,
    dryRun: false,
  };

  for (const arg of argv) {
    switch (arg) {
      case '--skip-scan': args.skipScan = true; break;
      case '--skip-extract': args.skipExtract = true; break;
      case '--from-extract': args.fromExtract = true; break;
      case '--from-prefilter': args.fromPrefilter = true; break;
      case '--dry-run': args.dryRun = true; break;
      case '-h':
      case '--help': printHelp(); process.exit(0);
      default: throw new Error(`Unknown option: ${arg}`);
    }
  }

  return args;
}

function runStep(label, command, commandArgs) {
  return new Promise((resolvePromise, rejectPromise) => {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`▶ ${label}`);
    console.log(`  ${command} ${commandArgs.join(' ')}`);
    console.log('='.repeat(60));

    const child = spawn(command, commandArgs, {
      cwd: __dirname,
      stdio: 'inherit',
    });

    child.on('error', (err) => rejectPromise(new Error(`${label}: ${err.message}`)));
    child.on('close', (code) => {
      if (code !== 0) {
        rejectPromise(new Error(`${label} failed with exit code ${code}`));
      } else {
        console.log(`✓ ${label} complete`);
        resolvePromise();
      }
    });
  });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  const steps = [];

  // Step 1: Always rebuild policy (fast, ensures it's current)
  steps.push({
    label: 'Step 1: Build prefilter policy',
    command: 'node',
    args: ['build-prefilter-policy.mjs'],
    skip: false,
  });

  // Step 2: Scan portals
  const skipScan = args.skipScan || args.fromExtract || args.fromPrefilter;
  steps.push({
    label: 'Step 2: Scan portals (zero-token, ATS API hits)',
    command: 'node',
    args: ['scan-local.mjs'],
    skip: skipScan,
  });

  // Step 3: Filter scan results
  steps.push({
    label: 'Step 3: Filter scan results (title, location, company cap)',
    command: 'node',
    args: ['scan-filter.mjs'],
    skip: skipScan,
  });

  // Step 4: Extract JDs
  const skipExtract = args.skipExtract || args.fromPrefilter;
  const extractFrom = existsSync(resolve(__dirname, 'data/scan-filter/kept.md'))
    ? 'data/scan-filter/kept.md'
    : null;
  steps.push({
    label: 'Step 4: Extract JDs (Playwright + ATS APIs, zero Claude tokens)',
    command: 'node',
    args: extractFrom
      ? ['extract-jd.mjs', '--from', extractFrom]
      : ['extract-jd.mjs'],
    skip: skipExtract,
  });

  // Step 5: Prefilter
  steps.push({
    label: 'Step 5: Prefilter (body-aware location + title + seniority)',
    command: 'node',
    args: ['prefilter-jobs.mjs', '--jobs', 'jds/normalized', '--policy', 'data/prefilter-policy.json'],
    skip: false,
  });

  // Step 6: Build candidate pack
  steps.push({
    label: 'Step 6: Build candidate pack',
    command: 'node',
    args: ['candidate-pack.mjs'],
    skip: false,
  });

  if (args.dryRun) {
    console.log('DRY RUN — would execute:\n');
    for (const step of steps) {
      const status = step.skip ? '(SKIP)' : '(RUN)';
      console.log(`  ${status} ${step.label}`);
      if (!step.skip) console.log(`         ${step.command} ${step.args.join(' ')}`);
    }
    console.log('\nThen stop. User runs triage separately.');
    return;
  }

  const start = Date.now();
  let completed = 0;
  let skipped = 0;

  for (const step of steps) {
    if (step.skip) {
      console.log(`\n⏭ Skipping: ${step.label}`);
      skipped++;
      continue;
    }
    await runStep(step.label, step.command, step.args);
    completed++;
  }

  const elapsed = ((Date.now() - start) / 1000).toFixed(1);

  console.log(`\n${'='.repeat(60)}`);
  console.log('✅ Zero-token pipeline complete');
  console.log(`   Steps run: ${completed}, skipped: ${skipped}`);
  console.log(`   Wall clock: ${elapsed}s`);
  console.log(`   Token cost: $0.00 (all stages are zero-token)`);
  console.log('');

  // Report what's ready for triage
  const keptPath = resolve(__dirname, 'data/prefilter/kept.json');
  if (existsSync(keptPath)) {
    try {
      const kept = JSON.parse(require('fs').readFileSync(keptPath, 'utf-8'));
      const count = (kept.items || kept).length || '?';
      console.log(`   Jobs ready for triage: ${count}`);
    } catch { /* ignore */ }
  }

  console.log('');
  console.log('Next steps (token-spending stages):');
  console.log('  npm run triage                               # Haiku — ~$2-3 for 300 jobs');
  console.log('  npm run analyze-triage                       # Zero-token — review results');
  console.log('  npm run full-customize -- --top 10 --approve # Sonnet — eval + PDF for top 10');
  console.log('='.repeat(60));
}

main().catch((err) => {
  console.error(`\n❌ Pipeline failed: ${err.message}`);
  process.exit(1);
});
