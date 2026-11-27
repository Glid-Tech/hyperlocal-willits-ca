// The data tools' matching rules. A wrong match here mixes two businesses into one listing (another shop's phone,
// website or search words), so the cases below are ones that went wrong before.
import test from 'node:test';
import assert from 'node:assert/strict';
import { sharesIdentifyingWord, prettyStreet, nameSimilarity, addressKey } from '../tools/lib/common.mjs';
import { addressNeedle, addressOnPage, pageFacts } from '../tools/lib/pagecheck.mjs';

test('names that share only a kind of business or a location are not the same business', () => {
  const different = [
    ['Nuts Factory', 'The Cheesecake Factory'],
    ['Massage Express', 'Panda Express'],
    ['Wells Fargo Bank (Main St)', 'Chase Bank - Main Street'],
    ['Noyo Harbor Inn', 'Noyo Fish Company'],
    ['Mendocino Coast Clinics', 'Mendocino Coast Optometric'],
    ['Coast Cinemas', 'Coast Dental'],
    ['Glass Beach Inn', 'Sea Glass Museum'],
    ['Fort Bragg Bakery', 'Fort Bragg Feed & Pet'],
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
    ['North Coast Brewing Company', 'North Coast Brewing Taproom'],
    ['Adventist Health Mendocino Coast', 'Adventist Health Mendocino Coast Pharmacy'],
  ];
  for (const [a, b] of same) assert.equal(sharesIdentifyingWord(a, b), true, `${a} / ${b}`);
  // Names that differ only in filler still match on their joined spelling.
  assert.ok(nameSimilarity('Fort Bragg Dental', 'Fort Bragg Dental Care') >= 0.85);
});

test('street addresses keep a house number letter and spell out directions and highways', () => {
  assert.equal(prettyStreet('32096-B N Harbor Dr'), '32096-B North Harbor Drive');
  assert.equal(prettyStreet('780b n franklin st.'), '780B North Franklin Street');
  assert.equal(prettyStreet('1st Street'), '1st Street');
  assert.equal(prettyStreet('401 N MAIN ST'), '401 North Main Street');
  assert.equal(prettyStreet('18100 CA-20'), '18100 Highway 20');
  assert.equal(prettyStreet('18100 State Hwy 20'), '18100 Highway 20');
  assert.equal(prettyStreet('24600 N HWY 1'), '24600 North Highway 1');
  assert.equal(prettyStreet('300 N MCPHERSON ST'), '300 North McPherson Street');
  assert.equal(prettyStreet('At Home Way'), 'At Home Way', 'a first word stays capitalized');
  assert.equal(prettyStreet('30303 Fort Bragg-Willits Rd'), '30303 Highway 20', 'the local name for Highway 20');
  assert.equal(prettyStreet('171 Boat Yard Dr'), '171 Boatyard Drive');
});

test('one place keeps one address key however its street is written', () => {
  assert.equal(addressKey('17900 North Highway 1'), addressKey('17900 Highway 1'));
  assert.equal(addressKey('171 Boat Yard Drive'), addressKey('171 Boatyard Dr'));
  assert.notEqual(addressKey('401 North Main Street'), addressKey('401 South Main Street'), 'in town, North and South Main differ');
});

test('an address is found however a house number letter or highway is written, and only that number', () => {
  const on = (address, text) => addressOnPage(addressNeedle(address), ` ${pageFacts(text).addrText} `);
  assert.ok(on('32096a North Harbor Drive', '32096 - A N HARBOR DR'), 'government list style');
  assert.ok(on('780-B North Franklin Street', '780B N Franklin St, Unit 8'));
  assert.ok(on('401 North Main Street', 'Visit us at 401 N. Main St.'));
  assert.ok(on('18100 Highway 20', '18100 CA-20, Fort Bragg, CA 95437'));
  assert.ok(on('24600 North Highway 1', '24600 N. Hwy One'));
  assert.ok(on('30303 Highway 20', '30303 Fort Bragg-Willits Road'));
  assert.equal(on('401 North Main Street', '401A North Main Street'), false, 'a different unit of the street');
  assert.equal(on('32096a North Harbor Drive', '32096 North Harbor Drive'), false, 'the letter matters');
  assert.equal(on('101 North Franklin Street', '1010 N Franklin St'), false);
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
