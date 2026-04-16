/**
 * lib/location-match.mjs
 *
 * Shared location-matching helpers used by scan-filter.mjs, prefilter-jobs.mjs,
 * and build-prefilter-policy.mjs.
 *
 * Zero-token. Pure deterministic string matching over job metadata + scoped
 * body content. DO NOT add LLM calls or external fetches to this module — the
 * whole point of the scan/prefilter stages is that they cost nothing.
 *
 * Exports:
 *   Constants:
 *     US_STATE_ALIASES, US_STATE_PAIRS, FOREIGN_COUNTRY_INDICATORS,
 *     FOREIGN_CITY_PATTERNS
 *   Text utilities:
 *     cleanText, normalizeText, escapeRegex
 *   Country/state matching:
 *     expandCountryAliases, expandStateAliases,
 *     detectMentionedCountries, detectMentionedStates
 *   Location signal detection:
 *     hasSpecificLocationSignal, hasExplicitLocationPhrase,
 *     hasEmbeddedLocationLabel
 *   Modality detection:
 *     detectModalityFromText (caller-supplied haystack)
 *   Scoped location evidence (the bug fix):
 *     extractLocationEvidence, detectForeignCityPattern
 */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const US_STATE_ALIASES = [
  'alabama', 'alaska', 'arizona', 'arkansas', 'california', 'colorado', 'connecticut', 'delaware',
  'florida', 'georgia', 'hawaii', 'idaho', 'illinois', 'indiana', 'iowa', 'kansas', 'kentucky',
  'louisiana', 'maine', 'maryland', 'massachusetts', 'michigan', 'minnesota', 'mississippi',
  'missouri', 'montana', 'nebraska', 'nevada', 'new hampshire', 'new jersey', 'new mexico',
  'new york', 'north carolina', 'north dakota', 'ohio', 'oklahoma', 'oregon', 'pennsylvania',
  'rhode island', 'south carolina', 'south dakota', 'tennessee', 'texas', 'utah', 'vermont',
  'virginia', 'washington', 'west virginia', 'wisconsin', 'wyoming', 'district of columbia',
  'dc', 'd.c.',
];

export const US_STATE_PAIRS = [
  ['alabama', 'al'], ['alaska', 'ak'], ['arizona', 'az'], ['arkansas', 'ar'], ['california', 'ca'],
  ['colorado', 'co'], ['connecticut', 'ct'], ['delaware', 'de'], ['florida', 'fl'], ['georgia', 'ga'],
  ['hawaii', 'hi'], ['idaho', 'id'], ['illinois', 'il'], ['indiana', 'in'], ['iowa', 'ia'],
  ['kansas', 'ks'], ['kentucky', 'ky'], ['louisiana', 'la'], ['maine', 'me'], ['maryland', 'md'],
  ['massachusetts', 'ma'], ['michigan', 'mi'], ['minnesota', 'mn'], ['mississippi', 'ms'], ['missouri', 'mo'],
  ['montana', 'mt'], ['nebraska', 'ne'], ['nevada', 'nv'], ['new hampshire', 'nh'], ['new jersey', 'nj'],
  ['new mexico', 'nm'], ['new york', 'ny'], ['north carolina', 'nc'], ['north dakota', 'nd'], ['ohio', 'oh'],
  ['oklahoma', 'ok'], ['oregon', 'or'], ['pennsylvania', 'pa'], ['rhode island', 'ri'], ['south carolina', 'sc'],
  ['south dakota', 'sd'], ['tennessee', 'tn'], ['texas', 'tx'], ['utah', 'ut'], ['vermont', 'vt'],
  ['virginia', 'va'], ['washington', 'wa'], ['west virginia', 'wv'], ['wisconsin', 'wi'], ['wyoming', 'wy'],
  ['district of columbia', 'dc'],
];

/**
 * Foreign country indicators. If any of these appear in a scoped location
 * evidence window, the role is foreign (for a US-based candidate). This is
 * used as a secondary check when country matching against allowed_countries
 * yields zero hits — the hope being to catch "Remote - Canada" style metadata
 * and "Based in Vancouver, British Columbia" style body prose.
 */
export const FOREIGN_COUNTRY_INDICATORS = [
  'canada', 'canadian',
  'united kingdom', ' uk ', 'u.k.', 'england', 'scotland', 'wales', 'northern ireland',
  'ireland', 'irish',
  'germany', 'german',
  'france', 'french',
  'spain', 'spanish',
  'portugal', 'portuguese',
  'italy', 'italian',
  'netherlands', 'dutch', 'holland',
  'belgium', 'belgian',
  'switzerland', 'swiss',
  'austria', 'austrian',
  'sweden', 'swedish', 'denmark', 'danish', 'norway', 'norwegian',
  'finland', 'finnish',
  'poland', 'polish',
  'czech republic', 'czechia',
  'hungary', 'hungarian',
  'greece', 'greek',
  'israel', 'israeli',
  'india', 'indian',
  'china', 'chinese',
  'japan', 'japanese',
  'south korea', 'korean',
  'singapore', 'singaporean',
  'hong kong',
  'taiwan', 'taiwanese',
  'thailand', 'thai',
  'vietnam', 'vietnamese',
  'indonesia', 'indonesian',
  'philippines', 'filipino',
  'malaysia', 'malaysian',
  'australia', 'australian',
  'new zealand',
  'brazil', 'brazilian',
  'mexico', 'mexican',
  'argentina', 'argentine',
  'chile', 'chilean',
  'colombia', 'colombian',
  'peru', 'peruvian',
  'south africa', 'south african',
  'egypt', 'egyptian',
  'nigeria', 'nigerian',
  'kenya', 'kenyan',
  'united arab emirates', ' uae ', 'dubai', 'abu dhabi',
  'saudi arabia',
  'turkey', 'turkish',
  'russia', 'russian',
  'ukraine', 'ukrainian',
  'romania', 'romanian',
  'bulgaria', 'bulgarian',
  // Continental / regional indicators — if a role's location is just
  // "Europe" / "EMEA" / "APAC" without a specific US qualifier, it's
  // almost certainly foreign for a US-based candidate.
  'europe', 'european',
  'emea',
  'apac', 'asia-pacific',
  'latam', 'latin america',
  'mena',
  'eu-only', 'europe only',
];

/**
 * City + foreign disambiguator patterns. Each pattern matches ONLY when the
 * city is paired with a clearly-foreign province/state/country indicator, so
 * we don't accidentally match Washington (state) or Dublin, OH.
 *
 * Format: regex with word boundaries around the whole phrase.
 */
export const FOREIGN_CITY_PATTERNS = [
  // Canada
  /\bvancouver\s*,?\s*(?:bc|british columbia|canada)\b/i,
  /\btoronto\s*,?\s*(?:on|ontario|canada)\b/i,
  /\bmontr[eé]al\s*,?\s*(?:qc|qu[eé]bec|canada)\b/i,
  /\bottawa\s*,?\s*(?:on|ontario|canada)\b/i,
  /\bcalgary\s*,?\s*(?:ab|alberta|canada)\b/i,
  /\bedmonton\s*,?\s*(?:ab|alberta|canada)\b/i,
  /\bwinnipeg\s*,?\s*(?:mb|manitoba|canada)\b/i,
  /\bhalifax\s*,?\s*(?:ns|nova scotia|canada)\b/i,
  // UK / Ireland
  /\blondon\s*,?\s*(?:uk|united kingdom|england)\b/i,
  /\bmanchester\s*,?\s*(?:uk|united kingdom|england)\b/i,
  /\bedinburgh\s*,?\s*(?:uk|united kingdom|scotland)\b/i,
  /\bglasgow\s*,?\s*(?:uk|united kingdom|scotland)\b/i,
  /\bdublin\s*,?\s*(?:ireland|ie)\b/i,
  /\bcork\s*,?\s*ireland\b/i,
  // Germany / Austria / Switzerland
  /\bberlin\s*,?\s*germany\b/i,
  /\bmunich\s*,?\s*germany\b/i,
  /\bfrankfurt\s*,?\s*germany\b/i,
  /\bhamburg\s*,?\s*germany\b/i,
  /\bk[oö]ln\b/i,  // Cologne in German spelling — unambiguously foreign
  /\bcologne\s*,?\s*germany\b/i,
  /\bvienna\s*,?\s*austria\b/i,
  /\bzurich\s*,?\s*switzerland\b/i,
  /\bgeneva\s*,?\s*switzerland\b/i,
  // Netherlands / Belgium
  /\bamsterdam\s*,?\s*(?:netherlands|nl)\b/i,
  /\brotterdam\s*,?\s*(?:netherlands|nl)\b/i,
  /\bthe hague\b/i,
  /\bbrussels\s*,?\s*belgium\b/i,
  // France
  /\bparis\s*,?\s*france\b/i,
  /\blyon\s*,?\s*france\b/i,
  /\btoulouse\s*,?\s*france\b/i,
  // Spain / Portugal / Italy
  /\bmadrid\s*,?\s*spain\b/i,
  /\bbarcelona\s*,?\s*spain\b/i,
  /\blisbon\s*,?\s*portugal\b/i,
  /\bporto\s*,?\s*portugal\b/i,
  /\brome\s*,?\s*italy\b/i,
  /\bmilan\s*,?\s*italy\b/i,
  // Nordics
  /\bstockholm\s*,?\s*sweden\b/i,
  /\bcopenhagen\s*,?\s*denmark\b/i,
  /\boslo\s*,?\s*norway\b/i,
  /\bhelsinki\s*,?\s*finland\b/i,
  // Eastern Europe
  /\bwarsaw\s*,?\s*poland\b/i,
  /\bkrak[oó]w\s*,?\s*poland\b/i,
  /\bprague\s*,?\s*(?:czech|czechia)\b/i,
  /\bbudapest\s*,?\s*hungary\b/i,
  // Middle East
  /\btel aviv\s*,?\s*israel\b/i,
  /\bjerusalem\s*,?\s*israel\b/i,
  /\bdubai\s*,?\s*uae\b/i,
  /\babu dhabi\b/i,
  // Asia
  /\bbangalore\b/i,
  /\bbengaluru\b/i,
  /\bmumbai\b/i,
  /\bhyderabad\s*,?\s*india\b/i,
  /\bchennai\s*,?\s*india\b/i,
  /\bpune\s*,?\s*india\b/i,
  /\bnew delhi\b/i,
  /\btokyo\s*,?\s*japan\b/i,
  /\bosaka\s*,?\s*japan\b/i,
  /\bseoul\s*,?\s*(?:korea|south korea)\b/i,
  /\bsingapore\b/i,  // only one Singapore
  /\bhong kong\b/i,
  /\bshanghai\s*,?\s*china\b/i,
  /\bbeijing\s*,?\s*china\b/i,
  /\btaipei\s*,?\s*taiwan\b/i,
  /\bbangkok\s*,?\s*thailand\b/i,
  // Oceania
  /\bsydney\s*,?\s*australia\b/i,
  /\bmelbourne\s*,?\s*australia\b/i,
  /\bbrisbane\s*,?\s*australia\b/i,
  /\bperth\s*,?\s*australia\b/i,
  /\bauckland\s*,?\s*new zealand\b/i,
  // South America
  /\bs[aã]o paulo\b/i,
  /\brio de janeiro\b/i,
  /\bmexico city\b/i,
  /\bbuenos aires\b/i,
  /\bsantiago\s*,?\s*chile\b/i,
];

// ---------------------------------------------------------------------------
// Text utilities
// ---------------------------------------------------------------------------

export function cleanText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

export function normalizeText(value) {
  return cleanText(value).toLowerCase();
}

export function escapeRegex(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ---------------------------------------------------------------------------
// Country / state matching
// ---------------------------------------------------------------------------

/**
 * Abbreviations that collide with common English words. For these, we require
 * a location context (comma-preceded, parens-wrapped, or "Remote - X") rather
 * than a bare word boundary match, to avoid false positives like "team in" or
 * "this or that".
 */
const AMBIGUOUS_STATE_ABBR = new Set(['in', 'or', 'me', 'ok', 'hi', 'de', 'la']);

/**
 * Detect if text mentions ANY US state (not just the allowed subset).
 * Useful for determining "this is a US role" independently of whether
 * the specific state is in the user's allowed list.
 *
 * Full state names match on any word boundary (they're unambiguous).
 * Common-word abbreviations (IN/OR/ME/OK/HI/DE/LA) only match when they
 * appear in a location context, e.g. "Portland, OR" or "Remote - IN".
 */
export function textMentionsAnyUsState(text) {
  const lower = normalizeText(text);

  // First pass: full state names + safe abbreviations
  for (const [full, abbr] of US_STATE_PAIRS) {
    if (new RegExp(`\\b${escapeRegex(full)}\\b`, 'i').test(lower)) return full;
    if (AMBIGUOUS_STATE_ABBR.has(abbr)) continue;
    if (new RegExp(`\\b${escapeRegex(abbr)}\\b`, 'i').test(lower)) return abbr;
  }

  // Second pass: ambiguous abbreviations, but only in location context
  for (const [, abbr] of US_STATE_PAIRS) {
    if (!AMBIGUOUS_STATE_ABBR.has(abbr)) continue;
    const a = escapeRegex(abbr);
    // Matches: "City, IN"  |  "City, IN,"  |  "(IN)"  |  "Remote - IN"  |  "/IN"
    const contextPattern = new RegExp(
      `[a-z]+,\\s*${a}\\b|,\\s*${a},|\\(${a}\\)|remote[\\s-]+${a}\\b|/\\s*${a}\\b`,
      'i',
    );
    if (contextPattern.test(lower)) return abbr;
  }

  return null;
}

export function expandCountryAliases(country) {
  const lower = normalizeText(country);

  if (lower === 'united states' || lower === 'usa' || lower === 'us') {
    // NOTE: bare 'us' is DELIBERATELY EXCLUDED — it matches the English
    // pronoun "us" far too often ("join us", "contact us", etc.).
    return ['united states', 'usa', 'u.s.', 'u.s.a.', ...US_STATE_ALIASES];
  }

  if (lower === 'united kingdom' || lower === 'uk') {
    return ['united kingdom', 'uk', 'england', 'scotland', 'wales', 'northern ireland', 'great britain'];
  }

  return [lower];
}

export function expandStateAliases(state) {
  const lower = normalizeText(state);
  const match = US_STATE_PAIRS.find(([full, abbr]) => lower === full || lower === abbr);
  if (match) {
    return [match[0], match[1]];
  }
  return [lower];
}

export function detectMentionedCountries(text, countries) {
  const lower = normalizeText(text);
  const matches = [];

  for (const country of countries) {
    const aliases = expandCountryAliases(country);
    if (aliases.some((alias) => alias && new RegExp(`\\b${escapeRegex(alias)}\\b`, 'i').test(lower))) {
      matches.push(country);
    }
  }

  const globalRemote = /\b(global|worldwide|anywhere|work from anywhere)\b/.test(lower);
  return {
    matches: [...new Set(matches)],
    globalRemote,
  };
}

export function detectMentionedStates(text, states) {
  const lower = normalizeText(text);
  const matches = [];

  for (const state of states || []) {
    const aliases = expandStateAliases(state);
    if (aliases.some((alias) => alias && new RegExp(`\\b${escapeRegex(alias)}\\b`, 'i').test(lower))) {
      matches.push(state);
    }
  }

  return [...new Set(matches)];
}

// ---------------------------------------------------------------------------
// Location signal detection
// ---------------------------------------------------------------------------

export function hasSpecificLocationSignal(text) {
  const stripped = normalizeText(text)
    .replace(/\b(remote|hybrid|distributed|anywhere|global|worldwide|work from anywhere|work from home|onsite|on-site|in office|office based|office-based|united states|usa|us)\b/g, ' ')
    .replace(/[#(),;/\\|-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  return stripped.length > 0;
}

export function hasExplicitLocationPhrase(text) {
  return /\b(based in|located in|must be based in|must be located in|must reside in|candidate must reside in|office in|office-first in|hybrid in|onsite in)\b/i.test(text);
}

export function hasEmbeddedLocationLabel(text) {
  return /\blocation\s*[:\-]?\s*[A-Za-z]/i.test(text);
}

// ---------------------------------------------------------------------------
// Modality detection (caller supplies the haystack)
// ---------------------------------------------------------------------------

/**
 * Takes a pre-built haystack string (title + location + body snippet at the
 * caller's discretion) and returns 'remote' | 'hybrid' | 'onsite' | 'unknown'.
 *
 * Use this instead of the old per-file detectModality so callers are explicit
 * about what text they're searching. scan-filter wants metadata only;
 * prefilter-jobs wants metadata + body snippet.
 */
export function detectModalityFromText(haystack) {
  const lower = normalizeText(haystack);

  // Remote indicators must be SPECIFIC to work-model — generic words like
  // "distributed" or "anywhere" cause massive false positives:
  //   - "distributed systems" (technical requirement, not a work model)
  //   - "code that works anywhere" (technical phrase, not work location)
  // Stick to phrases that unambiguously describe the role's work arrangement.
  const remote = /\b(remote|remote[\s-]?first|fully remote|work from home|work from anywhere|us[\s-]?remote|us[\s-]?based remote)\b|typeremote/.test(lower);
  const hybrid = /\bhybrid\b|typehybrid/.test(lower);
  const onsite = /\b(on[\s-]?site|onsite|in[\s-]?office|office-based|office based|must be in office)\b|typeonsite/.test(lower);

  if (hybrid) return 'hybrid';
  if (onsite && !remote) return 'onsite';
  if (remote) return 'remote';
  if (onsite) return 'onsite';
  return 'unknown';
}

// ---------------------------------------------------------------------------
// Scoped location evidence (the bug fix)
// ---------------------------------------------------------------------------

/**
 * Extract a structured "location evidence" object from a normalized job
 * artifact.
 *
 * Why this exists: the old prefilter-jobs.mjs built a 4,000-char haystack
 * from the full body and ran country detection against it. That produced
 * false-positive `\bunited states\b` matches from marketing copy like
 * "Brex is headquartered in San Francisco" or "operations across the US",
 * which made Vancouver/London/Amsterdam roles pass the country check.
 *
 * This function returns evidence TIERS rather than a single joined string,
 * so callers can check metadata FIRST (highest-priority signal) and only
 * fall through to body evidence if metadata is empty or ambiguous:
 *
 *   - `metadata`: the structured `job.location` field. If non-empty, this
 *     is authoritative — Greenhouse/Lever/Ashby APIs populate it with the
 *     actual role location.
 *   - `headerZone`: the first ~150 chars of body. This is the ATS location
 *     header zone — when metadata is null, these three ATS's all put the
 *     role's location in the text immediately after the duplicated title.
 *     Deliberately SHORT so we don't reach company marketing prose.
 *   - `phrases`: sentence-level matches in the first 4,000 chars for
 *     explicit "based in X" / "hybrid in X" / "join our X team" language.
 *     EXCLUDES "headquartered in" because that describes company HQ, not
 *     role location.
 *
 * Callers use these in priority order — see evaluateLocationFromEvidence()
 * for the reference pattern.
 */
export function extractLocationEvidence(job) {
  const metadata = cleanText(job?.job?.location);
  const body = (job?.content?.text || '');

  // 150 chars is empirically tight enough to capture the ATS header zone
  // (duplicated title + location) without reaching marketing prose that
  // typically starts with "Company X is..." around char 100-200.
  const headerZone = cleanText(body.slice(0, 150));

  // Phrase matching: scan first 4k chars for explicit role-location language.
  // Deliberately exclude "headquartered in" — that's company HQ, not the
  // role's work location. Also exclude bare "based in" without a clear
  // role-subject, because marketing also says "team based in X" meaning
  // "team members work from X" generically.
  const body4k = body.slice(0, 4000);
  const locPhraseRegex = /[^.!?\n]{0,80}\b(this role is based in|the role is based in|role is located in|position (?:is )?based in|must be (?:based|located) in|must reside in|candidate must reside in|remote in [A-Z]|hybrid in [A-Z]|onsite in [A-Z]|on-site in [A-Z]|work from our [a-z]+ office|[a-z]+-based team|join our [a-z]+ team|work from [A-Z])\b[^.!?\n]{0,80}[.!?]?/gi;
  const phrases = body4k.match(locPhraseRegex) || [];

  return { metadata, headerZone, phrases };
}

/**
 * Evaluate location evidence against the allowed-countries policy, tier by
 * tier. Returns { keep: bool, reason: str, tier: str, ... }.
 *
 * This is the canonical location check — both scan-filter and prefilter-jobs
 * should delegate to it rather than re-implementing the priority logic.
 *
 * Tier priority:
 *   1. Metadata tier takes precedence. If job.location says "Vancouver BC",
 *      the role is in Vancouver regardless of what the body prose says.
 *   2. Header zone is checked only if metadata is absent or empty.
 *   3. Phrase matches are the weakest signal, used only if neither tier
 *      above produced a decision.
 *
 * Within each tier, we check:
 *   - foreign country indicator (any country NOT in allowed_countries)
 *   - US state match (if allowed_states is populated)
 *   - allowed-country match
 *
 * Dual-country handling: if metadata contains BOTH a foreign country AND
 * an allowed-country mention (e.g., "Remote - Canada, USA"), we trust the
 * posting is open to both and KEEP it for the allowed-country candidate.
 */
export function evaluateLocationFromEvidence(evidence, policy) {
  const { metadata, headerZone, phrases } = evidence;
  const allowedCountries = policy.allowed_countries || [];
  const allowedStates = policy.allowed_states || [];
  const willingToRelocate = policy.willing_to_relocate === true;

  const checkTier = (rawText, tierName) => {
    if (!rawText) return null;

    // Normalize run-together ATS text: "CanadaAsana" → "Canada Asana",
    // "StatesWhy" → "States Why", "RemoteNew York" → "Remote New York"
    const text = rawText.replace(/([a-z])([A-Z])/g, '$1 $2');

    const usMatch = detectMentionedCountries(text, allowedCountries);
    const foreignIndicator = detectForeignCountryIndicator(text);
    const foreignCityPattern = detectForeignCityPattern(text);
    const stateMatch = detectMentionedStates(text, allowedStates);

    // Check if ANY US state appears (not just the allowed subset). This catches
    // "San Francisco, CA" where CA ≠ Florida but IS a US state, meaning the role
    // is at least in the US even if not in the user's allowed state.
    const anyUsState = textMentionsAnyUsState(text);
    const hasAllowedCountry = usMatch.matches.length > 0 || Boolean(anyUsState);
    const hasAllowedState = stateMatch.length > 0;
    const hasForeign = Boolean(foreignIndicator || foreignCityPattern);
    const foreignReason = foreignCityPattern || foreignIndicator;

    if (hasForeign && hasAllowedCountry) {
      // Dual-country posting — role is open to both. KEEP.
      return { decision: 'keep', reason: `${tierName}: dual-country posting (${foreignReason} + allowed)`, tier: tierName };
    }
    if (hasForeign && !hasAllowedCountry) {
      if (willingToRelocate) {
        return { decision: 'keep', reason: `${tierName}: foreign location (${foreignReason}) but willing to relocate`, tier: tierName };
      }
      return { decision: 'reject', reason: `${tierName}: foreign location detected (${foreignReason})`, tier: tierName };
    }
    if (hasAllowedCountry || hasAllowedState) {
      return { decision: 'keep', reason: `${tierName}: allowed country/state match`, tier: tierName };
    }
    return null;  // tier produced no decision; fall through
  };

  // Tier 1: metadata (highest priority)
  const metaDecision = checkTier(metadata, 'metadata');
  if (metaDecision) return metaDecision;

  // Tier 2: header zone
  const headerDecision = checkTier(headerZone, 'header');
  if (headerDecision) return headerDecision;

  // Tier 3: explicit phrases
  for (const phrase of phrases) {
    const phraseDecision = checkTier(phrase, 'phrase');
    if (phraseDecision) return phraseDecision;
  }

  // No tier produced a decision — unknown location
  return { decision: 'unknown', reason: 'no location signal found', tier: 'none' };
}

/**
 * Check scoped text against the foreign city patterns list. Returns the
 * first matching pattern source as a human-readable string, or null if
 * no match.
 */
export function detectForeignCityPattern(text) {
  const lower = normalizeText(text);
  for (const pattern of FOREIGN_CITY_PATTERNS) {
    if (pattern.test(lower)) {
      return pattern.source.replace(/\\b|\\s\*|\?:|\(|\)/g, '').trim();
    }
  }
  return null;
}

/**
 * Check scoped text for a foreign country indicator (country name, adjective,
 * or country abbreviation). Returns the first match or null.
 *
 * Use this in addition to detectMentionedCountries when you want to catch
 * "Remote - Canada" style metadata where Canada isn't in the allowed_countries
 * list but also isn't in any blocked_countries list (because blocked_countries
 * is typically empty — we prefer allow-list logic).
 */
export function detectForeignCountryIndicator(text) {
  const lower = normalizeText(text);
  for (const indicator of FOREIGN_COUNTRY_INDICATORS) {
    const trimmed = indicator.trim();
    if (!trimmed) continue;
    // Use word boundaries for multi-word indicators too
    const pattern = new RegExp(`\\b${escapeRegex(trimmed)}\\b`, 'i');
    if (pattern.test(lower)) return trimmed;
  }
  return null;
}
