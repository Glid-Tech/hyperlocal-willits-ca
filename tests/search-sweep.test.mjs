// Odd results found by sweeping common searches over the real directory (Nov 2026), kept fixed here on a
// small set of test listings.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildIndex, search } from '../assets/js/search.js';

let n = 0;
const biz = o => ({
  id: `s${++n}`, sub: '', tags: [], desc: '', address: `${3000 + n} Test Road`, unit: '', zip: '95437', center: '',
  area: 'harbor', lat: 39.43, lon: -123.81, phone: `(707) 555-${String(300 + n).padStart(4, '0')}`, website: '',
  hours: '', status: 'open', verified: null, sources: [], ...o,
});

const DOCS = [
  biz({ name: 'Bean There', category: 'cafes-treats', sub: 'Coffee shop', tags: ['coffee', 'espresso', 'tea'] }),
  biz({ name: 'Pearl Tea', category: 'cafes-treats', sub: 'Bubble tea', tags: ['bubble tea', 'boba', 'milk tea'] }),
  biz({ name: 'Kabob Palace', category: 'restaurants', sub: 'Afghan restaurant', tags: ['afghan', 'kabob', 'halal'] }),
  biz({ name: 'Corner Butcher', category: 'groceries', sub: 'Butcher shop', tags: ['butcher', 'meat'] }),
  biz({ name: 'Big Grocer', category: 'groceries', sub: 'Supermarket', tags: ['grocery', 'supermarket', 'pharmacy'] }),
  biz({ name: 'Whole Foods Market', category: 'groceries', sub: 'Natural and organic supermarket', tags: ['grocery', 'organic'] }),
  biz({ name: 'Whole Fish House', category: 'restaurants', sub: 'Seafood restaurant', tags: ['seafood', 'whole fish'] }),
  biz({ name: 'Siam Kitchen', category: 'restaurants', sub: 'Thai restaurant', tags: ['thai', 'curry'] }),
  biz({ name: 'Food Hall Thai', category: 'restaurants', sub: 'Thai counter (food hall)', tags: ['thai', 'food hall'] }),
  biz({ name: 'Village Primary Care', category: 'health', sub: 'Family medicine', tags: ['primary care', 'family doctor'] }),
  biz({ name: 'Acme Dermatology', category: 'health', sub: 'Dermatologist', tags: ['dermatology', 'skin doctor'] }),
  biz({ name: 'Glow Med Spa', category: 'beauty', sub: 'Med spa', tags: ['botox', 'skin care', 'facials'] }),
  biz({ name: 'Vein Center', category: 'health', sub: 'Vein treatment clinic', tags: ['veins', 'clinic'] }),
  biz({ name: 'Quick Urgent Care', category: 'health', sub: 'Urgent care', tags: ['urgent care', 'walk in', 'covid test'] }),
  biz({ name: 'Learning Tree Tutoring', category: 'kids', sub: 'Tutoring and test prep', tags: ['tutoring', 'test prep'] }),
  biz({ name: 'Jones Wealth', category: 'money', sub: 'Financial advisor', tags: ['financial advisor'] }),
  biz({ name: 'Step Ahead Shoes', category: 'shopping', sub: 'Shoe store', tags: ['shoes'] }),
  biz({ name: 'Strike Lanes', category: 'arts-fun', sub: 'Bowling and arcade', tags: ['bowling', 'arcade', 'noyo harbor'] }),
  biz({ name: 'Town Art Gallery', category: 'arts-fun', sub: 'Community art gallery', tags: ['art gallery'] }),
  biz({ name: 'Bowl & Greens', category: 'restaurants', sub: 'Salads and bowls', tags: ['salads', 'bowls'] }),
  biz({ name: 'Grand Cinema', category: 'arts-fun', sub: 'Movie theater', tags: ['movies', 'cinema', 'movie theater'] }),
  biz({ name: 'Acorn Stage', category: 'arts-fun', sub: 'Professional theater', tags: ['theater', 'plays'] }),
  biz({ name: 'Roof Pros', category: 'home', sub: 'Roofing contractor', tags: ['roofing', 'gutters'] }),
  biz({ name: 'Kitchen Makers', category: 'home', sub: 'Kitchen and bath remodeler', tags: ['kitchen remodel', 'bath remodel', 'remodeling'] }),
];
const index = buildIndex(DOCS, { areas: [{ id: 'harbor', name: 'Noyo Harbor' }] });
const names = q => search(index, q).results.map(r => r.doc.b.name);
const strong = q => search(index, q).results.filter(r => r.strong).map(r => r.doc.b.name);

test('a guessed spelling that matches only part of a search shows nothing, not nonsense', () => {
  assert.deepEqual(names('trader joes'), []); // not "Jones Wealth"
  assert.deepEqual(names('pest control'), []); // not "test prep"
  assert.deepEqual(names('cardiologist'), []); // not an audiologist
});

test('"shoe repair" with no cobbler finds nothing, not shoe shops', () => {
  assert.deepEqual(names('shoe repair'), []);
});

test('bubble tea is tea, not every coffee shop', () => {
  assert.deepEqual(strong('bubble tea'), ['Pearl Tea']);
  assert.ok(!names('bubble tea').includes('Big Grocer'));
});

test('"halal" finds places that say halal, not every butcher and supermarket', () => {
  assert.deepEqual(names('halal'), ['Kabob Palace']);
});

test('a supermarket pharmacy counts as a pharmacy', () => {
  assert.ok(names('pharmacy').includes('Big Grocer'));
});

test('two words that run together in a name find that business first', () => {
  assert.equal(names('whole foods')[0], 'Whole Foods Market');
});

test('"thai food" finds every Thai place, not only the one in a food hall', () => {
  assert.deepEqual(strong('thai food').sort(), ['Food Hall Thai', 'Siam Kitchen']);
});

test('"doctor" means primary care; specialists are only related', () => {
  assert.equal(names('family doctor')[0], 'Village Primary Care');
  assert.equal(names('doctor')[0], 'Village Primary Care');
});

test('dermatologists before med spas', () => {
  assert.equal(names('dermatologist')[0], 'Acme Dermatology');
  assert.ok(!strong('dermatologist').includes('Glow Med Spa'));
});

test('urgent care is urgent care, not every clinic', () => {
  assert.deepEqual(strong('urgent care'), ['Quick Urgent Care']);
});

test('bowling is not salad bowls, and a museum is not a mall tag', () => {
  assert.deepEqual(strong('bowling'), ['Strike Lanes']);
  assert.deepEqual(strong('museum'), ['Town Art Gallery']);
});

test('the words typed rank first within a kind of place', () => {
  assert.equal(names('movie theater')[0], 'Grand Cinema');
  assert.equal(names('kitchen remodel')[0], 'Kitchen Makers');
});
