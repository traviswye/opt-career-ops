#!/usr/bin/env node

import { existsSync, readFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const DEFAULTS = {
  from: resolve(__dirname, 'data/triage/results.json'),
  topThemes: 12,
  topConcerns: 20,
};

const THEME_RULES = [
  {
    key: 'location_mismatch',
    label: 'Location / remote mismatch',
    patterns: [
      /\bhybrid\b(?!\s+networking)/i,
      /\bonsite\b/i,
      /\bon-site\b/i,
      /\boffice-first\b/i,
      /\bremote[- ]preferred\b/i,
      /\bfort lauderdale\b/i,
      /\brelocation\b/i,
      /\bcommute\b/i,
      /\blocation mismatch\b/i,
      /\bnyc\b/i,
      /\bsf\b/i,
      /\bsan francisco\b/i,
      /\btoronto\b/i,
      /\bvancouver\b/i,
      /\blondon\b/i,
      /\bberlin\b/i,
      /\bparis\b/i,
      /\bmountain view\b/i,
      /\blos angeles\b/i,
    ],
  },
  {
    key: 'seniority_mismatch',
    label: 'Seniority / level mismatch',
    patterns: [
      /\bstaff level\b/i,
      /\bstaff\b/i,
      /\bseniority\b/i,
      /\bstretch\b/i,
      /\b8\+ years\b/i,
      /\b\d+\+ years\b/i,
      /\bunleveled\b/i,
      /\bbelow candidate'?s senior target\b/i,
      /\bpossible seniority mismatch\b/i,
      /\bskew junior\b/i,
      /\bskew junior or expects elite\b/i,
      /\blevel unspecified\b/i,
    ],
  },
  {
    key: 'role_family_mismatch',
    label: 'Role-family / lane mismatch',
    patterns: [
      /\brole family mismatch\b/i,
      /\boff-strategy\b/i,
      /\bcareer lane shift\b/i,
      /\bnot (?:a |an )?(?:platform|infra|infrastructure|field|solutions) engineering\b/i,
      /\bfront-end leaning\b/i,
      /\bproduct-manager-hat\b/i,
      /\bsecondary to candidate'?s primary archetype\b/i,
      /\bunderutilizes full-stack and iac strengths\b/i,
      /\bnot a platform\/infra position\b/i,
      /\bmore dx lead than pure engineering\b/i,
      /\blateral specialization shift\b/i,
    ],
  },
  {
    key: 'ai_llm_gap',
    label: 'AI / LLM / agent gap',
    patterns: [
      /\bllm\b/i,
      /\bagentic\b/i,
      /\brag\b/i,
      /\bvoice ai\b/i,
      /\bnlp\b/i,
      /\bai\/ml\b/i,
      /\bgenerative ai\b/i,
      /\bai engineer\b/i,
      /\bmodel training\b/i,
      /\bmodel serving\b/i,
      /\bai product\b/i,
      /\bai coding agent\b/i,
    ],
  },
  {
    key: 'infra_stack_gap',
    label: 'Infra / platform stack gap',
    patterns: [
      /\bkubernetes\b/i,
      /\bk8s\b/i,
      /\bterraform\b/i,
      /\bargo\b/i,
      /\bcontainer orchestration\b/i,
      /\bdistributed systems\b/i,
      /\bon-call\b/i,
      /\bobservability\b/i,
      /\bincident response\b/i,
      /\bsli\b/i,
      /\bslo\b/i,
      /\bbazel\b/i,
      /\bgradle\b/i,
      /\bworkflow orchestrator\b/i,
      /\bairflow\b/i,
      /\bdagster\b/i,
      /\bprefect\b/i,
    ],
  },
  {
    key: 'language_gap',
    label: 'Language gap',
    patterns: [
      /\bno go experience\b/i,
      /\bgo backend\b/i,
      /\brust\b/i,
      /\bscala\b/i,
      /\bkotlin\b/i,
      /\belixir\b/i,
      /\bc\+\+\b/i,
      /\bno scala experience\b/i,
      /\bno elixir experience\b/i,
    ],
  },
  {
    key: 'domain_gap',
    label: 'Domain / industry gap',
    patterns: [
      /\bcrypto\b/i,
      /\bfintech\b/i,
      /\bad-tech\b/i,
      /\bvoice ai\b/i,
      /\bsearch infra\b/i,
      /\bdata warehouse\b/i,
      /\bsnowflake\b/i,
      /\bdatabricks\b/i,
      /\bdefi\b/i,
      /\bsmart contract\b/i,
      /\brestaurant order-taking\b/i,
      /\bpublic api\/sdk\b/i,
    ],
  },
  {
    key: 'customer_facing_gap',
    label: 'Customer-facing / solutions gap',
    patterns: [
      /\bcustomer-facing\b/i,
      /\bsolutions role\b/i,
      /\bfield\/solutions engineering\b/i,
      /\bdeployment strategist\b/i,
      /\bforward deployed\b/i,
      /\bembedded solutions\b/i,
    ],
  },
  {
    key: 'compensation_gap',
    label: 'Compensation mismatch',
    patterns: [
      /\bcomp range\b/i,
      /\bbelow candidate'?s\b/i,
      /\bbelow target\b/i,
      /\btarget range\b/i,
      /\bzone 3 comp\b/i,
    ],
  },
];

function printHelp() {
  console.log(`career-ops analyze-triage-concerns

Summarize common concern themes from lite-scoring results.

Usage:
  node analyze-triage-concerns.mjs [options]

Options:
  --from PATH         Results JSON path (default: data/triage/results.json)
  --top-themes N      Number of theme rows to print (default: 12)
  --top-concerns N    Number of raw concern rows to print (default: 20)
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
      case '--top-themes':
        args.topThemes = Math.max(1, Number.parseInt(argv[++index], 10) || 12);
        break;
      case '--top-concerns':
        args.topConcerns = Math.max(1, Number.parseInt(argv[++index], 10) || 20);
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

  return results;
}

function normalizeConcern(text) {
  return String(text || '')
    .replace(/\s+/g, ' ')
    .replace(/[–—]/g, '-')
    .trim();
}

function percent(count, total) {
  if (!total) return '0.0%';
  return `${((count / total) * 100).toFixed(1)}%`;
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

  const results = loadResults(args.from);
  const totalJobs = results.length;
  const concernRows = [];
  const rawConcernCounts = new Map();
  const themeStats = new Map();

  for (const rule of THEME_RULES) {
    themeStats.set(rule.key, {
      label: rule.label,
      occurrences: 0,
      jobs: new Set(),
      examples: [],
    });
  }
  themeStats.set('other', {
    label: 'Other / uncategorized',
    occurrences: 0,
    jobs: new Set(),
    examples: [],
  });

  for (const item of results) {
    const concerns = Array.isArray(item.top_concerns)
      ? item.top_concerns
      : Array.isArray(item.top_gaps)
        ? item.top_gaps
        : [];

    for (const concernText of concerns) {
      const concern = normalizeConcern(concernText);
      if (!concern) continue;

      concernRows.push({
        id: item.id || '',
        company: item.company || '',
        role: item.role || '',
        classification: item.classification || '',
        bucket: item.bucket || '',
        score: Number(item.score || 0),
        concern,
      });

      rawConcernCounts.set(concern, (rawConcernCounts.get(concern) || 0) + 1);

      let matched = false;
      for (const rule of THEME_RULES) {
        if (rule.patterns.some((pattern) => pattern.test(concern))) {
          const entry = themeStats.get(rule.key);
          entry.occurrences += 1;
          entry.jobs.add(item.id || `${item.company}|${item.role}`);
          if (entry.examples.length < 3) entry.examples.push(concern);
          matched = true;
        }
      }

      if (!matched) {
        const other = themeStats.get('other');
        other.occurrences += 1;
        other.jobs.add(item.id || `${item.company}|${item.role}`);
        if (other.examples.length < 3) other.examples.push(concern);
      }
    }
  }

  const themeRows = [...themeStats.entries()]
    .map(([key, value]) => ({
      key,
      label: value.label,
      occurrences: value.occurrences,
      jobs: value.jobs.size,
      examples: value.examples,
    }))
    .filter((row) => row.occurrences > 0)
    .sort((left, right) => right.jobs - left.jobs || right.occurrences - left.occurrences);

  const topRawConcerns = [...rawConcernCounts.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, args.topConcerns);

  const locationLeak = themeRows.find((row) => row.key === 'location_mismatch');

  console.log(`Concern summary: ${args.from}`);
  console.log(`Total scored jobs: ${totalJobs}`);
  console.log(`Total concern lines: ${concernRows.length}`);
  console.log('');

  console.log('Top concern themes:');
  for (const row of themeRows.slice(0, args.topThemes)) {
    console.log(`  ${row.label}: ${row.jobs} jobs (${percent(row.jobs, totalJobs)}), ${row.occurrences} concern lines`);
    for (const example of row.examples.slice(0, 2)) {
      console.log(`    e.g. ${truncate(example, 120)}`);
    }
  }
  console.log('');

  console.log('Most common raw concern lines:');
  for (const [concern, count] of topRawConcerns) {
    console.log(`  ${count}x ${truncate(concern, 140)}`);
  }
  console.log('');

  console.log('Quick read:');
  if (locationLeak) {
    console.log(`  Location/remote mismatch shows up in ${locationLeak.jobs} jobs (${percent(locationLeak.jobs, totalJobs)}).`);
  }
  console.log('  Use the top themes above to tighten scan-filter and prefilter before the next triage run.');
}

try {
  main();
} catch (error) {
  console.error(`Error: ${error.message}`);
  process.exit(1);
}
