// U.S. public holidays, for reading opening hours that a website publishes one week at a time.
// Chain stores' location pages show this week's hours, so a page read in Thanksgiving week says "closed Thursday".
import { parseHours } from '../../assets/js/hours.js';

const DAY_MS = 864e5;
/** The n-th weekday (0 = Sunday) of a month (0 = January), or the last one when n is -1, as a UTC date. */
function nthWeekday(year, month, weekday, n) {
  if (n > 0) {
    const first = new Date(Date.UTC(year, month, 1)).getUTCDay();
    return new Date(Date.UTC(year, month, 1 + ((weekday - first + 7) % 7) + (n - 1) * 7));
  }
  const last = new Date(Date.UTC(year, month + 1, 0));
  return new Date(Date.UTC(year, month, last.getUTCDate() - ((last.getUTCDay() - weekday + 7) % 7)));
}

/** Days most businesses close or keep special hours. */
export function holidays(year) {
  return [
    new Date(Date.UTC(year, 0, 1)), // New Year's Day
    nthWeekday(year, 4, 1, -1), // Memorial Day: the last Monday in May
    new Date(Date.UTC(year, 6, 4)), // Independence Day
    nthWeekday(year, 8, 1, 1), // Labor Day: the first Monday in September
    nthWeekday(year, 10, 4, 4), // Thanksgiving: the fourth Thursday in November
    new Date(Date.UTC(year, 11, 25)), // Christmas Day
  ];
}

/**
 * True when hours read from a web page on `checked` (YYYY-MM-DD) may show a holiday closure as a weekly one:
 * a public holiday falls within six days of the reading, and the hours have that weekday closed although the
 * business opens on at least four other days. Such hours aren't published; showing a shop as closed every
 * Thursday because it closed on Thanksgiving is worse than showing no hours.
 */
export function holidayClosure(hours, checked) {
  if (!hours || !/^\d{4}-\d{2}-\d{2}$/.test(checked || '')) return false;
  const p = parseHours(hours);
  if (!p || p.is247) return false;
  const day = Date.parse(`${checked}T12:00:00Z`);
  const year = new Date(day).getUTCFullYear();
  const openDays = p.week.filter(d => d.length).length;
  return [year - 1, year, year + 1].flatMap(holidays).some(h => {
    if (Math.abs(h.getTime() + DAY_MS / 2 - day) > 6.5 * DAY_MS) return false;
    const weekday = (h.getUTCDay() + 6) % 7; // Monday = 0, as in parseHours
    return !p.week[weekday].length && openDays >= 4;
  });
}
