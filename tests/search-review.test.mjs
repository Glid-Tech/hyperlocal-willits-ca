// Search fixes from the code review: emergency wording, business names that contain hour words,
// real words in spelling corrections, phone numbers, "open late" and "open today", body aches,
// "fix" words and the hour-word split the page uses. Fixed test listings, like search.test.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildIndex, search, parseQuery, splitFilters, suggest, normalize, tokenize } from '../assets/js/search.js';
import { INTENTS } from '../assets/js/intents.js';

let n = 0;
const biz = o => ({
  id: `r${++n}`, sub: '', tags: [], desc: '', address: `${2000 + n} Review Road`, unit: '', zip: '95490', center: '',
  area: 'downtown', lat: 39.41, lon: -123.36, phone: `(707) 555-${String(100 + n).padStart(4, '0')}`, website: '',
  hours: '', status: 'open', verified: null, sources: [], ...o,
});

const DOCS = [
  biz({ name: 'Open Road Outpost & Biergarten', category: 'restaurants', sub: 'American restaurant and beer garden', tags: ['beer garden', 'burgers'] }),
  biz({ name: 'Yard House', category: 'restaurants', sub: 'American restaurant', tags: ['beer', 'burgers'] }),
  biz({ name: 'Green Acres Landscaping', category: 'home', sub: 'Landscaper', tags: ['lawn care', 'yard work', 'house'] }),
  biz({ name: 'Willits Cleaners', category: 'errands', sub: 'Dry cleaner', tags: ['dry cleaning'] }),
  biz({ name: 'Langley Cleaners', category: 'errands', sub: 'Dry cleaner', tags: ['dry cleaning', 'alterations'] }),
  biz({ name: 'Sunday Morning Bakehouse', category: 'cafes-treats', sub: 'Bakery cafe', tags: ['bakery', 'pastries'], hours: 'Mo-Fr 07:00-15:00' }),
  biz({ name: 'Chipotle Mexican Grill', category: 'restaurants', sub: 'Mexican fast-casual', tags: ['burritos', 'tacos'] }),
  biz({ name: 'Edward Jones', category: 'money', sub: 'Financial advisor', tags: ['investments', 'retirement'] }),
  biz({ name: 'Bank of Review', category: 'money', sub: 'Bank', tags: ['bank', 'atm'] }),
  biz({ name: 'Oak Chiropractic', category: 'health', sub: 'Chiropractor', tags: ['chiropractic', 'back pain', 'neck pain'] }),
  biz({ name: 'Riverside Physical Therapy', category: 'health', sub: 'Physical therapy', tags: ['physical therapy', 'rehab'] }),
  biz({ name: 'Valley Spine & Pain', category: 'health', sub: 'Pain management clinic', tags: ['pain management', 'spine'] }),
  biz({ name: 'Elm Family Medicine', category: 'health', sub: 'Family medicine / primary care', tags: ['primary care', 'doctor'] }),
  biz({ name: 'Happy Feet Podiatry', category: 'health', sub: 'Podiatrist', tags: ['podiatrist', 'foot doctor'] }),
  biz({ name: 'Summit Orthopaedics', category: 'health', sub: 'Orthopedics and sports medicine', tags: ['orthopedics', 'joint replacement'] }),
  biz({ name: 'Back-Up Kids Care', category: 'kids', sub: 'Child care and back-up care center', tags: ['back-up care', 'daycare'] }),
  biz({ name: 'Pine Pharmacy', category: 'health', sub: 'Pharmacy', tags: ['pharmacy', 'prescriptions'], hours: 'Mo-Fr 09:00-18:00' }),
  biz({ name: 'Night Owl Pharmacy', category: 'health', sub: 'Pharmacy', tags: ['pharmacy'], hours: 'Mo-Su 07:00-22:00' }),
  biz({ name: 'Cool Air Comfort', category: 'home', sub: 'HVAC contractor', tags: ['air conditioning', 'heating', 'furnace'] }),
  biz({ name: 'Polar Heating & Cooling', category: 'home', sub: 'HVAC contractor', tags: ['heating', 'cooling', 'heat pumps'] }),
  biz({ name: 'Handy Helpers', category: 'home', sub: 'Handyman', tags: ['handyman', 'home repair'] }),
  biz({ name: 'Baechtel Auto Repair', category: 'auto', sub: 'Auto repair shop', tags: ['mechanic', 'oil change', 'brakes'] }),
  biz({ name: 'Corner Gas', category: 'auto', sub: 'Gas station', tags: ['gas', 'fuel'] }),
  biz({ name: 'Shine Car Wash', category: 'auto', sub: 'Car wash', tags: ['car wash'] }),
  biz({ name: 'Tony’s Pizza', category: 'restaurants', sub: 'Pizza restaurant', tags: ['pizza', 'delivery'], hours: 'Mo-Su 11:00-21:00' }),
  biz({ name: 'Late Bar', category: 'restaurants', sub: 'Bar', tags: ['bar', 'cocktails'], hours: 'Mo-Su 17:00-02:00' }),
  biz({ name: 'Evening Bistro', category: 'restaurants', sub: 'Bistro', tags: ['dinner'], hours: 'Mo-Su 11:00-22:00' }),
  biz({ name: 'Breakfast Nook', category: 'restaurants', sub: 'Breakfast restaurant', tags: ['breakfast'], hours: 'Mo-Su 06:00-14:00' }),
  biz({ name: 'Saturday Lounge', category: 'restaurants', sub: 'Lounge', tags: ['cocktails'], hours: 'Mo-Fr 11:00-20:00; Sa 11:00-23:00' }),
  biz({ name: 'Lucky Strike Lanes', category: 'arts-fun', sub: 'Bowling alley', tags: ['bowling'] }),
  biz({ name: 'Main Street Books', category: 'shopping', sub: 'Bookstore', tags: ['books', 'gifts'] }),
  biz({ name: 'Ridgewood Gifts', category: 'shopping', sub: 'Gift shop', tags: ['gifts'], area: 'ridgewood' }),
  biz({ name: 'Liftmaster Garage Doors', category: 'home', sub: 'Garage door installer', tags: ['garage doors', 'openers'] }),
];

const index = buildIndex(DOCS, { areas: [{ id: 'downtown', name: 'Downtown Willits' }] });
const MON_NOON = { day: 0, minutes: 12 * 60 };
const run = (q, opts = {}) => search(index, q, { now: MON_NOON, ...opts });
const names = r => r.results.map(x => x.doc.b.name);
const strongNames = r => r.results.filter(x => x.strong).map(x => x.doc.b.name);

test('the call-911 notice shows for plurals, other word forms and corrected spellings', () => {
  for (const q of ['chest pains', 'heart attacks', 'strokes', 'overdosed', 'poisoned', 'food poisoning', 'emergancy room', 'my chest hurts', 'hart attack']) {
    assert.equal(run(q).query.emergency, true, q);
  }
  for (const q of ['pizza', 'my back hurts', 'heart doctor', 'bleacher seats']) assert.equal(run(q).query.emergency, false, q);
});

test('an emergency word is never "corrected" into a business word: "stroke" is not "strike"', () => {
  const r = run('stroke');
  assert.deepEqual(r.query.corrections, []);
  assert.ok(!names(r).includes('Lucky Strike Lanes'));
});

test('a business name with hour words in it finds that business, not a filter: "Open Road"', () => {
  const r = run('Open Road');
  assert.deepEqual(r.query.filters, {});
  assert.equal(names(r)[0], 'Open Road Outpost & Biergarten', 'no hours listed, so an open-now filter would have hidden it');
  assert.equal(names(run('Open Road Outpost & Biergarten'))[0], 'Open Road Outpost & Biergarten');
  // Closed on Sundays, so a Sunday filter would have hidden it too.
  const s = run('Sunday Morning');
  assert.deepEqual(s.query.filters, {});
  assert.equal(names(s)[0], 'Sunday Morning Bakehouse');
});

test('hour words still work as filters when they are not part of a name', () => {
  assert.deepEqual(run('sunday brunch').query.filters, { day: 6 });
  assert.deepEqual(run('open now').query.filters, { open: true });
  assert.deepEqual(run('pizza open now').query.filters, { open: true });
});

test('typing a business’s exact name puts it first as a best match: "Yard House", "Willits Cleaners"', () => {
  const y = run('Yard House');
  assert.equal(names(y)[0], 'Yard House');
  assert.equal(y.results[0].strong, true);
  assert.equal(names(run('Willits Cleaners'))[0], 'Willits Cleaners', 'the town name is a stopword, but not in a name typed in full');
});

test('spelling corrections name a real word, never a chopped-off one', () => {
  assert.equal(run('chipolte').query.corrections[0].to, 'chipotle');
  assert.equal(run('Trader Joe’s').query.corrections.find(c => c.from === 'joes').to, 'jones');
  // Drop one letter from every longer word in the listings: each correction must be a real word.
  const listed = new Set(DOCS.flatMap(b => tokenize(`${b.name} ${b.sub} ${b.tags.join(' ')}`)));
  const real = new Set([...listed, ...INTENTS.flatMap(it => [...it.p, ...(it.a || [])].map(normalize))]);
  for (const word of [...listed].filter(w => w.length >= 6 && /^[a-z]+$/.test(w))) {
    for (const k of [1, word.length - 2]) {
      const typo = word.slice(0, k) + word.slice(k + 1);
      for (const c of parseQuery(index, typo).corrections) assert.ok(real.has(normalize(c.to)), `${typo} -> ${c.to}`);
    }
  }
});

test('a phone number typed as printed finds the business', () => {
  const b = DOCS.find(d => d.name === 'Riverside Physical Therapy');
  const local = b.phone.slice(6);
  for (const q of [b.phone, `1 ${b.phone}`, `+1 ${b.phone}`, b.phone.replace(/\D/g, '').replace(/(\d{3})(\d{3})(\d{4})/, '$1.$2.$3'), local]) {
    const r = run(q);
    assert.deepEqual(names(r), ['Riverside Physical Therapy'], q);
    assert.equal(r.partial, false, q);
  }
  const start = run('(707) 555');
  assert.ok(start.total > 0 && start.results.every(x => x.doc.b.phone.startsWith('(707) 555')));
});

test('A to Z ignores capitals and accents', () => {
  const idx = buildIndex([biz({ name: 'zebra Rugs' }), biz({ name: 'Éclair House' }), biz({ name: 'apple Tree' }), biz({ name: 'Eclair Bar' })]);
  assert.deepEqual(names(search(idx, '', { now: MON_NOON })), ['apple Tree', 'Eclair Bar', 'Éclair House', 'zebra Rugs']);
});

test('"open late" keeps places open until 10 PM or later that haven’t closed yet', () => {
  const lateNight = names(run('open late', { now: { day: 0, minutes: 23 * 60 + 30 } }));
  assert.ok(lateNight.includes('Late Bar'));
  assert.ok(!lateNight.includes('Evening Bistro'), 'closed at 10 PM, so not open late at 11:30 PM');
  const afternoon = names(run('open late', { now: { day: 0, minutes: 15 * 60 } }));
  assert.ok(afternoon.includes('Late Bar') && afternoon.includes('Evening Bistro'));
  assert.ok(!afternoon.includes('Breakfast Nook'));
  assert.ok(names(run('open late', { now: { day: 1, minutes: 30 } })).includes('Late Bar'), 'Monday’s hours run until 2 AM');
});

test('"open late saturday" looks at Saturday’s hours, whatever day it is now', () => {
  const r = names(run('open late saturday', { now: { day: 0, minutes: 23 * 60 + 30 } }));
  assert.ok(r.includes('Saturday Lounge'), 'open until 11 PM on Saturdays');
  assert.ok(!r.includes('Breakfast Nook'));
});

test('"open today" means open at some time today, not this minute', () => {
  const sevenAm = { day: 0, minutes: 7 * 60 };
  const today = run('pharmacy open today', { now: sevenAm });
  assert.deepEqual(today.query.filters, { day: 0 });
  assert.ok(names(today).includes('Pine Pharmacy'), 'opens at 9 AM today');
  assert.ok(!names(run('pharmacy open now', { now: sevenAm })).includes('Pine Pharmacy'));
});

test('"my back hurts" finds chiropractors, physical therapists and doctors, not banks', () => {
  for (const q of ['my back hurts', 'lower back pain', 'bad back', 'pain in my lower back', 'my neck is killing me']) {
    const r = run(q);
    assert.deepEqual(r.query.corrections, [], q);
    for (const name of ['Oak Chiropractic', 'Riverside Physical Therapy', 'Valley Spine & Pain']) assert.ok(strongNames(r).includes(name), `${q}: ${name}`);
    assert.ok(names(r).includes('Elm Family Medicine'), `${q}: a family doctor is related`);
    for (const name of ['Bank of Review', 'Back-Up Kids Care']) assert.ok(!names(r).includes(name), `${q}: ${name}`);
  }
});

test('other aches go to the right kind of doctor, and "ache" is never corrected to "acne"', () => {
  assert.equal(names(run('my foot hurts'))[0], 'Happy Feet Podiatry');
  assert.deepEqual(run('stomach ache').query.corrections, []);
  const wrist = run('my wrist hurts');
  assert.ok(strongNames(wrist).includes('Summit Orthopaedics'));
  assert.ok(strongNames(wrist).every(name => DOCS.find(d => d.name === name).category === 'health'));
});

test('typing a few letters isn’t offered made-up ache phrases ("pulled my toe" for "pul")', () => {
  const aches = ['Back & neck pain', 'Bone & joint doctors', 'Foot doctors (podiatry)', 'Dentists', 'Hearing care'];
  for (const q of ['pul', 'bad', 'sti']) {
    assert.deepEqual(suggest(index, q).filter(s => s.type === 'intent' && aches.includes(s.label)), [], q);
  }
  assert.ok(suggest(index, 'nec').some(s => s.type === 'intent' && s.label === 'Back & neck pain'));
});

test('fix words say what kind of job it is: "who fixes air conditioning"', () => {
  const r = run('who fixes air conditioning');
  assert.equal(r.partial, false);
  assert.deepEqual(r.query.corrections, []);
  assert.deepEqual(strongNames(r).sort(), ['Cool Air Comfort', 'Polar Heating & Cooling']);
});

test('fixing a car means a repair shop, not a car wash: "get my car fixed", "fix my car"', () => {
  for (const q of ['get my car fixed', 'fix my car', 'my car is broken', 'car broke down']) {
    const r = run(q);
    assert.deepEqual(r.query.corrections, [], `${q}: "fixed" is not "fired"`);
    assert.equal(names(r)[0], 'Baechtel Auto Repair', q);
    assert.ok(!strongNames(r).includes('Shine Car Wash') && !strongNames(r).includes('Corner Gas'), q);
  }
});

test('a fix phrase that already names the job keeps it, and "fix" alone means a handyman', () => {
  assert.ok(strongNames(run('fix my house')).includes('Green Acres Landscaping'), 'every home service, not only handymen');
  assert.equal(names(run('fix'))[0], 'Handy Helpers');
});

test('a filler word never names a kind of place: "close to me", "pizza shop"', () => {
  const p = run('pharmacy close to me');
  assert.equal(p.partial, false);
  assert.deepEqual(strongNames(p).sort(), ['Night Owl Pharmacy', 'Pine Pharmacy']);
  const z = run('pizza shop');
  assert.equal(z.partial, false);
  assert.equal(names(z)[0], 'Tony’s Pizza');
});

test('splitFilters: the exact contract the page relies on', () => {
  assert.deepEqual(splitFilters(index, 'pizza open now'), { rest: 'pizza', filters: { open: true } });
  assert.deepEqual(splitFilters(index, 'open now'), { rest: '', filters: { open: true } });
  assert.deepEqual(splitFilters(index, 'Open Road'), { rest: 'Open Road', filters: {} });
  assert.deepEqual(splitFilters(index, 'Sunday Morning'), { rest: 'Sunday Morning', filters: {} });
  assert.deepEqual(splitFilters(index, 'sunday brunch'), { rest: 'brunch', filters: { day: 6 } });
  assert.deepEqual(splitFilters(index, 'late night pizza'), { rest: 'pizza', filters: { late: true } });
  assert.deepEqual(splitFilters(index, 'pizza'), { rest: 'pizza', filters: {} });
  assert.deepEqual(splitFilters(index, ''), { rest: '', filters: {} });
  assert.deepEqual(splitFilters(index, 'open an account'), { rest: 'open an account', filters: {} }, 'a bank phrase, not "open now"');
  assert.deepEqual(splitFilters(index, 'pharmacy open today', { now: { day: 3, minutes: 420 } }), { rest: 'pharmacy', filters: { day: 3 } });
});

test('splitFilters keeps the visitor’s own spelling of the other words', () => {
  assert.equal(splitFilters(index, 'Pizza Open Now').rest, 'Pizza');
  assert.equal(splitFilters(index, '  pizza   open now  ').rest, 'pizza');
  assert.equal(splitFilters(index, 'pizza, open now!').rest, 'pizza');
  assert.equal(splitFilters(index, 'pizza open-now').rest, 'pizza');
  for (const words of ['Joe’s Café & Bar', 'Café Monet', 'AT&T store', 'rock&roll', 'Kids’ 1st Dentist', 'tacos 🌮 burritos']) {
    const { rest, filters } = splitFilters(index, `${words} open now`);
    assert.equal(rest, words);
    assert.deepEqual(tokenize(rest), tokenize(words));
    assert.deepEqual(filters, { open: true });
  }
});

test('searching the rest with the Open now button matches typing the hour words', () => {
  const evening = { now: { day: 0, minutes: 18 * 60 } };
  const { rest, filters } = splitFilters(index, 'pizza open now');
  assert.deepEqual(names(run(rest, { ...evening, open: filters.open })), names(run('pizza open now', evening)));
});

// Follow-up fixes after the review fixes were checked.

test('an appliance that broke down or won’t start isn’t a car problem: “my ac broke down”', () => {
  for (const q of ['my ac broke down', 'furnace won’t start', 'my heat pump broke down']) {
    const r = run(q);
    assert.equal(r.partial, false, q);
    assert.deepEqual(strongNames(r).sort(), ['Cool Air Comfort', 'Polar Heating & Cooling'], q);
    assert.ok(!names(r).includes('Baechtel Auto Repair'), q);
  }
  for (const q of ['my car won’t start', 'my car broke down', 'broke down', 'won’t start']) assert.equal(names(run(q))[0], 'Baechtel Auto Repair', q);
});

test('“shops” on its own means shops, and “close” never means a kind of place', () => {
  for (const q of ['shops', 'shop', 'local shops', 'shops near me']) assert.deepEqual(names(run(q)).sort(), ['Main Street Books', 'Ridgewood Gifts'], q);
  assert.deepEqual(names(run('shops downtown')), ['Main Street Books']);
  assert.deepEqual(run('close to me').query.concepts, [], 'it says how near, not a closing on a house');
});

test('splitFilters leaves no words when only filler is left: “what’s open now?”', () => {
  for (const q of ['what’s open now', "what's open now?", 'anything open now', 'is anything open now?', 'open near me', 'places open now', 'open now please', 'find me something open now', 'store open']) {
    assert.deepEqual(splitFilters(index, q), { rest: '', filters: { open: true } }, q);
  }
  // Filler words that name a kind of place together are kept.
  assert.deepEqual(splitFilters(index, 'shops open now'), { rest: 'shops', filters: { open: true } });
  assert.deepEqual(splitFilters(index, 'take out open now'), { rest: 'take out', filters: { open: true } });
});

test('a fix word counts when nothing else names a kind of place: “repair downtown”, “foundation repair”', () => {
  const downtown = names(run('repair downtown'));
  assert.ok(downtown.includes('Handy Helpers'));
  assert.ok(!downtown.includes('Tony’s Pizza'), 'not every place downtown');
  const foundation = run('foundation repair');
  assert.equal(foundation.partial, true);
  assert.equal(names(foundation)[0], 'Handy Helpers');
});

test('a listing whose name has no Latin letters never takes over a search with no words', () => {
  const idx = buildIndex([biz({ name: '스시 하우스', category: 'restaurants' }), biz({ name: 'Apple Tree', category: 'restaurants' }), biz({ name: 'Zebra Rugs', category: 'shopping' })]);
  for (const q of ['', '???', '!!']) assert.equal(search(idx, q, { now: MON_NOON }).total, 3, q);
  assert.equal(search(idx, '', { now: MON_NOON, category: 'restaurants' }).total, 2);
});

test('after midnight, “open late” and “late night food” mean open right now', () => {
  const tue1am = { now: { day: 1, minutes: 60 } };
  for (const q of ['open late', 'late night food']) assert.deepEqual(names(run(q, tue1am)), ['Late Bar'], `${q}: the others don’t open until the morning`);
});

test('“open today” and “open later today” leave out places already closed for the day', () => {
  const mon7pm = { now: { day: 0, minutes: 19 * 60 } };
  const p = run('pharmacy open today', mon7pm);
  assert.deepEqual(names(p), ['Night Owl Pharmacy'], 'Pine Pharmacy closed at 6 PM');
  assert.deepEqual(p.query.filters, { day: 0 });
  assert.equal(p.query.today, true);
  const later = names(run('open later today', mon7pm));
  for (const name of ['Late Bar', 'Evening Bistro', 'Tony’s Pizza', 'Saturday Lounge']) assert.ok(later.includes(name), name);
  for (const name of ['Breakfast Nook', 'Pine Pharmacy', 'Sunday Morning Bakehouse']) assert.ok(!later.includes(name), name);
  assert.ok(!run('pharmacy open now', mon7pm).query.today);
});

test('a misspelled emergency word still shows the call-911 notice: “heart atack”, “ambulence”', () => {
  for (const q of ['ambulence', 'heart atack', 'heart attak', 'overdoze', 'poisn', 'posion', 'storke', 'strok', 'bleding']) {
    const r = run(q);
    assert.equal(r.query.emergency, true, q);
    assert.deepEqual(r.query.corrections, [], `${q} isn’t “corrected” into a business word`);
  }
  assert.ok(!names(run('strok')).includes('Lucky Strike Lanes'));
  for (const q of ['panic atack', 'lucky strike', 'strike', 'painter', 'bleacher seats']) assert.equal(run(q).query.emergency, false, q);
  // A correction that is the emergency word anyway still happens.
  assert.deepEqual(run('emergancy room').query.corrections.map(c => c.to), ['emergency']);
});

test('“won’t open” is a job to do, not the Open now filter: “garage door won’t open”', () => {
  for (const q of ['garage door won’t open', 'garage door not opening', 'my garage door doesn’t open']) {
    const r = run(q);
    assert.deepEqual(r.query.filters, {}, q);
    assert.deepEqual(r.query.corrections, [], `${q}: “won’t” isn’t a typo`);
    assert.equal(names(r)[0], 'Liftmaster Garage Doors', `${q}: no hours listed, so an Open now filter would have hidden it`);
    assert.deepEqual(splitFilters(index, q), { rest: q, filters: {} });
  }
  assert.deepEqual(run('is the bank open').query.filters, { open: true });
});

test('“shop” means Shopping only when the other words just say where: “bake shop” is the bakery', () => {
  assert.equal(names(run('bake shop'))[0], 'Sunday Morning Bakehouse');
  assert.ok(!names(run('bake shop')).includes('Main Street Books'), 'not every shop');
  assert.ok(!names(run('vape shop')).includes('Main Street Books'), 'a kind of shop nobody here is finds no shops');
  // With only a street or neighborhood beside it, the shop word still means Shopping.
  assert.ok(names(run('shops on review road')).includes('Main Street Books'));
  assert.ok(names(run('shops downtown')).includes('Main Street Books'));
  assert.ok(names(run('shops')).includes('Ridgewood Gifts'));
});

test('real words near an emergency word don’t raise the 911 notice, but slips in two-word emergencies do', () => {
  for (const q of ['hormone imbalance', 'overcome anxiety', 'speeding lawyer', 'dog breeding', 'prison', 'blessing', 'sledding',
    'heat pump', 'hearing aid', 'chest of drawers', 'cedar chest', 'pan asian', 'pain management']) {
    assert.equal(run(q).query.emergency, false, q);
  }
  for (const q of ['heat attack', 'hear attack', 'chest pian', 'chest pan', 'cheest pain', 'my cheest hurts', 'someone ovrdosed', 'poisned']) {
    assert.equal(run(q).query.emergency, true, q);
  }
});
