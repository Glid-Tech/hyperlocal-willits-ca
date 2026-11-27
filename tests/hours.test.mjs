import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseHours, isOpenAt, hoursStatus, fmtTime, weekTable, normalizeHours, localNow } from '../assets/js/hours.js';

const MON = 0, TUE = 1, FRI = 4, SAT = 5, SUN = 6;
const at = (day, hh, mm = 0) => ({ day, minutes: hh * 60 + mm });

test('parses a typical weekly schedule', () => {
  const p = parseHours('Mo-Fr 09:00-17:00; Sa 10:00-14:00; Su off');
  assert.deepEqual(p.week[MON], [[540, 1020]]);
  assert.deepEqual(p.week[SAT], [[600, 840]]);
  assert.deepEqual(p.week[SUN], []);
});

test('days not mentioned are closed', () => {
  const p = parseHours('Mo-Fr 09:00-17:00');
  assert.deepEqual(p.week[SAT], []);
  assert.equal(isOpenAt(p, SAT, 600), false);
});

test('later rules override earlier ones for the same days', () => {
  const p = parseHours('Mo-Su 11:00-22:00; Mo off');
  assert.deepEqual(p.week[MON], []);
  assert.deepEqual(p.week[TUE], [[660, 1320]]);
});

test('comma-separated day lists and split shifts', () => {
  const p = parseHours('Mo,We,Fr 11:00-14:00,17:00-21:00');
  assert.deepEqual(p.week[MON], [[660, 840], [1020, 1260]]);
  assert.deepEqual(p.week[TUE], []);
  assert.equal(isOpenAt(p, MON, 15 * 60), false);
  assert.equal(isOpenAt(p, MON, 18 * 60), true);
});

test('comma between rules (OSM additional-rule separator) is understood', () => {
  const p = parseHours('Mo-Fr 09:00-17:00, Sa 10:00-14:00');
  assert.deepEqual(p.week[FRI], [[540, 1020]]);
  assert.deepEqual(p.week[SAT], [[600, 840]]);
});

test('ranges past midnight spill into the next morning', () => {
  const p = parseHours('Fr,Sa 17:00-02:00');
  assert.equal(isOpenAt(p, FRI, 23 * 60), true);
  assert.equal(isOpenAt(p, SAT, 60), true, 'Saturday 1 AM is still Friday night');
  assert.equal(isOpenAt(p, SAT, 3 * 60), false);
  assert.equal(isOpenAt(p, SUN, 60), true, 'Sunday 1 AM is Saturday night');
  const st = hoursStatus(p, at(SAT, 1, 0));
  assert.equal(st.state, 'open');
  assert.equal(st.detail, 'Closes at 2 AM');
});

test('24/7 and wrap-around day ranges', () => {
  assert.equal(parseHours('24/7').is247, true);
  assert.equal(hoursStatus(parseHours('24/7'), at(MON, 3)).label, 'Open 24 hours');
  const p = parseHours('Fr-Mo 10:00-18:00');
  assert.deepEqual([0, 1, 2, 3, 4, 5, 6].map(d => p.week[d].length), [1, 0, 0, 0, 1, 1, 1]);
});

test('holiday and month rules are ignored, not fatal', () => {
  const p = parseHours('Mo-Fr 08:00-18:00; PH off; Dec 25 off');
  assert.deepEqual(p.week[MON], [[480, 1080]]);
});

test('garbage returns null (unknown hours)', () => {
  assert.equal(parseHours(''), null);
  assert.equal(parseHours('call for hours'), null);
  assert.equal(parseHours('by appointment'), null);
  assert.equal(hoursStatus(null).state, 'unknown');
});

test('status: open, closing soon, opens soon, opens tomorrow, opens later in week', () => {
  const p = parseHours('Mo-Fr 09:00-17:00; Sa 10:00-14:00');
  assert.deepEqual(
    pick(hoursStatus(p, at(MON, 12))), { state: 'open', label: 'Open now', detail: 'Closes at 5 PM', closingSoon: false });
  assert.equal(hoursStatus(p, at(MON, 16, 30)).closingSoon, true);
  const soon = hoursStatus(p, at(MON, 8, 15));
  assert.equal(soon.label, 'Opens soon');
  assert.equal(soon.detail, 'Opens at 9 AM');
  assert.equal(hoursStatus(p, at(MON, 18)).detail, 'Opens tomorrow at 9 AM');
  assert.equal(hoursStatus(p, at(SAT, 15)).detail, 'Opens Monday at 9 AM');
});

test('midnight hand-off is treated as continuous', () => {
  const p = parseHours('Mo-Su 06:00-24:00; Tu 00:00-03:00');
  const st = hoursStatus(p, at(MON, 23));
  assert.equal(st.detail, 'Closes at 3 AM');
  assert.equal(st.openLate, true);
});

test('fmtTime reads naturally', () => {
  assert.equal(fmtTime(0), 'midnight');
  assert.equal(fmtTime(1440), 'midnight');
  assert.equal(fmtTime(720), 'noon');
  assert.equal(fmtTime(9 * 60), '9 AM');
  assert.equal(fmtTime(13 * 60 + 30), '1:30 PM');
  assert.equal(fmtTime(26 * 60), '2 AM');
});

test('weekTable marks today and formats closed days', () => {
  const rows = weekTable(parseHours('Mo-Fr 09:00-17:00'), at(TUE, 10));
  assert.equal(rows.length, 7);
  assert.equal(rows[TUE].isToday, true);
  assert.equal(rows[MON].text, '9 AM – 5 PM');
  assert.equal(rows[SUN].text, 'Closed');
});

test('normalizeHours converts loose formats to canonical OSM syntax', () => {
  assert.equal(normalizeHours('Mon-Fri 9am-5pm; Sat 10am-2pm; Sun closed'), 'Mo-Fr 09:00-17:00; Sa 10:00-14:00; Su off');
  assert.equal(normalizeHours('Monday - Friday: 9:00 AM – 5:30 PM'), 'Mo-Fr 09:00-17:30');
  assert.equal(normalizeHours('Daily 11am-10pm'), 'Mo-Su 11:00-22:00');
  assert.equal(normalizeHours('Mo-Fr 09:00-17:00'), 'Mo-Fr 09:00-17:00');
  assert.equal(normalizeHours('Tu-Su 5pm-midnight'), 'Tu-Su 17:00-24:00');
  assert.equal(normalizeHours('Open 24 hours'), '24/7');
  assert.equal(normalizeHours('Mon-Fri 9am-5pm, Sat 10am-2pm'), 'Mo-Fr 09:00-17:00; Sa 10:00-14:00');
  assert.equal(normalizeHours('Call for an appointment'), null);
  assert.equal(normalizeHours('Mo-Fr 09:00-17:00; by appointment'), null, 'any unparseable rule rejects the whole string');
});

test('localNow uses Pacific time regardless of machine time zone', () => {
  // 2026-07-06T19:30Z is Monday 12:30 PM PDT in Willits.
  assert.deepEqual(localNow(new Date('2026-07-06T19:30:00Z')), { day: MON, minutes: 12 * 60 + 30 });
  // 2026-01-05T07:10Z is Sunday 11:10 PM PST.
  assert.deepEqual(localNow(new Date('2026-01-05T07:10:00Z')), { day: SUN, minutes: 23 * 60 + 10 });
});

function pick(s) { return { state: s.state, label: s.label, detail: s.detail, closingSoon: s.closingSoon }; }
