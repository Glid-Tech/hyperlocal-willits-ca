// Fort Bragg Local search engine: forgiving, plain-English, fully client-side.
//
//  - normalises text (accents, apostrophes, "&"), drops filler words ("I need a good ___ near me")
//  - understands everyday phrases via intents.js ("fix my sink" -> Plumbers)
//  - understands filters in the query ("open now", "open late", "sunday")
//  - tolerates typos (Damerau-Levenshtein), plurals and word endings (plumbing ~ plumber)
//  - ranks exact business-name matches above category matches
// No dependencies; works in the browser and in Node (for tests).

import { INTENTS, FILTER_PHRASES, STOPWORDS, REPAIR_WORDS, REPAIR_PHRASES, NOT_WORDS } from './intents.js';
import { CATEGORY_BY_ID } from './taxonomy.js';
import { parseHours, hoursStatus, localNow, opensOnDay } from './hours.js';

// ----------------------------------------------------------------------------- text helpers

export function normalize(str) {
  return String(str || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/['’`]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function tokenize(str) {
  const n = normalize(str);
  return n ? n.split(' ') : [];
}

/** A light, predictable English stemmer used identically for the index and for queries. */
export function stem(w) {
  if (w.length <= 3 || /\d/.test(w)) return w;
  let s = w;
  if (s.endsWith('ies') && s.length > 4) s = s.slice(0, -3) + 'i';
  else if (/(sses|ches|shes|xes|zes)$/.test(s)) s = s.slice(0, -2);
  else if (s.endsWith('s') && !/(ss|us|is|os)$/.test(s)) s = s.slice(0, -1);
  if (s.length > 5 && s.endsWith('ing')) {
    let base = s.slice(0, -3);
    if (/([bdgmnprt])\1$/.test(base)) base = base.slice(0, -1);
    if (base.length >= 4) s = base;
  }
  if (s.length > 4 && s.endsWith('y')) s = s.slice(0, -1) + 'i';
  if (s.length > 4 && s.endsWith('e')) s = s.slice(0, -1);
  return s;
}

/** Damerau-Levenshtein distance with an early exit once `max` is exceeded. */
export function editDistance(a, b, max = 2) {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > max) return max + 1;
  const n = a.length, m = b.length;
  let prev2 = null, prev = Array.from({ length: m + 1 }, (_, j) => j), cur;
  for (let i = 1; i <= n; i++) {
    cur = [i];
    let rowMin = i;
    for (let j = 1; j <= m; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      if (prev2 && i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, prev2[j - 2] + 1);
      cur[j] = v;
      if (v < rowMin) rowMin = v;
    }
    if (rowMin > max) return max + 1;
    prev2 = prev; prev = cur;
  }
  return prev[m];
}

const maxTypos = len => (len >= 8 ? 2 : len >= 4 ? 1 : 0);

// ----------------------------------------------------------------------------- phrase tables

function phraseKey(phrase) {
  return tokenize(phrase).map(stem).join(' ');
}

const INTENT_MAP = new Map();    // stemmed phrase -> [intent index]
const FILTER_MAP = new Map();    // stemmed phrase -> filter object
let MAX_PHRASE = 1;
INTENTS.forEach((it, i) => {
  it.sRe = it.s ? new RegExp(`\\b(?:${it.s})`, 'i') : null;
  // The categories this intent can match at all: `c` (every business in them matches) or `w` (only matching ones).
  it.scope = it.c || it.w || null;
  // Words that describe this kind of place (used to find related businesses).
  it.tKeys = [...new Set((it.t || []).map(phraseKey).filter(Boolean))];
  for (const p of [...it.p, ...(it.a || []), it.label]) {
    const k = phraseKey(p);
    if (!k) continue;
    if (!INTENT_MAP.has(k)) INTENT_MAP.set(k, []);
    if (!INTENT_MAP.get(k).includes(i)) INTENT_MAP.get(k).push(i);
    MAX_PHRASE = Math.max(MAX_PHRASE, k.split(' ').length);
  }
});
for (const f of FILTER_PHRASES) for (const p of f.p) {
  const k = phraseKey(p);
  FILTER_MAP.set(k, f.f);
  MAX_PHRASE = Math.max(MAX_PHRASE, k.split(' ').length);
}
const INTENT_WORDS = [...INTENT_MAP.keys()].filter(k => !k.includes(' ') && k.length >= 4);
// intent index -> the intent that repairs its things ("fix my car": Auto & gas -> Car repair)
const REPAIRED_BY = new Map();
INTENTS.forEach((it, i) => {
  const to = it.r ? INTENTS.findIndex(x => x.label === it.r) : -1;
  if (to >= 0) REPAIRED_BY.set(i, to);
});
const EMERGENCY_RE = /\b(emergenc(y|ies)|911|9 1 1|ambulances?|er|heart attacks?|strokes?|chest (pains?|hurts?|hurting)|overdos(e|ed|es|ing)|poison(s|ed|ing)?|bleed(s|ing)?)\b/;
// The words of EMERGENCY_RE, for reading misspellings: "heart atack", "ambulence", "storke".
const EMERGENCY_WORDS = ['emergency', 'ambulance', 'heart', 'attack', 'stroke', 'chest', 'pain', 'overdose', 'overdosed',
  'overdosing', 'poison', 'poisoned', 'poisoning', 'bleeding'];
// Real words one letter away from an emergency word, which mustn't raise the 911 notice ("dog breeding").
const NOT_MISSPELLINGS = new Set(['prison', 'prisons', 'breeding', 'breeder', 'breeders', 'stoke', 'stoked', 'strode', 'overdone', 'emergence']);
// Two-word emergencies, read together so a slip in either half still counts ("heat attack", "chest pian").
const EMERGENCY_PAIRS = [['heart', ['attack', 'attacks']], ['chest', ['pain', 'pains', 'hurts', 'hurt', 'hurting']]];
// Filler words that a kind of place lists as its own: "shops" means Shopping when nothing else is named.
// "close" isn't listed (it only shares a stem with "closing"), so it never means Mortgages & title.
const FILLER_PLACES = new Set(INTENTS.flatMap(it => it.p).filter(p => STOPWORDS.has(p)));
const COLLATOR = new Intl.Collator('en', { sensitivity: 'base' });

// ----------------------------------------------------------------------------- index

const FIELD_WEIGHTS = { name: 10, sub: 7, tags: 5, cat: 4, center: 3, area: 3, street: 2, desc: 1.5 };

/**
 * Build the search index.
 * @param {Array<object>} businesses  records from data/businesses.json
 * @param {object} [opts]  { areas: [{id,name}] }
 */
export function buildIndex(businesses, opts = {}) {
  const areaNames = Object.fromEntries((opts.areas || []).map(a => [a.id, a.name]));
  const postings = new Map(); // term -> Map(docIdx -> weight)
  const words = new Set();
  const stemmedFrom = new Map(); // shortened form -> Map(word -> count)
  const placeWords = new Set(); // words that only say where a place is: its neighborhood, shopping center or street
  const docs = businesses.map((b, i) => {
    const cat = CATEGORY_BY_ID[b.category];
    const fields = {
      name: b.name,
      sub: b.sub || '',
      tags: (b.tags || []).join(' '),
      cat: cat ? `${cat.name} ${cat.short}` : '',
      center: b.center || '',
      area: areaNames[b.area] || '',
      street: (b.address || '').replace(/^\d+(?:\s*-?\s*[a-z])?\s+/i, ''), // "8347-A Greensboro Drive" -> "Greensboro Drive"
      desc: b.desc || '',
    };
    for (const text of [fields.center, fields.area, fields.street]) {
      for (const tok of tokenize(text)) if (!/\d/.test(tok) && !STOPWORDS.has(tok)) placeWords.add(stem(tok));
    }
    for (const [field, text] of Object.entries(fields)) {
      const w = FIELD_WEIGHTS[field];
      for (const tok of tokenize(text)) {
        if (STOPWORDS.has(tok) && field !== 'name') continue;
        const s = stem(tok);
        words.add(tok);
        if (s !== tok) countWord(stemmedFrom, s, tok);
        for (const term of new Set([tok, s])) {
          let m = postings.get(term);
          if (!m) postings.set(term, (m = new Map()));
          if ((m.get(i) || 0) < w) m.set(i, w);
        }
      }
    }
    // Street numbers and phone digits are searchable too ("1250", "(707) 964-1234", "707-964").
    const num = (b.address || '').match(/^\d+/);
    if (num) addPosting(postings, num[0], i, 2);
    const digits = (b.phone || '').replace(/\D/g, '');
    if (digits.length >= 10) addPosting(postings, digits.slice(-10), i, 2);
    const parsedHours = parseHours(b.hours);
    return {
      b, i, parsedHours,
      nameNorm: normalize(b.name),
      nameStems: tokenize(b.name).map(stem),
      subTags: `${b.sub || ''} ${(b.tags || []).join(' ')}`.toLowerCase(),
      // Name, type and tags as one run of stems, to tell a phrase ("bubble tea") from its words apart.
      stemText: ` ${[b.name, b.sub, ...(b.tags || [])].map(x => tokenize(x).map(stem).join(' ')).join(' | ')} `,
      quality: (b.phone ? 1 : 0) + (b.website ? 1 : 0) + (parsedHours ? 1 : 0),
    };
  });
  const vocab = [...postings.keys()].sort();
  const areas = (opts.areas || [])
    .filter(a => a.id !== 'elsewhere')
    .map(a => ({ id: a.id, name: a.name, norm: normalize(a.name), count: docs.filter(d => d.b.area === a.id).length }))
    .filter(a => a.count > 0);
  // Spelling corrections are shown to the visitor, so each shortened form needs a real word to
  // stand for it ("chipotl" -> "chipotle", "servic" -> "services").
  const surface = new Map();
  for (const [s, counts] of stemmedFrom) {
    if (!words.has(s)) surface.set(s, [...counts].sort((a, b) => b[1] - a[1] || a[0].length - b[0].length)[0][0]);
  }
  // A name with no Latin letters or digits ("스시 하우스") has no key, so it never stands in for an empty search.
  const byName = new Map();
  for (const d of docs) if (d.nameNorm) byName.set(d.nameNorm, [...(byName.get(d.nameNorm) || []), d]);
  return { docs, postings, vocab, N: docs.length, intentCounts: new Map(), areas, surface, byName, placeWords };
}

function countWord(counts, key, word) {
  let m = counts.get(key);
  if (!m) counts.set(key, (m = new Map()));
  m.set(word, (m.get(word) || 0) + 1);
}

function addPosting(postings, term, i, w) {
  let m = postings.get(term);
  if (!m) postings.set(term, (m = new Map()));
  if ((m.get(i) || 0) < w) m.set(i, w);
}

function prefixRange(vocab, prefix) {
  let lo = 0, hi = vocab.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (vocab[mid] < prefix) lo = mid + 1; else hi = mid; }
  const out = [];
  for (let k = lo; k < vocab.length && vocab[k].startsWith(prefix); k++) out.push(vocab[k]);
  return out;
}

// ----------------------------------------------------------------------------- query parsing

/**
 * Turn raw text into concepts and filters.
 * @param {object} index
 * @param {string} raw
 * @param {{live?: boolean, literal?: boolean, hoursAsWords?: boolean, now?: {day, minutes}}} opts
 *   live = the user is still typing (last word may be partial); hoursAsWords = "open", "sunday"
 *   are part of a business name, not filters; now = the clock that "open today" refers to
 * @returns {{ raw, tokens, concepts, filters, corrections, emergency, today }}
 *   today = "open today" was typed, so filters.day is today and places closed for the day are left out
 */
export function parseQuery(index, raw, opts = {}) {
  const number = phoneNumber(raw);
  const tokens = number ? [number] : tokenize(raw);
  const stems = tokens.map(stem);
  let { concepts, filters, today } = readPhrases(tokens, stems, opts);
  const corrections = [];
  for (const c of concepts) if (REPAIR_WORDS.has(c.words) || REPAIR_PHRASES.has(c.words)) c.repair = true;

  // Typo correction for words that match nothing at all. Emergency words are left alone, so
  // "stroke" never becomes "strike".
  const unmatched = concepts.filter(c => c.kind === 'term' && !c.optional && !c.repair && !/\d/.test(c.stem) &&
    !EMERGENCY_RE.test(c.words) && maxTypos(c.words.length) && !termCandidates(index, c, { fuzzy: false }).length);
  // So are misspelled ones, when reading them that way makes the search an emergency: "heart atack"
  // (not "panic atack") and "storke" (not "stocks").
  const urgent = new Map();
  for (const c of unmatched) {
    // One slip at most: two would read "imbalance" as ambulance and "overcome" as overdose.
    if (NOT_MISSPELLINGS.has(c.words)) continue;
    const word = EMERGENCY_WORDS.find(w => editDistance(c.words, w, 1) <= 1);
    if (word) urgent.set(c.words, word);
  }
  // A slip in a two-word emergency can make a word the listings use ("heat" for heating, "pian" for piano),
  // so each half is read next to the other.
  const slip = (t, w) => t.length >= 3 && editDistance(t, w, 1) <= 1;
  tokens.forEach((t, k) => {
    const next = tokens[k + 1];
    if (!next) return;
    for (const [first, seconds] of EMERGENCY_PAIRS) {
      const second = seconds.find(w => slip(next, w));
      if (second && slip(t, first)) { urgent.set(t, first); urgent.set(next, second); }
    }
  });
  if (!EMERGENCY_RE.test(tokens.map(t => urgent.get(t) ?? t).join(' '))) urgent.clear();
  for (const c of unmatched) {
    const max = maxTypos(c.words.length);
    // Closest everyday phrase ("dentsit" -> dentist) and closest indexed word ("chesapeak").
    let bestIntent = null, bestVocab = null;
    for (const w of INTENT_WORDS) {
      const d = Math.min(editDistance(c.stem, w, max), editDistance(c.words, w, max));
      if (d <= max && (!bestIntent || d < bestIntent.d)) bestIntent = { d, word: w, intent: true };
    }
    for (const t of index.vocab) {
      if (t.length < 4 || /\d/.test(t)) continue;
      const d = Math.min(editDistance(c.stem, t, max), editDistance(c.words, t, max));
      if (d > max) continue;
      const df = index.postings.get(t).size;
      if (!bestVocab || d < bestVocab.d || (d === bestVocab.d && df > bestVocab.df)) bestVocab = { d, word: t, intent: false, df };
    }
    const best = !opts.literal && bestIntent && (!bestVocab || bestIntent.d <= bestVocab.d) ? bestIntent : bestVocab;
    // A misspelled emergency word stays as typed, unless the correction is that word anyway ("emergancy").
    const meant = urgent.get(c.words);
    if (!best || (meant && best.word !== meant && best.word !== stem(meant))) continue;
    if (best.intent) {
      c.kind = 'intent';
      c.intents = INTENT_MAP.get(best.word);
      c.key = best.word;
    } else {
      c.fuzzyTo = best.word;
    }
    corrections.push({ from: c.words, to: displayWordFor(index, best.word, c) });
  }

  // A filler word names a kind of place only when the other words just say where: "shops" and "shops at noyo
  // harbor" are Shopping, but "pizza shop" is Pizza and "bake shop" is bakeries.
  const where = c => c.kind === 'term' && index.placeWords?.has(c.stem);
  if (concepts.some(c => !c.filler && !c.optional && !where(c))) concepts = concepts.filter(c => !c.filler);

  // "who fixes air conditioning", "my ac broke down": the fix words only say it's a repair job. When the
  // rest names a kind of place, search for that, and send things a shop sells to the trade that mends them.
  // Otherwise the fix words are all there is to go on: "repair downtown", "foundation repair".
  const repairJob = concepts.some(c => c.repair) || tokens.some(t => REPAIR_WORDS.has(t));
  if (repairJob && concepts.some(c => !c.repair && !c.optional && (c.kind === 'intent' || opts.literal))) {
    concepts = concepts.filter(c => !c.repair);
    for (const c of concepts) {
      if (c.kind !== 'intent' || c.words.split(' ').some(w => REPAIR_WORDS.has(w))) continue;
      c.intents = [...new Set(c.intents.map(i => REPAIRED_BY.get(i) ?? i))];
    }
  }

  // Check the corrected words too: "emergancy room", "hart attack", "heart atack".
  const fixed = new Map(corrections.map(c => [c.from, normalize(c.to)]));
  const emergency = [normalize(raw), tokens.map(t => fixed.get(t) ?? urgent.get(t) ?? t).join(' ')].some(t => EMERGENCY_RE.test(t));
  return { raw, tokens, concepts, filters, corrections, emergency, today };
}

/** Everyday phrases, hour words and search words, longest phrase first. */
function readPhrases(tokens, stems, opts = {}) {
  const concepts = [];
  const filters = {};
  const hourAt = new Set(); // positions of the hour words ("open now", "sunday")
  let today = false; // "open today": the day filter is today, and places already closed for the day don't count
  let i = 0;
  while (i < tokens.length) {
    let matched = false;
    for (let n = Math.min(MAX_PHRASE, tokens.length - i); n >= 1 && !matched; n--) {
      const key = stems.slice(i, i + n).join(' ');
      const words = tokens.slice(i, i + n).join(' ');
      const filler = n === 1 && STOPWORDS.has(words);
      if (n === 1 && key === 'open' && NOT_WORDS.has(tokens[i - 1])) {
        // "The garage door won't open" is a job to do, not "open now", and "open" isn't a search word.
        i += n; matched = true;
      } else if (!opts.hoursAsWords && FILTER_MAP.has(key)) {
        // "open" alone at the end of a live query might be the start of "open late"; that's fine.
        const f = FILTER_MAP.get(key);
        addFilter(filters, f, opts.now);
        if (f.today) today = true;
        for (let k = i; k < i + n; k++) hourAt.add(k);
        i += n; matched = true;
      } else if (!opts.literal && INTENT_MAP.has(key) && (!filler || FILLER_PLACES.has(words))) {
        concepts.push({ kind: 'intent', intents: INTENT_MAP.get(key), words, key, filler });
        i += n; matched = true;
      }
    }
    if (matched) continue;
    const tok = tokens[i];
    const isLast = i === tokens.length - 1;
    if (!STOPWORDS.has(tok)) {
      concepts.push({ kind: 'term', words: tok, stem: stems[i], partial: !!opts.live && isLast });
    } else if (opts.live && isLast && tok.length >= 3) {
      // Still typing: "list" may become "listranis". Ignored later if it matches nothing.
      concepts.push({ kind: 'term', words: tok, stem: tok, partial: true, optional: true });
    }
    i++;
  }
  return { concepts, filters, hourAt, today };
}

function addFilter(filters, f, now) {
  if (f.today) filters.day = (now || localNow()).day;
  else Object.assign(filters, f);
}

/** A phone number typed the way it's printed ("(707) 964-5298", "707-964"): its digits, or null. */
function phoneNumber(raw) {
  const text = String(raw || '').trim();
  if (!/^[\d\s().+-]+$/.test(text)) return null;
  let digits = text.replace(/\D/g, '');
  if (digits.length === 11 && digits[0] === '1') digits = digits.slice(1);
  return digits.length >= 6 ? digits : null;
}

function displayWordFor(index, stemmed, concept) {
  // Find a readable phrase for a corrected stem (prefer an intent phrase spelled out).
  if (concept.kind === 'intent') {
    for (const idx of concept.intents) {
      const p = INTENTS[idx].p.find(ph => phraseKey(ph) === stemmed);
      if (p) return p;
    }
  }
  return index.surface?.get(stemmed) || stemmed;
}

/**
 * Hour words that belong to a business's name: "Open Road", "Sunday Morning Bakehouse".
 * True when the typed words are a whole name, or the start of one and more than hour words.
 */
function hoursInName(index, raw) {
  const tokens = tokenize(raw);
  const { hourAt } = readPhrases(tokens, tokens.map(stem));
  if (!hourAt.size) return false;
  const typed = tokens.join(' ');
  if (index.byName?.has(typed)) return true;
  const more = tokens.some((t, k) => !hourAt.has(k) && !STOPWORDS.has(t));
  return more && index.docs.some(d => d.nameNorm.startsWith(`${typed} `));
}

/**
 * Take the hour words out of a search ("pizza open now" -> "pizza", open now), so the page can
 * show them as a filter the visitor can see and switch off. A business's own name is left whole.
 * @returns {{ rest: string, filters: { open?: true, late?: true, day?: number } }}
 *   rest = the other words as typed ('' when nothing is left); filters = the same shape as query.filters
 */
export function splitFilters(index, raw, opts = {}) {
  const text = String(raw ?? '');
  const words = typedWords(text);
  const tokens = words.map(w => w.token);
  const { filters, hourAt } = readPhrases(tokens, tokens.map(stem), { now: opts.now });
  if (!hourAt.size) return { rest: tidy(text), filters: {} };
  if (hoursInName(index, text)) return { rest: text, filters: {} };
  let rest = '';
  let from = 0;
  words.forEach((w, k) => {
    if (!hourAt.has(k)) return;
    rest += `${text.slice(from, w.start)} `;
    from = w.end;
  });
  // Punctuation left hanging where the hour words were ("pizza, open now!") goes too.
  rest = tidy(rest + text.slice(from)).replace(/\s+([,.;:!?])/g, '$1').replace(/^[\s,.;:!?–—-]+|[\s,.;:!?–—-]+$/g, '');
  return { rest: asksFor(rest) ? rest : '', filters };
}

const tidy = s => s.replace(/\s+/g, ' ').trim();

/** Do the words ask for anything? "what’s", "places" and "near me" don't; "shops" and "take out" do. */
function asksFor(text) {
  const tokens = tokenize(text);
  return readPhrases(tokens, tokens.map(stem)).concepts.length > 0;
}

/** The words of the text, as tokenize() reads them, with where each one sits in the text. */
function typedWords(text) {
  const out = [];
  let word = null;
  for (let k = 0; k < text.length;) {
    const ch = String.fromCodePoint(text.codePointAt(k));
    const at = k;
    k += ch.length;
    if (ch === '&') {
      word = null;
      out.push({ token: 'and', start: at, end: k });
      continue;
    }
    const plain = ch.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
    if (/^['’`]?$/.test(plain)) continue; // apostrophes and accents don't split a word
    if (!/^[a-z0-9]+$/.test(plain)) { word = null; continue; }
    if (!word) out.push(word = { token: '', start: at, end: k });
    word.token += plain;
    word.end = k;
  }
  return out;
}

// ----------------------------------------------------------------------------- scoring

function termCandidates(index, c, { fuzzy = true } = {}) {
  const out = [];
  const seen = new Set();
  const push = (term, q) => { if (!seen.has(term)) { seen.add(term); out.push([term, q]); } };
  const raw = normalize(c.words).replace(/ /g, '');
  for (const t of [c.stem, raw]) if (index.postings.has(t)) push(t, 1);
  const minPrefix = c.partial ? 2 : 3;
  if (c.stem.length >= minPrefix) {
    for (const t of prefixRange(index.vocab, c.stem).slice(0, 60)) push(t, c.partial ? 0.9 : 0.8);
    if (raw !== c.stem && raw.length >= minPrefix) for (const t of prefixRange(index.vocab, raw).slice(0, 60)) push(t, 0.85);
  }
  // A local number without the area code ("852-5298") ends a full phone number.
  if (/^\d{7}$/.test(c.stem)) {
    for (const t of index.vocab) {
      if (!/^\d/.test(t)) break;
      if (t.length === 10 && t.endsWith(c.stem)) push(t, 1);
    }
  }
  // Index word is a prefix of the query word: plumb(ing) ~ plumber, clean(ing) ~ cleaners.
  for (let len = c.stem.length - 1; len >= Math.max(5, c.stem.length - 3); len--) {
    const p = c.stem.slice(0, len);
    if (index.postings.has(p)) push(p, 0.75);
  }
  if (fuzzy && c.fuzzyTo) push(c.fuzzyTo, 0.6);
  return out;
}

function idf(index, term) {
  const df = index.postings.get(term)?.size || 1;
  return 1 + Math.log(1 + index.N / df) / 3;
}

function scoreTerm(index, c) {
  const scores = new Map();
  const strong = new Set(); // matched in the name, type or tags (not just a street or description)
  for (const [term, quality] of termCandidates(index, c)) {
    const post = index.postings.get(term);
    if (!post) continue;
    const w = quality * idf(index, term);
    for (const [doc, fw] of post) {
      const s = fw * w;
      if ((scores.get(doc) || 0) < s) scores.set(doc, s);
      if (fw >= DESCRIBES) strong.add(doc);
    }
  }
  return { scores, strong };
}

// Minimum field weight for a word to count as describing the business (name, type or tags),
// so words that only appear in a category title or street name don't drag in false matches.
const DESCRIBES = 5;

/**
 * The categories an intent may match. A `w` intent ("thai") leaves its categories only when the search names
 * another kind of place too ("thai massage", "indian wedding photographer").
 */
const scopeOf = (it, wide) => it.c || (wide ? null : it.w) || null;

/**
 * Base matches for an intent (memoised): { scores, strong }.
 * Strong = the right kind of place by category / type. Related words (t-terms) found in the
 * name, type or tags add weaker matches that are shown under "Also related".
 */
function intentBaseScores(index, intentIdx, wide = false) {
  index.intentBase = index.intentBase || new Map();
  const memo = `${intentIdx}${wide ? 'w' : ''}`;
  if (index.intentBase.has(memo)) return index.intentBase.get(memo);
  const it = INTENTS[intentIdx];
  const scope = scopeOf(it, wide);
  const scores = new Map();
  const strong = new Set();
  const bump = (doc, s) => { if ((scores.get(doc) || 0) < s) scores.set(doc, s); };
  const inScope = d => !scope || scope.includes(d.b.category);
  if (it.c) {
    for (const d of index.docs) {
      if (!inScope(d)) continue;
      if (it.sRe) { if (it.sRe.test(d.subTags)) { bump(d.i, 9); strong.add(d.i); } }
      else { bump(d.i, 6); strong.add(d.i); }
    }
  } else if (it.sRe) {
    for (const d of index.docs) if (inScope(d) && it.sRe.test(d.subTags)) { bump(d.i, 8); strong.add(d.i); }
  }
  for (const key of it.tKeys) {
    for (const [doc, fw] of keyPostings(index, key)) {
      if (fw < DESCRIBES || !inScope(index.docs[doc])) continue;
      bump(doc, fw * 0.55);
    }
  }
  const base = { scores, strong };
  index.intentBase.set(memo, base);
  return base;
}

/** Docs containing a (possibly multi-word, stemmed) key, with the weakest field weight among its words. */
function keyPostings(index, key) {
  const parts = key.split(' ');
  const lists = parts.map(p => index.postings.get(p));
  if (lists.some(l => !l)) return new Map();
  if (lists.length === 1) return lists[0];
  const out = new Map();
  for (const [doc, fw] of lists[0]) {
    if (!lists.every(l => l.has(doc))) continue;
    out.set(doc, Math.min(fw, ...lists.map(l => l.get(doc))));
  }
  return out;
}

/** Docs where a (possibly multi-word, stemmed) key appears as a phrase in the name, type or a tag. */
function phrasePostings(index, key) {
  const docs = keyPostings(index, key);
  if (!key.includes(' ')) return docs;
  return new Map([...docs].filter(([doc]) => index.docs[doc].stemText.includes(` ${key} `)));
}

/**
 * The word(s) the visitor actually typed, as index keys. A phrase that no business has ("thai food",
 * "italian food", an intent label) falls back to its words that describe the intent ("thai").
 */
function typedKeys(index, it, key) {
  if (!key) return [];
  if (phrasePostings(index, key).size) return [key];
  return key.split(' ').filter(w => it.tKeys.includes(w) && index.postings.has(w));
}

function intentDocScores(index, intentIdx, typedKey, wide) {
  const it = INTENTS[intentIdx];
  const scope = scopeOf(it, wide);
  const base = intentBaseScores(index, intentIdx, wide);
  const scores = new Map(base.scores);
  const strong = new Set(base.strong);
  // The word the visitor actually typed counts most ("italian" beats a related "pizza").
  // It adds to the kind-of-place match, so "kitchen remodel" puts kitchen remodelers before roofers.
  const typed = new Map();
  for (const key of typedKeys(index, it, typedKey)) {
    for (const [doc, fw] of phrasePostings(index, key)) {
      if (fw < DESCRIBES || (scope && !scope.includes(index.docs[doc].b.category))) continue;
      const s = fw * 0.9 + (fw >= 7 ? 1.5 : 0);
      if ((typed.get(doc) || 0) < s) typed.set(doc, s);
    }
  }
  for (const [doc, s] of typed) { scores.set(doc, (base.scores.get(doc) || 0) + s); strong.add(doc); }
  return { scores, strong };
}

function scoreIntent(index, c, wide = false) {
  const scores = new Map();
  const strong = new Set();
  for (const idx of c.intents) {
    const r = intentDocScores(index, idx, c.key, wide);
    for (const [doc, s] of r.scores) if ((scores.get(doc) || 0) < s) scores.set(doc, s);
    for (const doc of r.strong) strong.add(doc);
  }
  // The literal words also count, so typing a business name that happens to be an
  // intent phrase ("Giant", "CVS", "UPS Store") puts that business first. Outside the
  // intent's categories a name match only earns a low score ("Flower Child" for "flowers").
  const lit = ` ${normalize(c.words)} `;
  const cats = new Set(c.intents.flatMap(i => scopeOf(INTENTS[i], wide) || []));
  for (const d of index.docs) {
    if (!` ${d.nameNorm} `.includes(lit)) continue;
    const inCats = !cats.size || cats.has(d.b.category);
    const s = inCats ? 14 : 2;
    if ((scores.get(d.i) || 0) < s) scores.set(d.i, s);
    if (inCats) strong.add(d.i);
  }
  return { scores, strong };
}

/** Docs matching an intent's kind of place: { scores, strong } (for "narrow it down" chips). */
export function intentMatches(index, intentIdx) {
  return intentBaseScores(index, intentIdx);
}

/** Count businesses matching an intent (memoised), for suggestion badges. */
export function intentCount(index, intentIdx) {
  if (!index.intentCounts.has(intentIdx)) index.intentCounts.set(intentIdx, intentBaseScores(index, intentIdx).scores.size);
  return index.intentCounts.get(intentIdx);
}

// ----------------------------------------------------------------------------- public search

/**
 * Search.
 * @param {object} index
 * @param {string} raw
 * @param {object} [opts]
 *   live: boolean          user is still typing
 *   category: string       restrict to category id
 *   area: string           restrict to area id
 *   open: boolean          only places open right now
 *   sort: 'best'|'name'|'open'
 *   now: {day, minutes}    override clock (tests)
 * @returns {{ query, results: Array<{doc, score, matched, nameHit, strong, status}>, partial, total }}
 *   strong = the place is the kind of thing asked for (not just loosely related)
 */
export function search(index, raw, opts = {}) {
  const now = opts.now || localNow();
  const hoursAsWords = hoursInName(index, raw || '');
  const query = parseQuery(index, raw || '', { live: opts.live, literal: opts.literal, now, hoursAsWords });
  const filters = { ...query.filters };
  if (opts.open) filters.open = true;
  // Typing a business's exact name finds it first, whatever its words mean elsewhere ("Yard House").
  const typedName = normalize(raw);
  const exact = (typedName && index.byName?.get(typedName)) || [];

  let scored;
  let n = query.concepts.length;
  if (n === 0) {
    scored = (exact.length ? exact : index.docs).map(d => ({ doc: d, score: 0, matched: 0, nameHit: false, strong: true }));
  } else {
    const wide = query.concepts.filter(c => c.kind === 'intent').length > 1;
    let perConcept = query.concepts.map(c => (c.kind === 'intent' ? scoreIntent(index, c, wide) : scoreTerm(index, c)));
    const keep = query.concepts.map((c, k) => !(c.optional && perConcept[k].scores.size === 0));
    query.concepts = query.concepts.filter((_, k) => keep[k]);
    perConcept = perConcept.filter((_, k) => keep[k]);
    const acc = new Map();
    perConcept.forEach(({ scores, strong }) => {
      for (const [doc, s] of scores) {
        const a = acc.get(doc) || { score: 0, matched: 0, strong: 0 };
        a.score += s; a.matched += 1;
        if (strong.has(doc)) a.strong += 1;
        acc.set(doc, a);
      }
    });
    n = query.concepts.length;
    const qNorm = query.concepts.map(c => normalize(c.words)).join(' ');
    scored = [...acc].map(([i, a]) => {
      const d = index.docs[i];
      // Phrase bonus: the words appear together in the business name.
      // Two or more words that run together in a name are that name, whatever they mean elsewhere ("whole foods").
      const nameHit = qNorm.length >= 3 && ((conceptsAllInName(query.concepts, d) &&
        (d.nameNorm.includes(qNorm) || query.concepts.length > 0)) || (qNorm.includes(' ') && ` ${d.nameNorm} `.includes(` ${qNorm} `)));
      let score = a.score + (nameHit ? 25 : 0) + (d.nameNorm === qNorm ? 40 : 0);
      return { doc: d, score, matched: a.matched, nameHit, strong: nameHit || a.strong === a.matched };
    });
    for (const d of exact) {
      let r = scored.find(x => x.doc === d);
      if (!r) scored.push(r = { doc: d, score: 0 });
      Object.assign(r, { exact: true, matched: n, nameHit: true, strong: true });
    }
  }

  // Filters.
  scored = scored.filter(r => {
    const d = r.doc;
    if (opts.category && d.b.category !== opts.category) return false;
    if (opts.area && d.b.area !== opts.area) return false;
    return true;
  });
  for (const r of scored) r.status = hoursStatus(r.doc.parsedHours, now);
  if (filters.open) scored = scored.filter(r => r.status.state === 'open');
  if (filters.late) scored = scored.filter(r => isOpenLate(r.doc.parsedHours, now, filters.day));
  if (filters.day !== undefined) scored = scored.filter(r => opensOnDay(r.doc.parsedHours, filters.day));
  // "Open today" leaves out places that have already closed for the day.
  if (query.today && filters.day === now.day) scored = scored.filter(r => r.doc.parsedHours.week[now.day].some(([, e]) => e > now.minutes));

  // Prefer businesses that match every concept; fall back to partial matches.
  let partial = false;
  if (n > 1) {
    const full = scored.filter(r => r.matched === n);
    if (full.length) scored = full;
    // Half a search, and half of that a guess at the spelling ("trader joes" -> "jones"), finds nonsense.
    else if (query.corrections.length) scored = [];
    else partial = scored.length > 0;
  }

  // Nothing in this scope for what the words usually mean ("delivery" means takeout, but the
  // visitor is looking at shops): try the words literally before giving up. Not for a cuisine or dish: with no
  // Vietnamese restaurant, "vietnamese" would otherwise find a dentist who speaks Vietnamese.
  if (!scored.length && !opts.literal && query.concepts.some(c => c.kind === 'intent' && !c.intents.every(i => INTENTS[i].w))) {
    const literal = search(index, raw, { ...opts, literal: true });
    // Only an exact reading of every word: "cardiologist" spelled as "audiologist" isn't a heart doctor, and
    // "shoe repair" read as "shoe" finds shoe shops, not someone who mends shoes.
    const mends = tokenize(raw).some(t => REPAIR_WORDS.has(t));
    if (literal.total && !literal.partial && !mends && literal.query.corrections.length <= query.corrections.length) return { ...literal, query: { ...literal.query, emergency: literal.query.emergency || query.emergency } };
  }

  const sort = opts.sort || (n === 0 ? 'name' : 'best');
  const byName = (a, b) => COLLATOR.compare(a.doc.b.name, b.doc.b.name);
  const openRank = r => (r.status.state === 'open' ? 0 : r.status.state === 'closed' ? 1 : 2);
  if (sort === 'name') scored.sort(byName);
  else if (sort === 'open') scored.sort((a, b) => openRank(a) - openRank(b) || b.score - a.score || byName(a, b));
  else scored.sort((a, b) => (b.exact || 0) - (a.exact || 0) || b.matched - a.matched || b.strong - a.strong || b.score - a.score || b.doc.quality - a.doc.quality || byName(a, b));

  return { query: { ...query, filters }, results: scored, partial, total: scored.length };
}

function conceptsAllInName(concepts, d) {
  if (!concepts.length) return false;
  return concepts.every(c => {
    if (c.kind === 'intent') {
      const cats = c.intents.flatMap(i => INTENTS[i].scope || []);
      if (cats.length && !cats.includes(d.b.category)) return false;
      const words = c.key.split(' ');
      return words.every(w => d.nameStems.some(ns => ns === w || (w.length >= 3 && ns.startsWith(w))));
    }
    return d.nameStems.some(ns => ns === c.stem || (c.stem.length >= 3 && ns.startsWith(c.stem)));
  });
}

/**
 * "Open late": open until 10 PM or later, and not already closed for the night. After midnight, that
 * means open right now. On another day ("open late saturday") only that day's hours count.
 */
function isOpenLate(parsed, now, day = now.day) {
  if (!parsed) return false;
  if (parsed.is247) return true;
  const late = 22 * 60;
  if (day !== now.day) return parsed.week[day].some(([, e]) => e >= late);
  // Just after midnight, last night's hours may still be going.
  if (parsed.week[(day + 6) % 7].some(([, e]) => e > 24 * 60 && now.minutes + 24 * 60 < e)) return true;
  // Before 5 AM, tonight is a long way off: "late night food" at 1 AM wants somewhere open now.
  if (now.minutes < 5 * 60) return parsed.week[day].some(([s, e]) => s <= now.minutes && now.minutes < e);
  return parsed.week[day].some(([, e]) => e >= late && now.minutes < e);
}

// ----------------------------------------------------------------------------- suggestions

/**
 * Autocomplete suggestions while typing.
 * @returns {Array<{type:'intent'|'area'|'business', label:string, sub?:string, value:string, id?:string, count?:number, category?:string}>}
 */
export function suggest(index, raw, limit = 7) {
  const norm = normalize(raw);
  if (!norm) return [];
  const out = [];
  const seenLabels = new Set();

  // 1) Kinds of business ("Dentists", "Pizza", "Plumbers").
  const intentHits = [];
  INTENTS.forEach((it, idx) => {
    let best = Infinity;
    if (normalize(it.label).startsWith(norm)) best = 0;
    for (const p of it.p) {
      const np = normalize(p);
      if (np.startsWith(norm)) best = Math.min(best, 1 + np.length / 100);
      else if (norm.length >= 3 && np.split(' ').some(w => w.startsWith(norm))) best = Math.min(best, 2 + np.length / 100);
    }
    if (best < Infinity) intentHits.push({ idx, best });
  });
  // Neighborhoods ("noy" -> Noyo Harbor), ranked alongside the kinds of business.
  if (norm.length >= 3) {
    for (const a of index.areas || []) {
      const best = a.norm.startsWith(norm) ? 0 : a.norm.split(' ').some(w => w.startsWith(norm)) ? 0.5 : Infinity;
      if (best < Infinity) intentHits.push({ area: a, best });
    }
  }
  intentHits.sort((a, b) => a.best - b.best);
  for (const hit of intentHits) {
    if (hit.area) {
      out.push({ type: 'area', label: hit.area.name, value: hit.area.name, id: hit.area.id, count: hit.area.count });
    } else {
      const it = INTENTS[hit.idx];
      if (seenLabels.has(it.label)) continue;
      const count = intentCount(index, hit.idx);
      if (!count) continue;
      seenLabels.add(it.label);
      out.push({ type: 'intent', label: it.label, value: it.label, count, category: it.c && it.c.length === 1 ? it.c[0] : undefined });
    }
    if (out.length >= 3) break;
  }

  // 2) Business names.
  const allToks = tokenize(raw);
  const qTokens = allToks.filter((t, k) => k === allToks.length - 1 || !STOPWORDS.has(t));
  const qStems = qTokens.map(stem);
  if (qTokens.length) {
    const hits = [];
    for (const d of index.docs) {
      const nameToks = tokenize(d.b.name);
      let ok = true, pos = 0;
      for (let k = 0; k < qTokens.length; k++) {
        const last = k === qTokens.length - 1;
        const found = nameToks.findIndex(nt => nt === qTokens[k] || stem(nt) === qStems[k] || (last && nt.startsWith(qTokens[k])));
        if (found < 0) { ok = false; break; }
        pos += found;
      }
      if (ok) hits.push({ d, pos, starts: normalize(d.b.name).startsWith(norm) });
    }
    hits.sort((a, b) => (b.starts - a.starts) || a.pos - b.pos || a.d.b.name.length - b.d.b.name.length);
    for (const h of hits.slice(0, limit - out.length)) {
      out.push({ type: 'business', label: h.d.b.name, sub: h.d.b.sub, value: h.d.b.name, id: h.d.b.id, category: h.d.b.category });
    }
  }
  return out.slice(0, limit);
}

/** "Did you mean ...?" for queries with no results: closest intent phrase or vocabulary word. */
export function didYouMean(index, raw) {
  const q = parseQuery(index, raw);
  if (q.corrections.length) return q.corrections.map(c => c.to).join(' ');
  return null;
}
