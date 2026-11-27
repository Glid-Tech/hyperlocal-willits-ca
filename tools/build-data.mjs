#!/usr/bin/env node
// Build the directory dataset (CONFIG.siteName in assets/js/config.js, e.g. "Willits Local").
//
//   node tools/build-data.mjs candidates   # merge sources -> data/sources/candidates.json
//   node tools/build-data.mjs final        # candidates + verification + overrides -> data/businesses.json
//
// Working files (all under data/sources/; only osm.json and geocode-cache.json are published):
//   osm.json                    OpenStreetMap snapshot (tools/fetch-osm.mjs)
//   research/*.json             tips about which businesses exist (one JSON array per file)
//   firstparty.json             facts confirmed on each business's own website (tools/check-firstparty.mjs)
//   confirmed/*.json            facts confirmed by hand from allowed sources, with a source for each fact
//   geocode-cache.json          coordinates for addresses (tools/geocode.mjs)
// Manual fixes live in data/overrides.json (see README).
//
// Only facts backed by OpenStreetMap, the business's own website or a government record are
// published, and descriptions are always written from those facts (data/SOURCES.md).

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fromOsm } from './lib/osm-map.mjs';
import { prettyStreet, extractUnit, formatPhone, cleanUrl, slugify, nameSimilarity, sharesIdentifyingWord, nameKey, addressKey, haversine, uniq } from './lib/common.mjs';
import { normalizeHours, TIME_ZONE } from '../assets/js/hours.js';
import { holidayClosure } from './lib/holidays.mjs';
import { CATEGORY_BY_ID, CATEGORIES } from '../assets/js/taxonomy.js';
import { CONFIG } from '../assets/js/config.js';
import { classifySource, isOwnWebsite, SOURCE_KINDS, siteKey, hostOf } from './lib/source-policy.mjs';
import { buildOffline } from './build-offline.mjs';
import { describe as describeFrom } from './lib/describe.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'data/sources');
const readJson = (p, fallback) => (fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : fallback);
const writeJson = (p, v, pretty = true) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, JSON.stringify(v, null, pretty ? 1 : 0) + '\n'); };
const listJson = dir => (fs.existsSync(dir) ? fs.readdirSync(dir).filter(f => f.endsWith('.json')).sort().map(f => path.join(dir, f)) : []);
const TODAY = process.env.BUILD_DATE || new Intl.DateTimeFormat('en-CA', { timeZone: TIME_ZONE }).format(new Date()); // the town's date
// Only listings in the town's ZIP codes are published (CONFIG.zips in assets/js/config.js).
const inScopeZip = zip => CONFIG.zips.includes(String(zip || '').slice(0, 5));
// "Willits", "WILLITS" and "Brooktrails" all name the town (CONFIG.placeNames; Brooktrails shares ZIP 95490).
const townKey = s => String(s || '').toLowerCase().replace(/[^a-z]/g, '');
const TOWN_KEYS = new Set((CONFIG.placeNames || [CONFIG.town]).map(townKey));

const AREAS = readJson(path.join(ROOT, 'data/areas.json'), []);

// ----------------------------------------------------------------------------- inputs

function loadOsm() {
  const snap = readJson(path.join(SRC, 'osm.json'), { elements: [] });
  const out = [];
  for (const el of snap.elements) {
    const r = fromOsm(el);
    if (!r) continue;
    // Outside the city limits we only keep places whose address names the town or one of its ZIP codes.
    const townAddr = TOWN_KEYS.has(townKey(r.city)) || inScopeZip(r.zip);
    if (!r.inCity && !townAddr) continue;
    out.push(r);
  }
  return out;
}

const RESEARCH_STATUS = new Set(['open', 'coming_soon', 'closed', 'relocated', 'uncertain']);

const fileDate = f => { try { return fs.statSync(f).mtime.toISOString().slice(0, 10); } catch { return TODAY; } };

function fromResearch(rec, file) {
  if (!rec || !rec.name || !CATEGORY_BY_ID[rec.category]) return null;
  const status = RESEARCH_STATUS.has(rec.status) ? rec.status : 'uncertain';
  const addr = rec.address_public === false ? '' : rec.address || '';
  return {
    source: 'research',
    file: path.basename(file),
    name: String(rec.name).trim(),
    category: rec.category,
    sub: String(rec.subcategory || '').trim(),
    tags: uniq((rec.tags || []).map(t => String(t).toLowerCase().trim())),
    address: prettyStreet(addr),
    unit: rec.suite ? String(rec.suite).replace(/^(ste\.?|suite|unit|#)\s*/i, 'Suite ') : extractUnit(addr),
    zip: String(rec.zip || '').slice(0, 5),
    center: String(rec.shopping_center || '').trim(),
    phone: formatPhone(rec.phone),
    website: cleanUrl(rec.website),
    hours: normalizeHours(rec.hours) || '',
    hoursRaw: rec.hours || '',
    hoursSource: rec.hours_source || '',
    status,
    statusEvidence: rec.status_evidence || '',
    sources: uniq(rec.sources || []),
    chain: !!rec.chain,
    notes: rec.notes || '',
    addressPublic: rec.address_public !== false,
    // The OpenStreetMap entry the researcher matched this record to, if any ("node/123"): it joins this listing.
    osmRef: /^(node|way|relation)\/\d+$/.test(rec.osm || '') ? rec.osm : '',
    checked: fileDate(file),
  };
}

function loadResearch() {
  const out = [];
  for (const f of listJson(path.join(SRC, 'research'))) {
    let arr;
    try { arr = readJson(f, []); } catch (e) { console.warn(`! skipping ${path.basename(f)}: ${e.message}`); continue; }
    if (!Array.isArray(arr)) continue;
    for (const rec of arr) { const r = fromResearch(rec, f); if (r) out.push(r); }
  }
  return out;
}

// ----------------------------------------------------------------------------- clustering

function sameBusiness(a, b) {
  const ak = addressKey(a.address), bk = addressKey(b.address);
  const sim = nameSimilarity(a.name, b.name);
  // Many businesses share an address (a shopping center or office building has one street number), so a partial
  // name match has to rest on a word that names the business, not on "Corner", "Center", "Bank" or "Factory".
  const named = min => sim >= 0.85 || (sim >= min && sharesIdentifyingWord(a.name, b.name));
  if (ak && bk) {
    if (ak === bk) return named(0.5);
    // Same street number on the same street with a minor spelling difference.
    const [an, ...as] = ak.split(' '), [bn, ...bs] = bk.split(' ');
    if (an === bn && as[0] && as[0] === bs[0]) return named(0.6);
    return false;
  }
  if (a.lat && b.lat && haversine(a.lat, a.lon, b.lat, b.lon) < 120) return named(0.7);
  return sim >= 0.9;
}

function cluster(records) {
  const clusters = [];
  const byKey = new Map(); // first name token -> clusters (cheap pre-filter)
  for (const r of records) {
    const k = nameKey(r.name).split(' ')[0] || r.name.toLowerCase();
    const pool = [...(byKey.get(k) || []), ...clusters.filter(c => c.addrKeys.has(addressKey(r.address)) && addressKey(r.address))];
    let target = null;
    const matches = new Set();
    const rk = addressKey(r.address);
    // An OpenStreetMap entry that a researcher matched to their record belongs with it, whatever each calls the place.
    const linked = r.osmId && clusters.find(c => c.members.some(m => m.osmRef === r.osmId));
    if (linked) matches.add(linked);
    else for (const c of pool) {
      if (!c.members.some(m => sameBusiness(m, r))) continue;
      // A chain's locations share a name. A record that matches only an entry with no address must not join a
      // cluster that is already at a different address (one chain store isn't its sister store across town).
      if (rk && c.addrKeys.size && !c.addrKeys.has(rk) && !c.members.some(m => addressKey(m.address) && sameBusiness(m, r))) continue;
      matches.add(c);
    }
    if (matches.size === 1) target = [...matches][0];
    else if (matches.size > 1) {
      // Prefer the cluster that shares an address with this record.
      target = [...matches].find(c => c.addrKeys.has(addressKey(r.address))) || [...matches][0];
    }
    if (!target) {
      target = { members: [], addrKeys: new Set() };
      clusters.push(target);
    }
    target.members.push(r);
    if (addressKey(r.address)) target.addrKeys.add(addressKey(r.address));
    if (!byKey.has(k)) byKey.set(k, []);
    if (!byKey.get(k).includes(target)) byKey.get(k).push(target);
  }
  return clusters;
}

const SOURCE_RANK = { verified: 3, research: 2, osm: 1 };

function mergeCluster(c) {
  const ms = [...c.members].sort((a, b) => SOURCE_RANK[b.source] - SOURCE_RANK[a.source]);
  const first = (field, pred = v => !!v) => { for (const m of ms) if (pred(m[field])) return m[field]; return ''; };
  const research = ms.filter(m => m.source === 'research');
  // Status: any explicit closure/relocation report wins over silence; open beats uncertain.
  const statuses = research.map(m => m.status);
  let status = 'unverified';
  const gone = statuses.includes('closed') || statuses.includes('relocated');
  // Researchers disagree (one found it open, another closed): send it to verification.
  if (gone && statuses.includes('open')) status = 'uncertain';
  else if (statuses.includes('closed')) status = 'closed';
  else if (statuses.includes('relocated')) status = 'relocated';
  else if (statuses.includes('open')) status = 'open';
  else if (statuses.includes('coming_soon')) status = 'coming_soon';
  else if (statuses.includes('uncertain')) status = 'uncertain';
  // Prefer the most common category among research members, else OSM's.
  const catVotes = {};
  for (const m of ms) catVotes[m.category] = (catVotes[m.category] || 0) + SOURCE_RANK[m.source];
  const category = Object.entries(catVotes).sort((a, b) => b[1] - a[1])[0][0];
  const osm = ms.find(m => m.source === 'osm');
  const hoursFrom = ms.find(m => m.hours);
  return {
    name: first('name'),
    category,
    sub: first('sub', v => !!v && !/^(restaurant|fast casual)$/i.test(v)) || first('sub'),
    tags: uniq(ms.flatMap(m => m.tags || [])).slice(0, 24),
    address: first('address'),
    unit: first('unit'),
    zip: first('zip', v => inScopeZip(v)) || first('zip'),
    center: first('center'),
    phone: first('phone'),
    website: first('website'),
    hours: hoursFrom?.hours || '',
    hoursSource: hoursFrom ? (hoursFrom.source === 'osm' ? `https://www.openstreetmap.org/${hoursFrom.osmId}` : hoursFrom.hoursSource || '') : '',
    lat: osm?.lat ?? null,
    lon: osm?.lon ?? null,
    status,
    statusEvidence: uniq(research.map(m => m.statusEvidence)).join(' | '),
    statusVotes: statuses.reduce((o, v) => ({ ...o, [v]: (o[v] || 0) + 1 }), {}),
    chain: ms.some(m => m.chain),
    osmId: osm?.osmId || '',
    inCity: !!osm?.inCity,
    sources: uniq(ms.flatMap(m => m.sources || [])),
    notes: uniq(research.map(m => m.notes)).join(' | '),
    foundBy: uniq(ms.map(m => (m.source === 'research' ? m.file.replace(/\.json$/, '') : m.source))),
    checked: research.map(m => m.checked).filter(Boolean).sort().pop() || '',
  };
}

function assignIds(records) {
  const used = new Map();
  for (const r of records) {
    const num = (r.address.match(/^\d+/) || [''])[0];
    let base = slugify(r.name) || 'business';
    if (num) base += '-' + num;
    let id = base, n = 2;
    while (used.has(id)) id = `${base}-${n++}`;
    used.set(id, true);
    r.id = id;
  }
}

// ----------------------------------------------------------------------------- geography

const cacheIndexes = new WeakMap();
const cacheIndex = cache => {
  if (!cacheIndexes.has(cache)) cacheIndexes.set(cache, new Map(Object.entries(cache).map(([k, v]) => [k.toLowerCase(), v])));
  return cacheIndexes.get(cache);
};
// Stores inside an enclosed mall sometimes give the mall's own store numbering ("12 Example Mall"), which no geocoder
// knows. List such malls here so their stores share the mall's map point. None are listed for Willits yet.
// Example: { name: 'Example Mall', street: /\bExample Mall$/i, address: '100 Main Street', zip: '95490' }
const MALLS = [];
function mallPoint(r, cache) {
  const mall = MALLS.find(m => m.street.test(prettyStreet(r.address)));
  if (!mall) return;
  if (!r.center) r.center = mall.name;
  if (!r.zip) r.zip = mall.zip;
  if (r.lat && r.lon) return;
  const hit = cacheIndex(cache).get(`${mall.address}|${mall.zip}`.toLowerCase());
  if (hit?.lat) { r.lat = hit.lat; r.lon = hit.lon; r.geocoded = 'mall'; }
}

function geocodeFromCache(r, cache) {
  if (r.address) mallPoint(r, cache);
  if (r.lat && r.lon) return;
  if (!r.address) return;
  const addr = prettyStreet(r.address);
  const lc = cacheIndex(cache);
  const hit = lc.get(`${addr}|${r.zip || ''}`.toLowerCase()) || lc.get(`${addr}|`.toLowerCase());
  if (hit && hit.lat) { r.lat = hit.lat; r.lon = hit.lon; r.geocoded = hit.source || 'census'; }
}

function streetParts(address) {
  const m = String(address || '').toLowerCase().replace(/\./g, '').match(/^(\d+)[a-z]?(?:-\d+)?\s+(.+)$/);
  if (!m) return null;
  return { num: Number(m[1]), street: m[2].replace(/\s+/g, ' ').trim() };
}

// Address rules first (most reliable), then coordinates: an area's box, then the circle the
// point sits most centrally in. Rules from the geography research (notes/research).
function assignArea(r) {
  const sp = streetParts(r.address);
  if (sp) {
    for (const a of AREAS) {
      if (!a.streets || (a.zip && r.zip && r.zip !== a.zip)) continue;
      for (const [street, lo, hi] of a.streets) {
        if (sp.street !== street) continue;
        if (lo === undefined || (sp.num >= lo && sp.num <= hi)) return a.id;
      }
    }
  }
  if (!r.lat) return 'elsewhere';
  for (const a of AREAS) {
    if (!a.bbox) continue;
    const [s, w, n, e] = a.bbox;
    if (r.lat >= s && r.lat <= n && r.lon >= w && r.lon <= e) return a.id;
  }
  let best = null;
  for (const a of AREAS) {
    if (!a.lat || !a.radius_m) continue;
    const d = haversine(r.lat, r.lon, a.lat, a.lon);
    if (d <= a.radius_m && (!best || d / a.radius_m < best.score)) best = { id: a.id, score: d / a.radius_m };
  }
  return best ? best.id : 'elsewhere';
}

// Our own one-line description, built only from published facts (never copied from anywhere).
const describe = r => describeFrom(r, AREAS);

// ----------------------------------------------------------------------------- stages

function stageCandidates() {
  const osm = loadOsm();
  const research = loadResearch();
  console.log(`inputs: osm=${osm.length} research=${research.length}`);
  const clusters = cluster([...research, ...osm]);
  const merged = clusters.map(mergeCluster);
  merged.sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name));
  assignIds(merged);
  const cache = readJson(path.join(SRC, 'geocode-cache.json'), {});
  for (const r of merged) geocodeFromCache(r, cache);
  supersedeStale(merged);
  writeJson(path.join(SRC, 'candidates.json'), { built: TODAY, count: merged.length, candidates: merged });
  const by = {};
  for (const r of merged) by[r.status] = (by[r.status] || 0) + 1;
  console.log(`candidates: ${merged.length}`, by);
}

// An OpenStreetMap-only entry ('unverified') that matches a researched, current entry of the same
// kind nearby is an old copy of it (an old address, or a mall store number), so retire it.
function supersedeStale(list) {
  const digits = v => String(v || '').replace(/\D/g, '');
  const fresh = list.filter(r => (r.status === 'open' || r.status === 'coming_soon') && r.foundBy.some(f => f !== 'osm'));
  let n = 0;
  for (const r of list) {
    if (r.status !== 'unverified') continue;
    const hit = fresh.find(f => f.category === r.category && (
      (nameSimilarity(f.name, r.name) >= 0.85 && (!r.lat || !f.lat || haversine(r.lat, r.lon, f.lat, f.lon) <= 800)) ||
      (r.phone && digits(r.phone) === digits(f.phone) && nameSimilarity(f.name, r.name) >= 0.5)));
    if (hit) { r.status = 'duplicate'; r.duplicateOf = hit.id; n++; }
  }
  console.log(`retired ${n} stale OpenStreetMap copies of researched listings`);
}

// ----------------------------------------------------------------------------- confirmation

// Facts confirmed by hand (or by a research agent) from allowed sources: one JSON array per file in
// data/sources/confirmed/, each item { id, verdict, facts: { field: { value, source } }, checked }.
// Hand checks from data/sources/confirmed/ (see data/sources/README.md), with two safety rules:
// - "not_confirmed" means the checker couldn't confirm the place, not that it closed, so it's ignored and the
//   listing depends on the automatic website check as before.
// - A "duplicate" must point at a different listing (its id, or the same name at the same street number).
//   Checkers sometimes report a listing as a duplicate of itself; that counts as confirming it, provided they
//   recorded facts, and as no check at all otherwise.
function loadConfirmations(candidates = []) {
  const out = new Map();
  const ids = new Set(candidates.map(c => c.id));
  const norm = t => String(t || '').toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]/g, '');
  const num = c => (String(c?.address || '').match(/^\d+/) || [''])[0];
  const byId = new Map(candidates.map(c => [c.id, c]));
  for (const f of listJson(path.join(SRC, 'confirmed'))) {
    for (const raw of readJson(f, [])) {
      if (!raw?.id || raw.verdict === 'not_confirmed') continue;
      let v = { ...raw, file: path.basename(f) };
      if (v.verdict === 'duplicate') {
        const me = byId.get(v.id);
        const target = (v.duplicateOf !== v.id && ids.has(v.duplicateOf) && v.duplicateOf)
          || candidates.find(c => c.id !== v.id && norm(c.name) === norm(v.duplicateOf) && num(c) && num(c) === num(me))?.id;
        if (target) v.duplicateOf = target;
        else if (Object.keys(v.facts || {}).length) v = { ...v, verdict: 'open', duplicateOf: null };
        else continue;
      }
      if (['open', 'coming_soon'].includes(v.verdict) && !Object.keys(v.facts || {}).length) continue;
      // A later file can add facts to a listing an earlier file confirmed; a later verdict replaces an earlier one.
      const prev = out.get(v.id);
      const live = x => ['open', 'coming_soon'].includes(x?.verdict);
      if (live(prev) && live(v)) v = { ...v, facts: { ...prev.facts, ...v.facts }, ignore: [...new Set([...(prev.ignore || []), ...(v.ignore || [])])] };
      out.set(v.id, v);
    }
  }
  return out;
}

const PUBLIC_FACTS = ['name', 'address', 'unit', 'zip', 'center', 'phone', 'website', 'hours', 'opened'];
const osmUrl = id => (id ? `https://www.openstreetmap.org/${id}` : '');
// Listings whose website hours were left out because they were read in a holiday week (see lib/holidays.mjs).
const holidayHours = [];
const DROP_REASON = { closed: 'closed', relocated: 'closed', duplicate: 'duplicate', out_of_scope: 'outOfScope', not_confirmed: 'notConfirmed' };

/**
 * The facts we may publish for one candidate, each backed by an allowed source.
 * Returns { facts, status, verified } or { drop: reason }.
 */
function confirmFacts(c, { osmById, fp, conf }) {
  const facts = {};
  const put = (k, value, source, kind) => { if (value && source && !facts[k]) facts[k] = { value: String(value).trim(), source, kind }; };
  const ownSite = u => (u && isOwnWebsite(u, c.name) ? cleanUrl(u) : '');
  // A checker can mark the website or OpenStreetMap entry on file as belonging to another business.
  const ignore = new Set(conf?.ignore || []);
  const siteOnFile = ignore.has('website') ? '' : ownSite(c.website);

  // 1. Confirmed by hand from allowed sources. Any fact whose source isn't allowed is ignored.
  if (conf) {
    if (!['open', 'coming_soon'].includes(conf.verdict)) return { drop: DROP_REASON[conf.verdict] || 'notConfirmed' };
    const site = ownSite(conf.facts?.website?.value) || siteOnFile;
    for (const k of PUBLIC_FACTS) {
      const f = conf.facts?.[k];
      if (!f?.value || !f.source) continue;
      const kind = classifySource(f.source, { website: site, name: c.name });
      if (!SOURCE_KINDS.includes(kind)) continue;
      if (k === 'website' && !ownSite(f.value)) continue;
      if (k === 'hours' && kind === 'first' && holidayClosure(normalizeHours(f.value), conf.checked)) { holidayHours.push(c.id); continue; }
      put(k, k === 'website' ? ownSite(f.value) : f.value, f.source, kind);
    }
  }
  // 2. The business's own website, checked automatically (tools/check-firstparty.mjs). When the
  // business's domain forwards to another domain, both the phone and the address must match there,
  // and we cite the business's own address that we asked for.
  // The check must be of the website on file now: a record split from another business may have changed website.
  if (fp?.url && siteKey(hostOf(fp.url)) !== siteKey(hostOf(c.website))) fp = null;
  const movedSite = !!(fp?.finalUrl && siteKey(hostOf(fp.finalUrl)) !== siteKey(hostOf(c.website)));
  const fpOk = !!(fp && fp.http === 200 && siteOnFile && (movedSite ? fp.phone && fp.address : fp.phone || fp.address));
  if (fpOk) {
    const page = movedSite ? fp.url : fp.finalUrl || fp.url;
    put('website', ownSite(c.website), page, 'first');
    put('name', c.name, page, 'first');
    if (fp.phone) put('phone', c.phone, page, 'first');
    else if (fp.ldPhone && /^\d{10}$/.test(fp.ldPhone)) put('phone', fp.ldPhone, page, 'first');
    if (fp.address) for (const k of ['address', 'unit', 'zip', 'center']) put(k, c[k], page, 'first');
    if (fp.hours && holidayClosure(fp.hours, fp.checked)) holidayHours.push(c.id);
    else if (fp.hours) put('hours', fp.hours, page, 'first');
  }
  // 3. OpenStreetMap, used under the Open Database License.
  const o = c.osmId && !ignore.has('osm') ? osmById.get(c.osmId) : null;
  if (o && (conf || fpOk)) {
    const src = osmUrl(c.osmId);
    for (const k of ['name', 'address', 'unit', 'zip', 'phone', 'hours']) put(k, o[k], src, 'osm');
    if (ownSite(o.website)) put('website', ownSite(o.website), src, 'osm');
  }
  // 4. Hours a researcher took from the business's own page or from OpenStreetMap.
  if ((conf || fpOk) && c.hours && c.hoursSource) {
    const kind = classifySource(c.hoursSource, { website: ownSite(conf?.facts?.website?.value) || siteOnFile, name: c.name });
    if (SOURCE_KINDS.includes(kind)) put('hours', c.hours, c.hoursSource, kind);
  }
  // A fact confirmed on the business's own site tells us its website, even when the home page itself couldn't
  // be read. Publish it, so readers can see the facts came from the business.
  // Only a fact that places the business (its phone, address or hours) counts; its name or shopping centre alone
  // could be on any page of a chain's site.
  const firstHand = ['phone', 'address', 'hours'].map(k => facts[k]).find(f => f?.kind === 'first');
  if (!facts.website && firstHand) {
    const site = ownSite(conf?.facts?.website?.value) || siteOnFile;
    if (site && siteKey(hostOf(site)) === siteKey(hostOf(firstHand.source))) put('website', site, firstHand.source, 'first');
  }
  if (!conf && !fpOk) return { drop: 'notConfirmed' };
  const status = conf ? conf.verdict : c.status === 'coming_soon' ? 'coming_soon' : 'open';
  if (!conf && !['open', 'coming_soon'].includes(c.status)) return { drop: 'notConfirmed' };
  const verified = [conf?.checked, fpOk ? fp.checked : ''].filter(Boolean).sort().pop() || TODAY;
  return { facts, status, verified };
}

function stageFinal() {
  const overrides = readJson(path.join(ROOT, 'data/overrides.json'), { remove: [], patch: {}, add: [] });
  const cache = readJson(path.join(SRC, 'geocode-cache.json'), {});
  // The working files in data/sources/ stay on the maintainer's computer (see data/sources/README.md). Without
  // them, for example in a fresh copy of the repository, apply the hand fixes to the published listings instead
  // of starting from nothing.
  if (!fs.existsSync(path.join(SRC, 'candidates.json'))) return republish(overrides, cache);
  const { candidates } = readJson(path.join(SRC, 'candidates.json'), { candidates: [] });
  const confirmations = loadConfirmations(candidates);
  const firstParty = readJson(path.join(SRC, 'firstparty.json'), {});
  const osmById = new Map(loadOsm().filter(o => o.osmId).map(o => [o.osmId, o]));
  const out = [];
  const comingSoon = [];
  const dropped = { closed: 0, notConfirmed: 0, duplicate: 0, outOfScope: 0, removed: 0, noContact: 0 };
  const thin = { noAddress: 0, noPhone: 0, noHours: 0 };

  for (const c of candidates) {
    const conf = confirmations.get(c.id);
    if (!conf && !['open', 'coming_soon'].includes(c.status)) { dropped[c.status === 'duplicate' ? 'duplicate' : c.status === 'closed' || c.status === 'relocated' ? 'closed' : 'notConfirmed']++; continue; }
    const res = confirmFacts(c, { osmById, fp: firstParty[c.id], conf });
    if (res.drop) { dropped[res.drop] = (dropped[res.drop] || 0) + 1; continue; }
    const f = k => res.facts[k]?.value || '';
    const r = {
      id: c.id, category: CATEGORY_BY_ID[conf?.category] ? conf.category : c.category, sub: c.sub, tags: c.tags, chain: c.chain,
      name: displayName(f('name'), c.name), address: f('address'), unit: f('unit'), zip: f('zip'), center: f('center'),
      phone: f('phone'), website: f('website'), hours: f('hours'),
      opened: /^\d{4}-\d{2}$/.test(f('opened')) && f('opened') <= TODAY.slice(0, 7) ? f('opened') : '',
      status: res.status, verified: res.verified,
      sources: uniq(Object.values(res.facts).map(x => x.source)),
      lat: null, lon: null,
    };
    // Small licensed residential care homes (four to six beds) are private houses: the state licence, often the only
    // record, gives a home address and the licensee's own phone, so a public directory leaves them out. Rule, not
    // ids, so the published files never name them.
    if (/^residential care home\b/i.test(r.sub || '')) { dropped.removed++; continue; }
    if (overrides.remove?.includes(r.id)) { dropped.removed++; continue; }
    if (overrides.patch?.[r.id]) applyPatch(r, overrides.patch[r.id]);
    tidy(r);
    if (r.zip && !inScopeZip(r.zip)) { dropped.outOfScope++; continue; }
    if (!r.address && !r.phone && !r.website) { dropped.noContact++; continue; }
    // Coordinates: OpenStreetMap's point when the address is the same, otherwise the geocoded address.
    const o = c.osmId && !conf?.ignore?.includes('osm') ? osmById.get(c.osmId) : null;
    if (o?.lat && (!r.address || prettyStreet(o.address) === r.address || (c.lat && prettyStreet(c.address) === r.address))) { r.lat = o.lat; r.lon = o.lon; }
    else if (c.lat && prettyStreet(c.address) === r.address && c.geocoded) { r.lat = c.lat; r.lon = c.lon; }
    geocodeFromCache(r, cache);
    if (!r.address) thin.noAddress++;
    if (!r.phone) thin.noPhone++;
    if (!r.hours) thin.noHours++;
    r.area = assignArea(r);
    r.desc = describe(r);
    const rec = publicRecord(r);
    if (r.status === 'coming_soon') comingSoon.push(rec); else out.push(rec);
  }
  console.log('published listings missing a confirmed', thin);
  if (holidayHours.length) console.log(`website hours left out because they were read in a holiday week (check again after it): ${[...new Set(holidayHours)].join(', ')}`);
  addListings(out, comingSoon, overrides, cache);
  publish(out, comingSoon, dropped);
}

// Rebuild from data/businesses.json plus data/overrides.json (no working files needed).
function republish(overrides, cache) {
  const prev = readJson(path.join(ROOT, 'data/businesses.json'), null);
  if (!prev?.businesses?.length) throw new Error('data/sources/candidates.json is missing and there are no published listings to start from.');
  console.log('No working files in data/sources/, so applying data/overrides.json to the published listings.');
  const dropped = { removed: 0 };
  const redo = list => list.filter(b => !(overrides.remove?.includes(b.id) && ++dropped.removed)).map(b => {
    const r = { ...b };
    const patch = overrides.patch?.[b.id];
    if (patch) {
      const before = r.address;
      applyPatch(r, patch);
      tidy(r);
      if (r.address !== before && !(patch.lat && patch.lon)) { r.lat = null; r.lon = null; }
      geocodeFromCache(r, cache);
      if (r.address && !r.lat) console.warn(`! ${r.id}: the new address isn't in the map cache yet. Run node tools/geocode.mjs, or add "lat" and "lon" to the patch.`);
      r.area = patch.area || assignArea(r);
    }
    r.desc = describe(r);
    return publicRecord(r);
  });
  const out = redo(prev.businesses);
  const comingSoon = redo(prev.comingSoon || []);
  addListings(out, comingSoon, overrides, cache);
  publish(out, comingSoon, dropped);
}

// Government lists often give names in capitals ("KEMMYS PIES"). When the researched name says the same words in
// ordinary case ("Kemmy's Pies"), show that one; the record still confirms it.
function displayName(confirmed, researched) {
  if (!confirmed) return researched;
  if (/[a-z]/.test(confirmed) || !researched || !/[a-z]/.test(researched)) return confirmed;
  const words = s => String(s).toLowerCase().replace(/['’]/g, '').split(/[^a-z0-9]+/).filter(Boolean);
  const have = new Set(words(confirmed));
  return words(researched).every(w => have.has(w)) ? researched : confirmed;
}

// A hand fix from data/overrides.json. Any new sources are added to the old ones, and only allowed kinds count.
function applyPatch(r, patch) {
  const sources = r.sources || [];
  Object.assign(r, patch);
  r.sources = uniq([...sources, ...(patch.sources || [])]).filter(u => SOURCE_KINDS.includes(classifySource(u, { website: r.website, name: r.name })));
}

function tidy(r) {
  r.address = prettyStreet(r.address || '');
  r.unit = r.unit ? String(r.unit).replace(/^(ste\.?|suite|unit|#)\s*/i, 'Suite ') : '';
  r.zip = String(r.zip || '').slice(0, 5);
  r.phone = formatPhone(r.phone);
  r.website = cleanUrl(r.website);
  r.hours = normalizeHours(r.hours) || '';
}

// Hand-added listings follow the same rules as the rest: facts from the business itself, OpenStreetMap or a
// government record, and a description written from those facts.
function addListings(out, comingSoon, overrides, cache) {
  for (const add of overrides.add || []) {
    if (!add?.name || !CATEGORY_BY_ID[add.category]) { console.warn(`! skipping an added listing without a name or known category: ${add?.name || '?'}`); continue; }
    const r = { ...add };
    tidy(r);
    r.id = add.id || `${slugify(r.name)}${(r.address.match(/^\d+/) || [''])[0] ? '-' + r.address.match(/^\d+/)[0] : ''}`;
    r.sources = uniq(add.sources || []).filter(u => SOURCE_KINDS.includes(classifySource(u, { website: r.website, name: r.name })));
    if (!r.sources.length && r.website && isOwnWebsite(r.website, r.name)) r.sources = [r.website];
    if (!r.sources.length) { console.warn(`! skipping ${r.name}: add its own website, its OpenStreetMap page or a government record to "sources" (see data/SOURCES.md)`); continue; }
    if (r.zip && !inScopeZip(r.zip)) { console.warn(`! skipping ${r.name}: ZIP ${r.zip} is outside ${CONFIG.town} (${CONFIG.zips.join(', ')})`); continue; }
    r.status = add.status === 'coming_soon' ? 'coming_soon' : 'open';
    r.verified = add.verified || TODAY;
    geocodeFromCache(r, cache);
    r.area = add.area || assignArea(r);
    r.desc = describe(r);
    const rec = publicRecord(r);
    for (const list of [out, comingSoon]) { const at = list.findIndex(x => x.id === rec.id); if (at >= 0) list.splice(at, 1); }
    (rec.status === 'coming_soon' ? comingSoon : out).push(rec);
  }
}

function publish(out, comingSoon, dropped) {
  out.sort((a, b) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }));
  const data = {
    meta: {
      title: CONFIG.siteName,
      built: TODAY,
      count: out.length,
      verifiedCount: out.filter(r => r.verified).length,
      license: 'Listing data: Open Database License (ODbL) 1.0. Includes data from OpenStreetMap, (c) OpenStreetMap contributors.',
    },
    areas: AREAS.map(({ id, name, blurb, lat, lon }) => ({ id, name, blurb, lat, lon, count: out.filter(r => r.area === id).length })),
    businesses: out,
    comingSoon,
  };
  writeJson(path.join(ROOT, 'data/businesses.json'), data, false);
  writeDirectoryHtml(data);
  writeSitemap(data);
  buildOffline(); // the saved offline copy must include the new listings
  console.log(`published ${out.length} businesses (+${comingSoon.length} coming soon)`, dropped);
  const byCat = {};
  for (const r of out) byCat[r.category] = (byCat[r.category] || 0) + 1;
  console.log(byCat);
}

function publicRecord(r) {
  const rec = {
    id: r.id, name: r.name, category: r.category, sub: r.sub || CATEGORY_BY_ID[r.category]?.short || '',
    tags: uniq(r.tags || []).slice(0, 24), desc: r.desc || '',
    address: r.address || '', unit: r.unit || '', zip: r.zip || '', center: r.center || '', area: r.area || 'elsewhere',
    lat: r.lat ? +(+r.lat).toFixed(6) : null, lon: r.lon ? +(+r.lon).toFixed(6) : null,
    phone: r.phone || '', website: r.website || '', hours: r.hours || '',
    status: r.status === 'open' || r.status === 'unverified' ? 'open' : r.status,
    verified: r.verified || null, sources: (r.sources || []).slice(0, 6),
  };
  if (r.opened) rec.opened = r.opened;
  if (r.chain) rec.chain = true;
  return rec;
}

// ----------------------------------------------------------------------------- static outputs

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function writeDirectoryHtml(data) {
  const byName = (a, b) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base' });
  const byCat = CATEGORIES.map(c => ({ c, items: data.businesses.filter(b => b.category === c.id).sort(byName) })).filter(g => g.items.length);
  const updated = new Date(data.meta.built + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
  // The web address itself is the link text, so it still makes sense on paper and in a screen reader's list of links.
  const siteLabel = url => { try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return 'Website'; } };
  const item = b => `<li class="biz" id="b-${esc(b.id)}"><h3>${esc(b.name)}</h3> <span class="muted">${esc(b.sub)}${b.status === 'coming_soon' ? ' &middot; opening soon' : ''}</span>
<div>${esc([b.address, b.unit].filter(Boolean).join(', '))}${b.address ? `, ${esc(CONFIG.town)}, ${esc(CONFIG.state)} ${esc(b.zip)}` : ''}${b.center && !String(b.unit || '').includes(b.center) ? ` <span class="muted">(${esc(b.center)})</span>` : ''}</div>
<div>${b.phone ? `<a href="tel:+1${b.phone.replace(/\D/g, '')}">${esc(b.phone)}</a>` : ''}${b.phone && b.website ? ' &middot; ' : ''}${b.website ? `<a href="${esc(b.website)}" rel="noopener">${esc(siteLabel(b.website))}</a>` : ''}</div></li>`;
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(CONFIG.siteName)}: printable list of all our listings</title>
<meta name="description" content="A plain, printable list of ${data.businesses.length} local businesses in ${esc(CONFIG.town)}, California, grouped by kind of business, with phone numbers and addresses.">
<link rel="canonical" href="${esc((CONFIG.siteUrl || '') + 'directory.html')}">
<style>
  :root { color-scheme: light dark; --ink:#1b1f1d; --muted:#4d5651; --line:#d9d6cc; --bg:#fbf9f4; --link:#1d5a43; }
  @media (prefers-color-scheme: dark) { :root { --ink:#ecebe6; --muted:#b9bdb8; --line:#3a403c; --bg:#111613; --link:#8fd3b2; } }
  body { margin:0; background:var(--bg); color:var(--ink); font:1.125rem/1.6 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
  main { max-width: 52rem; margin: 0 auto; padding: 1.5rem 1rem 4rem; }
  h1 { font-size: 2rem; line-height: 1.2; margin: .5rem 0; } h2 { margin-top: 2.5rem; border-bottom: 2px solid var(--line); padding-bottom: .25rem; }
  a { color: var(--link); overflow-wrap: anywhere; } .muted { color: var(--muted); }
  nav ul { columns: 2; padding-left: 1.2rem; } nav li { break-inside: avoid; }
  .list { list-style: none; margin: 0; padding: 0; }
  .biz { padding: .75rem 0; border-bottom: 1px solid var(--line); break-inside: avoid; }
  .biz h3 { display: inline; font-size: 1.15rem; margin: 0; } .biz div { margin-top: .15rem; }
  @media print { nav, .noprint { display:none } body { font-size: 11pt; } h2 { break-after: avoid; } a { color: inherit; text-decoration: none; } }
</style>
</head>
<body>
<main>
<p class="noprint"><a href="./">&larr; Back to the searchable directory</a></p>
<h1>${esc(CONFIG.siteName)}: all our listings</h1>
<p class="muted">Phone numbers and addresses for ${data.businesses.length} local businesses in ${esc(CONFIG.town)}, California, grouped by kind of business and listed A to Z. Last updated ${esc(updated)}. Please call before you go.</p>
<nav aria-label="Kinds of business"><ul>
${byCat.map(g => `<li><a href="#${g.c.id}">${esc(g.c.name)}</a> (${g.items.length})</li>`).join('\n')}
</ul></nav>
${byCat.map(g => `<section id="${g.c.id}" aria-labelledby="h-${g.c.id}">
<h2 id="h-${g.c.id}">${esc(g.c.name)}</h2>
<ul class="list">
${g.items.map(item).join('\n')}
</ul>
</section>`).join('\n')}
<p class="muted">Every fact here comes from the business’s own website, OpenStreetMap or a public government record. Listing data is available under the Open Database License (ODbL) 1.0 and includes data &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>.</p>
<p class="muted">Copyright &copy; 2026 Glīd&nbsp;Technologies. All&nbsp;Rights&nbsp;Reserved.</p>
</main>
</body>
</html>
`;
  fs.writeFileSync(path.join(ROOT, 'directory.html'), html);
}

function writeSitemap(data) {
  const base = (CONFIG.siteUrl || process.env.SITE_URL || '').replace(/\/$/, '');
  if (!base) return; // Only meaningful once the public URL is known.
  const urls = ['/', '/directory.html'];
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map(u => `  <url><loc>${base}${u}</loc><lastmod>${data.meta.built}</lastmod></url>`).join('\n')}\n</urlset>\n`;
  fs.writeFileSync(path.join(ROOT, 'sitemap.xml'), xml);
}

// ----------------------------------------------------------------------------- main
const stage = process.argv[2];
if (stage === 'candidates') stageCandidates();
else if (stage === 'final') stageFinal();
else { console.log('usage: node tools/build-data.mjs candidates|final'); process.exit(1); }
