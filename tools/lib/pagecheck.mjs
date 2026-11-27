// Reading a business's own web page politely: robots.txt, then the facts on the page (phone numbers,
// street addresses, schema.org data). Used by tools/check-firstparty.mjs and tools/audit-confirmed.mjs.
// Nothing from the page is kept except these facts.

import { normalizeHours } from '../../assets/js/hours.js';
import { CONFIG } from '../../assets/js/config.js';
import { hostOf, isGovHost } from './source-policy.mjs';
import { canonRoutes, UA_NAME } from './common.mjs';

// Some public lookups only show a record to a visitor who came from their search form, as a browser would.
const REFERER = { 'cslb.ca.gov': 'https://www.cslb.ca.gov/OnlineServices/CheckLicenseII/CheckLicense.aspx' };
const refererFor = url => { const h = hostOf(url); const k = Object.keys(REFERER).find(d => h === d || h.endsWith('.' + d)); return k ? { Referer: REFERER[k] } : {}; };

// In the usual form for an automated checker ("Mozilla/5.0 (compatible; name/version; purpose)"): some sites' firewalls
// turn away any client that doesn't start this way, even from robots.txt. It still names the tool and what it does.
// No apostrophes or quotes: some firewalls read them as an attack and refuse the request.
export const UA = `Mozilla/5.0 (compatible; ${UA_NAME}-fact-checker/1.0; checks business addresses and phone numbers for a static community directory)`;
// The robots.txt name for this checker ("willitslocal"): the UA's product name in lower case, so the two always agree.
const UA_TOKEN = UA_NAME.toLowerCase();
export const sleep = ms => new Promise(r => setTimeout(r, ms));

// ----------------------------------------------------------------------------- robots.txt

const robotsCache = new Map();
export function parseRobots(txt) {
  const groups = [];
  let cur = null, lastUA = false;
  for (const raw of txt.split(/\r?\n/)) {
    const line = raw.replace(/#.*/, '').trim();
    const m = line.match(/^([A-Za-z-]+)\s*:\s*(.*)$/);
    if (!m) continue;
    const k = m[1].toLowerCase(), v = m[2].trim();
    if (k === 'user-agent') {
      if (!cur || !lastUA) { cur = { agents: [], rules: [] }; groups.push(cur); }
      cur.agents.push(v.toLowerCase());
      lastUA = true;
      continue;
    }
    lastUA = false;
    if (cur && (k === 'allow' || k === 'disallow') && v) cur.rules.push({ allow: k === 'allow', path: v });
  }
  const mine = groups.filter(g => g.agents.some(a => a !== '*' && UA_TOKEN.includes(a)));
  return (mine.length ? mine : groups.filter(g => g.agents.includes('*'))).flatMap(g => g.rules);
}
export function robotsAllows(rules, pathAndQuery) {
  let best = null;
  for (const r of rules) {
    const src = '^' + r.path.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\\\*/g, '.*').replace(/\*/g, '.*').replace(/\\\$$/, '$');
    let re;
    try { re = new RegExp(src); } catch { continue; }
    if (!re.test(pathAndQuery)) continue;
    const len = r.path.length;
    if (!best || len > best.len || (len === best.len && r.allow)) best = { len, allow: r.allow };
  }
  return !best || best.allow;
}
export async function robotsFor(origin) {
  if (robotsCache.has(origin)) return robotsCache.get(origin);
  let rules = [];
  try {
    const res = await fetch(origin + '/robots.txt', { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(10000), redirect: 'follow' });
    if (res.ok) rules = parseRobots(await res.text());
    else if (res.status === 401 || res.status === 403) rules = [{ allow: false, path: '/' }];
  } catch { /* unreachable robots.txt: treat as no rules */ }
  robotsCache.set(origin, rules);
  return rules;
}

// ----------------------------------------------------------------------------- page facts

const ENTITIES = { amp: '&', nbsp: ' ', quot: '"', apos: "'", lt: '<', gt: '>', ndash: '-', mdash: '-', rsquo: "'", lsquo: "'" };
export const decode = s => s.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, e) => {
  if (e[0] === '#') { const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); return Number.isFinite(n) ? String.fromCodePoint(n) : ' '; }
  return ENTITIES[e.toLowerCase()] ?? ' ';
});

export function jsonLdObjects(html) {
  const out = [];
  const visit = o => {
    if (!o || typeof o !== 'object') return;
    if (Array.isArray(o)) { o.forEach(visit); return; }
    if (o['@graph']) visit(o['@graph']);
    if (o.telephone || o.address || o.openingHours || o.openingHoursSpecification) out.push(o);
    for (const k of ['location', 'department', 'subOrganization', 'containsPlace', 'mainEntity']) if (o[k]) visit(o[k]);
  };
  for (const m of html.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) {
    try { visit(JSON.parse(m[1].trim())); } catch { /* malformed JSON-LD is common; skip it */ }
  }
  return out;
}

const DAY = { monday: 'Mo', tuesday: 'Tu', wednesday: 'We', thursday: 'Th', friday: 'Fr', saturday: 'Sa', sunday: 'Su', mo: 'Mo', tu: 'Tu', we: 'We', th: 'Th', fr: 'Fr', sa: 'Sa', su: 'Su' };
const ORDER = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];
export function hoursFromLd(o) {
  if (typeof o.openingHours === 'string' || Array.isArray(o.openingHours)) {
    const h = normalizeHours([].concat(o.openingHours).join('; '));
    if (h) return h;
  }
  // Holiday and other special-day hours (a validFrom-validThrough window of a week or less) aren't the weekly hours.
  const special = s => s.validFrom && s.validThrough && Date.parse(s.validThrough) - Date.parse(s.validFrom) <= 7 * 864e5;
  const specs = [].concat(o.openingHoursSpecification || []).filter(s => s && !special(s));
  if (!specs.length) return '';
  const byDay = {};
  for (const s of specs) {
    const opens = String(s.opens || '').slice(0, 5), closes = String(s.closes || '').slice(0, 5);
    if (!/^\d\d:\d\d$/.test(opens) || !/^\d\d:\d\d$/.test(closes)) continue;
    // Opening and closing at 00:00 marks a closed day; 00:00-23:59 is open all day (schema.org, as Google documents).
    if (opens === '00:00' && closes === '00:00') continue;
    for (const d of [].concat(s.dayOfWeek || [])) {
      const key = DAY[String(d).split('/').pop().toLowerCase()];
      if (key) (byDay[key] ||= []).push(`${opens}-${closes === '00:00' || closes === '23:59' ? '24:00' : closes}`);
    }
  }
  const parts = [];
  for (let i = 0; i < 7;) {
    const t = (byDay[ORDER[i]] || []).join(',');
    let j = i;
    while (j + 1 < 7 && (byDay[ORDER[j + 1]] || []).join(',') === t) j++;
    if (t) parts.push(`${ORDER[i]}${j > i ? '-' + ORDER[j] : ''} ${t}`);
    i = j + 1;
  }
  return normalizeHours(parts.join('; ')) || '';
}

const ABBR = { dr: 'drive', rd: 'road', st: 'street', ave: 'avenue', av: 'avenue', blvd: 'boulevard', pkwy: 'parkway', ln: 'lane', ct: 'court', pl: 'place', plz: 'plaza', hwy: 'highway', cir: 'circle', ter: 'terrace', tpke: 'turnpike', sq: 'square', n: 'north', s: 'south', e: 'east', w: 'west' };
// Routes are written many ways ("CA-20", "US Hwy 101", "Fort Bragg Rd"): the shared ROUTE_ALIASES in common.mjs turn
// them into the same form prettyStreet gives a listing's address ("highway 20", "highway 101").
export const normAddr = s => ` ${canonRoutes(String(s)).toLowerCase().replace(/[.,#]/g, ' ').replace(/\s+/g, ' ').split(' ').map(w => ABBR[w] || w).join(' ')} `;
const DIRS = new Set(['north', 'south', 'east', 'west']);
export function addressNeedle(address) {
  const words = normAddr(address).replace(/^\s*(\d+)\s*-?\s*([a-z])\s/, ' $1$2 ').trim().split(' ');
  const num = words[0];
  if (!/^\d+[a-z]?$/.test(num)) return null;
  const street = words.slice(1).find(w => !DIRS.has(w));
  return street ? { num, street } : null;
}
export const phoneDigits = p => String(p || '').replace(/\D/g, '').replace(/^1(?=\d{10}$)/, '');

export function pageFacts(html) {
  const ld = jsonLdObjects(html);
  const text = decode(html.replace(/<(script|style|svg)\b[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ');
  const phones = new Set();
  for (const m of text.matchAll(/\(?\b(\d{3})\)?[\s.\-\u2013]{0,3}(\d{3})[\s.\-\u2013]{1,3}(\d{4})\b/g)) phones.add(m[1] + m[2] + m[3]);
  for (const m of html.matchAll(/href=["']tel:([^"']+)["']/gi)) phones.add(phoneDigits(decodeURIComponent(m[1])));
  for (const o of ld) phones.add(phoneDigits(o.telephone));
  const addrText = normAddr(text + ' ' + ld.map(o => [].concat(o.address || []).map(a => typeof a === 'string' ? a : `${a.streetAddress || ''} ${a.postalCode || ''}`).join(' ')).join(' '));
  const links = [...html.matchAll(/<a\b[^>]*href=["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi)].map(m => ({ href: m[1], label: decode(m[2].replace(/<[^>]+>/g, ' ')).trim().toLowerCase() }));
  return { ld, phones, addrText, links };
}

export async function getPage(url) {
  const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml', ...refererFor(url) }, redirect: 'follow', signal: AbortSignal.timeout(15000) });
  const type = res.headers.get('content-type') || '';
  if (!res.ok) return { status: res.status, finalUrl: res.url };
  if (!/html|xml/.test(type)) return { status: res.status, finalUrl: res.url, notHtml: true };
  const html = (await res.text()).slice(0, 3_000_000);
  return { status: res.status, finalUrl: res.url, html };
}

/** Like getPage, but also reads the plain-text formats government data is published in (JSON, text lists)
 *  and a site's own scripts, which some sites use to hold their contact details. */
export async function getText(url) {
  const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml,application/json;q=0.9,text/plain;q=0.8,*/*;q=0.5', ...refererFor(url) }, redirect: 'follow', signal: AbortSignal.timeout(20000) });
  const type = (res.headers.get('content-type') || '').toLowerCase();
  if (!res.ok) return { status: res.status, finalUrl: res.url };
  // A government licence list downloaded as a spreadsheet file (tab- or comma-separated text) is read in full, line by
  // line, keeping only the lines that mention the town: the statewide lists run to tens of megabytes.
  if (/csv|tab-separated|ms-excel|octet-stream/.test(type) && isGovHost(hostOf(url))) {
    return { status: res.status, finalUrl: res.url, type: 'text/plain', body: await townLines(res, 300_000_000) };
  }
  if (!/html|xml|json|text\/plain|javascript|ecmascript/.test(type)) return { status: res.status, finalUrl: res.url, type, unreadable: true };
  return { status: res.status, finalUrl: res.url, type, body: (await res.text()).slice(0, 4_000_000) };
}

/** The lines of a long text download that mention the town or another of its place names (any case), read as a
 *  stream up to `limit` bytes. */
async function townLines(res, limit) {
  const names = (CONFIG.placeNames || [CONFIG.town]).map(n => n.toLowerCase());
  const mentions = line => { const l = line.toLowerCase(); return names.some(n => l.includes(n)); };
  const decoder = new TextDecoder();
  const keep = [];
  let rest = '', read = 0, first = true;
  for await (const chunk of res.body) {
    read += chunk.length;
    const lines = (rest + decoder.decode(chunk, { stream: true })).split(/\r?\n/);
    rest = lines.pop();
    for (const line of lines) {
      if (first) { keep.push(line); first = false; continue; } // the header row names the columns
      if (mentions(line)) keep.push(line);
    }
    if (read > limit) break;
  }
  if (mentions(rest)) keep.push(rest);
  return keep.join('\n');
}

/** True when the street number and street name of `needle` appear in normalized page text. */
export function addressOnPage(needle, addrText) {
  if (!needle) return false;
  // "8377a" may be written "8377A", "8377 A" or "8377 - A" (government lists do the last).
  const [, digits, letter] = needle.num.match(/^(\d+)([a-z]?)$/) || [null, needle.num, ''];
  const num = letter ? `${digits}\\s*-?\\s*${letter}` : digits;
  return new RegExp(`\\s${num}\\s+(?:(?:north|south|east|west)\\s+)?${needle.street}\\s`).test(addrText);
}

/** Visible text of a page, without scripts, styles or tags. */
export function pageText(html) {
  return decode(html.replace(/<(script|style|svg)\b[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ');
}
