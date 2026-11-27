// Find map coordinates for candidate addresses that don't have them yet.
//
//   node tools/geocode.mjs                 # geocode new addresses
//   node tools/geocode.mjs --retry-misses  # also retry addresses that failed before
//
// 1. U.S. Census Bureau batch geocoder (free, no key): https://geocoding.geo.census.gov/
// 2. Anything the Census can't match goes to OpenStreetMap Nominatim, at most one request per
//    second as its usage policy asks: https://operations.osmfoundation.org/policies/nominatim/
//
// Results are cached in data/sources/geocode-cache.json (keyed "address|zip"), so each address
// is only ever looked up once. Run `node tools/build-data.mjs candidates` afterwards.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { prettyStreet } from './lib/common.mjs';
import { CONFIG } from '../assets/js/config.js';
import { TIME_ZONE } from '../assets/js/hours.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'data/sources');
const CACHE_FILE = path.join(SRC, 'geocode-cache.json');
const UA = 'FortBraggLocal-directory-builder/1.0 (static site data build)';
const TODAY = new Intl.DateTimeFormat('en-CA', { timeZone: TIME_ZONE }).format(new Date()); // the town's date
const STATE_NAME = { CA: 'California' }[CONFIG.state] || CONFIG.state;
const RETRY = process.argv.includes('--retry-misses');

// A generous box around ZIP 95437: Cleone and MacKerricher to the north, the Noyo River to the south and the
// Highway 20 corridor to the east. Anything outside it is a bad match.
const BOX = { south: 39.33, north: 39.56, west: -123.85, east: -123.55 };
const inBox = (lat, lon) => lat >= BOX.south && lat <= BOX.north && lon >= BOX.west && lon <= BOX.east;

const readJson = (f, fallback) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return fallback; } };
const sleep = ms => new Promise(r => setTimeout(r, ms));

const cache = readJson(CACHE_FILE, {});
const saveCache = () => {
  const sorted = Object.fromEntries(Object.entries(cache).sort(([a], [b]) => a.localeCompare(b)));
  fs.writeFileSync(CACHE_FILE, JSON.stringify(sorted, null, 1) + '\n');
};

const cands = (readJson(path.join(SRC, 'candidates.json'), {}).candidates) || [];
// Addresses confirmed by hand (data/sources/confirmed/) need coordinates too.
const byId = new Map(cands.map(r => [r.id, r]));
const confDir = path.join(SRC, 'confirmed');
const corrected = [];
for (const f of fs.existsSync(confDir) ? fs.readdirSync(confDir).filter(n => n.endsWith('.json')) : []) {
  for (const v of readJson(path.join(confDir, f), [])) {
    const c = v && byId.get(v.id);
    if (!c) continue;
    const address = prettyStreet(v.facts?.address?.value || '');
    const zip = v.facts?.zip?.value || c.zip || '';
    if (address && address !== prettyStreet(c.address)) corrected.push({ address, zip });
    // A point from an OpenStreetMap entry the check ignores isn't used, so the address needs one of its own.
    else if (v.ignore?.includes('osm') && (address || c.address)) corrected.push({ address: address || prettyStreet(c.address), zip });
  }
}
const todo = new Map();
for (const r of [...cands, ...corrected]) {
  if ((r.lat && r.lon) || !r.address) continue;
  const key = `${prettyStreet(r.address)}|${r.zip || ''}`;
  const hit = cache[key] || Object.entries(cache).find(([k]) => k.toLowerCase() === key.toLowerCase())?.[1];
  if (hit && (hit.lat || (hit.miss && !RETRY))) continue;
  if (!todo.has(key)) todo.set(key, { key, address: prettyStreet(r.address), zip: r.zip || '' });
}
console.log(`${todo.size} addresses to look up (${Object.keys(cache).length} already cached)`);
if (!todo.size) process.exit(0);

// ----------------------------------------------------------------------------- 1. Census batch

function csvCell(s) {
  const v = String(s ?? '');
  return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

function parseCsvLine(line) {
  const out = [];
  let cur = '', q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') q = false;
      else cur += c;
    } else if (c === '"') q = true;
    else if (c === ',') { out.push(cur); cur = ''; }
    else cur += c;
  }
  out.push(cur);
  return out;
}

async function censusBatch(items) {
  const rows = items.map((it, i) => [i, it.address, CONFIG.town, CONFIG.state, it.zip].map(csvCell).join(','));
  const form = new FormData();
  form.append('benchmark', 'Public_AR_Current');
  form.append('addressFile', new Blob([rows.join('\n') + '\n'], { type: 'text/csv' }), 'addresses.csv');
  const res = await fetch('https://geocoding.geo.census.gov/geocoder/locations/addressbatch', {
    method: 'POST', body: form, headers: { 'User-Agent': UA },
  });
  if (!res.ok) throw new Error(`Census geocoder HTTP ${res.status}`);
  const text = await res.text();
  const found = new Map();
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const cells = parseCsvLine(line);
    const idx = Number(cells[0]);
    if (!Number.isInteger(idx) || !items[idx]) continue;
    if (cells[2] !== 'Match') continue;
    const [lon, lat] = String(cells[5] || '').split(',').map(Number);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    found.set(idx, { lat: +lat.toFixed(6), lon: +lon.toFixed(6), matched: cells[4] || '', exact: cells[3] === 'Exact' });
  }
  return found;
}

const items = [...todo.values()];
let census = 0, nominatim = 0, misses = 0, outside = 0;
const left = [];
for (let i = 0; i < items.length; i += 500) {
  const chunk = items.slice(i, i + 500);
  let found = new Map();
  try {
    found = await censusBatch(chunk);
  } catch (err) {
    console.warn(`Census batch failed (${err.message}); falling back to Nominatim for these.`);
  }
  chunk.forEach((it, j) => {
    const hit = found.get(j);
    if (hit && inBox(hit.lat, hit.lon)) {
      cache[it.key] = { lat: hit.lat, lon: hit.lon, source: 'census', matched: hit.matched, at: TODAY };
      census++;
    } else {
      if (hit) outside++;
      left.push(it);
    }
  });
  saveCache();
}
console.log(`Census matched ${census}; ${left.length} left for Nominatim`);

// ----------------------------------------------------------------------------- 2. Nominatim

async function nominatimLookup(it) {
  const tries = [
    { street: it.address, city: CONFIG.town, state: STATE_NAME, postalcode: it.zip },
    { street: it.address, county: 'Mendocino County', state: STATE_NAME },
    { q: `${it.address}, ${CONFIG.town}, ${CONFIG.state} ${it.zip}`.trim() },
  ];
  for (const t of tries) {
    const p = new URLSearchParams({ format: 'jsonv2', limit: '1', countrycodes: 'us', ...Object.fromEntries(Object.entries(t).filter(([, v]) => v)) });
    const res = await fetch(`https://nominatim.openstreetmap.org/search?${p}`, { headers: { 'User-Agent': UA, 'Accept-Language': 'en' } });
    await sleep(1100);
    if (res.status === 429 || res.status === 403) throw new Error(`Nominatim refused (${res.status}); stopping. Try again later.`);
    if (!res.ok) continue;
    const arr = await res.json();
    const hit = arr && arr[0];
    if (!hit) continue;
    const lat = +(+hit.lat).toFixed(6), lon = +(+hit.lon).toFixed(6);
    if (inBox(lat, lon)) return { lat, lon, matched: hit.display_name || '' };
  }
  return null;
}

for (const it of left) {
  let hit = null;
  try {
    hit = await nominatimLookup(it);
  } catch (err) {
    console.warn(err.message);
    break;
  }
  if (hit) {
    cache[it.key] = { lat: hit.lat, lon: hit.lon, source: 'nominatim', matched: hit.matched, at: TODAY };
    nominatim++;
  } else {
    cache[it.key] = { miss: true, at: TODAY };
    misses++;
  }
  if ((nominatim + misses) % 10 === 0) saveCache();
}
saveCache();
console.log(`done: census ${census}, nominatim ${nominatim}, not found ${misses}, rejected as outside ${CONFIG.town} ${outside}`);
