#!/usr/bin/env node
// Download named points of interest for the town (CONFIG.town, Willits, CA) from OpenStreetMap (Overpass API)
// and save a compact snapshot to data/sources/osm.json.
//
//   node tools/fetch-osm.mjs
//
// Scope: everything inside the City of Willits (CONFIG.osmCityRelation), plus places in the ZIP 95490 box
// (CONFIG.bbox: Brooktrails, Ridgewood, Longvale, Sherwood Road and the Highway 20 and 101 corridors) whose address
// names Willits or Brooktrails (CONFIG.placeNames) or ZIP 95490 (CONFIG.zips). Only the city's own places are marked
// inCity; tools/build-data.mjs keeps the others only when their address names the town or its ZIP code.
// OSM data (c) OpenStreetMap contributors, ODbL 1.0. https://www.openstreetmap.org/copyright

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CONFIG } from '../assets/js/config.js';
import { slugify } from './lib/common.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'data/sources/osm.json');
const ENDPOINT = 'https://overpass-api.de/api/interpreter';
// Overpass area id = 3600000000 + the relation id: relation 111764, City of Willits (boundary=administrative, admin_level=8).
const CITY_AREA = 3600000000 + CONFIG.osmCityRelation;
// Overpass wants the box as 'south,west,north,east', the same order as CONFIG.bbox.
const BBOX = CONFIG.bbox.join(',');
const KEYS = ['shop', 'amenity', 'office', 'craft', 'healthcare', 'leisure', 'tourism'];
const UA = `${slugify(CONFIG.siteName)}-directory/1.0 (static community directory build script)`; // willits-local-directory/1.0

const sel = area => KEYS.map(k => `  nwr["name"]["${k}"](area.${area});`).join('\n');

const QUERY_CITY = `[out:json][timeout:180];
area(id:${CITY_AREA})->.city;
(
${sel('city')}
);
out center tags;`;

// Optional: other places wholly inside the ZIP code whose OpenStreetMap entries often carry no address, such as the
// Brooktrails census-designated place (relation 19964312). List their relation ids in CONFIG.osmPlaceRelations
// (none by default). Their places count as in town (inCity), or build-data.mjs would drop the ones with no address.
const PLACE_AREAS = (CONFIG.osmPlaceRelations || []).map(id => 3600000000 + id);
const queryArea = area => `[out:json][timeout:180];
area(id:${area})->.place;
(
${sel('place')}
);
out center tags;`;

// "^(Willits|Brooktrails)$" and "^(95490)": the town's addr:city spellings and its ZIP codes (ZIP+4 too).
const reEscape = s => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\\\$&'); // escaped twice: once for the query, once for the regex
const CITY_RE = `^(${(CONFIG.placeNames || [CONFIG.town]).map(reEscape).join('|')})$`;
const ZIP_RE = `^(${CONFIG.zips.map(reEscape).join('|')})`;

const QUERY_AROUND = `[out:json][timeout:180];
(
  nwr["name"]["addr:city"~"${CITY_RE}",i](${BBOX});
  nwr["name"]["addr:postcode"~"${ZIP_RE}"](${BBOX});
);
out center tags;`;

const sleep = ms => new Promise(r => setTimeout(r, ms));

// The public Overpass server answers 429 or 502/504 when it's busy, and asks clients to retry with exponential backoff.
async function overpass(query, tries = 6) {
  for (let i = 0, wait = 15000; ; i++, wait *= 2) {
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': UA },
      body: 'data=' + encodeURIComponent(query),
    });
    if (res.ok) return (await res.json()).elements;
    const busy = [429, 502, 503, 504].includes(res.status);
    if (!busy || i >= tries - 1) throw new Error(`Overpass HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
    console.log(`Overpass is busy (HTTP ${res.status}); trying again in ${wait / 1000} s…`);
    await sleep(wait);
  }
}

const compact = (e, inCity) => ({
  id: `${e.type}/${e.id}`,
  lat: e.lat ?? e.center?.lat,
  lon: e.lon ?? e.center?.lon,
  inCity,
  tags: e.tags,
});

async function main() {
  console.log(`Querying Overpass (City of ${CONFIG.town})…`);
  const inside = await overpass(QUERY_CITY);
  const places = [];
  for (const area of PLACE_AREAS) {
    console.log(`Querying Overpass (area ${area})…`);
    places.push(...await overpass(queryArea(area)));
  }
  console.log(`Querying Overpass (${CONFIG.town} and ${CONFIG.zips.join(', ')} addresses nearby)…`);
  const around = await overpass(QUERY_AROUND);
  const all = new Map();
  for (const e of [...inside, ...places]) all.set(`${e.type}/${e.id}`, compact(e, true));
  for (const e of around) if (!all.has(`${e.type}/${e.id}`)) all.set(`${e.type}/${e.id}`, compact(e, false));
  const elements = [...all.values()];
  await fs.mkdir(path.dirname(OUT), { recursive: true });
  await fs.writeFile(OUT, JSON.stringify({
    fetched: new Date().toISOString(),
    source: 'OpenStreetMap via Overpass API',
    license: 'ODbL 1.0, (c) OpenStreetMap contributors',
    elements,
  }, null, 1));
  console.log(`Saved ${elements.length} elements (${inside.length} inside the city limits${places.length ? `, ${places.length} in the other listed places` : ''}) to ${path.relative(ROOT, OUT)}`);
}

main().catch(err => { console.error(err); process.exit(1); });
