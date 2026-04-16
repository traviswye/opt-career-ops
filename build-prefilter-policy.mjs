#!/usr/bin/env node

import { createHash } from 'crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { US_STATE_PAIRS } from './lib/location-match.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));

const DEFAULTS = {
  profile: resolve(__dirname, 'config/profile.yml'),
  out: resolve(__dirname, 'data/prefilter-policy.json'),
};

const FAMILY_SYNONYMS = [
  { pattern: /software engineer|software developer|swe/i, keywords: ['software engineer', 'software developer', 'backend engineer', 'frontend engineer'] },
  { pattern: /full[ -]?stack/i, keywords: ['full stack engineer', 'full-stack engineer', 'frontend engineer', 'backend engineer'] },
  { pattern: /platform|infrastructure|infra/i, keywords: ['platform engineer', 'infrastructure engineer', 'infra engineer', 'systems engineer', 'production engineer'] },
  { pattern: /devops|cloud|sre|site reliability/i, keywords: ['devops engineer', 'cloud engineer', 'site reliability engineer', 'sre', 'platform engineer'] },
  { pattern: /data engineer|ml\/data|mlops|machine learning|ml engineer/i, keywords: ['data engineer', 'ml engineer', 'machine learning engineer', 'mlops engineer', 'data platform engineer'] },
  { pattern: /architect/i, keywords: ['solutions architect', 'solution architect', 'technical architect'] },
  { pattern: /solutions engineer|customer engineer/i, keywords: ['solutions engineer', 'customer engineer', 'sales engineer'] },
  { pattern: /product manager/i, keywords: ['product manager', 'technical product manager'] },
];

const DEFAULT_SENIORITY_EXCLUDES = [
  'intern',
  'internship',
  'junior',
  'jr',
  'new grad',
  'graduate',
  'apprentice',
  'entry level',
];

// US_STATE_PAIRS imported from lib/location-match.mjs

function printHelp() {
  console.log(`career-ops build-prefilter-policy

Generate a reusable local prefilter policy from config/profile.yml.

Usage:
  node build-prefilter-policy.mjs [options]

Options:
  --profile PATH   Profile YAML (default: config/profile.yml)
  --out PATH       Output JSON path (default: data/prefilter-policy.json)
  -h, --help       Show help
`);
}

function parseArgs(argv) {
  const args = { ...DEFAULTS };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    switch (arg) {
      case '--profile':
        args.profile = resolve(argv[++i]);
        break;
      case '--out':
        args.out = resolve(argv[++i]);
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

function cleanText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function uniqueStrings(values, limit = 100) {
  const seen = new Set();
  const result = [];

  for (const value of values) {
    const clean = cleanText(value);
    if (!clean) continue;
    const key = clean.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(clean);
    if (result.length >= limit) break;
  }

  return result;
}

function wordsFromRole(role) {
  const normalized = cleanText(role)
    .replace(/[()]/g, ' ')
    .replace(/\//g, ' / ')
    .split(/[,|]/)
    .flatMap((part) => part.split(/\s{2,}/))
    .map((part) => cleanText(part))
    .filter(Boolean);

  const phrases = [];

  for (const item of normalized) {
    phrases.push(item);

    const withoutLevel = cleanText(
      item
        .replace(/\b(senior|staff|principal|lead|mid|mid-senior|junior|jr\.?|sr\.?)\b/gi, ' ')
        .replace(/\s+/g, ' ')
    );

    if (withoutLevel && withoutLevel.toLowerCase() !== item.toLowerCase()) {
      phrases.push(withoutLevel);
    }

    for (const family of FAMILY_SYNONYMS) {
      if (family.pattern.test(item)) {
        phrases.push(...family.keywords);
      }
    }
  }

  return uniqueStrings(phrases, 30);
}

function deriveRoleKeywords(profile, prefilter) {
  const roles = [
    ...(profile?.target_roles?.primary || []),
    ...((profile?.target_roles?.archetypes || []).map((item) => item?.name).filter(Boolean)),
    ...((prefilter?.role_keywords?.include || [])),
  ];

  return uniqueStrings(roles.flatMap((role) => wordsFromRole(role)), 40);
}

function deriveLocationPolicy(profile, prefilter) {
  const locationConfig = prefilter?.location || {};
  const flexibility = cleanText(profile?.compensation?.location_flexibility || '').toLowerCase();
  const onsiteAvailability = cleanText(profile?.location?.onsite_availability || '').toLowerCase();
  const candidateLocation = cleanText(profile?.candidate?.location || '');
  const combined = `${flexibility} ${onsiteAvailability}`.trim();

  const inferBoolean = (explicitValue, fallback) => {
    if (typeof explicitValue === 'boolean') return explicitValue;
    return fallback;
  };

  const remotePreferred = /\bremote preferred|remote only|fully remote|remote-first\b/.test(combined);
  const hybridMentioned = /\bhybrid\b/.test(combined);
  const onsiteMentioned = /\bon[- ]?site|onsite|in office|in-office|office\b/.test(combined);
  const relocateMentioned = /\brelocat|move|commute|travel\b/.test(combined);

  const willingToRelocate = inferBoolean(locationConfig.willing_to_relocate, relocateMentioned);
  const inferredStates = US_STATE_PAIRS
    .filter(([full, abbr]) => {
      const text = candidateLocation.toLowerCase();
      return text.includes(full) || new RegExp(`\\b${abbr}\\b`, 'i').test(candidateLocation);
    })
    .map(([full]) => full);
  const allowedCountries = uniqueStrings(
    locationConfig.allowed_countries?.length
      ? locationConfig.allowed_countries
      : (!willingToRelocate && profile?.location?.country ? [profile.location.country] : []),
    12
  );

  return {
    allowed_countries: allowedCountries,
    blocked_countries: uniqueStrings(locationConfig.blocked_countries || [], 12),
    allowed_states: uniqueStrings(
      locationConfig.allowed_states?.length
        ? locationConfig.allowed_states
        : (!willingToRelocate ? inferredStates : []),
      12
    ),
    allowed_cities: uniqueStrings(locationConfig.allowed_cities || [], 20),
    allow_remote: inferBoolean(locationConfig.allow_remote, true),
    allow_hybrid: inferBoolean(locationConfig.allow_hybrid, hybridMentioned || remotePreferred || true),
    allow_onsite: inferBoolean(locationConfig.allow_onsite, onsiteMentioned && !remotePreferred),
    allow_unknown_location: inferBoolean(locationConfig.allow_unknown_location, true),
    willing_to_relocate: willingToRelocate,
  };
}

function deriveSeniorityPolicy(profile, prefilter) {
  const configured = prefilter?.seniority || {};
  const derivedInclude = uniqueStrings(
    (profile?.target_roles?.archetypes || [])
      .map((item) => item?.level)
      .filter(Boolean)
      .flatMap((level) => cleanText(level).split(/[\/,]/))
      .map((part) => cleanText(part)),
    10
  );

  return {
    include: uniqueStrings([...(configured.include || []), ...derivedInclude], 12),
    exclude: uniqueStrings([...(configured.exclude || []), ...DEFAULT_SENIORITY_EXCLUDES], 16),
    require_match: typeof configured.require_match === 'boolean' ? configured.require_match : false,
  };
}

function deriveCompanyBalancePolicy(prefilter) {
  const configured = prefilter?.company_balance || {};

  return {
    enabled: typeof configured.enabled === 'boolean' ? configured.enabled : true,
    max_per_company: Number.isFinite(configured.max_per_company)
      ? Math.max(1, Math.min(50, Number(configured.max_per_company)))
      : 5,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }

  if (!existsSync(args.profile)) {
    throw new Error(`Profile not found: ${args.profile}`);
  }

  let loadYaml;
  try {
    const yamlModule = await import('js-yaml');
    loadYaml = yamlModule.load || yamlModule.default?.load;
  } catch (error) {
    throw new Error(`Missing dependency "js-yaml" (${error.message}). Run npm install.`);
  }

  const profileText = readFileSync(args.profile, 'utf-8');
  const profile = loadYaml(profileText) || {};
  const prefilter = profile.prefilter || {};

  const roleKeywords = {
    include: deriveRoleKeywords(profile, prefilter),
    exclude: uniqueStrings(prefilter?.role_keywords?.exclude || [], 30),
    require_match: typeof prefilter?.role_keywords?.require_match === 'boolean'
      ? prefilter.role_keywords.require_match
      : true,
    minimum_matches: Number.isFinite(prefilter?.role_keywords?.minimum_matches)
      ? Math.max(1, Number(prefilter.role_keywords.minimum_matches))
      : 1,
  };

  const policy = {
    schema_version: 'career-ops.prefilter-policy.v1',
    generated_at: new Date().toISOString(),
    sources: {
      profile: {
        path: args.profile,
        sha256: sha256(profileText),
      },
    },
    candidate_context: {
      target_roles: uniqueStrings(profile?.target_roles?.primary || [], 12),
      archetypes: uniqueStrings((profile?.target_roles?.archetypes || []).map((item) => item?.name), 16),
      country: profile?.location?.country || null,
      city: profile?.location?.city || null,
      timezone: profile?.location?.timezone || null,
      visa_status: profile?.location?.visa_status || null,
      location_flexibility: profile?.compensation?.location_flexibility || null,
    },
    rules: {
      location: deriveLocationPolicy(profile, prefilter),
      seniority: deriveSeniorityPolicy(profile, prefilter),
      role_keywords: roleKeywords,
      hard_title_excludes: uniqueStrings(prefilter?.hard_title_excludes || [], 30),
      company_excludes: uniqueStrings(prefilter?.company_excludes || [], 30),
      blocked_text_keywords: uniqueStrings(prefilter?.blocked_text_keywords || [], 30),
      company_balance: deriveCompanyBalancePolicy(prefilter),
    },
  };

  mkdirSync(dirname(args.out), { recursive: true });
  writeFileSync(args.out, `${JSON.stringify(policy, null, 2)}\n`, 'utf-8');

  console.log(`Prefilter policy written to ${args.out}`);
  console.log(`Role include keywords: ${policy.rules.role_keywords.include.length}`);
  console.log(`Allowed countries:     ${policy.rules.location.allowed_countries.length}`);
  console.log(`Allowed states:        ${policy.rules.location.allowed_states.length}`);
  console.log(`Title excludes:        ${policy.rules.hard_title_excludes.length}`);
  console.log(`Max per company:       ${policy.rules.company_balance.max_per_company}`);
}

try {
  await main();
} catch (error) {
  console.error(`Error: ${error.message}`);
  process.exit(1);
}
