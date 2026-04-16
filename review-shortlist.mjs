#!/usr/bin/env node

import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

const DEFAULTS = {
  from: resolve(__dirname, 'data/triage/results.json'),
  limit: 25,
};

function printHelp() {
  console.log(`career-ops review-shortlist

Show ranked triage results before promotion to full customization.

Usage:
  node review-shortlist.mjs [options]

Options:
  --from PATH      Results JSON or shortlist JSON (default: data/triage/results.json)
  --limit N        Number of rows to show (default: 25)
  -h, --help       Show help
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
      case '--limit':
        args.limit = Math.max(1, Number.parseInt(argv[++i], 10) || 25);
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
  if (Array.isArray(payload.results)) return payload.results;
  if (Array.isArray(payload.jobs)) return payload.jobs;
  if (Array.isArray(payload)) return payload;

  throw new Error(`Unsupported file shape in ${path}`);
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

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }

  const items = loadItems(args.from)
    .map((item, index) => ({
      rank: item.rank || index + 1,
      id: item.id || '',
      company: item.company || '',
      role: item.role || '',
      score: item.score,
      bucket: item.bucket || '',
      classification: item.classification || '',
      archetype: item.archetype || '',
    }))
    .sort((a, b) => {
      const rankDiff = Number(a.rank) - Number(b.rank);
      if (rankDiff !== 0) return rankDiff;
      return String(a.company).localeCompare(String(b.company));
    });

  const rows = items.slice(0, args.limit);

  console.log(`Shortlist Review: ${args.from}`);
  console.log(`Showing ${rows.length} of ${items.length} ranked jobs`);
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

  for (const row of rows) {
    console.log([
      pad(row.rank, 5, 'right'),
      pad(formatScore(row.score), 6, 'right'),
      pad(truncate(row.bucket, 14), 14),
      pad(truncate(row.classification, 8), 8),
      pad(truncate(row.company, 18), 18),
      pad(truncate(row.role, 32), 32),
    ].join('  '));
  }

  console.log('');
  console.log('Promotion examples:');
  console.log(`  npm run full-customize -- --from ${args.from.replace(/\\/g, '/')} --top 10`);
  console.log(`  npm run full-customize -- --from ${args.from.replace(/\\/g, '/')} --ranks 1,2,5`);
  console.log('The runner will preview the selection and require --approve before it executes.');
}

try {
  main();
} catch (error) {
  console.error(`Error: ${error.message}`);
  process.exit(1);
}
