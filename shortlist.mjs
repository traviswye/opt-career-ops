#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const DEFAULTS = {
  from: resolve(__dirname, 'data/triage/results.json'),
  out: resolve(__dirname, 'data/triage/shortlist.json'),
  top: 25,
  minScore: null,
  include: ['apply', 'maybe'],
};

function printHelp() {
  console.log(`career-ops shortlist

Promote top triage results into a shortlist manifest.

Usage:
  node shortlist.mjs [options]

Options:
  --from PATH         Triage results JSON (default: data/triage/results.json)
  --out PATH          Output shortlist JSON (default: data/triage/shortlist.json)
  --top N             Promote the top N roles after filtering (default: 25)
  --min-score N       Minimum score required for promotion
  --include VALUES    Comma-separated classifications to include (default: apply,maybe)
  -h, --help          Show help
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
      case '--out':
        args.out = resolve(argv[++i]);
        break;
      case '--top':
        args.top = Math.max(1, Number.parseInt(argv[++i], 10) || 25);
        break;
      case '--min-score':
        args.minScore = Number.parseFloat(argv[++i]);
        break;
      case '--include':
        args.include = argv[++i]
          .split(',')
          .map((item) => item.trim().toLowerCase())
          .filter(Boolean);
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
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload.results)) return payload.results;
  throw new Error(`Unsupported results shape in ${path}`);
}

function bucketRank(bucket) {
  switch (String(bucket || '').toLowerCase()) {
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

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }

  const results = loadResults(args.from);
  const filtered = results
    .filter((item) => args.include.includes(String(item.classification || '').toLowerCase()))
    .filter((item) => args.minScore == null || Number(item.score || 0) >= args.minScore)
    .sort((a, b) => {
      const bucketDiff = bucketRank(a.bucket) - bucketRank(b.bucket);
      if (bucketDiff !== 0) return bucketDiff;

      const scoreDiff = Number(b.score || 0) - Number(a.score || 0);
      if (scoreDiff !== 0) return scoreDiff;
      return String(a.company || '').localeCompare(String(b.company || ''));
    })
    .slice(0, args.top)
    .map((item, index) => ({
      rank: index + 1,
      id: item.id,
      company: item.company || null,
      role: item.role || null,
      score: item.score || null,
      bucket: item.bucket || null,
      classification: item.classification || null,
      archetype: item.archetype || null,
      url: item.url || null,
      job_file: item.job_file || null,
      markdown_path: item.markdown_path || null,
      rationale: item.rationale || null,
      top_strengths: item.top_strengths || [],
      top_concerns: item.top_concerns || item.top_gaps || [],
      recommendation: item.recommendation || null,
    }));

  const payload = {
    generated_at: new Date().toISOString(),
    source_results: args.from,
    top: args.top,
    min_score: args.minScore,
    included_classifications: args.include,
    promoted_count: filtered.length,
    jobs: filtered,
  };

  mkdirSync(dirname(args.out), { recursive: true });
  writeFileSync(args.out, `${JSON.stringify(payload, null, 2)}\n`, 'utf-8');

  const tsvPath = args.out.replace(/\.json$/i, '.tsv');
  const tsvLines = [
    'rank\tid\tcompany\trole\tscore\tbucket\tclassification\tarchetype\tjob_file\turl',
    ...filtered.map((item) => [
      item.rank,
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
  writeFileSync(tsvPath, `${tsvLines.join('\n')}\n`, 'utf-8');

  console.log(`Shortlist written to ${args.out}`);
  console.log(`Promoted jobs: ${filtered.length}`);
}

try {
  main();
} catch (error) {
  console.error(`Error: ${error.message}`);
  process.exit(1);
}
