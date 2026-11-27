// Confirm listing facts on each business's OWN website (see data/SOURCES.md).
//
//   node tools/check-firstparty.mjs              # check every publishable candidate with its own website
//   node tools/check-firstparty.mjs --missing    # only candidates not checked yet
//   node tools/check-firstparty.mjs --ids=a,b    # check these listings again
//
// For each site it reads robots.txt first and skips the site if robots.txt says no. It sends at most
// three requests per site, one at a time and slowly. Then it records whether the listing's phone number
// and street address appear on the page. Opening hours are taken only from the schema.org data the
// business publishes about itself. Nothing else is kept: no text, no photos.
// Output: data/sources/firstparty.json (a working file, not published).

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isOwnWebsite, hostOf } from './lib/source-policy.mjs';
import { UA, sleep, robotsFor, robotsAllows, getPage, pageFacts, addressNeedle, addressOnPage, phoneDigits, hoursFromLd } from './lib/pagecheck.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'data/sources');
const OUT = path.join(SRC, 'firstparty.json');
const TODAY = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' }).format(new Date()); // Fort Bragg's date
const CONCURRENCY = 8;
const PER_HOST_GAP_MS = 1500;
const MAX_PAGES = 3;

const readJson = (f, fb) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return fb; } };

const cands = readJson(path.join(SRC, 'candidates.json'), {}).candidates || [];
const prev = readJson(OUT, {});
const onlyMissing = process.argv.includes('--missing');
const onlyIds = new Set((process.argv.find(a => a.startsWith('--ids=')) || '').slice(6).split(',').filter(Boolean));
const todo = cands.filter(c => (c.status === 'open' || c.status === 'coming_soon') && c.website && isOwnWebsite(c.website, c.name))
  .filter(c => !onlyMissing || !prev[c.id])
  .filter(c => !onlyIds.size || onlyIds.has(c.id))
  .slice(0, Number((process.argv.find(a => a.startsWith('--limit=')) || '').split('=')[1]) || Infinity);
console.log(`${todo.length} listings to check on their own websites`);

// ----------------------------------------------------------------------------- run, a few hosts at a time

const results = { ...prev };
const byHost = new Map();
for (const c of todo) {
  const h = hostOf(c.website);
  if (!byHost.has(h)) byHost.set(h, []);
  byHost.get(h).push(c);
}


async function checkOne(c) {
  const r = { id: c.id, url: c.website, checked: TODAY, phone: false, address: false, pages: [], hours: '', ldPhone: '', ldStreet: '' };
  const wantPhone = phoneDigits(c.phone), needle = c.address ? addressNeedle(c.address) : null;
  let url = c.website, origin;
  try { origin = new URL(url).origin; } catch { r.error = 'bad url'; return r; }
  const rules = await robotsFor(origin);
  const queue = [url];
  const seen = new Set();
  while (queue.length && r.pages.length < MAX_PAGES) {
    const next = queue.shift();
    if (seen.has(next)) continue;
    seen.add(next);
    const u = new URL(next);
    if (!robotsAllows(rules, u.pathname + u.search)) { r.robots = true; if (!r.pages.length) return r; continue; }
    let page;
    try { page = await getPage(next); } catch (e) { r.error = e.name === 'TimeoutError' ? 'timeout' : (e.cause?.code || e.message); break; }
    r.pages.push(next);
    r.http = page.status;
    if (!page.html) { if (!r.error) r.error = page.notHtml ? 'not html' : `http ${page.status}`; break; }
    delete r.error;
    if (page.finalUrl && page.finalUrl !== next) r.finalUrl = page.finalUrl;
    const f = pageFacts(page.html);
    if (wantPhone && f.phones.has(wantPhone)) r.phone = true;
    if (addressOnPage(needle, f.addrText)) r.address = true;
    for (const o of f.ld) {
      if (!r.hours) r.hours = hoursFromLd(o);
      if (!r.ldPhone && o.telephone) r.ldPhone = phoneDigits(o.telephone);
      const a = [].concat(o.address || [])[0];
      if (!r.ldStreet && a && typeof a === 'object' && a.streetAddress) r.ldStreet = String(a.streetAddress).slice(0, 120);
    }
    if (r.phone && r.address) break;
    // try a contact or location page on the same site
    const base = new URL(page.finalUrl || next);
    for (const l of f.links) {
      if (!/contact|location|visit|find[\s-]?us|directions|hours|store|office/.test(l.label + ' ' + l.href)) continue;
      let abs;
      try { abs = new URL(l.href, base); } catch { continue; }
      if (abs.origin !== base.origin || !/^https?:$/.test(abs.protocol) || /\.(pdf|jpe?g|png|gif|webp|zip)$/i.test(abs.pathname)) continue;
      abs.hash = '';
      if (!seen.has(abs.href) && !queue.includes(abs.href)) queue.push(abs.href);
      if (queue.length >= 4) break;
    }
    if (queue.length) await sleep(PER_HOST_GAP_MS);
  }
  return r;
}

let done = 0;
const hosts = [...byHost.keys()];
async function worker() {
  while (hosts.length) {
    const h = hosts.shift();
    for (const c of byHost.get(h)) {
      results[c.id] = await checkOne(c);
      done++;
      if (done % 25 === 0) { console.log(`${done}/${todo.length}`); fs.writeFileSync(OUT, JSON.stringify(results, null, 1) + '\n'); }
      await sleep(PER_HOST_GAP_MS);
    }
  }
}
await Promise.all(Array.from({ length: CONCURRENCY }, worker));
fs.writeFileSync(OUT, JSON.stringify(results, null, 1) + '\n');

const all = Object.values(results);
const both = all.filter(r => r.phone && r.address).length, one = all.filter(r => (r.phone || r.address) && !(r.phone && r.address)).length;
const robots = all.filter(r => r.robots && !r.phone && !r.address).length, errors = all.filter(r => r.error && !r.phone && !r.address).length;
console.log(`done: ${all.length} checked; phone and address confirmed ${both}; one of them ${one}; robots.txt said no ${robots}; unreachable or blocked ${errors}; hours found ${all.filter(r => r.hours).length}`);
