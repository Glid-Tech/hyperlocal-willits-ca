#!/usr/bin/env node
// Turn the facts that researchers recorded in data/sources/research/*.json into hand checks
// (data/sources/confirmed/research-*.json), one per candidate listing.
//
//   node tools/build-data.mjs candidates     # first, so every lead has a candidate id
//   node tools/confirm-from-research.mjs
//   node tools/audit-confirmed.mjs           # then re-check every cited page before publishing
//
// A research record may carry `facts`: { field: { value, source } }, each fact with the page that shows it
// (data/sources/README.md). Only facts from an allowed kind of source are kept here, and the audit fetches each
// cited page again and rejects any fact the page doesn't show, so nothing reaches the site on a researcher's word.
// A record whose status is "closed" or "relocated" becomes a "closed" check, which takes the listing off the site
// (often an old OpenStreetMap entry). Records that match no candidate are reported and skipped.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { prettyStreet, addressKey, nameSimilarity, sharesIdentifyingWord, cleanUrl } from './lib/common.mjs';
import { classifySource, isOwnWebsite, SOURCE_KINDS } from './lib/source-policy.mjs';
import { CATEGORY_BY_ID } from '../assets/js/taxonomy.js';
import { TIME_ZONE } from '../assets/js/hours.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'data/sources');
const OUT_DIR = path.join(SRC, 'confirmed');
const TODAY = new Intl.DateTimeFormat('en-CA', { timeZone: TIME_ZONE }).format(new Date());
const readJson = (f, fb) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return fb; } };

const FIELDS = ['name', 'address', 'unit', 'zip', 'center', 'phone', 'website', 'hours', 'opened'];
const VERDICT = { open: 'open', coming_soon: 'coming_soon', closed: 'closed', relocated: 'closed' };

const candidates = readJson(path.join(SRC, 'candidates.json'), {}).candidates || [];
if (!candidates.length) { console.error('No candidates yet: run node tools/build-data.mjs candidates first.'); process.exit(1); }

const BY_ID = new Map(candidates.map(c => [c.id, c]));

/** The candidate a research record belongs to. An OpenStreetMap entry retired as a copy of a researched listing
 *  leads to that listing, so one place never ends up confirmed twice. */
function findCandidate(rec) {
  let c = findDirect(rec);
  for (let hops = 0; c?.status === 'duplicate' && c.duplicateOf && BY_ID.has(c.duplicateOf) && hops < 3; hops++) c = BY_ID.get(c.duplicateOf);
  return c;
}

/** Same OpenStreetMap entry, or the same name at the same address. */
function findDirect(rec) {
  const addr = addressKey(prettyStreet(rec.address || ''));
  const scored = [];
  for (const c of candidates) {
    if (rec.osm && c.osmId === rec.osm) return c;
    const sim = nameSimilarity(rec.name, c.name);
    const ck = addressKey(c.address);
    if (addr && ck) {
      if (addr === ck && (sim >= 0.85 || (sim >= 0.5 && sharesIdentifyingWord(rec.name, c.name)))) scored.push([sim + 1, c]);
    } else if (sim >= 0.9 && c.foundBy.some(f => f !== 'osm')) scored.push([sim, c]);
  }
  scored.sort((a, b) => b[0] - a[0]);
  return scored[0]?.[1] || null;
}

const files = fs.existsSync(path.join(SRC, 'research')) ? fs.readdirSync(path.join(SRC, 'research')).filter(f => f.endsWith('.json')).sort() : [];
fs.mkdirSync(OUT_DIR, { recursive: true });
let total = 0, unmatched = 0, droppedFacts = 0;
for (const file of files) {
  const recs = readJson(path.join(SRC, 'research', file), []);
  if (!Array.isArray(recs)) continue;
  const out = new Map();
  for (const rec of recs) {
    const verdict = VERDICT[rec?.status];
    if (!rec?.name || !verdict) continue;
    const c = findCandidate(rec);
    if (!c) { unmatched++; console.warn(`  no candidate for ${rec.name} (${rec.address || 'no address'}) in ${file}`); continue; }
    let website = cleanUrl(rec.facts?.website?.value || rec.website || '');
    const facts = {};
    // A department of a bigger provider (a hospital's lab, a clinic group's dental office, a supermarket's pharmacy)
    // often has no website of its own, only the provider's page for that location. That page is its parent brand's
    // own page, so it serves as the website, provided the domain carries a word of the name: adventisthealth.org for
    // "Adventist Health Lab", but not fedex.com for a shipping store that FedEx lists.
    if (!website && verdict !== 'closed') {
      const page = ['address', 'phone', 'hours'].map(k => rec.facts?.[k]?.source).find(Boolean);
      const host = page ? new URL(page).hostname.replace(/^www\./, '').replace(/[^a-z0-9]/g, '') : '';
      const words = String(rec.name).toLowerCase().split(/[^a-z0-9]+/).filter(w => w.length >= 4);
      if (page && isOwnWebsite(page, rec.name) && classifySource(page) === 'other' && words.some(w => host.includes(w))) {
        website = cleanUrl(page);
        facts.website = { value: website, source: page };
      }
    }
    if (verdict !== 'closed') {
      for (const k of FIELDS) {
        const f = rec.facts?.[k];
        if (!f?.value || !f.source) continue;
        const kind = classifySource(f.source, { website, name: c.name });
        if (!SOURCE_KINDS.includes(kind) || (k === 'website' && !isOwnWebsite(f.value, c.name))) { droppedFacts++; continue; }
        let value = String(f.value).trim();
        // Licence lists shout ("THE MEN'S ROOM"). When the researcher wrote the same name in ordinary case, use
        // that: the audit compares names without regard to case, so this changes how it reads, not what it says.
        if (k === 'name' && value === value.toUpperCase() && value.toLowerCase() === String(rec.name).trim().toLowerCase()) value = String(rec.name).trim();
        facts[k] = { value, source: f.source };
      }
      if (!Object.keys(facts).length) continue; // nothing confirmed: leave it to the automatic website check
    }
    const check = {
      id: c.id, verdict, duplicateOf: null, facts,
      evidence: String(rec.status_evidence || '').slice(0, 300),
      checked: TODAY,
    };
    // A record sets the category only if it names this very place: a "Safeway Pharmacy" record that joined the
    // "Safeway" listing doesn't make the supermarket a pharmacy.
    if (CATEGORY_BY_ID[rec.category] && rec.category !== c.category && nameSimilarity(rec.name, c.name) >= 0.95) check.category = rec.category;
    // A second record for the same listing fills in facts the first lacks. Where both have a fact, the record whose
    // name is closer to the listing's wins: the "Skunk Train" record names the train, not the "Skunk Train Railbikes"
    // record that shares its depot, and "Safeway" stays a supermarket when a "Safeway Pharmacy" record follows it.
    const prev = out.get(c.id);
    const sim = nameSimilarity(rec.name, c.name);
    // Whether the place is open or closed is also the closer-named record's call.
    if (prev && (prev.verdict === 'closed') !== (verdict === 'closed') && prev.sim >= sim) continue;
    if (prev && prev.verdict !== 'closed' && verdict !== 'closed') {
      if (prev.sim >= sim) {
        check.facts = { ...facts, ...prev.facts };
        if (prev.category) check.category = prev.category; else delete check.category;
      } else check.facts = { ...prev.facts, ...facts };
    }
    out.set(c.id, { ...check, sim: Math.max(sim, prev?.sim ?? 0) });
  }
  const name = `research-${file.replace(/^disc_/, '')}`;
  fs.writeFileSync(path.join(OUT_DIR, name), JSON.stringify([...out.values()].map(({ sim, ...check }) => check), null, 1) + '\n');
  total += out.size;
  console.log(`${name}: ${out.size} checks`);
}
console.log(`done: ${total} checks written; ${unmatched} research records matched no candidate; ${droppedFacts} facts dropped for a source that isn't allowed`);
