// A cuisine means food: "chinese" finds Chinese restaurants, not Chinese medicine or a Chinese-speaking
// dentist. Naming another kind of place too ("thai massage") still reaches outside food.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildIndex, search, intentCount } from '../assets/js/search.js';
import { INTENTS } from '../assets/js/intents.js';

let n = 0;
const biz = o => ({
  id: `c${++n}`, sub: '', tags: [], desc: '', address: `${2000 + n} Test Road`, unit: '', zip: '95437', center: '',
  area: 'downtown', lat: 39.44, lon: -123.80, phone: `(707) 555-${String(200 + n).padStart(4, '0')}`, website: '',
  hours: '', status: 'open', verified: null, sources: [], ...o,
});

const DOCS = [
  biz({ name: 'Golden Wok', category: 'restaurants', sub: 'Chinese restaurant', tags: ['chinese', 'lo mein'] }),
  biz({ name: 'Jade Garden', category: 'restaurants', sub: 'Chinese restaurant (dim sum)', tags: ['chinese', 'dim sum'] }),
  biz({ name: 'Bangkok Kitchen', category: 'restaurants', sub: 'Thai restaurant', tags: ['thai', 'dumplings'] }),
  biz({ name: 'Harmony Acupuncture', category: 'health', sub: 'Acupuncture clinic', tags: ['acupuncture', 'chinese medicine'] }),
  biz({ name: 'Lotus Spa', category: 'beauty', sub: 'Massage', tags: ['massage', 'chinese massage'] }),
  biz({ name: 'Siam Thai Massage', category: 'beauty', sub: 'Thai massage', tags: ['massage', 'thai massage'] }),
  biz({ name: 'Nguyen Family Dental', category: 'dental', sub: 'Dentist', tags: ['dentist', 'vietnamese'] }),
  biz({ name: 'Rajput Photography', category: 'professional', sub: 'Wedding photographer', tags: ['wedding photography', 'indian weddings'] }),
];
const index = buildIndex(DOCS, { areas: [{ id: 'downtown', name: 'Downtown Fort Bragg' }] });
const names = q => search(index, q).results.map(r => r.doc.b.name);

test('"chinese food" finds Chinese restaurants only', () => {
  for (const q of ['Chinese food', 'chinese', 'chinese restaurant']) {
    const found = names(q);
    assert.deepEqual(found.slice(0, 2).sort(), ['Golden Wok', 'Jade Garden'], q);
    for (const no of ['Harmony Acupuncture', 'Lotus Spa', 'Bangkok Kitchen']) assert.ok(!found.includes(no), `${q} -> ${no}`);
  }
});

test('the "Chinese food" suggestion counts only food places', () => {
  const idx = INTENTS.findIndex(i => i.label === 'Chinese food');
  assert.equal(intentCount(index, idx), 2);
});

test('naming another kind of place still finds it outside food', () => {
  assert.equal(names('thai massage')[0], 'Siam Thai Massage');
  assert.deepEqual(names('chinese massage'), ['Lotus Spa']);
  assert.deepEqual(names('indian wedding photographer'), ['Rajput Photography']);
  assert.ok(names('chinese medicine').includes('Harmony Acupuncture'));
});

test('a cuisine with no restaurant says so, rather than finding something else', () => {
  assert.deepEqual(names('vietnamese'), []);
  assert.deepEqual(names('vietnamese food'), []);
  assert.deepEqual(names('Nguyen Family Dental'), ['Nguyen Family Dental']);
});
