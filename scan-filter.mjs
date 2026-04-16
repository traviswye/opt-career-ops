#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname, extname, resolve } from 'path';
import { fileURLToPath } from 'url';
import {
  cleanText,
  normalizeText,
  escapeRegex,
  detectModalityFromText,
  detectMentionedCountries,
  detectMentionedStates,
  detectForeignCountryIndicator,
  detectForeignCityPattern,
  hasSpecificLocationSignal,
} from './lib/location-match.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));

const DEFAULT_SCAN_RESULTS_PATH = resolve(__dirname, 'data/scan-results.json');
const DEFAULT_PIPELINE_PATH = resolve(__dirname, 'data/pipeline.md');
const DEFAULTS = {
  from: null,
  policy: resolve(__dirname, 'data/prefilter-policy.json'),
  outDir: resolve(__dirname, 'data/scan-filter'),
  maxPerCompany: null,
};

function printHelp() {
  console.log(`career-ops scan-filter

Apply deterministic local filters to scan results before extraction.

Usage:
  node scan-filter.mjs [options]

Options:
  --from PATH      Input file: pipeline.md or scan-results.json
                   Defaults to data/scan-results.json when present,
                   otherwise data/pipeline.md
  --policy PATH    Prefilter policy JSON (default: data/prefilter-policy.json)
  --out-dir PATH   Output directory (default: data/scan-filter)
  --max-per-company N
                   Override policy company cap for this run
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
      case '--policy':
        args.policy = resolve(argv[++i]);
        break;
      case '--out-dir':
        args.outDir = resolve(argv[++i]);
        break;
      case '--max-per-company':
        args.maxPerCompany = Math.max(1, Number(argv[++i]));
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

// cleanText and normalizeText imported from lib/location-match.mjs

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf-8'));
}

function compileKeywordSet(values) {
  return (values || []).map((value) => ({
    raw: cleanText(value),
    lower: normalizeText(value),
    regex: new RegExp(`\\b${escapeRegex(normalizeText(value))}\\b`, 'i'),
  }));
}

function findKeywordMatches(text, compiledKeywords) {
  const lower = normalizeText(text);
  const matches = [];

  for (const entry of compiledKeywords) {
    if (!entry.lower) continue;
    if (lower.includes(entry.lower)) {
      matches.push(entry.raw);
    }
  }

  return [...new Set(matches)];
}

// Location helpers imported from lib/location-match.mjs (expandCountryAliases,
// expandStateAliases, detectMentionedCountries, detectMentionedStates,
// hasSpecificLocationSignal, escapeRegex all live in the shared module now).

function detectModality(entry) {
  const haystack = [entry.title, entry.location, entry.url].filter(Boolean).join('\n');
  return detectModalityFromText(haystack);
}

function parsePipelineEntries(text) {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith('- [ ] '))
    .map((line) => line.replace(/^- \[ \]\s+/, ''))
    .map((raw) => {
      const parts = raw.split('|').map((part) => cleanText(part));
      return {
        raw,
        url: parts[0] || null,
        company: parts[1] || null,
        title: parts.slice(2).join(' | ') || null,
        location: null,
        source: null,
      };
    })
    .filter((entry) => entry.url);
}

function parseScanResults(payload) {
  const items = Array.isArray(payload?.items) ? payload.items : [];
  return items
    .map((item) => ({
      raw: null,
      url: cleanText(item.url),
      company: cleanText(item.company),
      title: cleanText(item.title),
      location: cleanText(item.location),
      source: cleanText(item.source),
    }))
    .filter((entry) => entry.url);
}

function loadEntries(args) {
  const sourcePath = args.from || (existsSync(DEFAULT_SCAN_RESULTS_PATH) ? DEFAULT_SCAN_RESULTS_PATH : DEFAULT_PIPELINE_PATH);

  if (!existsSync(sourcePath)) {
    throw new Error(`Input not found: ${sourcePath}`);
  }

  const extension = extname(sourcePath).toLowerCase();
  if (extension === '.json') {
    return {
      sourcePath,
      entries: parseScanResults(readJson(sourcePath)),
    };
  }

  return {
    sourcePath,
    entries: parsePipelineEntries(readFileSync(sourcePath, 'utf-8')),
  };
}

function evaluateLocation(entry, policy) {
  const rules = policy.rules.location || {};
  const haystack = [entry.title, entry.location, entry.url].filter(Boolean).join('\n');
  const modality = detectModality(entry);
  const hasLocationMetadata = Boolean(cleanText(entry.location));
  const allowed = detectMentionedCountries(haystack, rules.allowed_countries || []);
  const blocked = detectMentionedCountries(haystack, rules.blocked_countries || []);
  const allowedStates = detectMentionedStates(haystack, rules.allowed_states || []);
  const hasSpecificLocation = hasSpecificLocationSignal(entry.location);

  if (blocked.matches.length > 0 && allowed.matches.length === 0) {
    return { keep: false, reason: `blocked country match: ${blocked.matches.join(', ')}`, details: { modality, hasLocationMetadata, allowedCountries: allowed.matches, blockedCountries: blocked.matches, allowedStates } };
  }

  if (modality === 'remote' && rules.allow_remote === false) {
    return { keep: false, reason: 'remote roles disabled by policy', details: { modality, hasLocationMetadata, allowedStates } };
  }

  if (modality === 'hybrid' && rules.allow_hybrid === false) {
    return { keep: false, reason: 'hybrid roles disabled by policy', details: { modality, hasLocationMetadata, allowedStates } };
  }

  if (modality === 'onsite' && rules.allow_onsite === false) {
    return { keep: false, reason: 'onsite roles disabled by policy', details: { modality, hasLocationMetadata, allowedStates } };
  }

  if (!rules.willing_to_relocate && hasLocationMetadata && hasSpecificLocation && !allowed.globalRemote) {
    if ((rules.allowed_countries || []).length > 0 && allowed.matches.length === 0 && allowedStates.length === 0) {
      return { keep: false, reason: 'location outside allowed region', details: { modality, hasLocationMetadata, allowedCountries: allowed.matches, allowedStates } };
    }

    if ((rules.allowed_states || []).length > 0 && (modality === 'onsite' || modality === 'hybrid') && allowedStates.length === 0) {
      return { keep: false, reason: 'onsite/hybrid location outside allowed states', details: { modality, hasLocationMetadata, allowedCountries: allowed.matches, allowedStates } };
    }
  }

  if (hasLocationMetadata && (rules.allowed_countries || []).length > 0 && !allowed.globalRemote && allowed.matches.length === 0 && !hasSpecificLocation && rules.allow_unknown_location === false) {
    return { keep: false, reason: 'location did not match allowed countries', details: { modality, hasLocationMetadata, allowedCountries: allowed.matches, allowedStates } };
  }

  if (!hasLocationMetadata && rules.allow_unknown_location === false) {
    return { keep: false, reason: 'unknown location disabled by policy', details: { modality, hasLocationMetadata, allowedStates } };
  }

  return {
    keep: true,
    reason: hasLocationMetadata ? 'location metadata passed' : 'location unknown; deferred',
    details: {
      modality,
      hasLocationMetadata,
      allowedCountries: allowed.matches,
      blockedCountries: blocked.matches,
      allowedStates,
      globalRemote: allowed.globalRemote,
    },
  };
}

function evaluateTitle(entry, policy) {
  const title = cleanText(entry.title);
  const company = cleanText(entry.company);

  const hardExcludes = findKeywordMatches(title, compileKeywordSet(policy.rules.hard_title_excludes));
  if (hardExcludes.length > 0) {
    return { keep: false, reason: `hard title exclude: ${hardExcludes.join(', ')}`, details: { includeMatches: [], excludeMatches: hardExcludes } };
  }

  const companyExcludes = findKeywordMatches(company, compileKeywordSet(policy.rules.company_excludes));
  if (companyExcludes.length > 0) {
    return { keep: false, reason: `company exclude: ${companyExcludes.join(', ')}`, details: { includeMatches: [], excludeMatches: companyExcludes } };
  }

  const seniorityExcludes = findKeywordMatches(title, compileKeywordSet(policy.rules.seniority.exclude));
  if (seniorityExcludes.length > 0) {
    return { keep: false, reason: `seniority exclude: ${seniorityExcludes.join(', ')}`, details: { includeMatches: [], excludeMatches: seniorityExcludes } };
  }

  const includeMatches = findKeywordMatches(title, compileKeywordSet(policy.rules.role_keywords.include));
  const excludeMatches = findKeywordMatches(title, compileKeywordSet(policy.rules.role_keywords.exclude));

  if (excludeMatches.length > 0) {
    return { keep: false, reason: `role exclude keyword: ${excludeMatches.join(', ')}`, details: { includeMatches, excludeMatches } };
  }

  if (policy.rules.role_keywords.require_match) {
    const minimum = policy.rules.role_keywords.minimum_matches || 1;
    if (includeMatches.length < minimum) {
      return { keep: false, reason: 'did not match target role families', details: { includeMatches, excludeMatches } };
    }
  }

  if (policy.rules.seniority.require_match) {
    const includeSeniority = findKeywordMatches(title, compileKeywordSet(policy.rules.seniority.include));
    if (includeSeniority.length === 0) {
      return { keep: false, reason: 'did not match target seniority', details: { includeMatches, excludeMatches } };
    }
  }

  return { keep: true, reason: 'title policy passed', details: { includeMatches, excludeMatches } };
}

function computePriority(entry, policy) {
  const includeMatches = Array.isArray(entry.details?.includeMatches) ? entry.details.includeMatches.length : 0;
  const modality = entry.details?.modality || 'unknown';
  const hasLocationMetadata = Boolean(entry.details?.hasLocationMetadata);
  const seniorityMatches = findKeywordMatches(cleanText(entry.title), compileKeywordSet(policy.rules?.seniority?.include || []));

  let score = 0;
  score += includeMatches * 20;
  score += seniorityMatches.length * 10;
  score += hasLocationMetadata ? 6 : 1;

  if (modality === 'remote') score += 5;
  else if (modality === 'hybrid') score += 4;
  else if (modality === 'unknown') score += 2;
  else if (modality === 'onsite') score -= 2;

  if (/\b(platform|infrastructure|infra|backend|full[ -]?stack|devops|cloud|sre|site reliability)\b/i.test(cleanText(entry.title))) {
    score += 4;
  }

  return score;
}

function sortEntries(entries) {
  return [...entries].sort((left, right) => {
    const scoreDiff = Number(right.priority_score || 0) - Number(left.priority_score || 0);
    if (scoreDiff !== 0) return scoreDiff;

    const companyDiff = cleanText(left.company).localeCompare(cleanText(right.company));
    if (companyDiff !== 0) return companyDiff;

    const titleDiff = cleanText(left.title).localeCompare(cleanText(right.title));
    if (titleDiff !== 0) return titleDiff;

    return cleanText(left.url).localeCompare(cleanText(right.url));
  });
}

function applyCompanyBalance(entries, policy, overrideMaxPerCompany = null) {
  const settings = policy.rules?.company_balance || {};
  const enabled = settings.enabled !== false;
  const maxPerCompany = Number.isFinite(overrideMaxPerCompany)
    ? Math.max(1, Number(overrideMaxPerCompany))
    : Math.max(1, Number(settings.max_per_company || 5));

  if (!enabled) {
    return {
      kept: sortEntries(entries),
      rejected: [],
      settings: { enabled, max_per_company: maxPerCompany },
    };
  }

  const grouped = new Map();
  for (const entry of entries) {
    const companyKey = normalizeText(entry.company) || '__unknown__';
    if (!grouped.has(companyKey)) grouped.set(companyKey, []);
    grouped.get(companyKey).push(entry);
  }

  const kept = [];
  const rejected = [];

  for (const groupEntries of grouped.values()) {
    const sorted = sortEntries(groupEntries);
    kept.push(...sorted.slice(0, maxPerCompany));

    for (const entry of sorted.slice(maxPerCompany)) {
      rejected.push({
        ...entry,
        reason: `company cap: kept top ${maxPerCompany} for ${entry.company || 'Unknown'}`,
      });
    }
  }

  return {
    kept: sortEntries(kept),
    rejected: sortEntries(rejected),
    settings: { enabled, max_per_company: maxPerCompany },
  };
}

function buildPipeline(entries) {
  const lines = [
    '# Pipeline',
    '',
    '## Pendientes',
    '',
    ...entries.map((entry) => `- [ ] ${entry.url} | ${entry.company || 'Unknown'} | ${entry.title || 'Untitled role'}`),
    '',
    '## Procesadas',
    '',
  ];

  return `${lines.join('\n')}\n`;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }

  if (!existsSync(args.policy)) {
    throw new Error(`Prefilter policy not found: ${args.policy}`);
  }

  const policy = readJson(args.policy);
  const { sourcePath, entries } = loadEntries(args);

  if (entries.length === 0) {
    console.log('No scan entries found.');
    return;
  }

  mkdirSync(args.outDir, { recursive: true });

  const kept = [];
  const rejected = [];
  let unknownLocationCount = 0;

  for (const entry of entries) {
    const locationDecision = evaluateLocation(entry, policy);
    if (!locationDecision.details?.hasLocationMetadata) {
      unknownLocationCount += 1;
    }

    if (!locationDecision.keep) {
      rejected.push({
        ...entry,
        reason: locationDecision.reason,
        details: locationDecision.details,
      });
      continue;
    }

    const titleDecision = evaluateTitle(entry, policy);
    if (!titleDecision.keep) {
      rejected.push({
        ...entry,
        reason: titleDecision.reason,
        details: {
          ...locationDecision.details,
          ...titleDecision.details,
        },
      });
      continue;
    }

    kept.push({
      ...entry,
      reason: 'passed scan filter',
      priority_score: 0,
      details: {
        ...locationDecision.details,
        ...titleDecision.details,
      },
    });
  }

  for (const entry of kept) {
    entry.priority_score = computePriority(entry, policy);
  }

  const balanced = applyCompanyBalance(kept, policy, args.maxPerCompany);
  const finalKept = balanced.kept;
  const finalRejected = [...rejected, ...balanced.rejected];

  const reasonCounts = finalRejected.reduce((accumulator, entry) => {
    accumulator[entry.reason] = (accumulator[entry.reason] || 0) + 1;
    return accumulator;
  }, {});

  const companiesBeforeBalance = kept.reduce((accumulator, entry) => {
    const key = entry.company || 'Unknown';
    accumulator[key] = (accumulator[key] || 0) + 1;
    return accumulator;
  }, {});

  const companiesAfterBalance = finalKept.reduce((accumulator, entry) => {
    const key = entry.company || 'Unknown';
    accumulator[key] = (accumulator[key] || 0) + 1;
    return accumulator;
  }, {});

  const summary = {
    generated_at: new Date().toISOString(),
    source: sourcePath,
    policy: args.policy,
    total_entries: entries.length,
    kept_entries: finalKept.length,
    rejected_entries: finalRejected.length,
    entries_without_location_metadata: unknownLocationCount,
    company_balance: {
      enabled: balanced.settings.enabled,
      max_per_company: balanced.settings.max_per_company,
      rejected_by_company_cap: balanced.rejected.length,
    },
    rejection_reasons: reasonCounts,
    companies_before_balance: companiesBeforeBalance,
    companies_after_balance: companiesAfterBalance,
  };

  writeFileSync(resolve(args.outDir, 'kept.md'), buildPipeline(finalKept), 'utf-8');
  writeFileSync(resolve(args.outDir, 'kept.json'), `${JSON.stringify({ ...summary, items: finalKept }, null, 2)}\n`, 'utf-8');
  writeFileSync(resolve(args.outDir, 'rejected.json'), `${JSON.stringify({ ...summary, items: finalRejected }, null, 2)}\n`, 'utf-8');

  const tsvLines = [
    'decision\tcompany\ttitle\tlocation\treason\turl',
    ...finalKept.map((entry) => ['keep', entry.company || '', entry.title || '', entry.location || '', entry.reason || '', entry.url || ''].join('\t')),
    ...finalRejected.map((entry) => ['reject', entry.company || '', entry.title || '', entry.location || '', entry.reason || '', entry.url || ''].join('\t')),
  ];
  writeFileSync(resolve(args.outDir, 'summary.tsv'), `${tsvLines.join('\n')}\n`, 'utf-8');
  writeFileSync(resolve(args.outDir, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`, 'utf-8');

  console.log(`Total scan entries:             ${entries.length}`);
  console.log(`Kept after scan filter:         ${finalKept.length}`);
  console.log(`Rejected after scan filter:     ${finalRejected.length}`);
  console.log(`Missing location metadata:      ${unknownLocationCount}`);
  console.log(`Company cap applied:            top ${balanced.settings.max_per_company} per company`);
  console.log(`Rejected by company cap:        ${balanced.rejected.length}`);
  console.log(`Kept pipeline:                  ${resolve(args.outDir, 'kept.md')}`);
  console.log(`Rejected summary:               ${resolve(args.outDir, 'rejected.json')}`);
}

main().catch((error) => {
  console.error(`Fatal: ${error.message}`);
  process.exit(1);
});
