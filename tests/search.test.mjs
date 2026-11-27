// Search behaviour that non-technical visitors rely on. Uses a small fixed set of test
// listings (not the real data), so the expectations stay stable as the directory changes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildIndex, search, suggest } from '../assets/js/search.js';

const AREAS = [
  { id: 'downtown', name: 'Downtown Fort Bragg' },
  { id: 'cleone', name: 'Cleone' },
  { id: 'elsewhere', name: 'Around Fort Bragg' },
];

let n = 0;
const biz = o => ({
  id: `t${++n}`, sub: '', tags: [], desc: '', address: `${1000 + n} Test Road`, unit: '', zip: '95437', center: '',
  area: 'downtown', lat: 39.44, lon: -123.80, phone: `(707) 555-${String(100 + n).padStart(4, '0')}`, website: '',
  hours: '', status: 'open', verified: null, sources: [], ...o,
});

const DOCS = [
  biz({ name: 'Giant Food', category: 'groceries', sub: 'Supermarket', tags: ['grocery', 'pharmacy', 'bakery'], hours: 'Mo-Su 06:00-23:00' }),
  biz({ name: 'Safeway', category: 'groceries', sub: 'Supermarket', tags: ['grocery', 'pharmacy'], area: 'cleone' }),
  biz({ name: 'Plumb Perfect', category: 'home', sub: 'Plumber', tags: ['plumbing', 'drains', 'water heaters'] }),
  biz({ name: 'Cool Breeze Heating & Air', category: 'home', sub: 'HVAC contractor', tags: ['air conditioning', 'heating', 'furnace'] }),
  biz({ name: 'Sparkle Nails', category: 'beauty', sub: 'Nail salon', tags: ['manicure', 'pedicure'] }),
  biz({ name: 'Main Street Barbers', category: 'beauty', sub: 'Barbershop', tags: ['haircut', 'beard trim'] }),
  biz({ name: 'Bright Smile Dental', category: 'dental', sub: 'Dentist', tags: ['cleanings', 'crowns'] }),
  biz({ name: 'Listrani’s', category: 'restaurants', sub: 'Italian restaurant', tags: ['italian', 'pizza', 'pasta'], hours: 'Mo-Su 11:00-22:00' }),
  biz({ name: 'Pizza Hut', category: 'restaurants', sub: 'Pizza (quick service)', tags: ['pizza', 'delivery', 'takeout'], chain: true }),
  biz({ name: 'Flower Child', category: 'restaurants', sub: 'Healthy restaurant', tags: ['salads', 'bowls', 'healthy'] }),
  biz({ name: 'Petal & Stem', category: 'shopping', sub: 'Florist', tags: ['flowers', 'bouquets', 'delivery'] }),
  biz({ name: 'Sunny Side Diner', category: 'restaurants', sub: 'Breakfast restaurant', tags: ['breakfast', 'brunch', 'pancakes'], hours: 'Mo-Fr 07:00-14:00; Sa,Su 08:00-15:00' }),
  biz({ name: 'Early Bird Cafe', category: 'restaurants', sub: 'Breakfast restaurant', tags: ['breakfast', 'brunch'], hours: 'Mo-Sa 07:00-14:00; Su off' }),
  biz({ name: 'Little Picasso Studio', category: 'kids', sub: 'Art classes', tags: ['art classes', 'summer camp', 'kids'] }),
  biz({ name: 'Coast Cinema', category: 'arts-fun', sub: 'Movie theater', tags: ['movies'] }),
  biz({ name: 'Cleone Cleaners', category: 'errands', sub: 'Dry cleaner', tags: ['dry cleaning', 'alterations'], area: 'cleone' }),
  biz({ name: 'Quick Lube Auto Care', category: 'auto', sub: 'Auto repair', tags: ['oil change', 'brakes', 'tires'] }),
];

const index = buildIndex(DOCS, { areas: AREAS });
const TUE_8AM = { day: 1, minutes: 8 * 60 };
const run = (q, opts = {}) => search(index, q, { now: TUE_8AM, ...opts });
const names = r => r.results.map(x => x.doc.b.name);
const strongNames = r => r.results.filter(x => x.strong).map(x => x.doc.b.name);

test('everyday problems map to the right trade: "fix my sink" finds plumbers', () => {
  const r = run('fix my sink');
  assert.equal(names(r)[0], 'Plumb Perfect');
  assert.ok(!names(r).includes('Sparkle Nails'));
});

test('spelling mistakes are corrected: "plumer" and "dentsit"', () => {
  const p = run('plumer');
  assert.equal(names(p)[0], 'Plumb Perfect');
  assert.ok(p.query.corrections.length > 0, 'the correction is reported so the page can say "We think you meant…"');
  const d = run('dentsit');
  assert.equal(names(d)[0], 'Bright Smile Dental');
});

test('typing a business name puts that business first: "giant"', () => {
  assert.equal(names(run('giant'))[0], 'Giant Food');
  assert.equal(names(run('pizza hut'))[0], 'Pizza Hut');
});

test('a word in a restaurant name does not make it a florist: "flowers"', () => {
  const r = run('flowers');
  assert.equal(names(r)[0], 'Petal & Stem');
  assert.ok(!strongNames(r).includes('Flower Child'));
});

test('"italian food" ranks Italian restaurants as best matches and pizza chains as related', () => {
  const r = run('italian food');
  assert.equal(names(r)[0], 'Listrani’s');
  const hut = r.results.find(x => x.doc.b.name === 'Pizza Hut');
  if (hut) assert.equal(hut.strong, false);
});

test('a haircut search does not return nail salons as best matches', () => {
  const r = run('i need a haircut');
  assert.equal(names(r)[0], 'Main Street Barbers');
  assert.ok(!strongNames(r).includes('Sparkle Nails'));
});

test('conversational phrasing: "my tooth hurts" finds dentists without a partial-match warning', () => {
  const r = run('my tooth hurts');
  assert.equal(names(r)[0], 'Bright Smile Dental');
  assert.equal(r.partial, false);
});

test('"somewhere to take the kids" finds activities, not takeout', () => {
  const r = run('somewhere to take the kids');
  assert.ok(r.total > 0);
  for (const name of names(r)) assert.ok(!['Pizza Hut', 'Listrani’s'].includes(name), `${name} should not match`);
  assert.ok(names(r).includes('Little Picasso Studio'));
});

test('"open now" keeps only places open at that moment', () => {
  const r = run('open now');
  assert.ok(r.total > 0);
  assert.ok(r.results.every(x => x.status.state === 'open'));
  assert.ok(names(r).includes('Giant Food'));
  assert.ok(!names(r).includes('Listrani’s'), 'opens at 11 AM, so closed at 8 AM');
});

test('"sunday brunch" keeps brunch places that open on Sundays', () => {
  const r = run('sunday brunch');
  assert.equal(r.query.filters.day, 6);
  assert.ok(names(r).includes('Sunny Side Diner'));
  assert.ok(!names(r).includes('Early Bird Cafe'), 'closed on Sundays');
});

test('a category filter limits results to that category', () => {
  const r = run('delivery', { category: 'shopping' });
  assert.deepEqual(names(r), ['Petal & Stem']);
});

test('an empty search lists everything A to Z', () => {
  const r = run('');
  assert.equal(r.total, DOCS.length);
  const sorted = [...names(r)].sort((a, b) => a.localeCompare(b, 'en', { sensitivity: 'base' }));
  assert.deepEqual(names(r), sorted);
});

test('phone numbers are searchable', () => {
  const plumber = DOCS.find(d => d.name === 'Plumb Perfect');
  assert.equal(names(run(plumber.phone.replace(/\D/g, '')))[0], 'Plumb Perfect');
});

test('suggestions while typing: business names by prefix', () => {
  assert.ok(suggest(index, 'list').some(s => s.type === 'business' && s.label === 'Listrani’s'));
  assert.ok(suggest(index, 'piz').some(s => s.type === 'intent' && s.label === 'Pizza'));
});

test('suggestions while typing: neighborhoods come first when the name matches', () => {
  const s = suggest(index, 'cleo');
  assert.equal(s[0].type, 'area');
  assert.equal(s[0].id, 'cleone');
  assert.ok(s.some(x => x.type === 'business' && x.label === 'Cleone Cleaners'));
});

test('every suggestion leads somewhere', () => {
  for (const q of ['den', 'piz', 'ha', 'oil', 'cleo', 'flo']) {
    for (const s of suggest(index, q)) {
      if (s.type === 'business') assert.ok(s.id);
      else assert.ok(s.count > 0, `${s.label} for "${q}" has no places`);
    }
  }
});
