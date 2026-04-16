#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'fs';
import { dirname, extname, resolve } from 'path';
import { fileURLToPath } from 'url';
import {
  cleanText,
  normalizeText,
  escapeRegex,
  detectModalityFromText,
  extractLocationEvidence,
  evaluateLocationFromEvidence,
  detectMentionedStates,
  textMentionsAnyUsState,
} from './lib/location-match.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));

const DEFAULTS = {
  jobs: resolve(__dirname, 'jds/normalized'),
  policy: resolve(__dirname, 'data/prefilter-policy.json'),
  outDir: resolve(__dirname, 'data/prefilter'),
};

function printHelp() {
  console.log(`career-ops prefilter

Apply deterministic local filters before token-based triage.

Usage:
  node prefilter-jobs.mjs [options]

Options:
  --jobs PATH      Directory of normalized JD JSON files or a manifest
  --policy PATH    Prefilter policy JSON (default: data/prefilter-policy.json)
  --out-dir PATH   Output directory (default: data/prefilter)
  -h, --help       Show help
`);
}

function parseArgs(argv) {
  const args = { ...DEFAULTS };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    switch (arg) {
      case '--jobs':
        args.jobs = resolve(argv[++i]);
        break;
      case '--policy':
        args.policy = resolve(argv[++i]);
        break;
      case '--out-dir':
        args.outDir = resolve(argv[++i]);
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

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf-8'));
}

function collectJobFiles(inputPath) {
  if (!existsSync(inputPath)) {
    throw new Error(`Jobs input not found: ${inputPath}`);
  }

  const extension = extname(inputPath).toLowerCase();
  if (extension === '.json') {
    const payload = readJson(inputPath);
    if (Array.isArray(payload)) return payload;
    if (Array.isArray(payload.items)) {
      return payload.items.map((item) => item.job_file || item.path).filter(Boolean);
    }
    if (Array.isArray(payload.results)) {
      return payload.results.map((item) => item.job_file).filter(Boolean);
    }
    throw new Error(`Unsupported manifest shape: ${inputPath}`);
  }

  return readdirSync(inputPath)
    .filter((entry) => entry.endsWith('.json') && entry !== 'index.json')
    .map((entry) => resolve(inputPath, entry))
    .sort();
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

function evaluateLocation(job, policy) {
  const rules = policy.rules.location;

  // 1. Expired check (before anything else)
  if (job.status?.liveness === 'expired') {
    return { keep: false, reason: 'expired posting', details: {} };
  }

  // 2. Modality detection — uses title + location metadata + body snippet.
  // 6000 chars catches "Location-based hybrid policy" / "in-office 25%" type
  // signals that live in Logistics sections at the bottom of JDs.
  const modalityHaystack = [
    job.job?.title,
    job.job?.location,
    (job.content?.text || '').slice(0, 6000),
  ].filter(Boolean).join('\n');
  const modality = detectModalityFromText(modalityHaystack);

  // 3. Modality policy gating
  if (modality === 'remote' && !rules.allow_remote) {
    return { keep: false, reason: 'remote roles disabled by policy', details: { modality } };
  }
  if (modality === 'hybrid' && !rules.allow_hybrid) {
    return { keep: false, reason: 'hybrid roles disabled by policy', details: { modality } };
  }
  if (modality === 'onsite' && !rules.allow_onsite) {
    return { keep: false, reason: 'onsite roles disabled by policy', details: { modality } };
  }
  if (modality === 'unknown' && !rules.allow_unknown_location) {
    return { keep: false, reason: 'unknown-location roles disabled by policy', details: { modality } };
  }

  // 4. Tiered location evidence evaluation (the bug fix — uses scoped evidence
  //    instead of the old 4000-char body haystack that false-positive matched
  //    marketing prose).
  const evidence = extractLocationEvidence(job);
  const locationResult = evaluateLocationFromEvidence(evidence, {
    allowed_countries: rules.allowed_countries || [],
    allowed_states: rules.allowed_states || [],
    willing_to_relocate: rules.willing_to_relocate === true,
  });

  if (locationResult.decision === 'reject') {
    return { keep: false, reason: locationResult.reason, details: { modality, tier: locationResult.tier } };
  }

  // 5. State check for hybrid/onsite — if the evidence says "US" but the
  //    specific state isn't in the allowed list, reject for non-local hybrid/onsite.
  if ((modality === 'hybrid' || modality === 'onsite') && (rules.allowed_states || []).length > 0) {
    const allEvidence = [evidence.metadata, evidence.headerZone, ...(evidence.phrases || [])].filter(Boolean).join('\n');
    const stateMatches = detectMentionedStates(allEvidence, rules.allowed_states);
    if (stateMatches.length === 0 && locationResult.decision === 'keep') {
      return { keep: false, reason: 'onsite/hybrid location outside allowed states', details: { modality, tier: locationResult.tier } };
    }
  }

  // 5b. Unknown-modality WITH specific non-local state → assume onsite/hybrid
  //     and reject. This catches JDs like Anthropic's that list "San Francisco, CA"
  //     in metadata but don't mention "remote" or "hybrid" in the first 6000 chars
  //     of body. The absence of a remote signal combined with a specific
  //     non-local city is strong evidence the role requires local presence.
  if (modality === 'unknown' && (rules.allowed_states || []).length > 0 && locationResult.decision === 'keep') {
    const allEvidence = [evidence.metadata, evidence.headerZone, ...(evidence.phrases || [])].filter(Boolean).join('\n');
    const allowedStateMatches = detectMentionedStates(allEvidence, rules.allowed_states);
    // Only reject if a specific US state is mentioned AND it's not in allowed_states.
    // "United States" alone (country-level, no state) is truly ambiguous — keep.
    if (allowedStateMatches.length === 0) {
      const anyUsState = textMentionsAnyUsState(allEvidence);
      if (anyUsState) {
        return {
          keep: false,
          reason: `unknown modality with specific non-local state (${anyUsState}) — assumed onsite/hybrid`,
          details: { modality, tier: locationResult.tier, state_detected: anyUsState },
        };
      }
    }
  }

  // 6. City allowlist check (optional — only applies if allowed_cities is populated)
  if ((rules.allowed_cities || []).length > 0 && (modality === 'hybrid' || modality === 'onsite')) {
    const locationLower = normalizeText(job.job?.location || '');
    const cityMatch = rules.allowed_cities.some((city) => locationLower.includes(normalizeText(city)));
    if (!cityMatch && !rules.willing_to_relocate) {
      return { keep: false, reason: 'onsite/hybrid city not in allowed_cities', details: { modality } };
    }
  }

  return {
    keep: true,
    reason: locationResult.reason || 'location policy passed',
    details: { modality, tier: locationResult.tier },
  };
}

function evaluateTitle(job, policy) {
  const title = cleanText(job.job?.title);
  const bodyPreview = cleanText(job.content?.text?.slice(0, 2000));
  const company = cleanText(job.job?.company);
  const titleLower = normalizeText(title);

  const hardExcludes = findKeywordMatches(title, compileKeywordSet(policy.rules.hard_title_excludes));
  if (hardExcludes.length > 0) {
    return { keep: false, reason: `hard title exclude: ${hardExcludes.join(', ')}`, details: { includeMatches: [], excludeMatches: hardExcludes } };
  }

  const companyExcludes = findKeywordMatches(company, compileKeywordSet(policy.rules.company_excludes));
  if (companyExcludes.length > 0) {
    return { keep: false, reason: `company exclude: ${companyExcludes.join(', ')}`, details: { includeMatches: [], excludeMatches: companyExcludes } };
  }

  const blockedTextKeywords = findKeywordMatches(bodyPreview, compileKeywordSet(policy.rules.blocked_text_keywords));
  if (blockedTextKeywords.length > 0) {
    return { keep: false, reason: `blocked text keyword: ${blockedTextKeywords.join(', ')}`, details: { includeMatches: [], excludeMatches: blockedTextKeywords } };
  }

  const seniorityExcludes = findKeywordMatches(titleLower, compileKeywordSet(policy.rules.seniority.exclude));
  if (seniorityExcludes.length > 0) {
    return { keep: false, reason: `seniority exclude: ${seniorityExcludes.join(', ')}`, details: { includeMatches: [], excludeMatches: seniorityExcludes } };
  }

  const includeMatches = findKeywordMatches(`${title}\n${bodyPreview}`, compileKeywordSet(policy.rules.role_keywords.include));
  const titleExcludes = findKeywordMatches(title, compileKeywordSet(policy.rules.role_keywords.exclude));

  if (titleExcludes.length > 0) {
    return { keep: false, reason: `role exclude keyword: ${titleExcludes.join(', ')}`, details: { includeMatches, excludeMatches: titleExcludes } };
  }

  if (policy.rules.role_keywords.require_match) {
    const minimum = policy.rules.role_keywords.minimum_matches || 1;
    if (includeMatches.length < minimum) {
      return { keep: false, reason: 'did not match target role families', details: { includeMatches, excludeMatches: [] } };
    }
  }

  if (policy.rules.seniority.require_match) {
    const seniorityInclude = findKeywordMatches(title, compileKeywordSet(policy.rules.seniority.include));
    if (seniorityInclude.length === 0) {
      return { keep: false, reason: 'did not match target seniority', details: { includeMatches, excludeMatches: [] } };
    }
  }

  return { keep: true, reason: 'title policy passed', details: { includeMatches, excludeMatches: [] } };
}

function buildManifestItem(jobFile, artifact, decision) {
  return {
    id: artifact.id,
    company: artifact.job?.company || null,
    title: artifact.job?.title || null,
    location: artifact.job?.location || null,
    url: artifact.source?.final_url || artifact.source?.input_ref || null,
    liveness: artifact.status?.liveness || null,
    job_file: jobFile,
    markdown_path: artifact.content?.markdown_path || null,
    decision: decision.keep ? 'keep' : 'reject',
    reason: decision.reason,
    details: decision.details,
  };
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
  const jobFiles = collectJobFiles(args.jobs);

  mkdirSync(args.outDir, { recursive: true });

  const kept = [];
  const rejected = [];

  for (const jobFile of jobFiles) {
    const artifact = readJson(jobFile);
    const locationDecision = evaluateLocation(artifact, policy);

    if (!locationDecision.keep) {
      rejected.push(buildManifestItem(jobFile, artifact, locationDecision));
      continue;
    }

    const titleDecision = evaluateTitle(artifact, policy);
    if (!titleDecision.keep) {
      rejected.push(buildManifestItem(jobFile, artifact, titleDecision));
      continue;
    }

    kept.push(buildManifestItem(jobFile, artifact, {
      keep: true,
      reason: 'passed all prefilters',
      details: {
        ...locationDecision.details,
        ...titleDecision.details,
      },
    }));
  }

  const keptPayload = {
    generated_at: new Date().toISOString(),
    policy: args.policy,
    total_jobs: jobFiles.length,
    kept_jobs: kept.length,
    rejected_jobs: rejected.length,
    items: kept,
  };

  const rejectedPayload = {
    generated_at: new Date().toISOString(),
    policy: args.policy,
    total_jobs: jobFiles.length,
    kept_jobs: kept.length,
    rejected_jobs: rejected.length,
    items: rejected,
  };

  writeFileSync(resolve(args.outDir, 'kept.json'), `${JSON.stringify(keptPayload, null, 2)}\n`, 'utf-8');
  writeFileSync(resolve(args.outDir, 'rejected.json'), `${JSON.stringify(rejectedPayload, null, 2)}\n`, 'utf-8');

  const tsvLines = [
    'decision\tcompany\ttitle\tlocation\treason\tjob_file\turl',
    ...kept.map((item) => ['keep', item.company || '', item.title || '', item.location || '', item.reason || '', item.job_file || '', item.url || ''].join('\t')),
    ...rejected.map((item) => ['reject', item.company || '', item.title || '', item.location || '', item.reason || '', item.job_file || '', item.url || ''].join('\t')),
  ];

  writeFileSync(resolve(args.outDir, 'summary.tsv'), `${tsvLines.join('\n')}\n`, 'utf-8');

  console.log(`Total jobs:    ${jobFiles.length}`);
  console.log(`Kept jobs:     ${kept.length}`);
  console.log(`Rejected jobs: ${rejected.length}`);
  console.log(`Kept manifest: ${resolve(args.outDir, 'kept.json')}`);
  console.log(`Reject log:    ${resolve(args.outDir, 'rejected.json')}`);
}

main().catch((error) => {
  console.error(`Fatal: ${error.message}`);
  process.exit(1);
});
