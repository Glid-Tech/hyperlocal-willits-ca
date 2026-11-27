// The data tools' matching rules. A wrong match here mixes two businesses into one listing (another shop's phone,
// website or search words), so the cases below are ones that went wrong before.
import test from 'node:test';
import assert from 'node:assert/strict';
import { sharesIdentifyingWord, prettyStreet, nameSimilarity, addressKey } from '../tools/lib/common.mjs';
import { addressNeedle, addressOnPage, pageFacts, normAddr, UA } from '../tools/lib/pagecheck.mjs';
import { isOwnWebsite, classifySource, isNeverVisit } from '../tools/lib/source-policy.mjs';
import { classify } from '../tools/lib/osm-map.mjs';

test('names that share only a kind of business or a location are not the same business', () => {
  const different = [
    ['Nuts Factory', 'The Cheesecake Factory'],
    ['Massage Express', 'Panda Express'],
    ['Wells Fargo Bank (Main St)', 'Chase Bank - Main Street'],
    ['Willits Bakery', 'Willits Feed & Pet'],
    ['Little Lake Grange', 'Little Lake Dental'],
    ['Brooktrails Lodge', 'Brooktrails Market'],
    ['Mendocino Coast Clinics', 'Mendocino Coast Optometric'],
    // Two places that share one street address in Willits: 299 East Commercial Street and 400 East Commercial Street.
    ['Skunk Train', 'Willits Chamber of Commerce'],
    ['Mendocino County Museum', 'Roots of Motive Power'],
    ['Mendocino County Museum', 'Mendocino County Library'],
    ['PAUL Bakery', 'Corner Bakery Cafe'],
    ['Pizza Hut', 'Badd Pizza'],
    ['AT&T Store', 'T-Mobile'],
  ];
  for (const [a, b] of different) assert.equal(sharesIdentifyingWord(a, b), false, `${a} / ${b}`);
});

test('names that share the word that names the business still match', () => {
  const same = [
    ['Safeway', 'Safeway Pharmacy'],
    ['Skunk Train', 'Skunk Train Railbikes'],
    ['Roots of Motive Power', 'Roots of Motive Power Museum'],
    ['Adventist Health Howard Memorial', 'Adventist Health Howard Memorial Pharmacy'],
  ];
  for (const [a, b] of same) assert.equal(sharesIdentifyingWord(a, b), true, `${a} / ${b}`);
  // Names that differ only in filler still match on their joined spelling.
  assert.ok(nameSimilarity('Willits Dental', 'Willits Dental Care') >= 0.85);
});

test('street addresses keep a house number letter and spell out directions and highways', () => {
  assert.equal(prettyStreet('32096-B N Harbor Dr'), '32096-B North Harbor Drive');
  assert.equal(prettyStreet('780b n franklin st.'), '780B North Franklin Street');
  assert.equal(prettyStreet('1st Street'), '1st Street');
  assert.equal(prettyStreet('401 N MAIN ST'), '401 North Main Street');
  assert.equal(prettyStreet('18100 CA-20'), '18100 Highway 20');
  assert.equal(prettyStreet('18100 State Hwy 20'), '18100 Highway 20');
  assert.equal(prettyStreet('18100 CA Hwy 20'), '18100 Highway 20');
  assert.equal(prettyStreet('24600 N HWY 1'), '24600 North Highway 1');
  assert.equal(prettyStreet('300 N MCPHERSON ST'), '300 North McPherson Street');
  assert.equal(prettyStreet('At Home Way'), 'At Home Way', 'a first word stays capitalized');
  assert.equal(prettyStreet('845 S Main St'), '845 South Main Street');
  assert.equal(prettyStreet('299 E Commercial St., Willits, CA 95490'), '299 East Commercial Street');
  assert.equal(prettyStreet('1 SHERWOOD RD'), '1 Sherwood Road');
  assert.equal(prettyStreet('200 baechtel rd'), '200 Baechtel Road');
  assert.equal(prettyStreet('500 Hwy 20'), '500 Highway 20');
  assert.equal(prettyStreet('30303 Fort Bragg-Willits Rd'), '30303 Highway 20', 'the local name for Highway 20');
  assert.equal(prettyStreet('30303 Fort Bragg Willits Road'), '30303 Highway 20');
  assert.equal(prettyStreet('1500 Fort Bragg Rd'), '1500 Highway 20', 'its name in town');
  assert.equal(prettyStreet('1500 Ft. Bragg Rd.'), '1500 Highway 20');
  assert.equal(prettyStreet('1 Redwood Hwy'), '1 Redwood Highway', 'old 101 keeps its own street name');
  for (const spelling of ['US 101', 'US-101', 'US Hwy 101', 'U.S. Hwy 101', 'U.S. Highway 101', 'US Highway 101',
    'US Route 101', 'us hwy 101', 'us 101', 'Us-101', 'U.S. 101', 'Hwy 101', 'HWY 101', 'Highway 101', 'US101']) {
    assert.equal(prettyStreet(`2100 ${spelling}`), '2100 Highway 101', spelling);
  }
  assert.equal(prettyStreet('2100 N US Hwy 101'), '2100 North Highway 101');
  assert.equal(prettyStreet('2100 S. Hwy 101'), '2100 South Highway 101');
});

test('one place keeps one address key however its street is written', () => {
  assert.equal(addressKey('2100 North Highway 101'), addressKey('2100 Highway 101'));
  assert.equal(addressKey('2100 N Hwy 101'), addressKey('2100 US-101'));
  assert.equal(addressKey('1500 Fort Bragg Rd'), addressKey('1500 Highway 20'));
  assert.notEqual(addressKey('401 North Main Street'), addressKey('401 South Main Street'), 'in town, North and South Main differ');
});

test('an address is found however a house number letter or highway is written, and only that number', () => {
  const on = (address, text) => addressOnPage(addressNeedle(address), ` ${pageFacts(text).addrText} `);
  assert.ok(on('32096a North Harbor Drive', '32096 - A N HARBOR DR'), 'government list style');
  assert.ok(on('780-B North Franklin Street', '780B N Franklin St, Unit 8'));
  assert.ok(on('401 North Main Street', 'Visit us at 401 N. Main St.'));
  assert.ok(on('18100 Highway 20', '18100 CA-20, Willits, CA 95490'));
  assert.ok(on('24600 North Highway 1', '24600 N. Hwy One'));
  assert.ok(on('30303 Highway 20', '30303 Fort Bragg-Willits Road'));
  assert.ok(on('1500 Highway 20', '1500 Fort Bragg Rd., Willits, CA 95490'));
  assert.ok(on('500 Highway 20', '500 Hwy 20'));
  assert.ok(on('2100 North Highway 101', '2100 N US-101, Willits'));
  assert.ok(on('2100 Highway 101', '2100 U.S. Hwy. 101'));
  assert.ok(on('2100 Highway 101', 'Find us at 2100 US Highway 101'));
  assert.ok(on('299 East Commercial Street', '299 E. Commercial St., Willits, CA 95490'));
  assert.equal(on('401 North Main Street', '401A North Main Street'), false, 'a different unit of the street');
  assert.equal(on('32096a North Harbor Drive', '32096 North Harbor Drive'), false, 'the letter matters');
  assert.equal(on('101 North Franklin Street', '1010 N Franklin St'), false);
});

test('a listing address and the same address on a web page normalise alike, for every route spelling', () => {
  // prettyStreet (a listing) and normAddr (page text) share one ROUTE_ALIASES list; they must never drift apart.
  const norm = s => normAddr(s).trim();
  for (const a of ['18100 CA-20', '18100 State Hwy 20', '18100 CA Hwy 20', '1500 Fort Bragg Rd',
    '30303 Fort Bragg-Willits Road', '2100 US 101', '2100 US Hwy 101', '2100 U.S. Highway 101', '2100 US-101',
    '2100 N Hwy 101', '24600 N Hwy One', '1 Redwood Hwy']) {
    assert.equal(norm(a), norm(prettyStreet(a)), a);
  }
  assert.equal(norm('1500 Fort Bragg Rd'), '1500 highway 20');
  assert.equal(norm('2100 US Hwy 101'), '2100 highway 101');
  for (const text of ['Call us 707-459-1234', 'Call us 707 459 1234', 'Contact us 24 hours a day', 'Email us 7 days a week']) {
    assert.ok(!norm(text).includes('highway'), `page text is not a route: ${text}`);
  }
  assert.equal(norm('Visit us at 2100 US 101'), 'visit us at 2100 highway 101');
});

test('the tools name themselves after the site, with no quotes or apostrophes', () => {
  assert.match(UA, /\bWillitsLocal-fact-checker\/1\.0\b/);
  assert.doesNotMatch(UA, /['"’]/);
});

test('a community or chamber website is never taken for a business’s own site', () => {
  assert.equal(isOwnWebsite('https://brooktrails.org', 'Brooktrails Lodge'), false);
  assert.equal(isOwnWebsite('https://www.willits.org/members/acme', 'Willits Furniture'), false);
  assert.equal(isOwnWebsite('https://visitwillits.com', 'Willits Bakery'), false);
  assert.equal(isOwnWebsite('https://willitsweekly.com', 'Willits Weekly'), true, 'the paper itself');
  assert.equal(classifySource('https://cityofwillits.org/permits'), 'gov');
  assert.equal(classifySource('https://www.btcsd.org/'), 'gov');
  assert.equal(classifySource('https://noyoharbordistrict.org/'), 'other', 'a Fort Bragg district is not ours');
  assert.equal(isNeverVisit('https://mendocinomuseum.org/'), true, 'a lapsed museum domain');
});

test('rural OpenStreetMap places become candidates; cannabis, hunting and weapons shops do not', () => {
  const cat = tags => classify({ name: 'Example', ...tags });
  assert.deepEqual(cat({ shop: 'agrarian' }), { category: 'home', sub: 'Feed & farm supply' });
  assert.deepEqual(cat({ shop: 'country_store' }), { category: 'home', sub: 'Country store & farm supply' });
  assert.deepEqual(cat({ shop: 'gas' }), { category: 'home', sub: 'Propane & bottled gas' });
  assert.equal(cat({ shop: 'farm' }).category, 'groceries', 'a farm stand sells produce');
  for (const shop of ['motorcycle', 'atv', 'trailer']) assert.equal(cat({ shop }).category, 'auto', shop);
  assert.deepEqual(cat({ leisure: 'horse_riding' }), { category: 'arts-fun', sub: 'Horseback riding' });
  assert.equal(cat({ craft: 'sawmill' }).category, 'home');
  assert.equal(cat({ craft: 'welder' }).category, 'home');
  assert.equal(cat({ tourism: 'attraction' }).category, 'arts-fun');
  for (const shop of ['cannabis', 'hunting', 'weapons']) assert.equal(cat({ shop }), null, shop);
});

test('hours read from a website: midnight to midnight is a closed day, never "open all day"', async () => {
  const { normalizeHours } = await import('../assets/js/hours.js');
  const { hoursFromLd } = await import('../tools/lib/pagecheck.mjs');
  assert.equal(normalizeHours('Mo-Fr 09:00-17:00; Sa-Su 00:00-00:00'), 'Mo-Fr 09:00-17:00; Sa-Su off');
  assert.equal(normalizeHours('Su 00:00-00:00'), null, 'one closed day says nothing about the others');
  assert.equal(normalizeHours('Mon-Sun 00:00-00:00'), null, 'a placeholder, not hours');
  assert.equal(normalizeHours('Mo-Su 00:00-23:59'), '24/7');
  assert.equal(normalizeHours('Tu-Sa 17:00-00:00'), 'Tu-Sa 17:00-24:00', 'closing at midnight is unchanged');
  const spec = (d, o, c, extra = {}) => ({ dayOfWeek: d, opens: o, closes: c, ...extra });
  assert.equal(hoursFromLd({ openingHoursSpecification: [spec(['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'], '09:00', '17:00'), spec('Saturday', '00:00', '00:00'), spec('Sunday', '00:00', '00:00')] }), 'Mo-Fr 09:00-17:00');
  assert.equal(hoursFromLd({ openingHoursSpecification: [spec('Sunday', '00:00', '00:00')] }), '');
  assert.equal(hoursFromLd({ openingHoursSpecification: [spec(['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'], '00:00', '23:59')] }), '24/7');
  // A holiday entry (a one-day window) doesn't replace the weekly hours.
  assert.equal(hoursFromLd({ openingHoursSpecification: [spec(['Thursday', 'Friday'], '10:00', '21:00'), spec('Thursday', '00:00', '00:00', { validFrom: '2026-11-26', validThrough: '2026-11-26' })] }), 'Th-Fr 10:00-21:00');
});

test('hours read in a holiday week that show the holiday as a weekly closure are left out', async () => {
  const { holidayClosure } = await import('../tools/lib/holidays.mjs');
  const thanksgivingWeek = 'Mo,Tu,We,Fr,Sa 10:00-21:00; Th off; Su 11:00-19:00';
  assert.equal(holidayClosure(thanksgivingWeek, '2026-11-22'), true, 'read four days before Thanksgiving');
  assert.equal(holidayClosure(thanksgivingWeek, '2026-11-30'), true, 'read four days after it');
  assert.equal(holidayClosure(thanksgivingWeek, '2026-10-14'), false, 'an ordinary week: a real weekly closure');
  assert.equal(holidayClosure('Mo-Fr 09:00-17:00; Sa-Su off', '2026-11-22'), false, 'open on Thanksgiving’s weekday');
  assert.equal(holidayClosure('Tu-Sa 11:00-21:00', '2026-05-24'), true, 'closed Mondays, read in Memorial Day week');
  assert.equal(holidayClosure('Mo-Fr 09:00-17:00', '2026-12-28'), false, 'Christmas was a Friday, and Friday is open');
  assert.equal(holidayClosure('24/7', '2026-11-22'), false);
});
