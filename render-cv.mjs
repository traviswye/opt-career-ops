#!/usr/bin/env node

/**
 * render-cv.mjs -- Deterministic local CV renderer.
 *
 * Consumes a minimal JSON tailoring file + cv.md + profile.yml + JD text,
 * fills the HTML template, runs generate-pdf.mjs, and reports keyword
 * coverage + cliche lint.
 *
 * The LLM only produces the tailoring JSON (summary, competencies, bullets
 * by company, selected projects, extracted keywords). Everything else --
 * paper format detection, language detection, filename generation, HTML
 * assembly, template substitution, PDF invocation, coverage calculation,
 * cliche linting -- happens here, deterministically, with zero tokens.
 *
 * Usage:
 *   node render-cv.mjs \
 *     --cv cv.md \
 *     --profile config/profile.yml \
 *     --jd /tmp/jd.txt \
 *     --tailoring /tmp/cv-tailoring.json \
 *     --output output/cv-travis-wye-workos-2026-04-15.pdf
 *
 * Options:
 *   --template path   Override template (default templates/cv-template.html)
 *   --format letter|a4   Force paper format (default: detect from JD)
 *   --lang en|es|fr|de|ja   Force language (default: en)
 *   --max-pages N     Hard cap on pages (default: profile.resume.max_pages → 2)
 *   --fail-on-overflow  Exit 2 if pages > max-pages (default: warn only)
 *   --keep-html       Keep the intermediate HTML file
 *   --json            Emit a JSON summary on stdout (for orchestrators)
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, unlinkSync } from 'fs';
import { resolve, dirname, basename } from 'path';
import { fileURLToPath } from 'url';
import { spawnSync } from 'child_process';
import yaml from 'js-yaml';

const DEFAULT_MAX_PAGES = 2;
// Empirical: our HTML template (letter, 11px DM Sans body, 0.6in margins)
// fits ~2,800 characters of body text per page. Measured across three
// Sonnet runs at 4,764 / 4,903 / 5,679 total chars, all fitting 2 pages.
// Budget = pages * this.
const CHARS_PER_PAGE = 2800;
const COVERAGE_FLOOR = 80;

const __dirname = dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// Arg parsing
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const args = {
    cv: 'cv.md',
    profile: 'config/profile.yml',
    template: 'templates/cv-template.html',
    jd: null,
    tailoring: null,
    output: null,
    format: null,
    lang: null,
    maxPages: null,
    failOnOverflow: false,
    keepHtml: false,
    json: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    switch (a) {
      case '--cv': args.cv = argv[++i]; break;
      case '--profile': args.profile = argv[++i]; break;
      case '--template': args.template = argv[++i]; break;
      case '--jd': args.jd = argv[++i]; break;
      case '--tailoring': args.tailoring = argv[++i]; break;
      case '--output': args.output = argv[++i]; break;
      case '--format': args.format = argv[++i]; break;
      case '--lang': args.lang = argv[++i]; break;
      case '--max-pages': args.maxPages = Number.parseInt(argv[++i], 10); break;
      case '--fail-on-overflow': args.failOnOverflow = true; break;
      case '--keep-html': args.keepHtml = true; break;
      case '--json': args.json = true; break;
      case '-h':
      case '--help':
        printHelp();
        process.exit(0);
      default:
        throw new Error(`Unknown arg: ${a}`);
    }
  }

  const missing = ['jd', 'tailoring', 'output'].filter((k) => !args[k]);
  if (missing.length) {
    throw new Error(`Missing required args: ${missing.map((m) => `--${m}`).join(', ')}`);
  }

  args.cv = resolve(args.cv);
  args.profile = resolve(args.profile);
  args.template = resolve(args.template);
  args.jd = resolve(args.jd);
  args.tailoring = resolve(args.tailoring);
  args.output = resolve(args.output);
  return args;
}

function printHelp() {
  console.log(`Usage: node render-cv.mjs --jd <file> --tailoring <file> --output <pdf> [options]

Required:
  --jd PATH         JD text file (used for paper format + language detection)
  --tailoring PATH  JSON tailoring file produced by the pdf mode
  --output PATH     Output PDF path

Optional:
  --cv PATH         cv.md (default: cv.md)
  --profile PATH    profile.yml (default: config/profile.yml)
  --template PATH   HTML template (default: templates/cv-template.html)
  --format FMT      Force paper format: letter | a4 (default: detect from JD)
  --lang LANG       Force language: en | es | fr | de | ja (default: en)
  --max-pages N     Hard page cap (default: profile.resume.max_pages -> 2)
  --fail-on-overflow  Exit 2 if pages > max-pages (default: warn only)
  --keep-html       Keep the intermediate HTML file
  --json            Emit JSON summary on stdout
`);
}

// ---------------------------------------------------------------------------
// Deterministic detection: paper format, language, filename slug
// ---------------------------------------------------------------------------

const US_CA_MARKERS = [
  'united states', 'u.s.', 'u.s.a', 'usa', ' us ', 'us only', 'us-only',
  'canada', 'canadian',
  // common US city/state markers
  'san francisco', 'new york', 'boston', 'seattle', 'austin', 'chicago',
  'los angeles', 'atlanta', 'denver', 'miami', 'fort lauderdale',
  'california', 'texas', 'florida', 'washington state', 'massachusetts',
];

function detectPaperFormat(jdText) {
  const t = ` ${jdText.toLowerCase()} `;
  if (US_CA_MARKERS.some((marker) => t.includes(marker))) return 'letter';
  return 'a4';
}

function detectLanguage(jdText) {
  const t = jdText.toLowerCase();
  const counts = {
    en: 0, es: 0, fr: 0, de: 0, ja: 0,
  };
  const markers = {
    en: ['responsibilities', 'qualifications', 'experience', 'requirements', 'we are looking for'],
    es: ['responsabilidades', 'requisitos', 'experiencia', 'buscamos', 'se ofrece'],
    fr: ['responsabilités', 'qualifications', 'profil', 'nous recherchons', 'compétences'],
    de: ['aufgaben', 'anforderungen', 'qualifikationen', 'wir suchen', 'kenntnisse'],
    ja: ['職務', '応募資格', '必須', '募集', '仕事内容'],
  };
  for (const [lang, words] of Object.entries(markers)) {
    for (const w of words) {
      if (t.includes(w)) counts[lang] += 1;
    }
  }
  const best = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
  return best && best[1] > 0 ? best[0] : 'en';
}

function kebab(str) {
  return String(str || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// ---------------------------------------------------------------------------
// cv.md parser -- minimal, regex-based, extracts only what the template needs
// ---------------------------------------------------------------------------

function parseCvMarkdown(md) {
  const sections = splitSections(md);
  return {
    experience: parseExperienceSection(sections.experience || sections.Experience || ''),
    skills: parseSkillsTable(sections.skills || sections.Skills || ''),
    education: parseEducationSection(sections.education || sections.Education || ''),
    projects: parseProjectsSection(
      sections['personal projects'] || sections['Personal Projects'] || sections.projects || sections.Projects || ''
    ),
    certifications: parseEducationSection(
      sections.certifications || sections.Certifications || ''
    ),
  };
}

function splitSections(md) {
  const lines = md.split(/\r?\n/);
  const sections = {};
  let current = null;
  let buf = [];
  for (const line of lines) {
    const h2 = line.match(/^##\s+(.+?)\s*$/);
    if (h2) {
      if (current) sections[current] = buf.join('\n');
      current = h2[1].toLowerCase().trim();
      buf = [];
    } else if (current) {
      buf.push(line);
    }
  }
  if (current) sections[current] = buf.join('\n');
  return sections;
}

function parseExperienceSection(section) {
  // Each job starts with `### Company — Location`
  // Then `**Role** | *Period*`
  // Then bullets `- ...` (may span multiple lines per bullet)
  const jobs = [];
  const blocks = section.split(/^###\s+/m).slice(1);
  for (const block of blocks) {
    const lines = block.split(/\r?\n/);
    const header = lines[0] || '';
    const [companyPart, locationPart] = header.split(/\s+[—-]\s+/);
    const company = (companyPart || '').trim();
    const location = (locationPart || '').trim();

    let role = '';
    let period = '';
    const bullets = [];
    let currentBullet = null;

    for (let i = 1; i < lines.length; i += 1) {
      const line = lines[i];
      // Role/period line: **Role** | *Period*
      const rp = line.match(/^\*\*(.+?)\*\*\s*\|\s*\*(.+?)\*\s*$/);
      if (rp) {
        role = rp[1].trim();
        period = rp[2].trim();
        continue;
      }
      // Bullet start
      const bm = line.match(/^-\s+(.*)$/);
      if (bm) {
        if (currentBullet) bullets.push(currentBullet.trim());
        currentBullet = bm[1];
        continue;
      }
      // Continuation of previous bullet
      if (currentBullet && line.trim() && !line.startsWith('#')) {
        currentBullet += ' ' + line.trim();
      }
    }
    if (currentBullet) bullets.push(currentBullet.trim());

    if (company) jobs.push({ company, location, role, period, bullets });
  }
  return jobs;
}

function parseSkillsTable(section) {
  // | **Category** | technologies |
  const skills = {};
  const rows = section.match(/^\|[^\n]+\|[^\n]+\|$/gm) || [];
  for (const row of rows) {
    const cells = row.split('|').map((c) => c.trim()).filter(Boolean);
    if (cells.length < 2) continue;
    if (/^-+$/.test(cells[0])) continue;
    if (/category/i.test(cells[0]) && /technolog/i.test(cells[1])) continue;
    const category = cells[0].replace(/\*\*/g, '').trim();
    const techs = cells[1].trim();
    if (category && techs) skills[category] = techs;
  }
  return skills;
}

function parseEducationSection(section) {
  // ### **Degree** — School — *Year*
  // or **Degree** — School — *Year*
  const items = [];
  const lines = section.split(/\r?\n/);
  for (const line of lines) {
    const m = line.match(/^(?:###\s+)?\*?\*?(.+?)\*?\*?\s*[—-]\s*(.+?)\s*[—-]\s*\*(.+?)\*\s*$/);
    if (m) {
      items.push({ title: m[1].replace(/\*\*/g, '').trim(), org: m[2].trim(), year: m[3].trim() });
    }
  }
  return items;
}

function parseProjectsSection(section) {
  // ### Title — optional subtitle
  // bullets
  const projects = [];
  const blocks = section.split(/^###\s+/m).slice(1);
  for (const block of blocks) {
    const lines = block.split(/\r?\n/);
    const header = lines[0] || '';
    const [titlePart, subtitle] = header.split(/\s+[—-]\s+/);
    const title = (titlePart || '').trim();
    const bullets = [];
    let currentBullet = null;
    for (let i = 1; i < lines.length; i += 1) {
      const line = lines[i];
      const bm = line.match(/^-\s+(.*)$/);
      if (bm) {
        if (currentBullet) bullets.push(currentBullet.trim());
        currentBullet = bm[1];
      } else if (currentBullet && line.trim() && !line.startsWith('#')) {
        currentBullet += ' ' + line.trim();
      }
    }
    if (currentBullet) bullets.push(currentBullet.trim());
    if (title) projects.push({ title, subtitle: (subtitle || '').trim(), bullets });
  }
  return projects;
}

// ---------------------------------------------------------------------------
// HTML assembly
// ---------------------------------------------------------------------------

function escapeHtml(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderExperienceHtml(jobs, experienceBullets, experienceInclude) {
  // experienceBullets: { "Company substring": [bullet strings] }
  // experienceInclude: optional array of company substrings to include
  //                    (omitted jobs are dropped). If absent, render all jobs.
  const parts = [];
  for (const job of jobs) {
    if (experienceInclude && experienceInclude.length) {
      const matched = experienceInclude.some(
        (name) => job.company.toLowerCase().includes(String(name).toLowerCase())
               || String(name).toLowerCase().includes(job.company.toLowerCase())
      );
      if (!matched) continue;
    }
    const override = findBulletsOverride(job.company, experienceBullets);
    const bullets = override || job.bullets;
    const bulletsHtml = bullets
      .map((b) => `        <li>${renderInlineMarkdown(b)}</li>`)
      .join('\n');
    parts.push(`    <div class="job">
      <div class="job-header">
        <div>
          <div class="job-company">${escapeHtml(job.company)}</div>
          <div class="job-role">${escapeHtml(job.role)}${job.location ? ` · ${escapeHtml(job.location)}` : ''}</div>
        </div>
        <div class="job-period">${escapeHtml(job.period)}</div>
      </div>
      <ul>
${bulletsHtml}
      </ul>
    </div>`);
  }
  return parts.join('\n\n');
}

function findBulletsOverride(company, bulletsMap) {
  if (!bulletsMap) return null;
  const cLower = company.toLowerCase();
  for (const [key, value] of Object.entries(bulletsMap)) {
    if (cLower.includes(key.toLowerCase()) || key.toLowerCase().includes(cLower)) {
      return value;
    }
  }
  return null;
}

function renderInlineMarkdown(text) {
  // Minimal: **bold** + escape. No other markdown.
  const escaped = escapeHtml(text);
  return escaped.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
}

function renderCompetenciesHtml(tags) {
  return tags
    .map((t) => `      <span class="competency-tag">${escapeHtml(t)}</span>`)
    .join('\n');
}

function renderProjectsHtml(selected, allProjects) {
  // `selected` is an array of { title, description } from tailoring.
  // If a title matches a project in cv.md, use that cv.md entry but with
  // the rewritten description. If no match, emit the description alone.
  const parts = [];
  for (const sel of selected) {
    const match = allProjects.find(
      (p) => p.title.toLowerCase().includes(sel.title.toLowerCase())
         || sel.title.toLowerCase().includes(p.title.toLowerCase())
    );
    const title = match ? match.title : sel.title;
    const subtitle = match ? match.subtitle : '';
    parts.push(`    <div class="project">
      <div class="project-title">${escapeHtml(title)}${subtitle ? ` <span style="font-weight:400;color:#666;font-size:10.5px">— ${escapeHtml(subtitle)}</span>` : ''}</div>
      <div class="project-desc">${renderInlineMarkdown(sel.description)}</div>
    </div>`);
  }
  return parts.join('\n\n');
}

function renderEducationHtml(items) {
  return items
    .map((e) => `    <div class="edu-item">
      <div class="edu-header">
        <div><span class="edu-title">${escapeHtml(e.title)}</span> · <span class="edu-org">${escapeHtml(e.org)}</span></div>
        <div class="edu-year">${escapeHtml(e.year)}</div>
      </div>
    </div>`)
    .join('\n\n');
}

function renderSkillsHtml(skills) {
  const rows = Object.entries(skills).map(
    ([category, techs]) => `      <div class="skill-item"><span class="skill-category">${escapeHtml(category)}:</span> ${escapeHtml(techs)}</div>`
  );
  return `    <div class="skills-grid">
${rows.join('\n')}
    </div>`;
}

function getSectionLabels(lang) {
  const labels = {
    en: {
      summary: 'Professional Summary',
      competencies: 'Core Competencies',
      experience: 'Work Experience',
      projects: 'Projects',
      education: 'Education',
      certifications: 'Certifications',
      skills: 'Skills',
    },
    es: {
      summary: 'Resumen Profesional',
      competencies: 'Competencias Core',
      experience: 'Experiencia Laboral',
      projects: 'Proyectos',
      education: 'Formación',
      certifications: 'Certificaciones',
      skills: 'Competencias',
    },
    fr: {
      summary: 'Résumé Professionnel',
      competencies: 'Compétences Clés',
      experience: 'Expérience Professionnelle',
      projects: 'Projets',
      education: 'Formation',
      certifications: 'Certifications',
      skills: 'Compétences',
    },
    de: {
      summary: 'Profil',
      competencies: 'Kernkompetenzen',
      experience: 'Berufserfahrung',
      projects: 'Projekte',
      education: 'Ausbildung',
      certifications: 'Zertifizierungen',
      skills: 'Fähigkeiten',
    },
    ja: {
      summary: '職務要約',
      competencies: 'コアスキル',
      experience: '職務経歴',
      projects: 'プロジェクト',
      education: '学歴',
      certifications: '資格',
      skills: 'スキル',
    },
  };
  return labels[lang] || labels.en;
}

function fillTemplate(template, values) {
  let out = template;
  for (const [key, value] of Object.entries(values)) {
    const pattern = new RegExp(`\\{\\{${key}\\}\\}`, 'g');
    out = out.replace(pattern, () => String(value ?? ''));
  }
  return out;
}

// ---------------------------------------------------------------------------
// Post-generation lint: keyword coverage + cliche phrases
// ---------------------------------------------------------------------------

const CLICHE_PHRASES = [
  'passionate about',
  'results-oriented',
  'results oriented',
  'proven track record',
  'leveraged',
  'spearheaded',
  'facilitated',
  'synergies',
  'robust',
  'seamless',
  'cutting-edge',
  'cutting edge',
  'innovative',
  'in today\'s fast-paced',
  'demonstrated ability to',
  'best practices',
  'utilized',
  'in order to',
];

function stripHtml(html) {
  return html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

function normalizeHardGap(entry) {
  // Accept annotated strings like "Kubernetes — no experience" or
  // "on-call (not explicit in cv.md)" and reduce to the bare keyword
  // by stripping everything after the first em-dash, en-dash, colon,
  // or opening parenthesis. LLMs write these in prose form; we need
  // the literal match against the keywords array.
  return String(entry || '')
    .split(/\s+[—–\-:(\[]/)[0]
    .trim()
    .toLowerCase();
}

function keywordMatches(keyword, text) {
  // Exact substring (case-insensitive) is the primary check.
  const lower = keyword.toLowerCase();
  if (text.includes(lower)) return true;
  // Inflection tolerance: for keywords of 7+ chars, match a fixed 6-char
  // word-boundary prefix so "scalability" matches "scalable",
  // "observability" matches "observable", "reliability" matches "reliable".
  // Using a fixed 6 (not a ratio) because noun→adjective pairs typically
  // share only the first 6 characters.
  if (lower.length >= 7) {
    const prefix = lower.slice(0, 6);
    const pattern = new RegExp(`\\b${prefix.replace(/[^a-z0-9]/g, '\\$&')}`);
    if (pattern.test(text)) return true;
  }
  return false;
}

function isKeywordDeclaredAsGap(keyword, hardGapEntries) {
  // A keyword is a declared hard gap if ANY entry in hard_gaps either:
  //  (a) exactly equals the keyword (after stripping annotations), or
  //  (b) contains the keyword as a substring (handles "on-call rotation"
  //      declared as a gap matching the keyword "on-call"), or
  //  (c) is contained BY the keyword (handles the inverse case).
  const kwLower = keyword.toLowerCase();
  for (const rawEntry of hardGapEntries || []) {
    const fullLower = String(rawEntry || '').toLowerCase();
    const stripped = normalizeHardGap(rawEntry);
    if (!fullLower && !stripped) continue;
    if (stripped === kwLower) return true;
    if (fullLower.includes(kwLower)) return true;
    if (stripped.includes(kwLower)) return true;
    if (kwLower.includes(stripped) && stripped.length >= 4) return true;
  }
  return false;
}

function computeCoverage(keywords, resumeText, hardGaps = []) {
  const text = resumeText.toLowerCase();
  const hit = [];
  const miss = [];
  const missInjectable = [];
  const missHardGap = [];
  for (const kw of keywords) {
    if (!kw) continue;
    const kwLower = String(kw).toLowerCase();
    if (keywordMatches(kwLower, text)) {
      hit.push(kw);
    } else {
      miss.push(kw);
      if (isKeywordDeclaredAsGap(kwLower, hardGaps)) missHardGap.push(kw);
      else missInjectable.push(kw);
    }
  }
  const total = keywords.length;
  const adjustedTotal = Math.max(1, total - missHardGap.length);
  const rawPct = total ? (hit.length / total) * 100 : 0;
  const adjustedPct = (hit.length / adjustedTotal) * 100;
  return {
    pct: adjustedPct,
    raw_pct: rawPct,
    hit,
    miss,
    miss_injectable: missInjectable,
    miss_hard_gap: missHardGap,
    total,
    adjusted_total: adjustedTotal,
  };
}

function findCliches(resumeText) {
  const lower = resumeText.toLowerCase();
  return CLICHE_PHRASES.filter((p) => lower.includes(p));
}

function countPdfPages(pdfPath) {
  // Same regex generate-pdf.mjs uses. Read as latin1 so PDF byte sequences
  // map 1:1 to characters.
  try {
    const buf = readFileSync(pdfPath);
    const str = buf.toString('latin1');
    const matches = str.match(/\/Type\s*\/Page[^s]/g) || [];
    return matches.length;
  } catch (_) {
    return 0;
  }
}

function computeBudget(tailoring, maxPages) {
  // Character counts per section of the tailoring JSON. These are the
  // LLM-controllable slots — Education/Skills/Certifications come from
  // cv.md and don't count against the budget.
  const summary = (tailoring.summary || '').length;
  const competencies = (tailoring.competencies || []).join(' ').length;
  const experienceBullets = Object.values(tailoring.experience_bullets || {})
    .flat()
    .reduce((sum, b) => sum + String(b).length, 0);
  const projects = (tailoring.projects || []).reduce(
    (sum, p) => sum + (p.title || '').length + (p.description || '').length,
    0,
  );
  const total = summary + competencies + experienceBullets + projects;
  const target = maxPages * CHARS_PER_PAGE;
  const ceiling = Math.round(target * 1.05);
  return {
    summary,
    competencies,
    experience_bullets: experienceBullets,
    projects,
    total,
    target,
    ceiling,
    overshoot_pct: Number((((total - target) / target) * 100).toFixed(1)),
    within_budget: total <= ceiling,
  };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main() {
  const args = parseArgs(process.argv.slice(2));

  const profile = yaml.load(readFileSync(args.profile, 'utf-8'));
  const cvMd = readFileSync(args.cv, 'utf-8');
  const tailoring = JSON.parse(readFileSync(args.tailoring, 'utf-8'));
  const jdText = readFileSync(args.jd, 'utf-8');
  const template = readFileSync(args.template, 'utf-8');

  const lang = args.lang || tailoring.language || detectLanguage(jdText);
  const format = args.format || tailoring.paper_format || detectPaperFormat(jdText);
  const pageWidth = format === 'letter' ? '8.5in' : '210mm';

  const parsed = parseCvMarkdown(cvMd);

  const candidate = profile.candidate || {};
  const name = candidate.full_name || 'Candidate';
  const email = candidate.email || '';
  const phone = candidate.phone || '';
  const location = candidate.location || '';
  const linkedinUrl = candidate.linkedin
    ? (candidate.linkedin.startsWith('http') ? candidate.linkedin : `https://${candidate.linkedin}`)
    : '';
  const linkedinDisplay = candidate.linkedin || '';
  const portfolioUrl = candidate.portfolio_url || '';
  const portfolioDisplay = candidate.portfolio_url
    ? candidate.portfolio_url.replace(/^https?:\/\//, '')
    : '';
  const githubUrl = candidate.github
    ? (candidate.github.startsWith('http') ? candidate.github : `https://${candidate.github}`)
    : '';
  const githubDisplay = candidate.github || '';

  // Build contact row dynamically, skipping empty fields and collapsing
  // separators. Order: email > phone > linkedin > github > portfolio > location.
  const contactItems = [];
  if (email) contactItems.push(`<span>${escapeHtml(email)}</span>`);
  if (phone) contactItems.push(`<span>${escapeHtml(phone)}</span>`);
  if (linkedinDisplay) contactItems.push(`<a href="${escapeHtml(linkedinUrl)}">${escapeHtml(linkedinDisplay)}</a>`);
  if (githubDisplay) contactItems.push(`<a href="${escapeHtml(githubUrl)}">${escapeHtml(githubDisplay)}</a>`);
  if (portfolioDisplay) contactItems.push(`<a href="${escapeHtml(portfolioUrl)}">${escapeHtml(portfolioDisplay)}</a>`);
  if (location) contactItems.push(`<span>${escapeHtml(location)}</span>`);
  const contactRow = contactItems.join('\n      <span class="separator">|</span>\n      ');

  const labels = getSectionLabels(lang);

  const experienceHtml = renderExperienceHtml(
    parsed.experience,
    tailoring.experience_bullets || {},
    tailoring.experience_include || null
  );
  const competenciesHtml = renderCompetenciesHtml(tailoring.competencies || []);
  const projectsHtml = renderProjectsHtml(tailoring.projects || [], parsed.projects);
  const educationHtml = renderEducationHtml(parsed.education);
  const certificationsHtml = parsed.certifications.length
    ? renderEducationHtml(parsed.certifications)
    : '<div style="color:#888;font-size:10px">&nbsp;</div>';
  const skillsHtml = renderSkillsHtml(parsed.skills);

  const filled = fillTemplate(template, {
    LANG: lang,
    PAGE_WIDTH: pageWidth,
    NAME: escapeHtml(name),
    CONTACT_ROW: contactRow,
    // Legacy placeholders kept for backward compat with older template forks
    EMAIL: escapeHtml(email),
    PHONE: escapeHtml(phone),
    LINKEDIN_URL: linkedinUrl,
    LINKEDIN_DISPLAY: escapeHtml(linkedinDisplay),
    PORTFOLIO_URL: portfolioUrl,
    PORTFOLIO_DISPLAY: escapeHtml(portfolioDisplay),
    LOCATION: escapeHtml(location),
    SECTION_SUMMARY: labels.summary,
    SUMMARY_TEXT: renderInlineMarkdown(tailoring.summary || ''),
    SECTION_COMPETENCIES: labels.competencies,
    COMPETENCIES: competenciesHtml,
    SECTION_EXPERIENCE: labels.experience,
    EXPERIENCE: experienceHtml,
    SECTION_PROJECTS: labels.projects,
    PROJECTS: projectsHtml,
    SECTION_EDUCATION: labels.education,
    EDUCATION: educationHtml,
    SECTION_CERTIFICATIONS: labels.certifications,
    CERTIFICATIONS: certificationsHtml,
    SECTION_SKILLS: labels.skills,
    SKILLS: skillsHtml,
  });

  // Write HTML next to the output PDF so font paths resolve correctly
  mkdirSync(dirname(args.output), { recursive: true });
  const htmlPath = args.output.replace(/\.pdf$/i, '.html');
  writeFileSync(htmlPath, filled, 'utf-8');

  // Invoke generate-pdf.mjs. In --json mode, capture its stdout so it
  // doesn't pollute the structured summary; in human mode let it stream.
  const pdfSpawnOpts = args.json
    ? { cwd: __dirname, stdio: ['ignore', 'pipe', 'pipe'] }
    : { cwd: __dirname, stdio: 'inherit' };
  const pdfResult = spawnSync(
    'node',
    [resolve(__dirname, 'generate-pdf.mjs'), htmlPath, args.output, `--format=${format}`],
    pdfSpawnOpts,
  );
  if (pdfResult.status !== 0) {
    if (args.json) {
      process.stderr.write(pdfResult.stdout || '');
      process.stderr.write(pdfResult.stderr || '');
    }
    throw new Error(`generate-pdf.mjs failed with code ${pdfResult.status}`);
  }
  if (args.json && pdfResult.stdout) {
    // Surface the pdf-gen log on stderr for debugging, keep stdout clean.
    process.stderr.write(pdfResult.stdout.toString());
  }

  // Cleanup HTML unless --keep-html
  if (!args.keepHtml) {
    try { unlinkSync(htmlPath); } catch (_) { /* ignore */ }
  }

  // Lint: coverage + cliches + page count vs profile.resume.max_pages
  const plainResume = stripHtml(filled);
  const coverage = computeCoverage(
    tailoring.keywords || [],
    plainResume,
    tailoring.hard_gaps || [],
  );
  const cliches = findCliches(plainResume);
  const resumeConfig = (profile && profile.resume) || {};
  const maxPages = Number(args.maxPages || resumeConfig.max_pages || DEFAULT_MAX_PAGES);
  const failOnOverflow = args.failOnOverflow || resumeConfig.fail_on_overflow === true;
  const pageCount = countPdfPages(args.output);
  const overflow = pageCount > maxPages;
  const budget = computeBudget(tailoring, maxPages);

  // Two parallel gates: page overflow and coverage floor. Treated
  // independently because they fail for different reasons and need
  // different fixes. Coverage uses the ADJUSTED floor (excludes
  // declared hard_gaps from the denominator).
  const warnings = [];
  if (overflow) {
    warnings.push(`page_overflow: ${pageCount} > ${maxPages}`);
  }
  if (!budget.within_budget) {
    warnings.push(`char_overshoot: total=${budget.total}, target=${budget.target}, +${budget.overshoot_pct}%`);
  }
  if (coverage.pct < COVERAGE_FLOOR) {
    warnings.push(`coverage_below_floor: adjusted ${coverage.pct.toFixed(1)}% < ${COVERAGE_FLOOR}% (raw ${coverage.raw_pct.toFixed(1)}%)`);
  }
  if (coverage.miss_injectable.length > 0) {
    warnings.push(`injectable_misses: ${coverage.miss_injectable.join(', ')}`);
  }
  if (cliches.length) {
    warnings.push(`cliches: ${cliches.join(', ')}`);
  }

  const summary = {
    output: args.output,
    format,
    language: lang,
    pages: pageCount,
    max_pages: maxPages,
    overflow,
    coverage_pct: Number(coverage.pct.toFixed(1)),
    coverage_raw_pct: Number(coverage.raw_pct.toFixed(1)),
    coverage_floor: COVERAGE_FLOOR,
    coverage_ok: coverage.pct >= COVERAGE_FLOOR,
    keywords_total: coverage.total,
    keywords_adjusted_total: coverage.adjusted_total,
    keywords_hit: coverage.hit.length,
    keywords_miss_injectable: coverage.miss_injectable,
    keywords_miss_hard_gap: coverage.miss_hard_gap,
    hard_gaps_declared: tailoring.hard_gaps || [],
    cliches_found: cliches,
    budget,
    warnings,
    llm_budget_analysis: tailoring.budget_analysis || null,
    llm_coverage_warning: tailoring.coverage_warning || null,
  };

  if (args.json) {
    console.log(JSON.stringify(summary, null, 2));
  } else {
    console.log('');
    console.log(`📄 Pages: ${pageCount}/${maxPages}${overflow ? ' ⚠️  OVERFLOW' : ''}`);
    console.log(`📐 Char budget: ${budget.total}/${budget.target}${budget.within_budget ? '' : ` ⚠️  +${budget.overshoot_pct}%`}`);
    console.log(`   summary ${budget.summary}  competencies ${budget.competencies}  experience ${budget.experience_bullets}  projects ${budget.projects}`);
    const hardGapCount = coverage.miss_hard_gap.length;
    const hardGapNote = hardGapCount ? ` [-${hardGapCount} hard gap${hardGapCount > 1 ? 's' : ''}]` : '';
    console.log(`📎 Coverage: adjusted ${summary.coverage_pct}% (${summary.keywords_hit}/${summary.keywords_adjusted_total})${hardGapNote} | raw ${summary.coverage_raw_pct}%${summary.coverage_ok ? '' : ' ⚠️  BELOW FLOOR'}`);
    if (coverage.miss_injectable.length) {
      console.log(`   Injectable misses: ${coverage.miss_injectable.slice(0, 10).join(', ')}${coverage.miss_injectable.length > 10 ? '…' : ''}`);
    }
    if (coverage.miss_hard_gap.length) {
      console.log(`   Hard gaps (declared): ${coverage.miss_hard_gap.join(', ')}`);
    }
    if (cliches.length) {
      console.log(`⚠️  Cliche phrases: ${cliches.join(', ')}`);
    } else {
      console.log('✨ No cliche phrases');
    }
    if (tailoring.coverage_warning) {
      console.log(`📝 LLM coverage_warning: ${tailoring.coverage_warning}`);
    }
    if (warnings.length) {
      console.log('');
      console.log('Warnings to address on retry:');
      warnings.forEach((w) => console.log(`  - ${w}`));
    }
  }

  if (overflow && failOnOverflow) {
    process.exit(2);
  }
}

try {
  main();
} catch (error) {
  console.error(`Fatal: ${error.message}`);
  process.exit(1);
}
