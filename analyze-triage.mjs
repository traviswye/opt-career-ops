#!/usr/bin/env node

import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

const DEFAULTS = {
  from: resolve(__dirname, 'data/triage/results.json'),
  topPercent: 10,
  topRows: 12,
};

function printHelp() {
  console.log(`career-ops analyze-triage

Summarize lite-scoring results from data/triage/results.json.

Usage:
  node analyze-triage.mjs [options]

Options:
  --from PATH         Results JSON path (default: data/triage/results.json)
  --top-percent N     Percentile cutoff to inspect (default: 10)
  --top-rows N        Number of top rows to print (default: 12)
  -h, --help          Show help
`);
}

function parseArgs(argv) {
  const args = { ...DEFAULTS };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    switch (arg) {
      case '--from':
        args.from = resolve(argv[++index]);
        break;
      case '--top-percent':
        args.topPercent = Math.max(1, Math.min(100, Number.parseFloat(argv[++index]) || 10));
        break;
      case '--top-rows':
        args.topRows = Math.max(1, Number.parseInt(argv[++index], 10) || 12);
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

function loadResults(path) {
  if (!existsSync(path)) {
    throw new Error(`Results file not found: ${path}`);
  }

  const payload = JSON.parse(readFileSync(path, 'utf-8'));
  const results = Array.isArray(payload?.results) ? payload.results : Array.isArray(payload) ? payload : null;

  if (!results) {
    throw new Error(`Unsupported results shape in ${path}`);
  }

  return results.map((item) => ({
    id: item.id || '',
    company: item.company || '',
    role: item.role || '',
    score: Number(item.score || 0),
    bucket: item.bucket || '',
    classification: item.classification || '',
  }));
}

function countBy(items, keyFn) {
  const counts = new Map();
  for (const item of items) {
    const key = keyFn(item) || '(blank)';
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return [...counts.entries()].sort((left, right) => right[1] - left[1]);
}

function formatPercent(value, total) {
  if (!total) return '0.0%';
  return `${((value / total) * 100).toFixed(1)}%`;
}

function formatScore(score) {
  if (!Number.isFinite(score)) return '-';
  return score.toFixed(2);
}

function truncate(value, max) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (text.length <= max) return text;
  return `${text.slice(0, max - 3)}...`;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }

  const results = loadResults(args.from).sort((left, right) => right.score - left.score);
  const total = results.length;
  const topCount = Math.max(1, Math.ceil(total * (args.topPercent / 100)));
  const topSlice = results.slice(0, topCount);
  const cutoffScore = topSlice[topSlice.length - 1]?.score ?? null;

  const classificationCounts = countBy(results, (item) => item.classification);
  const bucketCounts = countBy(results, (item) => item.bucket);
  const applyCount = results.filter((item) => item.classification === 'apply').length;
  const maybeCount = results.filter((item) => item.classification === 'maybe').length;
  const rejectCount = results.filter((item) => item.classification === 'reject').length;

  const scoreBands = [
    ['4.0+', results.filter((item) => item.score >= 4.0).length],
    ['3.5-3.99', results.filter((item) => item.score >= 3.5 && item.score < 4.0).length],
    ['3.0-3.49', results.filter((item) => item.score >= 3.0 && item.score < 3.5).length],
    ['2.5-2.99', results.filter((item) => item.score >= 2.5 && item.score < 3.0).length],
    ['<2.5', results.filter((item) => item.score < 2.5).length],
  ];

  console.log(`Triage summary: ${args.from}`);
  console.log(`Total scored: ${total}`);
  console.log('');

  console.log('Classifications:');
  for (const [label, count] of classificationCounts) {
    console.log(`  ${label}: ${count} (${formatPercent(count, total)})`);
  }
  console.log('');

  console.log('Buckets:');
  for (const [label, count] of bucketCounts) {
    console.log(`  ${label}: ${count} (${formatPercent(count, total)})`);
  }
  console.log('');

  console.log('Score bands:');
  for (const [label, count] of scoreBands) {
    console.log(`  ${label}: ${count} (${formatPercent(count, total)})`);
  }
  console.log('');

  console.log(`Top ${args.topPercent}% cutoff:`);
  console.log(`  Count: ${topCount}`);
  console.log(`  Score cutoff: ${formatScore(cutoffScore)}`);
  console.log(`  Apply jobs inside top ${args.topPercent}%: ${topSlice.filter((item) => item.classification === 'apply').length}`);
  console.log('');

  console.log('Top rows:');
  for (const item of results.slice(0, args.topRows)) {
    console.log(`  ${formatScore(item.score)} | ${item.bucket} | ${item.classification} | ${truncate(item.company, 18)} | ${truncate(item.role, 60)}`);
  }
  console.log('');

  console.log('Quick read:');
  console.log(`  apply=${applyCount}, maybe=${maybeCount}, reject=${rejectCount}`);
}

try {
  main();
} catch (error) {
  console.error(`Error: ${error.message}`);
  process.exit(1);
}
