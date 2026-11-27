// Odd results found by sweeping common searches over the real directory (Nov 2026), kept fixed here on a
// small set of test listings.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildIndex, search, suggest } from '../assets/js/search.js';
import { INTENTS } from '../assets/js/intents.js';

let n = 0;
const biz = o => ({
  id: `s${++n}`, sub: '', tags: [], desc: '', address: `${3000 + n} Test Road`, unit: '', zip: '95490', center: '',
  area: 'south-main', lat: 39.40, lon: -123.35, phone: `(707) 555-${String(300 + n).padStart(4, '0')}`, website: '',
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
  biz({ name: 'Strike Lanes', category: 'arts-fun', sub: 'Bowling and arcade', tags: ['bowling', 'arcade', 'shopping galleria'] }),
  biz({ name: 'Town Art Gallery', category: 'arts-fun', sub: 'Community art gallery', tags: ['art gallery'] }),
  biz({ name: 'Bowl & Greens', category: 'restaurants', sub: 'Salads and bowls', tags: ['salads', 'bowls'] }),
  biz({ name: 'Grand Cinema', category: 'arts-fun', sub: 'Movie theater', tags: ['movies', 'cinema', 'movie theater'] }),
  biz({ name: 'Acorn Stage', category: 'arts-fun', sub: 'Professional theater', tags: ['theater', 'plays'] }),
  biz({ name: 'Roof Pros', category: 'home', sub: 'Roofing contractor', tags: ['roofing', 'gutters'] }),
  biz({ name: 'Kitchen Makers', category: 'home', sub: 'Kitchen and bath remodeler', tags: ['kitchen remodel', 'bath remodel', 'remodeling'] }),
];
const index = buildIndex(DOCS, { areas: [{ id: 'south-main', name: 'South Main & Highway 20' }] });
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

// Willits words: what people here search for, and town names that must never turn into a kind of place.
let w = 0;
const local = o => biz({ id: `w${++w}`, area: 'downtown', ...o });
const WILLITS = [
  local({ name: 'Valley Smog', category: 'auto', sub: 'Smog check station', tags: ['smog check', 'star certified'] }),
  local({ name: 'Suds Car Wash', category: 'auto', sub: 'Car wash', tags: ['car wash'] }),
  local({ name: 'Ranch Road Shine', category: 'auto', sub: 'Mobile car detailing', tags: ['mobile detailing'] }),
  local({ name: 'Corner Fuel', category: 'auto', sub: 'Gas station', tags: ['gas', 'propane'], address: '20 Shell Lane' }),
  local({ name: 'Comfort Heat', category: 'home', sub: 'HVAC contractor', tags: ['heat pumps', 'furnace', 'pellet stoves'] }),
  local({ name: 'Deep Well Drilling', category: 'home', sub: 'Well drilling and pump service', tags: ['well pump', 'water treatment'] }),
  local({ name: 'Bug Busters', category: 'home', sub: 'Pest control', tags: ['pest control', 'wildlife removal'] }),
  local({ name: 'Depot Rail Tours', category: 'arts-fun', sub: 'Heritage railroad', tags: ['train ride', 'railbikes'] }),
  local({ name: 'Oak Hill Cattle', category: 'arts-fun', sub: 'Cattle ranch', tags: ['ranch', 'grass-fed beef'] }),
  local({ name: 'Hilltop Stables', category: 'arts-fun', sub: 'Horseback riding stable', tags: ['trail rides'] }),
  local({ name: 'Valley Feed', category: 'shopping', sub: 'Feed and farm supply', tags: ['feed', 'tack', 'hay'] }),
  local({ name: 'Pizza Factory', category: 'restaurants', sub: 'Pizza restaurant', tags: ['pizza'] }),
  local({ name: 'Ridge Excavating', category: 'home', sub: 'Excavation and grading contractor', tags: ['grading', 'site prep'] }),
  local({ name: 'Gate Masters', category: 'home', sub: 'Fence contractor', tags: ['fencing', 'driveway gates'] }),
  local({ name: 'Rooter Bros', category: 'home', sub: 'Plumber', tags: ['plumbing', 'trenchless sewer repair'] }),
  local({ name: 'Mendo Mill', category: 'home', sub: 'Hardware and lumber', tags: ['hardware', 'firewood'] }),
  local({ name: 'Tri Counties Bank', category: 'money', sub: 'Bank', tags: ['bank', 'atm'] }),
  // The real directory has "Little Lake" names, so "lake" is a known word there and isn't respelled ("cake").
  local({ name: 'Little Lake Grange', category: 'community', sub: 'Grange hall', tags: ['community hall'] }),
];
const wIndex = buildIndex(WILLITS, { areas: [{ id: 'downtown', name: 'Downtown Willits' }] });
const wRun = q => search(wIndex, q);
const wStrong = q => wRun(q).results.filter(r => r.strong).map(r => r.doc.b.name);
const intentWords = q => wRun(q).query.concepts.filter(c => c.kind === 'intent').map(c => c.words);

test('a smog check is car repair, not a car wash', () => {
  for (const q of ['smog check', 'smog', 'star certified smog']) assert.deepEqual(wStrong(q), ['Valley Smog'], q);
});

test('a well pump is the well driller and a heat pump is HVAC', () => {
  assert.deepEqual(wStrong('well pump'), ['Deep Well Drilling']);
  assert.deepEqual(wStrong('heat pump'), ['Comfort Heat']);
});

test('"skunk" is the Skunk Train, not pest control', () => {
  assert.deepEqual(wStrong('skunk'), ['Depot Rail Tours']);
  assert.deepEqual(wStrong('wolf tree turn'), ['Depot Rail Tours']);
});

test('a cattle ranch is not horseback riding, and a feed store sells tack', () => {
  assert.deepEqual(wStrong('horseback riding'), ['Hilltop Stables']);
  assert.deepEqual(wStrong('tack'), ['Valley Feed']);
  assert.deepEqual(intentWords('ranch'), [], 'a ranch is a word in names, not a kind of place');
});

test('town and street names never mean a kind of place', () => {
  for (const q of ['willits', 'brooktrails', 'little lake', 'ridgewood', 'redwood', 'frontier', 'seabiscuit', 'shell lane', 'fort bragg road']) {
    assert.deepEqual(intentWords(q), [], q);
  }
  assert.ok(!wStrong('shell lane').length, 'Shell Lane is a street, not a gas brand');
  assert.ok(wRun('shell lane').results.some(r => r.doc.b.name === 'Corner Fuel'), 'but the street still finds what is on it');
  // "Fort Bragg Road" is the road west: its words are searched, not dropped as filler.
  assert.deepEqual(wRun('fort bragg road').query.concepts.map(c => c.words), ['fort', 'bragg', 'road']);
});

test('"willits" is filler in a search: "pizza in willits" is "pizza"', () => {
  assert.deepEqual(wRun('pizza in willits').results.map(r => r.doc.b.name), wRun('pizza').results.map(r => r.doc.b.name));
  assert.deepEqual(wStrong('pizza near willits ca'), ['Pizza Factory']);
});

// A word that matches nothing is read as the nearest phrase one letter away, so a new one-word phrase can
// swallow everyday words ("french" -> trenching, "grade" -> grading, "savings" -> paving).
const intentLabels = q => wRun(q).query.concepts.filter(c => c.kind === 'intent').flatMap(c => c.intents.map(i => INTENTS[i].label));

test('a word near a rural phrase stays itself: "french" is not trenching, "grade school" is not grading', () => {
  const rural = ['Excavation & grading', 'Feed, tack & farm supply', 'Wells, pumps & septic', 'Propane & firewood'];
  for (const q of ['french', 'french fries', 'grade school', 'grades', 'savings', 'having a party', 'stray cat', 'paddle', 'hay fever', 'well child', 'well woman']) {
    assert.deepEqual(intentLabels(q).filter(l => rural.includes(l)), [], q);
  }
  assert.ok(intentLabels('paddle').includes('Bikes & outdoor rentals'), 'paddle, not saddle');
  assert.deepEqual(intentLabels('hay fever'), ['Allergy & asthma']);
  assert.deepEqual(intentLabels('well child'), ['Pediatricians']);
  assert.deepEqual(intentLabels('well woman'), ['Women’s health']);
  assert.deepEqual(intentLabels('savings bank'), ['Banks & credit unions']);
  assert.deepEqual(intentLabels('wells fargo'), ['Banks & credit unions'], 'the bank, not the well driller');
  assert.deepEqual(intentLabels('well'), ['Wells, pumps & septic']);
});

test('rural trades find the trade, not a neighbour that shares a word', () => {
  assert.deepEqual(wStrong('excavation'), ['Ridge Excavating'], 'driveway gates are fencing; trenchless sewer work is plumbing');
  assert.ok(wStrong('firewood').includes('Mendo Mill'));
  assert.deepEqual(wStrong('gas station'), ['Corner Fuel'], 'mobile detailing is not a Mobil station');
  assert.ok(!wStrong('firewood').includes('Comfort Heat'), 'selling pellet stoves is not selling firewood');
  assert.ok(!suggest(wIndex, 'mendo').some(x => x.type === 'intent'), '"mendo" starts Mendo Mill, not a bank phrase with the county in it');
});
