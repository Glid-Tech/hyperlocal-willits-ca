// Saved copies of government licence lists whose detail pages can't be read by tools.
//
// California's Contractors State License Board (CSLB) sends scripted requests for a licence's detail page
// (LicenseDetail.aspx?LicNum=N) to a page behind reCAPTCHA. The same records are published, without a CAPTCHA,
// as county downloads on CSLB's own Public Data Portal. tools/fetch-cslb.mjs saves those downloads as a text
// list, one licence per line. When a fact cites a CSLB detail page, the audit reads that licence's line from the
// saved list instead of the page. People who follow the link in a browser still see the detail page itself.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const CSLB_LIST = path.join(ROOT, 'data/sources/gov/cslb-licences.txt');
export const CSLB_PORTAL = 'https://www.cslb.ca.gov/onlineservices/dataportal/ListByCounty';

/** The licence number a CSLB detail-page address names, or null. */
export function cslbLicNum(url) {
  try {
    const u = new URL(url);
    if (!/(^|\.)cslb\.ca\.gov$/i.test(u.hostname) || !/licensedetail\.aspx$/i.test(u.pathname)) return null;
    return u.searchParams.get('LicNum')?.replace(/\D/g, '') || null;
  } catch { return null; }
}

let cached;
/** The saved list's lines for one licence, as a plain-text page body, or null when there is no saved list. */
export function cslbLines(licNum, file = CSLB_LIST) {
  if (cached === undefined || cached.file !== file) {
    cached = { file, rows: fs.existsSync(file) ? fs.readFileSync(file, 'utf8').split(/\r?\n/) : null };
  }
  if (!cached.rows) return null;
  return cached.rows.filter(line => line.startsWith(`${licNum} |`)).join('\n');
}

/** Read the first sheet of a portal .xlsx download into objects keyed by its header row. Uses the system unzip. */
export function readXlsx(file) {
  const unzip = member => {
    try { return execFileSync('unzip', ['-p', file, member], { encoding: 'utf8', maxBuffer: 64 << 20 }); } catch { return ''; }
  };
  const list = execFileSync('unzip', ['-Z1', file], { encoding: 'utf8' }).split('\n');
  const sheet = list.find(m => /^xl\/worksheets\/[^/]+\.xml$/.test(m));
  if (!sheet) return [];
  const xmlText = s => s.replace(/<[^>]+>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
  const shared = [...unzip('xl/sharedStrings.xml').matchAll(/<(?:x:)?si>([\s\S]*?)<\/(?:x:)?si>/g)].map(m => xmlText(m[1]).trim());
  const colOf = ref => [...ref.replace(/\d/g, '')].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;
  const rows = [...unzip(sheet).matchAll(/<(?:x:)?row\b[^>]*>([\s\S]*?)<\/(?:x:)?row>/g)].map(r => {
    const cells = [];
    for (const c of r[1].matchAll(/<(?:x:)?c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/(?:x:)?c>)/g)) {
      const attrs = c[1], inner = c[2] || '';
      const ref = attrs.match(/\br="([A-Z]+\d+)"/)?.[1];
      const type = attrs.match(/\bt="(\w+)"/)?.[1];
      const v = inner.match(/<(?:x:)?v>([\s\S]*?)<\/(?:x:)?v>/)?.[1] ?? '';
      const val = type === 's' ? shared[Number(v)] ?? '' : type === 'inlineStr' ? xmlText(inner).trim() : xmlText(v).trim();
      cells[ref ? colOf(ref) : cells.length] = val;
    }
    return cells;
  });
  const [head, ...body] = rows;
  if (!head) return [];
  return body.map(r => Object.fromEntries(head.map((h, i) => [h, (r[i] ?? '').trim()])));
}

/** One line of the saved list. The licence number leads, so lookups are exact. */
export function cslbLine(r) {
  return [r.LicenseNumber, r.BusinessName, r.Address, r.City, r.State, r['ZIP Code'], r.PhoneNumber, r.Status,
    `expires ${r.ExpirationDate}`, r['Classification(s)']].map(v => String(v ?? '').replace(/\s*\|\s*/g, ' ').trim()).join(' | ');
}
