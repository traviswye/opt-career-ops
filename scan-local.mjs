#!/usr/bin/env node

/**
 * scan-local.mjs - local job scanner
 *
 * Discovery stays on the cheap path:
 * 1. Prefer ATS APIs when available
 * 2. Fall back to local Playwright against careers pages
 * 3. Leave WebSearch out of scan by default
 *
 * This keeps job discovery local and token-free while preserving the
 * richer downstream research path for shortlisted jobs only.
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';

let parseYaml = null;

const DEFAULT_PORTALS_PATH = 'portals.yml';
const SCAN_HISTORY_PATH = 'data/scan-history.tsv';
const SCAN_RESULTS_PATH = 'data/scan-results.json';
const PIPELINE_PATH = 'data/pipeline.md';
const APPLICATIONS_PATH = 'data/applications.md';

mkdirSync('data', { recursive: true });

const CONCURRENCY = 10;
const FETCH_TIMEOUT_MS = 10_000;
const PLAYWRIGHT_NAV_TIMEOUT_MS = 20_000;
const PLAYWRIGHT_SETTLE_MS = 2_500;
const MAX_PLAYWRIGHT_CONTEXT_CHARS = 400;

function printHelp() {
  console.log(`career-ops scan

Discover job URLs cheaply using ATS APIs first and local Playwright second.

Usage:
  node scan-local.mjs
  node scan-local.mjs --dry-run
  node scan-local.mjs --company OpenAI
  node scan-local.mjs --api-only
  node scan-local.mjs --summary-only
  node scan-local.mjs --max-print 50
  node scan-local.mjs --portals C:\\CodeWork\\jobhunt\\career-ops\\portals.yml

Options:
  --dry-run      Preview results without writing pipeline/history files
  --company NAME Only scan matching companies
  --api-only     Skip local Playwright fallback
  --summary-only Print counts without listing every new offer
  --max-print N  Limit how many new offers are printed to stdout
  --portals PATH Use a specific portals.yml file
  -h, --help     Show help
`);
}

function parseArgs(argv) {
  const args = {
    dryRun: false,
    apiOnly: false,
    filterCompany: null,
    summaryOnly: false,
    maxPrint: null,
    portalsPath: DEFAULT_PORTALS_PATH,
    help: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];

    switch (arg) {
      case '--dry-run':
        args.dryRun = true;
        break;
      case '--api-only':
        args.apiOnly = true;
        break;
      case '--summary-only':
        args.summaryOnly = true;
        break;
      case '--max-print':
        args.maxPrint = Number.parseInt(argv[++i], 10);
        if (!Number.isFinite(args.maxPrint) || args.maxPrint < 0) {
          throw new Error('--max-print must be a non-negative integer');
        }
        break;
      case '--company':
        args.filterCompany = argv[++i]?.toLowerCase() || null;
        break;
      case '--portals':
        args.portalsPath = argv[++i] || DEFAULT_PORTALS_PATH;
        break;
      case '-h':
      case '--help':
        args.help = true;
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return args;
}

function cleanText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function normalizeUrl(url, base) {
  try {
    return new URL(url, base).toString();
  } catch {
    return null;
  }
}

function detectApi(company) {
  if (company.api && company.api.includes('greenhouse')) {
    return { type: 'greenhouse', url: company.api };
  }

  const url = company.careers_url || '';

  const ashbyMatch = url.match(/jobs\.ashbyhq\.com\/([^/?#]+)/i);
  if (ashbyMatch) {
    return {
      type: 'ashby',
      url: `https://api.ashbyhq.com/posting-api/job-board/${ashbyMatch[1]}?includeCompensation=true`,
    };
  }

  const leverMatch = url.match(/jobs\.lever\.co\/([^/?#]+)/i);
  if (leverMatch) {
    return {
      type: 'lever',
      url: `https://api.lever.co/v0/postings/${leverMatch[1]}`,
    };
  }

  const greenhouseMatch = url.match(/job-boards(?:\.eu)?\.greenhouse\.io\/([^/?#]+)/i);
  if (greenhouseMatch) {
    return {
      type: 'greenhouse',
      url: `https://boards-api.greenhouse.io/v1/boards/${greenhouseMatch[1]}/jobs`,
    };
  }

  return null;
}

function parseGreenhouse(json, companyName) {
  const jobs = Array.isArray(json.jobs) ? json.jobs : [];
  return jobs.map((job) => ({
    title: cleanText(job.title),
    url: cleanText(job.absolute_url),
    company: companyName,
    location: cleanText(job.location?.name),
  }));
}

function parseAshby(json, companyName) {
  const jobs = Array.isArray(json.jobs) ? json.jobs : [];
  return jobs.map((job) => ({
    title: cleanText(job.title),
    url: cleanText(job.jobUrl),
    company: companyName,
    location: cleanText(job.location),
  }));
}

function parseLever(json, companyName) {
  if (!Array.isArray(json)) return [];

  return json.map((job) => ({
    title: cleanText(job.text),
    url: cleanText(job.hostedUrl),
    company: companyName,
    location: cleanText(job.categories?.location),
  }));
}

const PARSERS = {
  greenhouse: parseGreenhouse,
  ashby: parseAshby,
  lever: parseLever,
};

async function fetchJson(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'user-agent': 'career-ops-scan/1.0',
        accept: 'application/json',
      },
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

function buildTitleFilter(titleFilter) {
  const positive = (titleFilter?.positive || []).map((keyword) => String(keyword).toLowerCase());
  const negative = (titleFilter?.negative || []).map((keyword) => String(keyword).toLowerCase());

  return (title) => {
    const lower = String(title || '').toLowerCase();
    const hasPositive = positive.length === 0 || positive.some((keyword) => lower.includes(keyword));
    const hasNegative = negative.some((keyword) => lower.includes(keyword));
    return hasPositive && !hasNegative;
  };
}

function loadSeenUrls() {
  const seen = new Set();

  if (existsSync(SCAN_HISTORY_PATH)) {
    const lines = readFileSync(SCAN_HISTORY_PATH, 'utf-8').split(/\r?\n/);
    for (const line of lines.slice(1)) {
      const url = line.split('\t')[0];
      if (url) seen.add(url);
    }
  }

  if (existsSync(PIPELINE_PATH)) {
    const text = readFileSync(PIPELINE_PATH, 'utf-8');
    for (const match of text.matchAll(/- \[[ x]\] (https?:\/\/\S+)/g)) {
      seen.add(match[1]);
    }
  }

  if (existsSync(APPLICATIONS_PATH)) {
    const text = readFileSync(APPLICATIONS_PATH, 'utf-8');
    for (const match of text.matchAll(/https?:\/\/[^\s|)]+/g)) {
      seen.add(match[0]);
    }
  }

  return seen;
}

function loadSeenCompanyRoles() {
  const seen = new Set();

  if (!existsSync(APPLICATIONS_PATH)) {
    return seen;
  }

  const text = readFileSync(APPLICATIONS_PATH, 'utf-8');
  for (const match of text.matchAll(/\|[^|]+\|[^|]+\|\s*([^|]+)\s*\|\s*([^|]+)\s*\|/g)) {
    const company = match[1].trim().toLowerCase();
    const role = match[2].trim().toLowerCase();
    if (company && role && company !== 'company') {
      seen.add(`${company}::${role}`);
    }
  }

  return seen;
}

function ensurePipelineFile() {
  if (existsSync(PIPELINE_PATH)) {
    return readFileSync(PIPELINE_PATH, 'utf-8');
  }

  return '# Pipeline\n\n## Pendientes\n\n## Procesadas\n';
}

function appendToPipeline(offers) {
  if (offers.length === 0) return;

  let text = ensurePipelineFile();
  const marker = '## Pendientes';
  const idx = text.indexOf(marker);

  if (idx === -1) {
    const processedIdx = text.indexOf('## Procesadas');
    const insertAt = processedIdx === -1 ? text.length : processedIdx;
    const block = `\n${marker}\n\n${offers.map((offer) => `- [ ] ${offer.url} | ${offer.company} | ${offer.title}`).join('\n')}\n\n`;
    text = `${text.slice(0, insertAt)}${block}${text.slice(insertAt)}`;
  } else {
    const afterMarker = idx + marker.length;
    const nextSection = text.indexOf('\n## ', afterMarker);
    const insertAt = nextSection === -1 ? text.length : nextSection;
    const block = `\n${offers.map((offer) => `- [ ] ${offer.url} | ${offer.company} | ${offer.title}`).join('\n')}\n`;
    text = `${text.slice(0, insertAt)}${block}${text.slice(insertAt)}`;
  }

  writeFileSync(PIPELINE_PATH, text, 'utf-8');
}

function appendToScanHistory(offers, date) {
  if (!existsSync(SCAN_HISTORY_PATH)) {
    writeFileSync(SCAN_HISTORY_PATH, 'url\tfirst_seen\tportal\ttitle\tcompany\tstatus\n', 'utf-8');
  }

  const lines = offers
    .map((offer) => `${offer.url}\t${date}\t${offer.source}\t${offer.title}\t${offer.company}\tadded`)
    .join('\n');

  appendFileSync(SCAN_HISTORY_PATH, `${lines}\n`, 'utf-8');
}

function appendToScanResults(offers, date) {
  const existingPayload = existsSync(SCAN_RESULTS_PATH)
    ? JSON.parse(readFileSync(SCAN_RESULTS_PATH, 'utf-8'))
    : { generated_at: null, count: 0, items: [] };

  const byUrl = new Map(
    (Array.isArray(existingPayload.items) ? existingPayload.items : [])
      .filter((item) => item?.url)
      .map((item) => [item.url, item])
  );

  for (const offer of offers) {
    byUrl.set(offer.url, {
      url: offer.url,
      company: offer.company,
      title: offer.title,
      location: offer.location || null,
      source: offer.source || null,
      first_seen: date,
    });
  }

  const payload = {
    generated_at: new Date().toISOString(),
    count: byUrl.size,
    items: [...byUrl.values()].sort((left, right) => {
      const companyDiff = String(left.company || '').localeCompare(String(right.company || ''));
      if (companyDiff !== 0) return companyDiff;
      return String(left.title || '').localeCompare(String(right.title || ''));
    }),
  };

  writeFileSync(SCAN_RESULTS_PATH, `${JSON.stringify(payload, null, 2)}\n`, 'utf-8');
}

async function parallelFetch(tasks, limit) {
  let cursor = 0;

  async function next() {
    while (cursor < tasks.length) {
      const task = tasks[cursor];
      cursor += 1;
      await task();
    }
  }

  const workers = Array.from({ length: Math.min(limit, tasks.length) }, () => next());
  await Promise.all(workers);
}

function resolveStrategy(company, apiOnly) {
  const explicitMethod = String(company.scan_method || '').toLowerCase();
  const api = detectApi(company);

  if (explicitMethod === 'playwright' && company.careers_url && !apiOnly) {
    return { strategy: 'playwright', api: null };
  }

  if (api) {
    return { strategy: 'api', api };
  }

  if (company.careers_url && !apiOnly) {
    return { strategy: 'playwright', api: null };
  }

  return { strategy: 'skip', api: null };
}

function looksLikeJobLink(url, title, context, currentHost) {
  const href = String(url || '').toLowerCase();
  const text = `${title || ''} ${context || ''}`.toLowerCase();

  const urlSignals = [
    '/jobs/',
    '/job/',
    '/positions/',
    '/position/',
    '/openings/',
    '/opening/',
    '/careers/',
    '/career/',
    '/opportunities/',
    '/posting/',
    '/apply',
    'greenhouse.io',
    'ashbyhq.com',
    'lever.co',
    'workable.com',
    'smartrecruiters.com',
    'myworkdayjobs.com',
    'jobvite.com',
    'teamtailor.com',
  ];

  const titleSignals = [
    'engineer',
    'architect',
    'manager',
    'product',
    'developer',
    'scientist',
    'analyst',
    'specialist',
    'solutions',
    'solution architect',
    'customer engineer',
    'forward deployed',
    'deployed engineer',
    'staff',
    'principal',
    'lead',
    'director',
    'designer',
    'devrel',
    'advocate',
  ];

  const badSignals = [
    'privacy',
    'policy',
    'terms',
    'cookie',
    'benefits',
    'culture',
    'about',
    'blog',
    'news',
    'press',
    'linkedin',
    'twitter',
    'facebook',
    'instagram',
    'youtube',
    'login',
    'sign in',
    'candidate home',
    'talent network',
    'locations',
    'departments',
    'university',
    'students',
  ];

  const hasUrlSignal = urlSignals.some((signal) => href.includes(signal));
  const hasTitleSignal = titleSignals.some((signal) => text.includes(signal));
  const hasBadSignal = badSignals.some((signal) => text.includes(signal));

  return !hasBadSignal && (hasUrlSignal || hasTitleSignal);
}

async function scanWithPlaywright(browser, company) {
  const page = await browser.newPage();

  try {
    const response = await page.goto(company.careers_url, {
      waitUntil: 'domcontentloaded',
      timeout: PLAYWRIGHT_NAV_TIMEOUT_MS,
    });

    const status = response?.status() ?? 0;
    if (status >= 400) {
      throw new Error(`HTTP ${status}`);
    }

    await page.waitForTimeout(PLAYWRIGHT_SETTLE_MS);

    const extracted = await page.evaluate((companyName, maxContextChars) => {
      const clean = (value) => String(value || '').replace(/\s+/g, ' ').trim();
      const absolutize = (href) => {
        try {
          return new URL(href, window.location.href).toString();
        } catch {
          return null;
        }
      };

      const isVisible = (element) => {
        if (!element) return false;
        if (element.closest('nav, header, footer')) return false;
        if (element.closest('[aria-hidden="true"]')) return false;

        const style = window.getComputedStyle(element);
        if (style.display === 'none' || style.visibility === 'hidden') return false;
        if (!element.getClientRects().length) return false;

        return Array.from(element.getClientRects()).some((rect) => rect.width > 0 && rect.height > 0);
      };

      const anchors = Array.from(document.querySelectorAll('a[href]'));
      const items = [];

      for (const anchor of anchors) {
        if (!isVisible(anchor)) continue;

        const href = absolutize(anchor.getAttribute('href'));
        if (!href) continue;

        const title = clean(anchor.innerText || anchor.textContent || '');
        const container =
          anchor.closest('article, li, tr, [role="listitem"], .job, .opening, .posting, .position, .career') ||
          anchor.parentElement;
        const context = clean(container?.innerText || '').slice(0, maxContextChars);
        const host = window.location.hostname.replace(/^www\./, '');

        items.push({
          title,
          url: href,
          context,
          host,
          company: companyName,
        });
      }

      return {
        finalUrl: window.location.href,
        pageTitle: clean(document.title),
        items,
      };
    }, company.name, MAX_PLAYWRIGHT_CONTEXT_CHARS);

    const currentHost = new URL(extracted.finalUrl).hostname.replace(/^www\./, '');
    const seen = new Set();
    const locationPattern = /\b(remote|hybrid|on-site|onsite|new york|san francisco|london|berlin|paris|barcelona|madrid|emea|europe|usa|united states|canada)\b/i;
    const jobs = [];

    for (const item of extracted.items) {
      const title = cleanText(item.title || item.context.split(/[\r\n]+/)[0]);
      const url = normalizeUrl(item.url, extracted.finalUrl);
      const context = cleanText(item.context);

      if (!title || !url) continue;
      if (!looksLikeJobLink(url, title, context, currentHost || item.host)) continue;

      const key = `${url}::${title.toLowerCase()}`;
      if (seen.has(key)) continue;
      seen.add(key);

      const locationMatch = context.match(locationPattern);

      jobs.push({
        title,
        url,
        company: company.name,
        location: cleanText(locationMatch?.[1] || ''),
      });
    }

    return jobs;
  } finally {
    await page.close();
  }
}

function recordJobs({
  jobs,
  source,
  titleFilter,
  seenUrls,
  seenCompanyRoles,
  newOffers,
  stats,
}) {
  stats.totalFound += jobs.length;

  for (const job of jobs) {
    const title = cleanText(job.title);
    const url = cleanText(job.url);
    const company = cleanText(job.company);
    const location = cleanText(job.location);

    if (!title || !url || !company) {
      continue;
    }

    if (!titleFilter(title)) {
      stats.totalFiltered += 1;
      continue;
    }

    if (seenUrls.has(url)) {
      stats.totalDupes += 1;
      continue;
    }

    const key = `${company.toLowerCase()}::${title.toLowerCase()}`;
    if (seenCompanyRoles.has(key)) {
      stats.totalDupes += 1;
      continue;
    }

    seenUrls.add(url);
    seenCompanyRoles.add(key);

    const offer = {
      title,
      url,
      company,
      location,
      source,
    };

    newOffers.push(offer);
    stats.addedBySource[source] = (stats.addedBySource[source] || 0) + 1;
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }

  if (!existsSync(args.portalsPath)) {
    console.error(`Error: portals config not found: ${args.portalsPath}`);
    process.exit(1);
  }

  if (!parseYaml) {
    try {
      const yamlModule = await import('js-yaml');
      parseYaml = yamlModule.load || yamlModule.default?.load;
    } catch (error) {
      throw new Error(`Missing dependency "js-yaml" (${error.message}). Run npm install.`);
    }
  }

  const config = parseYaml(readFileSync(args.portalsPath, 'utf-8'));
  const companies = Array.isArray(config.tracked_companies) ? config.tracked_companies : [];
  const titleFilter = buildTitleFilter(config.title_filter);

  const enabledCompanies = companies
    .filter((company) => company.enabled !== false)
    .filter((company) => !args.filterCompany || String(company.name || '').toLowerCase().includes(args.filterCompany))
    .map((company) => {
      const { strategy, api } = resolveStrategy(company, args.apiOnly);
      return { ...company, _strategy: strategy, _api: api };
    });

  const apiTargets = enabledCompanies.filter((company) => company._strategy === 'api');
  const playwrightTargets = enabledCompanies.filter((company) => company._strategy === 'playwright');
  const skippedTargets = enabledCompanies.filter((company) => company._strategy === 'skip');

  console.log(
    `Scanning ${apiTargets.length} companies via API and ${playwrightTargets.length} via local Playwright (${skippedTargets.length} skipped)`
  );
  if (args.apiOnly) {
    console.log('Playwright fallback disabled via --api-only');
  }
  if (args.dryRun) {
    console.log('(dry run - no files will be written)');
  }
  console.log('');

  const seenUrls = loadSeenUrls();
  const seenCompanyRoles = loadSeenCompanyRoles();
  const date = new Date().toISOString().slice(0, 10);
  const newOffers = [];
  const errors = [];
  const stats = {
    totalFound: 0,
    totalFiltered: 0,
    totalDupes: 0,
    addedBySource: {},
  };

  const apiTasks = apiTargets.map((company) => async () => {
    try {
      const payload = await fetchJson(company._api.url);
      const parser = PARSERS[company._api.type];
      const jobs = parser ? parser(payload, company.name) : [];
      recordJobs({
        jobs,
        source: `${company._api.type}-api`,
        titleFilter,
        seenUrls,
        seenCompanyRoles,
        newOffers,
        stats,
      });
    } catch (error) {
      errors.push({ company: company.name, error: error.message });
    }
  });

  await parallelFetch(apiTasks, CONCURRENCY);

  if (playwrightTargets.length > 0) {
    let chromium;

    try {
      ({ chromium } = await import('playwright'));
    } catch (error) {
      errors.push({
        company: 'Playwright',
        error: `not available (${error.message})`,
      });
    }

    if (chromium) {
      const browser = await chromium.launch({ headless: true });

      try {
        for (const company of playwrightTargets) {
          try {
            const jobs = await scanWithPlaywright(browser, company);
            recordJobs({
              jobs,
              source: 'playwright-scan',
              titleFilter,
              seenUrls,
              seenCompanyRoles,
              newOffers,
              stats,
            });
          } catch (error) {
            errors.push({ company: company.name, error: error.message });
          }
        }
      } finally {
        await browser.close();
      }
    }
  }

  if (!args.dryRun && newOffers.length > 0) {
    appendToPipeline(newOffers);
    appendToScanHistory(newOffers, date);
    appendToScanResults(newOffers, date);
  }

  console.log(`${'-'.repeat(48)}`);
  console.log(`Portal Scan - ${date}`);
  console.log(`${'-'.repeat(48)}`);
  console.log(`Companies scanned:     ${apiTargets.length + playwrightTargets.length}`);
  console.log(`API companies:         ${apiTargets.length}`);
  console.log(`Playwright companies:  ${playwrightTargets.length}`);
  console.log(`Skipped companies:     ${skippedTargets.length}`);
  console.log(`Total jobs found:      ${stats.totalFound}`);
  console.log(`Filtered by title:     ${stats.totalFiltered} removed`);
  console.log(`Duplicates:            ${stats.totalDupes} skipped`);
  console.log(`New offers added:      ${newOffers.length}`);

  const sourceEntries = Object.entries(stats.addedBySource).sort((left, right) => right[1] - left[1]);
  if (sourceEntries.length > 0) {
    console.log('\nAdded by source:');
    for (const [source, count] of sourceEntries) {
      console.log(`  - ${source}: ${count}`);
    }
  }

  if (errors.length > 0) {
    console.log(`\nErrors (${errors.length}):`);
    for (const entry of errors) {
      console.log(`  - ${entry.company}: ${entry.error}`);
    }
  }

  if (newOffers.length > 0 && !args.summaryOnly) {
    const offersToPrint = args.maxPrint === null ? newOffers : newOffers.slice(0, args.maxPrint);

    console.log('\nNew offers:');
    for (const offer of offersToPrint) {
      console.log(`  + ${offer.company} | ${offer.title} | ${offer.location || 'N/A'}`);
    }

    if (offersToPrint.length < newOffers.length) {
      console.log(`  ... ${newOffers.length - offersToPrint.length} more not shown`);
    }

    if (args.dryRun) {
      console.log('\nDry run complete. Re-run without --dry-run to save results.');
    } else {
      console.log(`\nResults saved to ${PIPELINE_PATH}, ${SCAN_HISTORY_PATH}, and ${SCAN_RESULTS_PATH}`);
    }
  } else if (newOffers.length > 0) {
    if (args.dryRun) {
      console.log('\nDry run complete. Re-run without --dry-run to save results.');
    } else {
      console.log(`\nResults saved to ${PIPELINE_PATH}, ${SCAN_HISTORY_PATH}, and ${SCAN_RESULTS_PATH}`);
    }
  }

  console.log('\nFinal totals:');
  console.log(`  - New offers added: ${newOffers.length}`);
  console.log(`  - Total jobs found before filters/dedup: ${stats.totalFound}`);
  console.log(`  - Filtered by title: ${stats.totalFiltered}`);
  console.log(`  - Skipped as duplicates: ${stats.totalDupes}`);

  console.log('\nNext steps:');
  console.log('  1. npm run prefilter-policy');
  console.log('  2. npm run scan-filter -- --from data/scan-results.json --policy data/prefilter-policy.json');
  console.log('  3. npm run extract -- --from data/scan-filter/kept.md');
  console.log('  4. npm run prefilter -- --jobs jds/normalized --policy data/prefilter-policy.json');
  console.log('  5. npm run candidate-pack');
  console.log('  6. npm run triage -- --jobs data/prefilter/kept.json --pack data/candidate-pack.json');
}

main().catch((error) => {
  console.error(`Fatal: ${error.message}`);
  process.exit(1);
});
