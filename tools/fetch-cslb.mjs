#!/usr/bin/env node
// Save CSLB's licence list for this county, one licence per line, so the audit can check contractor facts.
//
//   node tools/fetch-cslb.mjs                 download every classification for CONFIG.cslbCounty from the portal
//   node tools/fetch-cslb.mjs --from=<dir>    rebuild the list from .xlsx files already downloaded there
//
// CSLB's licence detail pages send scripted requests to a reCAPTCHA page, and we never get around a CAPTCHA.
// The board publishes the same records on its Public Data Portal (no CAPTCHA), one download per classification
// and county. This asks for each one in turn, waits between requests, and names itself in its User-Agent.
// Output (private, gitignored): data/sources/gov/cslb/*.xlsx and data/sources/gov/cslb-licences.txt.
import fs from 'node:fs';
import path from 'node:path';
import { CONFIG } from '../assets/js/config.js';
import { CSLB_LIST, CSLB_PORTAL, readXlsx, cslbLine } from './lib/gov-snapshots.mjs';
import { UA } from './lib/pagecheck.mjs';

const DIR = path.join(path.dirname(CSLB_LIST), 'cslb');
const from = process.argv.find(a => a.startsWith('--from='))?.slice(7);
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function download() {
  if (!CONFIG.cslbCounty) throw new Error('set CONFIG.cslbCounty (the portal\'s county code, e.g. "23" for Mendocino)');
  fs.mkdirSync(DIR, { recursive: true });
  let cookie = '';
  const get = async (opts = {}) => {
    const res = await fetch(CSLB_PORTAL, { ...opts, headers: { 'User-Agent': UA, Referer: CSLB_PORTAL, ...(cookie && { Cookie: cookie }), ...opts.headers } });
    const set = res.headers.getSetCookie?.() || [];
    if (set.length) cookie = set.map(c => c.split(';')[0]).join('; ');
    return res;
  };
  const form = await (await get()).text();
  const hidden = n => form.match(new RegExp(`name="${n.replace(/\$/g, '\\$')}"[^>]*value="([^"]*)"`))?.[1] ?? '';
  const select = form.match(/id="[^"]*lbClassification"[\s\S]*?<\/select>/)?.[0] || '';
  const classes = [...select.matchAll(/<option[^>]*value="([^"]*)"/g)].map(m => m[1]);
  console.log(`${classes.length} classifications for county ${CONFIG.cslbCounty}`);
  for (const c of classes) {
    const file = path.join(DIR, `${c.replace(/[^\w-]/g, '_')}.xlsx`);
    const body = new URLSearchParams({
      __EVENTTARGET: 'ctl00$MainContent$btnSearch', __EVENTARGUMENT: '',
      __VIEWSTATE: hidden('__VIEWSTATE'), __VIEWSTATEGENERATOR: hidden('__VIEWSTATEGENERATOR'), __EVENTVALIDATION: hidden('__EVENTVALIDATION'),
      ctl00$MainContent$lbClassification: c, ctl00$MainContent$lbCounty: String(CONFIG.cslbCounty),
    });
    try {
      const res = await get({ method: 'POST', body, headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
      const type = res.headers.get('content-type') || '';
      const buf = Buffer.from(await res.arrayBuffer());
      if (/spreadsheet/.test(type)) fs.writeFileSync(file, buf);
      console.log(`${c}: ${/spreadsheet/.test(type) ? `${buf.length} bytes` : 'no licences'}`);
    } catch (e) { console.log(`${c}: failed (${e.message})`); }
    await sleep(4000);
  }
  return DIR;
}

const dir = from ? path.resolve(from) : await download();
const byLic = new Map();
for (const f of fs.readdirSync(dir).filter(f => f.endsWith('.xlsx'))) {
  for (const r of readXlsx(path.join(dir, f))) {
    if (!r.LicenseNumber) continue;
    const prev = byLic.get(r.LicenseNumber);
    // A licence with several classifications appears in several downloads; keep one line, all classifications.
    if (prev) prev['Classification(s)'] = [...new Set(`${prev['Classification(s)']} ${r['Classification(s)']}`.split(/[\s|,]+/).filter(Boolean))].join(' ');
    else byLic.set(r.LicenseNumber, { ...r });
  }
}
const lines = [...byLic.values()].sort((a, b) => Number(a.LicenseNumber) - Number(b.LicenseNumber)).map(cslbLine);
fs.mkdirSync(path.dirname(CSLB_LIST), { recursive: true });
fs.writeFileSync(CSLB_LIST, `# CSLB licences, ${CONFIG.cslbCounty ? `county code ${CONFIG.cslbCounty}` : 'county'}, from ${CSLB_PORTAL}, saved ${new Date().toISOString().slice(0, 10)}\n${lines.join('\n')}\n`);
const inTown = lines.filter(l => CONFIG.zips.some(z => l.includes(`| ${z} |`))).length;
console.log(`saved ${lines.length} licences (${inTown} in ${CONFIG.zips.join(', ')}) to ${path.relative(process.cwd(), CSLB_LIST)}`);
