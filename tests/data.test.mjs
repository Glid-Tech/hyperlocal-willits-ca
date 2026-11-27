// Checks on the published listings in data/businesses.json. Run after every data rebuild:
//   node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { CATEGORY_BY_ID } from '../assets/js/taxonomy.js';
import { parseHours } from '../assets/js/hours.js';
import { classifySource, isOwnWebsite, SOURCE_KINDS } from '../tools/lib/source-policy.mjs';
import { describe } from '../tools/lib/describe.mjs';

const data = JSON.parse(fs.readFileSync(new URL('../data/businesses.json', import.meta.url), 'utf8'));
const all = [...data.businesses, ...(data.comingSoon || [])];
const areaIds = new Set(data.areas.map(a => a.id));
const problems = (pred) => all.filter(pred).map(b => `${b.id} (${b.name})`);

test('the file has listings and matching metadata', () => {
  assert.ok(data.businesses.length > 100, 'expected a full directory');
  assert.equal(data.meta.count, data.businesses.length);
  assert.match(data.meta.built, /^\d{4}-\d{2}-\d{2}$/);
});

test('ids are unique and URL-safe', () => {
  const seen = new Set();
  for (const b of all) {
    assert.match(b.id, /^[a-z0-9-]+$/, b.id);
    assert.ok(!seen.has(b.id), `duplicate id ${b.id}`);
    seen.add(b.id);
  }
});

test('every listing has a name, a known category and a known area', () => {
  assert.deepEqual(problems(b => !String(b.name || '').trim()), []);
  assert.deepEqual(problems(b => !CATEGORY_BY_ID[b.category]), []);
  assert.deepEqual(problems(b => !areaIds.has(b.area)), []);
});

test('every listing is in Fort Bragg’s ZIP code and can be reached somehow', () => {
  assert.deepEqual(problems(b => b.zip && b.zip !== '95437'), []);
  assert.deepEqual(problems(b => !b.address && !b.phone && !b.website), []);
});

test('phone numbers and websites are well formed', () => {
  assert.deepEqual(problems(b => b.phone && !/^\(\d{3}\) \d{3}-\d{4}$/.test(b.phone)), []);
  assert.deepEqual(problems(b => b.website && !/^https?:\/\/[^\s/]+\.[^\s]+$/.test(b.website)), []);
});

test('opening hours, when present, can be read', () => {
  assert.deepEqual(problems(b => b.hours && !parseHours(b.hours)), []);
});

test('map pins are inside ZIP 95437, from Cleone and Inglenook to the Botanical Gardens and the Highway 20 corridor', () => {
  // The geocoder's box (tools/geocode.mjs).
  const outside = b => typeof b.lat === 'number' && !(b.lat > 39.33 && b.lat < 39.56 && b.lon > -123.85 && b.lon < -123.55);
  assert.deepEqual(problems(outside), []);
});

test('listings say when they were last checked', () => {
  assert.deepEqual(problems(b => b.verified && !/^\d{4}-\d{2}-\d{2}$/.test(b.verified)), []);
  const unchecked = data.businesses.filter(b => !b.verified).length;
  assert.ok(unchecked / data.businesses.length < 0.05, `${unchecked} listings have no checked date`);
});

test('opening dates are in the past, as YYYY-MM', () => {
  assert.deepEqual(problems(b => b.opened && (!/^\d{4}-\d{2}$/.test(b.opened) || b.opened > data.meta.built.slice(0, 7))), []);
});

// The legal rules in data/SOURCES.md: only facts, only from allowed sources, only our own words.
test('every listing cites at least one source, and every source is allowed', () => {
  assert.deepEqual(problems(b => !(b.sources || []).length), []);
  const bad = all.flatMap(b => (b.sources || []).filter(u => !SOURCE_KINDS.includes(classifySource(u, b))).map(u => `${b.id}: ${u}`));
  assert.deepEqual(bad, []);
});

test('websites are the businesses’ own, never a review site, map app or directory', () => {
  assert.deepEqual(problems(b => b.website && !isOwnWebsite(b.website, b.name)), []);
});

test('descriptions are our own sentence, written from the facts', () => {
  assert.deepEqual(problems(b => b.desc !== describe(b, data.areas)), []);
});

test('no review text, ratings, photos or other borrowed content in the data', () => {
  const allowed = new Set(['id', 'name', 'category', 'sub', 'tags', 'desc', 'address', 'unit', 'zip', 'center', 'area', 'lat', 'lon',
    'phone', 'website', 'hours', 'status', 'verified', 'sources', 'opened', 'chain']);
  assert.deepEqual(all.flatMap(b => Object.keys(b).filter(k => !allowed.has(k)).map(k => `${b.id}: ${k}`)), []);
});
