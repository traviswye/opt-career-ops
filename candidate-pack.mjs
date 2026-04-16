#!/usr/bin/env node

import { createHash } from 'crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const DEFAULTS = {
  profile: resolve(__dirname, 'config/profile.yml'),
  cv: resolve(__dirname, 'cv.md'),
  profileMode: resolve(__dirname, 'modes/_profile.md'),
  digest: resolve(__dirname, 'article-digest.md'),
  out: resolve(__dirname, 'data/candidate-pack.json'),
};

function printHelp() {
  console.log(`career-ops candidate-pack

Generate a compact reusable candidate context artifact for triage and batch runs.

Usage:
  node candidate-pack.mjs [options]

Options:
  --profile PATH         Profile YAML (default: config/profile.yml)
  --cv PATH              CV markdown (default: cv.md)
  --profile-mode PATH    User framing markdown (default: modes/_profile.md)
  --digest PATH          Article digest markdown (default: article-digest.md)
  --out PATH             Output JSON path (default: data/candidate-pack.json)
  -h, --help             Show help
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
      case '--cv':
        args.cv = resolve(argv[++i]);
        break;
      case '--profile-mode':
        args.profileMode = resolve(argv[++i]);
        break;
      case '--digest':
        args.digest = resolve(argv[++i]);
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

function readOptional(path) {
  if (!existsSync(path)) return '';
  return readFileSync(path, 'utf-8');
}

function sha256(text) {
  return createHash('sha256').update(text).digest('hex');
}

function uniqueStrings(values, limit = 20) {
  const seen = new Set();
  const out = [];

  for (const value of values) {
    if (!value) continue;
    const clean = String(value).replace(/\s+/g, ' ').trim();
    if (!clean) continue;
    const key = clean.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(clean);
    if (out.length >= limit) break;
  }

  return out;
}

function parseMarkdownSections(markdown) {
  const sections = [];
  let current = { title: 'intro', level: 0, lines: [] };

  for (const line of markdown.split(/\r?\n/)) {
    const heading = line.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      if (current.lines.length > 0 || current.title !== 'intro') {
        sections.push({
          title: current.title,
          level: current.level,
          content: current.lines.join('\n').trim(),
        });
      }
      current = { title: heading[2].trim(), level: heading[1].length, lines: [] };
      continue;
    }

    current.lines.push(line);
  }

  if (current.lines.length > 0 || current.title !== 'intro') {
    sections.push({
      title: current.title,
      level: current.level,
      content: current.lines.join('\n').trim(),
    });
  }

  return sections.filter((section) => section.content);
}

function extractMarkdownBullets(markdown, limit = 20) {
  const bullets = [];
  const lines = markdown.split(/\r?\n/);

  for (const line of lines) {
    const match = line.match(/^\s*(?:[-*+]|\d+\.)\s+(.*)$/);
    if (!match) continue;
    const bullet = match[1].replace(/\s+/g, ' ').trim();
    if (!bullet) continue;
    bullets.push(bullet);
    if (bullets.length >= limit) break;
  }

  return bullets;
}

function extractSkillsFromSection(sectionText) {
  const skills = [];
  const normalized = sectionText
    .replace(/[|/]/g, ',')
    .replace(/[()]/g, ' ')
    .split(/[,\n]/)
    .map((item) => item.trim())
    .filter(Boolean);

  for (const item of normalized) {
    if (item.length < 2 || item.length > 40) continue;
    skills.push(item);
  }

  return uniqueStrings(skills, 24);
}

function compactSection(section, maxChars = 500) {
  const clean = section.replace(/\s+/g, ' ').trim();
  if (clean.length <= maxChars) return clean;
  return `${clean.slice(0, maxChars - 3)}...`;
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

  const profileText = readFileSync(args.profile, 'utf-8');
  const yaml = await import('js-yaml');
  const profile = yaml.load(profileText) || {};
  const cvText = readOptional(args.cv);
  const profileModeText = readOptional(args.profileMode);
  const digestText = readOptional(args.digest);

  const cvSections = parseMarkdownSections(cvText);
  const digestSections = parseMarkdownSections(digestText);
  const profileSections = parseMarkdownSections(profileModeText);

  const skillsSection = cvSections.find((section) => /skills|competenc/i.test(section.title));
  // Include H2 experience/project headers PLUS any deeper subsection (H3+) that
  // contains bullet content. The cv.md structure uses H2 "Experience" / "Personal
  // Projects" as parent headers with individual jobs/projects as H3 children.
  // A strict /experience|project/i title filter would miss those H3 children.
  const experienceSections = cvSections.filter((section) => {
    if (/experience|project/i.test(section.title)) return true;
    // H3+ section that contains bullets — likely a job or project entry
    if (section.level >= 3 && /^[\s]*[-*+]/m.test(section.content)) return true;
    return false;
  });

  const profileArchetypes = Array.isArray(profile?.target_roles?.archetypes)
    ? profile.target_roles.archetypes
    : [];
  const profileProofPoints = Array.isArray(profile?.narrative?.proof_points)
    ? profile.narrative.proof_points
    : [];

  const strongestProofPoints = uniqueStrings([
    ...profileProofPoints.map((item) => [item.name, item.hero_metric].filter(Boolean).join(' - ')),
    ...extractMarkdownBullets(digestText, 10),
    ...digestSections.slice(0, 5).map((section) => `${section.title}: ${compactSection(section.content, 160)}`),
  ], 12);

  // Per-section cap of 4, no whole-CV supplement (it duplicates what's already
  // captured per-section), overall cap of 40 unique. With ~10 sections × 4
  // bullets each, this fits every section's top 4 without truncating the
  // later projects (career-ops, etc).
  const strongestReusableBullets = uniqueStrings(
    experienceSections.flatMap((section) => extractMarkdownBullets(section.content, 4)),
    40,
  );

  const keySkills = uniqueStrings([
    ...(profile?.narrative?.superpowers || []),
    ...extractSkillsFromSection(skillsSection?.content || ''),
    ...profileArchetypes.map((item) => item.name),
  ], 20);

  const domainExperience = uniqueStrings([
    ...(profile?.target_roles?.primary || []),
    ...profileArchetypes.map((item) => item.name),
    ...profileProofPoints.map((item) => item.name),
  ], 12);

  const fitSignals = uniqueStrings([
    profile?.narrative?.headline,
    profile?.narrative?.exit_story,
    ...(profile?.narrative?.superpowers || []),
    ...profileArchetypes.map((item) => `${item.name} (${item.level || 'unspecified'} / ${item.fit || 'unspecified'})`),
  ], 14);

  const mustHaveCriteria = uniqueStrings([
    ...(profile?.target_roles?.must_have || []),
    ...(profile?.narrative?.must_have || []),
  ], 12);

  const niceToHaveCriteria = uniqueStrings([
    ...(profile?.target_roles?.nice_to_have || []),
    ...(profile?.narrative?.nice_to_have || []),
  ], 12);

  const dealBreakers = uniqueStrings([
    ...(profile?.narrative?.deal_breakers || []),
    ...(profile?.target_roles?.deal_breakers || []),
  ], 12);

  const gapMitigationRules = uniqueStrings([
    ...(profile?.target_roles?.gap_mitigation_rules || []),
    ...(profile?.narrative?.gap_mitigation_rules || []),
    ...extractMarkdownBullets(profileModeText, 12),
  ], 14);

  // Include the raw skills table content from cv.md — this is the most direct
  // signal triage has for "does this candidate's stack match the JD's stack?"
  const rawSkillsTable = skillsSection?.content || '';

  const compactContextLines = uniqueStrings([
    `Headline: ${profile?.narrative?.headline || 'N/A'}`,
    `Exit story: ${profile?.narrative?.exit_story || 'N/A'}`,
    `Primary targets: ${(profile?.target_roles?.primary || []).join(', ') || 'N/A'}`,
    `Archetypes: ${profileArchetypes.map((item) => item.name).join(', ') || 'N/A'}`,
    `Must-have in JD: ${mustHaveCriteria.join(', ') || 'N/A'}`,
    `Deal-breakers: ${dealBreakers.join(', ') || 'N/A'}`,
    `Top strengths: ${keySkills.join(', ') || 'N/A'}`,
    `Skills table: ${rawSkillsTable.replace(/\s+/g, ' ').trim().slice(0, 600) || 'N/A'}`,
    `Proof points: ${strongestProofPoints.slice(0, 5).join(' | ') || 'N/A'}`,
    `Comp target: ${profile?.compensation?.target_range || 'N/A'} ${profile?.compensation?.currency || ''}`.trim(),
    `Location: ${profile?.candidate?.location || profile?.location?.city || 'N/A'} (remote preferred, no relocation)`,
  ], 16);

  const pack = {
    schema_version: 'career-ops.candidate-pack.v1',
    generated_at: new Date().toISOString(),
    sources: {
      profile: {
        path: args.profile,
        sha256: sha256(profileText),
        exists: true,
      },
      cv: {
        path: args.cv,
        sha256: cvText ? sha256(cvText) : null,
        exists: Boolean(cvText),
      },
      profile_mode: {
        path: args.profileMode,
        sha256: profileModeText ? sha256(profileModeText) : null,
        exists: Boolean(profileModeText),
      },
      digest: {
        path: args.digest,
        sha256: digestText ? sha256(digestText) : null,
        exists: Boolean(digestText),
      },
    },
    candidate: {
      full_name: profile?.candidate?.full_name || null,
      email: profile?.candidate?.email || null,
      location: profile?.candidate?.location || null,
      linkedin: profile?.candidate?.linkedin || null,
      portfolio_url: profile?.candidate?.portfolio_url || null,
      headline: profile?.narrative?.headline || null,
      exit_story: profile?.narrative?.exit_story || null,
      target_roles: profile?.target_roles?.primary || [],
      archetypes: profileArchetypes.map((item) => ({
        name: item.name || null,
        level: item.level || null,
        fit: item.fit || null,
      })),
      compensation: {
        target_range: profile?.compensation?.target_range || null,
        minimum: profile?.compensation?.minimum || null,
        currency: profile?.compensation?.currency || null,
        location_flexibility: profile?.compensation?.location_flexibility || null,
      },
      location_policy: {
        country: profile?.location?.country || null,
        city: profile?.location?.city || null,
        timezone: profile?.location?.timezone || null,
        visa_status: profile?.location?.visa_status || null,
        onsite_availability: profile?.location?.onsite_availability || null,
      },
    },
    signals: {
      key_skills: keySkills,
      domain_experience: domainExperience,
      strongest_proof_points: strongestProofPoints,
      strongest_reusable_bullets: strongestReusableBullets,
      must_have_criteria: mustHaveCriteria,
      nice_to_have_criteria: niceToHaveCriteria,
      deal_breakers: dealBreakers,
      fit_signals: fitSignals,
      gap_mitigation_rules: gapMitigationRules,
    },
    source_summaries: {
      cv_sections: cvSections.slice(0, 8).map((section) => ({
        title: section.title,
        preview: compactSection(section.content, 220),
      })),
      profile_mode_sections: profileSections.slice(0, 6).map((section) => ({
        title: section.title,
        preview: compactSection(section.content, 220),
      })),
      digest_sections: digestSections.slice(0, 6).map((section) => ({
        title: section.title,
        preview: compactSection(section.content, 220),
      })),
    },
    compact_context: compactContextLines.join('\n'),
  };

  mkdirSync(dirname(args.out), { recursive: true });
  writeFileSync(args.out, `${JSON.stringify(pack, null, 2)}\n`, 'utf-8');

  console.log(`Candidate pack written to ${args.out}`);
  console.log(`Target roles: ${pack.candidate.target_roles.length}`);
  console.log(`Key skills: ${pack.signals.key_skills.length}`);
  console.log(`Proof points: ${pack.signals.strongest_proof_points.length}`);
}

try {
  await main();
} catch (error) {
  console.error(`Error: ${error.message}`);
  process.exit(1);
}
