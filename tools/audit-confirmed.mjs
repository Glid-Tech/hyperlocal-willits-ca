#!/usr/bin/env node
// Re-check hand confirmations against the pages they cite, before anything is published.
//
//   node tools/audit-confirmed.mjs                      # every file in data/sources/confirmed/
//   node tools/audit-confirmed.mjs confirmed/wave1-01.json
//
// Every fact in data/sources/confirmed/*.json names its source (see data/sources/README.md). This
// script makes sure each one holds up:
//   - The source must be an allowed kind: the business's own website, OpenStreetMap or a government
//     record (tools/lib/source-policy.mjs).
//   - Own-website and government pages are fetched again, politely and only where robots.txt allows.
//     The value must appear there: the phone number, the street number and name, the ZIP code, the
//     suite number, the business's name, and every opening and closing time in its hours. Government
//     data in JSON or plain text counts too; in a text list (one licence per line) the value must be on
//     a line that also carries the business's name and street address.
//   - A website must load and show the business's name, phone number or street address, and must not
//     look parked, for sale or hijacked (gambling spam is the usual sign).
//   - OpenStreetMap facts are compared with data/sources/osm.json.
// A fact that doesn't hold up is moved to "rejected" with the reason, so the build ignores it. An
// "open" check left with no facts is dropped entirely, and the listing then depends on the automatic
// website check. The files are rewritten in place, so running this twice gives the same result.
//
//   --websites   re-check only the website facts (for files audited before the website rule existed)
//   --dry        report what would change without rewriting any file

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { classifySource, hostOf, isOwnWebsite, siteKey } from './lib/source-policy.mjs';
import { sleep, robotsFor, robotsAllows, getText, pageFacts, pageText, jsonLdObjects, hoursFromLd, addressNeedle, addressOnPage, phoneDigits } from './lib/pagecheck.mjs';
import { normalizeHours } from '../assets/js/hours.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'data/sources');
const DIR = path.join(SRC, 'confirmed');
const CONCURRENCY = 6;
const PER_HOST_GAP_MS = 1500;

const readJson = (f, fb) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return fb; } };
const args = process.argv.slice(2).filter(a => !a.startsWith('--'));
const ONLY_WEBSITES = process.argv.includes('--websites');
const DRY = process.argv.includes('--dry');
const files = (args.length ? args.map(a => path.resolve(SRC, a)) : fs.existsSync(DIR) ? fs.readdirSync(DIR).filter(f => f.endsWith('.json')).map(f => path.join(DIR, f)) : []);
if (!files.length) { console.log('No confirmation files to audit.'); process.exit(0); }

const candidates = new Map((readJson(path.join(SRC, 'candidates.json'), {}).candidates || []).map(c => [c.id, c]));
const osm = new Map((readJson(path.join(SRC, 'osm.json'), {}).elements || []).map(e => [e.id, e]));

// ----------------------------------------------------------------------------- what a page shows

const fold = s => String(s || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase();
const NAME_SKIP = new Set(['the', 'and', 'of', 'at', 'in', 'a', 'an', 'inc', 'llc', 'ltd', 'co', 'company', 'corp', 'pc', 'pllc', 'willits', 'ca', 'california']);
const nameWords = name => fold(name).replace(/&/g, ' ').split(/[^a-z0-9]+/).filter(w => w.length >= 2 && !NAME_SKIP.has(w));

/** Minutes after midnight for every time written on the page: "9am", "9:30 AM", "21:00", "noon"... */
function timesIn(text) {
  const t = new Set();
  const s = fold(text);
  for (const m of s.matchAll(/\b(\d{1,2})(?::(\d{2}))?\s*(a\.?\s?m\.?|p\.?\s?m\.?)(?![a-z])/g)) {
    let h = +m[1] % 12; const min = +(m[2] || 0);
    if (m[3][0] === 'p') h += 12;
    t.add((h * 60 + min) % 1440);
  }
  for (const m of s.matchAll(/\b([01]?\d|2[0-4])[:.h]([0-5]\d)\b/g)) t.add((+m[1] * 60 + +m[2]) % 1440);
  if (/\bnoon\b/.test(s)) t.add(720);
  if (/\bmidnight\b/.test(s)) t.add(0);
  return t;
}
const hoursTimes = h => [...String(h).matchAll(/\b(\d{2}):(\d{2})\b/g)].map(m => (+m[1] * 60 + +m[2]) % 1440);

function factOnPage(field, value, page, cand) {
  const { html, facts, text } = page;
  switch (field) {
    case 'phone': return facts.phones.has(phoneDigits(value)) || 'phone number not on the page';
    case 'address': {
      const needle = addressNeedle(value);
      if (!needle) return 'address has no street number';
      return addressOnPage(needle, facts.addrText) || 'address not on the page';
    }
    case 'zip': return new RegExp(`\\b${String(value).slice(0, 5)}(?:-?\\d{4})?\\b`).test(text) || 'ZIP code not on the page'; // ZIP+4 is often written 954901234
    case 'unit': {
      const n = String(value).match(/[0-9]+[a-z]?|\b[a-z]\b/i)?.[0];
      return (!!n && new RegExp(`\\b${n}\\b`, 'i').test(text)) || 'suite number not on the page';
    }
    case 'center': {
      // A shopping centre's name is short and made of common words ("Willits Shopping Center"), so the whole name
      // must appear together.
      const flat = t => ` ${fold(t).replace(/[^a-z0-9]+/g, ' ').trim()} `;
      return flat(`${text} ${html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1] || ''}`).includes(flat(value)) || 'shopping center not on the page';
    }
    case 'name': {
      const words = nameWords(value);
      if (!words.length) return true;
      // The page title, plus the name a site gives itself in its sharing tags (og:site_name, og:title), which
      // pages that build their title with JavaScript still carry.
      const meta = [...html.matchAll(/<meta\b[^>]*(?:property|name)=["'](?:og:site_name|og:title|application-name)["'][^>]*>/gi)].map(m => m[0].match(/content=["']([^"']*)["']/i)?.[1] || '');
      const hay = fold(`${text} ${html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1] || ''} ${meta.join(' ')}`);
      const found = words.filter(w => new RegExp(`\\b${w}\\b`).test(hay)).length;
      return found / words.length >= 0.6 || 'name not on the page';
    }
    case 'hours': {
      const h = normalizeHours(value);
      if (!h) return 'hours not in a format we can read';
      if (jsonLdObjects(html).some(o => hoursFromLd(o) === h)) return true;
      if (/24\/7/.test(h)) return /24\s*\/\s*7|24 hours|open 24/i.test(text) || 'open 24/7 not on the page';
      const onPage = timesIn(text);
      const missing = hoursTimes(h).filter(t => !onPage.has(t));
      return !missing.length || 'some opening or closing times are not on the page';
    }
    case 'opened': {
      const y = String(value).slice(0, 4);
      return new RegExp(`\\b${y}\\b`).test(text) || 'year not on the page';
    }
    case 'website': return true; // checked separately, by websiteLooksRight
    default: return 'not a fact we publish';
  }
}

// A domain that lapsed is often bought to show gambling spam or a "for sale" page. Linking older visitors there
// would be worse than showing no website at all.
const SPAM = /\b(slot (gacor|online|terpercaya)|situs (judi|slot|toto)|judi (online|bola|slot)|togel|sbobet|maxwin|bandar (bola|togel|slot)|casino online)\b/i;
const PARKED = /\b(this domain (name )?(is|may be) for sale|buy this domain|domain (is )?parked|parked free|domain (has )?expired|this domain has been registered|is available for purchase)\b/i;

function websiteLooksRight(page, url, name, rec, cand) {
  if (SPAM.test(page.text)) return 'website: the page shows gambling spam, so the site may have been taken over';
  if (PARKED.test(page.text)) return 'website: the domain looks parked, expired or for sale';
  // Big chains often build their pages with JavaScript or turn automated readers away, so the name may not be in
  // what we get back. Their own domain carrying the name (yardhouse.com for Yard House) is enough, as long as
  // the address doesn't forward somewhere else, which is what a lapsed domain usually does.
  const host = hostOf(url);
  const staysHome = siteKey(hostOf(page.finalUrl || url)) === siteKey(host);
  if (staysHome && nameWords(name).some(w => w.length >= 4 && host.replace(/[^a-z0-9]/g, '').includes(w))) return true;
  if (factOnPage('name', name, page, cand) === true) return true;
  const phone = rec.facts?.phone?.value || cand.phone;
  if (phone && page.facts.phones.has(phoneDigits(phone))) return true;
  const needle = addressNeedle(rec.facts?.address?.value || cand.address);
  if (needle && addressOnPage(needle, page.facts.addrText)) return true;
  return 'website: the page doesn’t show the business’s name, phone number or address';
}

/** Turn a fetched file into what factOnPage reads. JSON is flattened to its values; a plain-text file is kept as
 *  lines, because government lists put one licence on each line. */
function makePage(body, type, finalUrl) {
  if (/html|xml/.test(type)) return { html: body, facts: pageFacts(body), text: pageText(body), finalUrl };
  let text = body;
  if (/json/.test(type)) {
    try {
      const flat = [];
      const walk = v => { if (v == null) return; if (typeof v === 'object') Object.values(v).forEach(walk); else flat.push(String(v)); };
      walk(JSON.parse(body));
      text = flat.join('\n');
    } catch { /* not valid JSON: read it as text */ }
  }
  return { html: text, facts: pageFacts(text), text: text.replace(/\s+/g, ' '), finalUrl, rows: /text\/plain/.test(type) ? text.split(/\r?\n/) : null };
}

// A licence that has lapsed or been taken away is still listed, but it doesn't show the business is trading.
const LAPSED = /\b(delinquent|expired|cancell?ed|revoked|surrendered|suspended|inactive|retired|deceased|closed)\b/i;

/** In a text list, only the lines naming this business at this address, on a licence still in force, count. */
function scopeToBusiness(page, name, address) {
  if (!page.rows) return page;
  const words = nameWords(name);
  const needle = addressNeedle(address);
  const rows = page.rows.filter(line => {
    if (LAPSED.test(line)) return false;
    const l = fold(line);
    const named = words.length > 0 && words.filter(w => new RegExp(`\\b${w}\\b`).test(l)).length / words.length >= 0.6;
    return named && (!needle || addressOnPage(needle, ` ${pageFacts(line).addrText} `));
  });
  if (!rows.length) return null;
  const text = rows.join('\n');
  return { html: text, facts: pageFacts(text), text: text.replace(/\s+/g, ' '), finalUrl: page.finalUrl };
}

function factInOsm(field, value, el) {
  const t = el?.tags || {};
  switch (field) {
    case 'phone': return [t.phone, t['contact:phone']].filter(Boolean).flatMap(p => p.split(/[;,]/)).some(p => phoneDigits(p) === phoneDigits(value)) || 'phone differs from OpenStreetMap';
    case 'address': {
      const needle = addressNeedle(value);
      return (!!needle && addressOnPage(needle, pageFacts(`${t['addr:housenumber'] || ''} ${t['addr:street'] || ''}`).addrText)) || 'address differs from OpenStreetMap';
    }
    case 'zip': return t['addr:postcode']?.slice(0, 5) === String(value).slice(0, 5) || 'ZIP differs from OpenStreetMap';
    case 'unit': return !!t['addr:unit'] || !!t['addr:suite'] || 'no suite in OpenStreetMap';
    case 'name': return fold(t.name) === fold(value) || nameWords(value).every(w => fold(t.name).includes(w)) || 'name differs from OpenStreetMap';
    case 'hours': return normalizeHours(t.opening_hours || '') === normalizeHours(value) || 'hours differ from OpenStreetMap';
    case 'website': return true;
    default: return 'not in OpenStreetMap';
  }
}

// ----------------------------------------------------------------------------- fetching, a few hosts at a time

const pages = new Map(); // url -> Promise<page | {error}>
const hostQueue = new Map(); // host -> Promise chain, so one site gets one request at a time
let active = 0;
const waiters = [];
async function slot(fn) {
  while (active >= CONCURRENCY) await new Promise(r => waiters.push(r));
  active++;
  try { return await fn(); } finally { active--; waiters.shift()?.(); }
}
function fetchPage(url) {
  if (pages.has(url)) return pages.get(url);
  const host = hostOf(url);
  const run = (hostQueue.get(host) || Promise.resolve()).then(() => slot(async () => {
    let u;
    try { u = new URL(url); } catch { return { error: 'bad address' }; }
    const rules = await robotsFor(u.origin);
    if (!robotsAllows(rules, u.pathname + u.search)) return { error: 'robots.txt asks us not to read this page' };
    try {
      const p = await getText(url);
      if (!p.body) return { error: p.unreadable ? `not a page we can read (${p.type.split(';')[0] || 'unknown type'})` : `the page answered ${p.status}` };
      return makePage(p.body, p.type, p.finalUrl);
    } catch (e) {
      return { error: e.name === 'TimeoutError' ? 'the page took too long' : 'the page could not be reached' };
    } finally {
      await sleep(PER_HOST_GAP_MS);
    }
  }));
  hostQueue.set(host, run.catch(() => {}));
  pages.set(url, run);
  return run;
}

// ----------------------------------------------------------------------------- audit

const osmIdOf = url => url.match(/openstreetmap\.org\/(node|way|relation)\/(\d+)/)?.slice(1).join('/');

async function auditRecord(rec) {
  const cand = candidates.get(rec.id) || {};
  const name = rec.facts?.name?.value || cand.name || '';
  const website = rec.facts?.website?.value || cand.website || '';
  const kept = {};
  const rejected = { ...(rec.rejected || {}) };
  for (const [field, fact] of Object.entries(rec.facts || {})) {
    if (ONLY_WEBSITES && field !== 'website') { kept[field] = fact; continue; }
    const value = String(fact?.value ?? '').trim();
    const source = String(fact?.source ?? '').trim();
    if (!value || !source) { rejected[field] = { ...fact, reason: 'missing value or source' }; continue; }
    const kind = classifySource(source, { website, name });
    if (!['first', 'gov', 'osm'].includes(kind)) { rejected[field] = { ...fact, reason: 'source is not the business’s own website, OpenStreetMap or a government record' }; continue; }
    let ok;
    if (field === 'website') {
      if (!isOwnWebsite(value, name)) ok = 'not the business’s own website';
      else { const p = await fetchPage(value); ok = p.error ? `website: ${p.error}` : websiteLooksRight(p, value, name, rec, cand); }
    } else if (kind === 'osm') {
      const el = osm.get(osmIdOf(source));
      ok = el ? factInOsm(field, value, el) : 'OpenStreetMap element not in osm.json';
    } else {
      const p = await fetchPage(source);
      const scoped = p.error ? null : scopeToBusiness(p, name, field === 'address' ? value : rec.facts?.address?.value || cand.address);
      ok = p.error ? p.error : scoped ? factOnPage(field, value, scoped, cand) : 'the business isn’t on that list at that address';
    }
    if (ok === true) kept[field] = { value, source };
    else rejected[field] = { value, source, reason: ok };
  }
  const out = { ...rec, facts: kept };
  if (Object.keys(rejected).length) out.rejected = rejected; else delete out.rejected;
  return out;
}

const report = { files: 0, records: 0, kept: 0, rejected: 0, droppedOpen: 0, reasons: {} };
for (const file of files) {
  const recs = readJson(file, null);
  if (!Array.isArray(recs)) { console.warn(`! ${path.relative(ROOT, file)} is not a list of checks; skipped`); continue; }
  const audited = await Promise.all(recs.map(auditRecord));
  const keep = audited.filter(r => {
    if (['open', 'coming_soon'].includes(r.verdict) && !Object.keys(r.facts).length) { report.droppedOpen++; return false; }
    return true;
  });
  for (const r of audited) {
    report.kept += Object.keys(r.facts).length;
    for (const f of Object.values(r.rejected || {})) { report.rejected++; report.reasons[f.reason] = (report.reasons[f.reason] || 0) + 1; }
  }
  report.files++; report.records += recs.length;
  if (DRY) {
    for (const r of audited) for (const [k, f] of Object.entries(r.rejected || {})) if (!rec0(recs, r.id)?.rejected?.[k]) console.log(`  would reject ${r.id} ${k}: ${f.reason}  <${f.source}>`);
  } else fs.writeFileSync(file, JSON.stringify(keep, null, 1) + '\n');
}
function rec0(recs, id) { return recs.find(r => r.id === id); }
console.log(`${DRY ? '(dry run, nothing saved) ' : ''}audited ${report.records} checks in ${report.files} files: ${report.kept} facts hold up, ${report.rejected} rejected; ${report.droppedOpen} "open" checks had nothing left and were dropped`);
console.log(report.reasons);
