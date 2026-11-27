// Opening-hours utilities for Fort Bragg Local (browser + Node, no dependencies).
//
// Data uses a practical subset of the OpenStreetMap `opening_hours` syntax:
//   "Mo-Fr 09:00-17:00; Sa 10:00-14:00; Su off"
//   "Mo-Th 11:00-21:00; Fr,Sa 11:00-22:00; Su 12:00-20:00"
//   "Mo-Fr 11:00-14:00,17:00-21:00"      (split shifts)
//   "Tu-Su 17:00-02:00"                   (open past midnight)
//   "24/7"
// Rules apply left to right; a later rule replaces earlier ones for the days it names
// (OSM semantics). Holiday / month / week rules are ignored. If nothing parses, hours
// are treated as unknown rather than guessed: showing wrong hours is worse than none.

export const DAY_CODES = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];
export const DAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
export const DAY_SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
export const TIME_ZONE = 'America/Los_Angeles';

const DAY_RE = '(?:Mo|Tu|We|Th|Fr|Sa|Su)';
const DAYSEL_RE = new RegExp(`^(${DAY_RE}(?:-${DAY_RE})?(?:,${DAY_RE}(?:-${DAY_RE})?)*)(?:\\s+|$)`);
const RANGE_RE = /^(\d{1,2}):(\d{2})-(\d{1,2}):(\d{2})$/;
const DAY_MINUTES = 1440;

/**
 * Parse an opening_hours string.
 * @returns {{ week: number[][][], is247: boolean } | null}
 *   week[d] = sorted list of [startMinute, endMinute] for day d (0 = Monday). endMinute may
 *   exceed 1440 when a range runs past midnight. Returns null when nothing usable parses.
 */
export function parseHours(input) {
  if (!input || typeof input !== 'string') return null;
  const str = input.trim();
  if (!str) return null;
  if (/^24\/7$/.test(str)) return { week: DAY_CODES.map(() => [[0, DAY_MINUTES]]), is247: true };

  // A comma after a time and before a day code separates rules ("..17:00, Sa 10:00-14:00").
  const rules = str
    .replace(new RegExp(`(\\d{2}:\\d{2}|off|closed)\\s*,\\s*(?=(${DAY_RE}|PH)\\b)`, 'g'), '$1;')
    .split(/\s*;\s*|\s*\|\|\s*/);

  const week = DAY_CODES.map(() => null); // null = no rule seen for that day yet
  let parsedAny = false;

  for (let rule of rules) {
    rule = rule.trim();
    if (!rule) continue;
    // Skip rules about holidays, months, dates or weeks: they can't be evaluated reliably.
    if (/\b(PH|SH|easter|week)\b|\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\b|"/.test(rule)) continue;

    let days = [0, 1, 2, 3, 4, 5, 6];
    let rest = rule;
    const dm = rule.match(DAYSEL_RE);
    if (dm) {
      days = expandDays(dm[1]);
      rest = rule.slice(dm[0].length).trim();
    }
    if (!days.length) continue;

    if (/^(off|closed)$/i.test(rest)) {
      days.forEach(d => { week[d] = []; });
      parsedAny = true;
      continue;
    }
    if (rest === '24/7') {
      days.forEach(d => { week[d] = [[0, DAY_MINUTES]]; });
      parsedAny = true;
      continue;
    }
    const ranges = [];
    let ok = rest.length > 0;
    for (const part of rest.split(/\s*,\s*/)) {
      const m = part.match(RANGE_RE);
      if (!m) { ok = false; break; }
      const s = +m[1] * 60 + +m[2];
      let e = +m[3] * 60 + +m[4];
      if (+m[2] > 59 || +m[4] > 59 || s >= DAY_MINUTES || e > DAY_MINUTES * 2) { ok = false; break; }
      if (e <= s) e += DAY_MINUTES; // runs past midnight
      ranges.push([s, e]);
    }
    if (!ok || !ranges.length) continue;
    ranges.sort((a, b) => a[0] - b[0]);
    days.forEach(d => { week[d] = ranges.map(r => r.slice()); });
    parsedAny = true;
  }
  if (!parsedAny) return null;
  // Days never mentioned are closed (OSM semantics).
  return { week: week.map(d => d || []), is247: false };
}

function expandDays(sel) {
  const out = new Set();
  for (const part of sel.split(',')) {
    const [a, b] = part.split('-');
    const i = DAY_CODES.indexOf(a);
    if (i < 0) continue;
    if (!b) { out.add(i); continue; }
    const j = DAY_CODES.indexOf(b);
    if (j < 0) continue;
    // Wrap-around ranges such as "Fr-Mo" are valid.
    for (let k = i; ; k = (k + 1) % 7) { out.add(k); if (k === j) break; }
  }
  return [...out].sort((x, y) => x - y);
}

/** Current day (0 = Monday) and minute-of-day in Fort Bragg, regardless of the visitor's own time zone. */
export function localNow(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: TIME_ZONE, weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(date);
  const get = t => (parts.find(p => p.type === t) || {}).value;
  const day = DAY_SHORT.indexOf(get('weekday'));
  const hour = +get('hour') % 24;
  return { day, minutes: hour * 60 + +get('minute') };
}

/** Is the place open at (day, minute)? Accounts for ranges that spill over from the day before. */
export function isOpenAt(parsed, day, minutes) {
  if (!parsed) return null;
  if (parsed.is247) return true;
  if (parsed.week[day].some(([s, e]) => s <= minutes && minutes < e)) return true;
  return parsed.week[(day + 6) % 7].some(([, e]) => e > DAY_MINUTES && minutes + DAY_MINUTES < e);
}

/**
 * Describe the current status in plain English.
 * @returns {{ state: 'open'|'closed'|'unknown', label: string, detail: string,
 *             closingSoon: boolean, opensSoon: boolean, openLate: boolean }}
 */
export function hoursStatus(parsed, now = localNow()) {
  const base = { closingSoon: false, opensSoon: false, openLate: false };
  if (!parsed) return { ...base, state: 'unknown', label: 'Hours not listed', detail: 'Call ahead to check hours' };
  if (parsed.is247) return { ...base, state: 'open', label: 'Open 24 hours', detail: 'Open every day, all day', openLate: true };
  const { day, minutes } = now;

  // Are we inside a range (today's, or one spilling over from yesterday)? closeAt is
  // measured in minutes from the start of today.
  let closeAt = null;
  for (const [s, e] of parsed.week[day]) if (s <= minutes && minutes < e) closeAt = Math.max(closeAt ?? 0, e);
  for (const [, e] of parsed.week[(day + 6) % 7]) {
    if (e > DAY_MINUTES && minutes + DAY_MINUTES < e) closeAt = Math.max(closeAt ?? 0, e - DAY_MINUTES);
  }

  if (closeAt !== null) {
    closeAt = extendClose(parsed, day, closeAt);
    if (closeAt >= DAY_MINUTES * 7) return { ...base, state: 'open', label: 'Open now', detail: 'Open around the clock', openLate: true };
    return {
      ...base, state: 'open', label: 'Open now',
      detail: `Closes at ${fmtTime(closeAt)}`,
      closingSoon: closeAt - minutes <= 45,
      openLate: closeAt >= 22 * 60,
    };
  }
  // Closed: find the next opening within a week.
  for (let offset = 0; offset < 8; offset++) {
    const d = (day + offset) % 7;
    const starts = parsed.week[d].map(([s]) => s).filter(s => offset > 0 || s > minutes);
    if (!starts.length) continue;
    const first = Math.min(...starts);
    const when = offset === 0 ? '' : offset === 1 ? 'tomorrow ' : `${DAY_NAMES[d]} `;
    const soon = offset === 0 && first - minutes <= 60;
    return { ...base, state: 'closed', label: soon ? 'Opens soon' : 'Closed now', detail: `Opens ${when}at ${fmtTime(first)}`, opensSoon: soon };
  }
  return { ...base, state: 'closed', label: 'Closed now', detail: 'No upcoming hours listed' };
}

// If the place reopens exactly when it closes (e.g. a midnight hand-off), keep going.
function extendClose(parsed, day, closeAt) {
  for (let guard = 0; guard < 14; guard++) {
    const absDay = day + Math.floor(closeAt / DAY_MINUTES);
    const minuteOfDay = closeAt % DAY_MINUTES;
    const next = parsed.week[absDay % 7].find(([s]) => s === minuteOfDay);
    if (!next) break;
    closeAt = (absDay - day) * DAY_MINUTES + next[1];
  }
  return closeAt;
}

/** 13:30 -> "1:30 PM"; 0 or 1440 -> "midnight"; 720 -> "noon". */
export function fmtTime(min) {
  min = ((min % DAY_MINUTES) + DAY_MINUTES) % DAY_MINUTES;
  if (min === 0) return 'midnight';
  if (min === 720) return 'noon';
  const h = Math.floor(min / 60), m = min % 60;
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}${m ? ':' + String(m).padStart(2, '0') : ''} ${h < 12 ? 'AM' : 'PM'}`;
}

/** Weekly table rows for display: [{ day: 'Monday', text: '9 AM – 5 PM', isToday }] */
export function weekTable(parsed, now = localNow()) {
  if (!parsed) return [];
  return DAY_NAMES.map((name, d) => {
    const ranges = parsed.week[d];
    let text;
    if (parsed.is247) text = 'Open 24 hours';
    else if (!ranges.length) text = 'Closed';
    else text = ranges.map(([s, e]) => (s === 0 && e === DAY_MINUTES ? 'Open 24 hours' : `${fmtTime(s)} – ${fmtTime(e)}`)).join(', ');
    return { day: name, text, isToday: d === now.day };
  });
}

/** Does the place have any hours on a given weekday (0 = Monday)? */
export function opensOnDay(parsed, day) {
  return !!parsed && (parsed.is247 || parsed.week[day].length > 0);
}

// ---------------------------------------------------------------------------
// Build-time normaliser: turns loosely written hours ("Mon-Fri 9am-5pm; Sat 10am-2pm")
// into canonical OSM syntax, or returns null if it can't do so confidently.
// ---------------------------------------------------------------------------
const DAY_WORDS = [
  [/\b(mondays?|mon)\b\.?/gi, 'Mo'], [/\b(tuesdays?|tues?)\b\.?/gi, 'Tu'], [/\b(wednesdays?|wed)\b\.?/gi, 'We'],
  [/\b(thursdays?|thurs?|thu)\b\.?/gi, 'Th'], [/\b(fridays?|fri)\b\.?/gi, 'Fr'], [/\b(saturdays?|sat)\b\.?/gi, 'Sa'],
  [/\b(sundays?|sun)\b\.?/gi, 'Su'],
];

export function normalizeHours(input) {
  if (!input || typeof input !== 'string') return null;
  let s = input.trim();
  if (!s) return null;
  s = s.replace(/[–—−]/g, '-').replace(/\s+to\s+/gi, '-').replace(/\s*-\s*/g, '-');
  s = s.replace(/\bdaily\b|\bevery ?day\b|\bseven days a week\b/gi, 'Mo-Su');
  s = s.replace(/\bweekdays\b/gi, 'Mo-Fr').replace(/\bweekends\b/gi, 'Sa,Su');
  s = s.replace(/\bopen 24 hours\b|\b24 hours\b/gi, '00:00-24:00');
  for (const [re, code] of DAY_WORDS) s = s.replace(re, code);
  s = s.replace(/\bnoon\b/gi, '12:00pm').replace(/\bmidnight\b/gi, '12:00am');
  s = s.replace(/\bclosed\b/gi, 'off');
  // 9am / 9:30 pm / 9 a.m. -> 24h
  s = s.replace(/(\d{1,2})(?::(\d{2}))?\s*([ap])\.?\s*m\.?/gi, (_, h, m, ap) => {
    let hh = +h % 12;
    if (ap.toLowerCase() === 'p') hh += 12;
    return `${String(hh).padStart(2, '0')}:${m || '00'}`;
  });
  s = s.replace(/\b(\d{1,2}):(\d{2})\b/g, (_, h, m) => `${String(+h).padStart(2, '0')}:${m}`);
  // Midnight to midnight is how websites' structured data marks a day closed (the schema.org convention Google
  // documents), and 23:59 is their "until midnight". Read as "open all day", it put banks open all weekend.
  s = s.replace(/\b00:00-00:00\b/g, 'off').replace(/-23:59\b/g, '-24:00');
  // "12:00am" closing times become 24:00 so a range like 17:00-00:00 stays sensible.
  s = s.replace(/-00:00\b/g, '-24:00');
  s = s.replace(/\s*,\s*/g, ',').replace(/\s*;\s*/g, '; ').replace(/\s{2,}/g, ' ');
  s = s.replace(new RegExp(`(${DAY_RE})\\s*:\\s*`, 'g'), '$1 ');      // "Mo-Fr: 09:00" -> "Mo-Fr 09:00"
  s = s.replace(new RegExp(`(\\d{2}:\\d{2}|off),(?=${DAY_RE})`, 'g'), '$1; ');
  if (/^(Mo-Su )?00:00-24:00$/.test(s)) s = '24/7';
  const p = parseHours(s);
  if (!p) return null;
  // Every rule must have parsed: count the rules we expect vs. day-sets we got.
  const ruleCount = s.split(/;\s*/).filter(r => r.trim() && !/\b(PH|SH)\b/.test(r)).length;
  const ok = s.split(/;\s*/).every(r => !r.trim() || /\b(PH|SH)\b/.test(r) || parseHours(r));
  if (!ok || ruleCount === 0) return null;
  // Hours with no open time at all ("Su off" alone) say nothing about the other days: unknown, not closed all week.
  if (!p.is247 && p.week.every(d => !d.length)) return null;
  // Reject results that look broken (a range shorter than 15 minutes).
  if (!p.is247) for (const d of p.week) for (const [st, en] of d) if (en - st < 15) return null;
  return s;
}
