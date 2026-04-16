#!/usr/bin/env node

import { createHash } from 'crypto';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'fs';
import { dirname, extname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { classifyLiveness } from './liveness-core.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));

const DEFAULTS = {
  from: resolve(__dirname, 'data/pipeline.md'),
  out: resolve(__dirname, 'jds/normalized'),
  markdownDir: resolve(__dirname, 'jds'),
  allowExpired: false,
  force: false,
  // Default 4 concurrent workers. Playwright instances are ~200-500MB RAM
  // each, so 4 is a conservative balance. User can override higher with
  // --parallel N if they have the memory headroom.
  parallel: 4,
};

function printHelp() {
  console.log(`career-ops extract

Normalize job descriptions into local JSON and markdown artifacts.

Usage:
  node extract-jd.mjs [options]
  node extract-jd.mjs --from data/pipeline.md
  node extract-jd.mjs https://job.example.com/1 https://job.example.com/2

Options:
  --from PATH           Input source: pipeline.md, batch-input.tsv, or newline list
  --out PATH            Output directory for normalized JSON (default: jds/normalized)
  --markdown-dir PATH   Output directory for extracted markdown text (default: jds)
  --parallel N          Concurrent extraction workers (default: 4)
                        Playwright uses ~200-500MB RAM per worker — raise with care.
  --allow-expired       Keep artifacts even if liveness says expired
  --force               Re-extract even if output already exists
  -h, --help            Show help
`);
}

function parseArgs(argv) {
  const args = { ...DEFAULTS, refs: [] };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    switch (arg) {
      case '--from':
        args.from = resolve(argv[++i]);
        break;
      case '--out':
        args.out = resolve(argv[++i]);
        break;
      case '--markdown-dir':
        args.markdownDir = resolve(argv[++i]);
        break;
      case '--parallel':
        args.parallel = Math.max(1, Number.parseInt(argv[++i], 10) || 1);
        break;
      case '--allow-expired':
        args.allowExpired = true;
        break;
      case '--force':
        args.force = true;
        break;
      case '-h':
      case '--help':
        args.help = true;
        break;
      default:
        args.refs.push(arg);
        break;
    }
  }

  return args;
}

function slugify(value, fallback = 'job') {
  const slug = String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);

  return slug || fallback;
}

function shortHash(value) {
  return createHash('sha256').update(value).digest('hex').slice(0, 10);
}

function textHash(value) {
  return createHash('sha256').update(value).digest('hex');
}

function collapseWhitespace(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function htmlToText(html) {
  return collapseWhitespace(
    String(html || '')
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
      .replace(/<\/(p|div|section|article|li|h[1-6]|br)>/gi, '\n')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/gi, ' ')
      .replace(/&amp;/gi, '&')
      .replace(/&quot;/gi, '"')
      .replace(/&#39;/gi, "'")
      .replace(/&lt;/gi, '<')
      .replace(/&gt;/gi, '>')
  );
}

function extractTitleFromText(text) {
  const firstLine = String(text || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean);
  return firstLine || null;
}

function inferCompanyFromUrl(url) {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.replace(/^www\./, '');
    const domain = host.split('.');
    if (domain.length >= 2) return domain[0];
    return host;
  } catch {
    return null;
  }
}

function parsePipelineRefs(text) {
  const refs = [];
  const lines = text.split(/\r?\n/);

  for (const line of lines) {
    const match = line.match(/^- \[(?: |x|!)]\s+(.+)$/);
    if (!match) continue;

    const parts = match[1].split('|').map((part) => part.trim()).filter(Boolean);
    if (parts.length === 0) continue;

    refs.push({
      ref: parts[0],
      companyHint: parts[1] || null,
      titleHint: parts.slice(2).join(' | ') || null,
    });
  }

  return refs;
}

function parseBatchTsv(text) {
  const refs = [];
  const lines = text.split(/\r?\n/);

  for (const line of lines) {
    if (!line.trim()) continue;
    const cols = line.split('\t');
    if (cols[0] === 'id') continue;
    if (!cols[1]) continue;

    refs.push({
      ref: cols[1].trim(),
      idHint: cols[0].trim(),
      sourceHint: cols[2]?.trim() || null,
      notes: cols[3]?.trim() || null,
    });
  }

  return refs;
}

function parseLineRefs(text) {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'))
    .map((line) => ({ ref: line }));
}

function loadRefs(args) {
  if (args.refs.length > 0) {
    return args.refs.map((ref) => ({ ref }));
  }

  if (!existsSync(args.from)) {
    throw new Error(`Input source not found: ${args.from}`);
  }

  const text = readFileSync(args.from, 'utf-8');
  const extension = extname(args.from).toLowerCase();

  if (extension === '.md') return parsePipelineRefs(text);
  if (extension === '.tsv') return parseBatchTsv(text);
  return parseLineRefs(text);
}

function normalizeLocalRef(ref) {
  if (ref.startsWith('local:')) {
    return resolve(__dirname, ref.slice('local:'.length));
  }

  if (existsSync(ref)) return resolve(ref);

  return null;
}

function buildBaseSlug({ company, title, ref }) {
  const base = [company, title].filter(Boolean).join('-');
  return `${slugify(base, 'job')}-${shortHash(ref)}`;
}

async function tryGreenhouseApi(url) {
  const match = url.match(/(?:boards|job-boards(?:\.eu)?)\.greenhouse\.io\/([^/]+)\/jobs\/(\d+)/i);
  if (!match) return null;

  const board = match[1];
  const jobId = match[2];
  const apiUrl = `https://boards-api.greenhouse.io/v1/boards/${board}/jobs/${jobId}`;
  const response = await fetch(apiUrl);
  if (!response.ok) throw new Error(`Greenhouse API HTTP ${response.status}`);

  const payload = await response.json();
  const text = htmlToText(payload.content || '');

  return {
    extractionMethod: 'greenhouse-api',
    provider: 'greenhouse',
    title: payload.title || null,
    company: payload.company_name || board,
    location: payload.location?.name || null,
    text,
    finalUrl: url,
    metadata: {
      board,
      job_id: jobId,
      updated_at: payload.updated_at || null,
      absolute_url: payload.absolute_url || url,
    },
  };
}

async function tryLeverApi(url) {
  const match = url.match(/jobs\.lever\.co\/([^/]+)\/([^/?#]+)/i);
  if (!match) return null;

  const company = match[1];
  const postingId = match[2];
  const apiUrl = `https://api.lever.co/v0/postings/${company}/${postingId}?mode=json`;
  const response = await fetch(apiUrl);
  if (!response.ok) throw new Error(`Lever API HTTP ${response.status}`);

  const payload = await response.json();
  const lists = Array.isArray(payload.lists)
    ? payload.lists.map((item) => `${item.text}: ${htmlToText(item.content || '')}`)
    : [];
  const text = collapseWhitespace([
    payload.descriptionPlain || htmlToText(payload.description || ''),
    ...lists,
  ].filter(Boolean).join('\n\n'));

  return {
    extractionMethod: 'lever-api',
    provider: 'lever',
    title: payload.text || null,
    company: payload.categories?.team || company,
    location: payload.categories?.location || null,
    text,
    finalUrl: payload.hostedUrl || url,
    metadata: {
      company_slug: company,
      posting_id: postingId,
      workplace_type: payload.workplaceType || null,
      commitment: payload.categories?.commitment || null,
    },
  };
}

async function tryStaticFetch(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Static fetch HTTP ${response.status}`);

  const contentType = response.headers.get('content-type') || '';
  const html = await response.text();
  const text = contentType.includes('html') ? htmlToText(html) : collapseWhitespace(html);

  if (!text || text.length < 400) return null;

  return {
    extractionMethod: 'static-fetch',
    provider: 'generic',
    title: null,
    company: null,
    location: null,
    text,
    finalUrl: response.url || url,
    metadata: {
      content_type: contentType,
    },
  };
}

async function extractWithPlaywright(url) {
  const { chromium } = await import('playwright');
  const browser = await chromium.launch({ headless: true });

  try {
    const page = await browser.newPage();
    const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });
    await page.waitForTimeout(2500);

    const status = response?.status() ?? 0;
    const finalUrl = page.url();

    const snapshot = await page.evaluate(() => {
      const collectText = (root) => {
        if (!root) return '';
        const clone = root.cloneNode(true);
        clone.querySelectorAll('script, style, nav, header, footer, svg, noscript').forEach((node) => node.remove());
        return clone.innerText || '';
      };

      const title =
        document.querySelector('h1')?.innerText?.trim() ||
        document.title?.trim() ||
        null;

      const main =
        document.querySelector('main, article, [role="main"], .job-description, .posting, .content') ||
        document.body;

      const bodyText = document.body?.innerText || '';
      const mainText = collectText(main);

      const applyControls = Array.from(
        document.querySelectorAll('a, button, input[type="submit"], input[type="button"], [role="button"]')
      )
        .filter((element) => {
          if (element.closest('nav, header, footer')) return false;
          if (element.closest('[aria-hidden="true"]')) return false;

          const style = window.getComputedStyle(element);
          if (style.display === 'none' || style.visibility === 'hidden') return false;
          if (!element.getClientRects().length) return false;

          return Array.from(element.getClientRects()).some((rect) => rect.width > 0 && rect.height > 0);
        })
        .map((element) => {
          const text = [
            element.innerText,
            element.value,
            element.getAttribute('aria-label'),
            element.getAttribute('title'),
          ].filter(Boolean).join(' ');
          return text.replace(/\s+/g, ' ').trim();
        })
        .filter(Boolean);

      return {
        title,
        bodyText,
        mainText,
        applyControls,
      };
    });

    const liveness = classifyLiveness({
      status,
      finalUrl,
      bodyText: snapshot.bodyText,
      applyControls: snapshot.applyControls,
    });

    return {
      extractionMethod: 'playwright',
      provider: 'browser',
      title: snapshot.title,
      company: null,
      location: null,
      text: collapseWhitespace(snapshot.mainText || snapshot.bodyText),
      finalUrl,
      liveness,
      metadata: {
        status,
      },
    };
  } finally {
    await browser.close();
  }
}

async function extractUrl(refEntry) {
  const url = refEntry.ref;

  const strategies = [
    tryGreenhouseApi,
    tryLeverApi,
    tryStaticFetch,
    extractWithPlaywright,
  ];

  let lastError = null;

  for (const strategy of strategies) {
    try {
      const result = await strategy(url);
      if (!result) continue;
      if (!result.text || result.text.length < 180) continue;
      return result;
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError || new Error('No extractor succeeded');
}

function createMarkdownArtifact({ title, company, url, method, liveness, text }) {
  const lines = [
    `# ${title || 'Untitled role'}`,
    '',
    `- Company: ${company || 'Unknown'}`,
    `- URL: ${url || 'N/A'}`,
    `- Extraction method: ${method}`,
    `- Liveness: ${liveness?.result || 'unknown'}${liveness?.reason ? ` (${liveness.reason})` : ''}`,
    '',
    '---',
    '',
    text,
    '',
  ];

  return lines.join('\n');
}

async function processRef(refEntry, args) {
  const localPath = normalizeLocalRef(refEntry.ref);
  let extracted;
  let ref = refEntry.ref;

  if (localPath) {
    const text = readFileSync(localPath, 'utf-8');
    extracted = {
      extractionMethod: 'local-file',
      provider: 'local',
      title: refEntry.titleHint || extractTitleFromText(text),
      company: refEntry.companyHint || null,
      location: null,
      text: text.trim(),
      finalUrl: null,
      liveness: { result: 'local', reason: 'local file' },
      metadata: {
        local_path: localPath,
      },
    };
    ref = `local:${localPath}`;
  } else {
    extracted = await extractUrl(refEntry);
  }

  const company = collapseWhitespace(extracted.company || refEntry.companyHint || inferCompanyFromUrl(refEntry.ref));
  const title = collapseWhitespace(extracted.title || refEntry.titleHint || extractTitleFromText(extracted.text));
  const baseSlug = buildBaseSlug({ company, title, ref });
  const jsonPath = resolve(args.out, `${baseSlug}.json`);
  const markdownPath = resolve(args.markdownDir, `${baseSlug}.md`);

  if (existsSync(jsonPath) && !args.force) {
    const existing = JSON.parse(readFileSync(jsonPath, 'utf-8'));
    return { status: 'cached', artifact: existing };
  }

  const liveness = extracted.liveness || { result: 'unknown', reason: null };
  if (!args.allowExpired && liveness.result === 'expired') {
    throw new Error(`URL marked expired: ${liveness.reason || refEntry.ref}`);
  }

  mkdirSync(args.out, { recursive: true });
  mkdirSync(args.markdownDir, { recursive: true });

  const markdown = createMarkdownArtifact({
    title,
    company,
    url: extracted.finalUrl || refEntry.ref,
    method: extracted.extractionMethod,
    liveness,
    text: extracted.text,
  });

  writeFileSync(markdownPath, markdown, 'utf-8');

  const artifact = {
    schema_version: 'career-ops.jd.v1',
    extracted_at: new Date().toISOString(),
    id: baseSlug,
    source: {
      input_ref: refEntry.ref,
      final_url: extracted.finalUrl || refEntry.ref,
      provider: extracted.provider,
      extraction_method: extracted.extractionMethod,
      source_hint: refEntry.sourceHint || null,
      notes: refEntry.notes || null,
    },
    job: {
      company: company || null,
      title: title || null,
      location: collapseWhitespace(extracted.location || null) || null,
    },
    status: {
      liveness: liveness.result || 'unknown',
      reason: liveness.reason || null,
    },
    content: {
      text: extracted.text,
      chars: extracted.text.length,
      words: extracted.text.split(/\s+/).filter(Boolean).length,
      sha256: textHash(extracted.text),
      markdown_path: markdownPath,
    },
    metadata: extracted.metadata || {},
  };

  writeFileSync(jsonPath, `${JSON.stringify(artifact, null, 2)}\n`, 'utf-8');
  return { status: 'extracted', artifact };
}

async function runPool(items, parallel, handler) {
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < items.length) {
      const current = nextIndex;
      nextIndex += 1;
      await handler(items[current], current);
    }
  }

  const workers = Array.from({ length: Math.min(parallel, items.length) }, () => worker());
  await Promise.all(workers);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }

  const refs = loadRefs(args);
  if (refs.length === 0) {
    console.log('No job references found.');
    return;
  }

  const summary = {
    processed: 0,
    extracted: 0,
    cached: 0,
    failed: 0,
    artifacts: [],
  };

  console.log(`Extracting ${refs.length} refs with ${args.parallel} parallel workers...`);

  await runPool(refs, args.parallel, async (refEntry) => {
    summary.processed += 1;
    try {
      const result = await processRef(refEntry, args);
      summary[result.status] += 1;
      summary.artifacts.push(result.artifact);
      console.log(`${result.status === 'cached' ? '↺' : '✓'} ${refEntry.ref}`);
    } catch (error) {
      summary.failed += 1;
      console.log(`✗ ${refEntry.ref}`);
      console.log(`  ${error.message}`);
    }
  });

  mkdirSync(args.out, { recursive: true });
  const manifestPath = resolve(args.out, 'index.json');
  writeFileSync(manifestPath, `${JSON.stringify({
    generated_at: new Date().toISOString(),
    count: summary.artifacts.length,
    items: summary.artifacts.map((artifact) => ({
      id: artifact.id,
      company: artifact.job.company,
      title: artifact.job.title,
      url: artifact.source.final_url,
      liveness: artifact.status.liveness,
      job_file: resolve(args.out, `${artifact.id}.json`),
      markdown_path: artifact.content.markdown_path,
    })),
  }, null, 2)}\n`, 'utf-8');

  console.log('');
  console.log(`Processed: ${summary.processed}`);
  console.log(`Extracted: ${summary.extracted}`);
  console.log(`Cached:    ${summary.cached}`);
  console.log(`Failed:    ${summary.failed}`);
  console.log(`Manifest:  ${manifestPath}`);
}

main().catch((error) => {
  console.error(`Fatal: ${error.message}`);
  process.exit(1);
});
