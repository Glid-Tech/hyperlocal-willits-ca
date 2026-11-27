#!/usr/bin/env node
// Download named points of interest for Fort Bragg, CA from OpenStreetMap (Overpass API)
// and save a compact snapshot to data/sources/osm.json.
//
//   node tools/fetch-osm.mjs
//
// Scope: everything inside the City of Fort Bragg, plus places in the surrounding box (Cleone,
// MacKerricher, Noyo, the Highway 20 corridor) whose address says Fort Bragg / ZIP 95437.
// OSM data (c) OpenStreetMap contributors, ODbL 1.0. https://www.openstreetmap.org/copyright

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'data/sources/osm.json');
const ENDPOINT = 'https://overpass-api.de/api/interpreter';
const CITY_AREA = 3600111761; // relation 111761, City of Fort Bragg (boundary=administrative, admin_level=8)
const BBOX = '39.33,-123.85,39.56,-123.55';
const KEYS = ['shop', 'amenity', 'office', 'craft', 'healthcare', 'leisure', 'tourism'];
const UA = 'fortbragg-local-directory/1.0 (static community directory build script)';

const sel = area => KEYS.map(k => `  nwr["name"]["${k}"](area.${area});`).join('\n');

const QUERY_CITY = `[out:json][timeout:180];
area(id:${CITY_AREA})->.city;
(
${sel('city')}
);
out center tags;`;

const QUERY_AROUND = `[out:json][timeout:180];
(
  nwr["name"]["addr:city"~"^(Fort|Ft\\\\.?) ?Bragg$",i](${BBOX});
  nwr["name"]["addr:postcode"~"^95437"](${BBOX});
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
  console.log('Querying Overpass (City of Fort Bragg)…');
  const inside = await overpass(QUERY_CITY);
  console.log('Querying Overpass (Fort Bragg addresses nearby)…');
  const around = await overpass(QUERY_AROUND);
  const all = new Map();
  for (const e of inside) all.set(`${e.type}/${e.id}`, compact(e, true));
  for (const e of around) if (!all.has(`${e.type}/${e.id}`)) all.set(`${e.type}/${e.id}`, compact(e, false));
  const elements = [...all.values()];
  await fs.mkdir(path.dirname(OUT), { recursive: true });
  await fs.writeFile(OUT, JSON.stringify({
    fetched: new Date().toISOString(),
    source: 'OpenStreetMap via Overpass API',
    license: 'ODbL 1.0, (c) OpenStreetMap contributors',
    elements,
  }, null, 1));
  console.log(`Saved ${elements.length} elements (${inside.length} inside the city limits) to ${path.relative(ROOT, OUT)}`);
}

main().catch(err => { console.error(err); process.exit(1); });
