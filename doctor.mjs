#!/usr/bin/env node

/**
 * doctor.mjs — Setup validation for career-ops
 * Checks all prerequisites and prints a pass/fail checklist.
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = __dirname;

// ANSI colors (only on TTY)
const isTTY = process.stdout.isTTY;
const green = (s) => isTTY ? `\x1b[32m${s}\x1b[0m` : s;
const red = (s) => isTTY ? `\x1b[31m${s}\x1b[0m` : s;
const dim = (s) => isTTY ? `\x1b[2m${s}\x1b[0m` : s;

function checkNodeVersion() {
  const major = parseInt(process.versions.node.split('.')[0]);
  if (major >= 18) {
    return { pass: true, label: `Node.js >= 18 (v${process.versions.node})` };
  }
  return {
    pass: false,
    label: `Node.js >= 18 (found v${process.versions.node})`,
    fix: 'Install Node.js 18 or later from https://nodejs.org',
  };
}

function checkDependencies() {
  if (existsSync(join(projectRoot, 'node_modules'))) {
    return { pass: true, label: 'Dependencies installed' };
  }
  return {
    pass: false,
    label: 'Dependencies not installed',
    fix: 'Run: npm install',
  };
}

async function checkPlaywright() {
  try {
    const { chromium } = await import('playwright');
    const execPath = chromium.executablePath();
    if (existsSync(execPath)) {
      return { pass: true, label: 'Playwright chromium installed' };
    }
    return {
      pass: false,
      label: 'Playwright chromium not installed',
      fix: 'Run: npx playwright install chromium',
    };
  } catch {
    return {
      pass: false,
      label: 'Playwright chromium not installed',
      fix: 'Run: npx playwright install chromium',
    };
  }
}

function checkCv() {
  if (existsSync(join(projectRoot, 'cv.md'))) {
    return { pass: true, label: 'cv.md found' };
  }
  return {
    pass: false,
    label: 'cv.md not found',
    fix: [
      'Create cv.md in the project root with your CV in markdown',
      'See examples/ for reference CVs',
    ],
  };
}

function checkProfile() {
  if (existsSync(join(projectRoot, 'config', 'profile.yml'))) {
    return { pass: true, label: 'config/profile.yml found' };
  }
  return {
    pass: false,
    label: 'config/profile.yml not found',
    fix: [
      'Run: cp config/profile.example.yml config/profile.yml',
      'Then edit it with your details',
    ],
  };
}

async function checkPrefilterConfig() {
  const profilePath = join(projectRoot, 'config', 'profile.yml');

  if (!existsSync(profilePath)) {
    return {
      pass: false,
      label: 'Prefilter profile config unavailable',
      fix: 'Create config/profile.yml first so prefilter-policy can be generated',
    };
  }

  try {
    const yamlModule = await import('js-yaml');
    const loadYaml = yamlModule.load || yamlModule.default?.load;
    const profile = loadYaml(readFileSync(profilePath, 'utf-8')) || {};

    if (profile.prefilter && typeof profile.prefilter === 'object') {
      return { pass: true, label: 'Prefilter config found in config/profile.yml' };
    }

    return {
      pass: true,
      label: 'Prefilter config will use derived defaults from config/profile.yml',
    };
  } catch {
    return {
      pass: true,
      label: 'Prefilter config not validated (js-yaml unavailable until dependencies are installed)',
    };
  }
}

function checkPortals() {
  if (existsSync(join(projectRoot, 'portals.yml'))) {
    return { pass: true, label: 'portals.yml found' };
  }
  return {
    pass: false,
    label: 'portals.yml not found',
    fix: [
      'Run: cp templates/portals.example.yml portals.yml',
      'Then customize with your target companies',
    ],
  };
}

function ensureFromTemplate(targetRelative, templateRelative, label) {
  const target = join(projectRoot, targetRelative);
  if (existsSync(target)) {
    return { pass: true, label: `${label} (${targetRelative})` };
  }
  const template = join(projectRoot, templateRelative);
  if (!existsSync(template)) {
    return {
      pass: false,
      label: `${label} — template missing (${templateRelative})`,
      fix: 'Reinstall or pull the template from upstream',
    };
  }
  try {
    const content = readFileSync(template, 'utf-8');
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, content);
    return { pass: true, label: `${label} — auto-copied from ${templateRelative}` };
  } catch (err) {
    return {
      pass: false,
      label: `${label} — failed to auto-copy from template`,
      fix: `cp ${templateRelative} ${targetRelative}`,
    };
  }
}

function checkProfileMode() {
  return ensureFromTemplate(
    join('modes', '_profile.md'),
    join('modes', '_profile.template.md'),
    'User customizations file ready',
  );
}

function checkStoryBank() {
  return ensureFromTemplate(
    join('interview-prep', 'story-bank.md'),
    join('interview-prep', 'story-bank.template.md'),
    'Interview story bank ready',
  );
}

function checkFonts() {
  const fontsDir = join(projectRoot, 'fonts');
  if (!existsSync(fontsDir)) {
    return {
      pass: false,
      label: 'fonts/ directory not found',
      fix: 'The fonts/ directory is required for PDF generation',
    };
  }
  try {
    const files = readdirSync(fontsDir);
    if (files.length === 0) {
      return {
        pass: false,
        label: 'fonts/ directory is empty',
        fix: 'The fonts/ directory must contain font files for PDF generation',
      };
    }
  } catch {
    return {
      pass: false,
      label: 'fonts/ directory not readable',
      fix: 'Check permissions on the fonts/ directory',
    };
  }
  return { pass: true, label: 'Fonts directory ready' };
}

function checkAutoDir(name) {
  const dirPath = join(projectRoot, name);
  if (existsSync(dirPath)) {
    return { pass: true, label: `${name}/ directory ready` };
  }
  try {
    mkdirSync(dirPath, { recursive: true });
    return { pass: true, label: `${name}/ directory ready (auto-created)` };
  } catch {
    return {
      pass: false,
      label: `${name}/ directory could not be created`,
      fix: `Run: mkdir ${name}`,
    };
  }
}

async function main() {
  console.log('\ncareer-ops doctor');
  console.log('================\n');

  const checks = [
    checkNodeVersion(),
    checkDependencies(),
    await checkPlaywright(),
    checkCv(),
    checkProfile(),
    await checkPrefilterConfig(),
    checkPortals(),
    checkProfileMode(),
    checkStoryBank(),
    checkFonts(),
    checkAutoDir('data'),
    checkAutoDir(join('data', 'prefilter')),
    checkAutoDir(join('data', 'triage')),
    checkAutoDir('jds'),
    checkAutoDir(join('jds', 'normalized')),
    checkAutoDir('output'),
    checkAutoDir('reports'),
    checkAutoDir('interview-prep'),
    checkAutoDir(join('batch', 'logs')),
    checkAutoDir(join('batch', 'tracker-additions')),
  ];

  let failures = 0;

  for (const result of checks) {
    if (result.pass) {
      console.log(`${green('✓')} ${result.label}`);
    } else {
      failures++;
      console.log(`${red('✗')} ${result.label}`);
      const fixes = Array.isArray(result.fix) ? result.fix : [result.fix];
      for (const hint of fixes) {
        console.log(`  ${dim('→ ' + hint)}`);
      }
    }
  }

  console.log('');
  if (failures > 0) {
    console.log(`Result: ${failures} issue${failures === 1 ? '' : 's'} found. Fix them and run \`npm run doctor\` again.`);
    process.exit(1);
  } else {
    console.log('Result: All checks passed. You\'re ready to go! Run `claude` to start.');
    console.log('');
    console.log('Single-JD path — paste a URL or JD into Claude Code:');
    console.log(`  ${dim('/career-ops {paste a JD}')}`);
    console.log('');
    console.log('Discovery-at-scale path (scan → triage → shortlist → customize):');
    console.log(`  ${dim('npm run pipeline                                        # full zero-token scan')}`);
    console.log(`  ${dim('npm run triage -- --jobs data/prefilter/kept.json       # Haiku lite-score')}`);
    console.log(`  ${dim('npm run shortlist -- --from data/triage/results.json --top 10')}`);
    console.log(`  ${dim('npm run full-customize -- --from data/triage/shortlist.json --top 10 --approve')}`);
    console.log('');
    console.log('See docs/STAGED_PIPELINE.md for per-stage flags, cost estimates, and retry semantics.');
    console.log('Join the community: https://discord.gg/8pRpHETxa4');
    process.exit(0);
  }
}

main().catch((err) => {
  console.error('doctor.mjs failed:', err.message);
  process.exit(1);
});
