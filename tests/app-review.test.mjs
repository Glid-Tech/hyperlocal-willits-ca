// Regression tests for the code-review fixes in assets/js/app.js and index.html.
//
// app.js runs the page, so it can't be imported in Node. These tests run its real code in a sandbox
// (node:vm) with a small stand-in for the page, and check index.html as text.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import * as searchModule from '../assets/js/search.js';
import { INTENTS, STOPWORDS } from '../assets/js/intents.js';
import { CATEGORIES, CATEGORY_BY_ID, FEATURED_CATEGORY_IDS } from '../assets/js/taxonomy.js';
import { weekTable, localNow, hoursStatus, DAY_NAMES, DAY_CODES } from '../assets/js/hours.js';
import { CONFIG } from '../assets/js/config.js';

const read = f => fs.readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
const APP = read('assets/js/app.js');
const HTML = read('index.html');
const DATA = JSON.parse(read('data/businesses.json'));
const wait = ms => new Promise(r => setTimeout(r, ms));

// ------------------------------------------------------------------------------------------ the page

function makePage() {
  const page = {};
  class El {
    constructor(name = '') {
      Object.assign(this, {
        name, innerHTML: '', textContent: '', outerHTML: '', value: '', hidden: false, open: false, required: false,
        dataset: {}, style: {}, attrs: {}, listeners: {}, kids: [], parentNode: null, found: {}, foundAll: {}, up: {},
      });
      this.classList = { add() {}, remove() {}, toggle() {}, contains: () => false };
    }
    setAttribute(k, v) { this.attrs[k] = String(v); }
    getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; }
    removeAttribute(k) { delete this.attrs[k]; }
    hasAttribute(k) { return k in this.attrs; }
    addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); }
    fire(type, ev = {}) { for (const fn of this.listeners[type] || []) fn({ target: this, preventDefault() {}, ...ev }); }
    querySelector(sel) { return this.found[sel] ?? null; }
    querySelectorAll(sel) { return this.foundAll[sel] ?? []; }
    closest(sel) { return this.up[sel] ?? null; }
    contains(el) { for (let e = el; e; e = e.parentNode) if (e === this) return true; return false; }
    append(...els) { for (const e of els) { e.remove(); e.parentNode = this; this.kids.push(e); } }
    remove() { if (this.parentNode) this.parentNode.kids = this.parentNode.kids.filter(k => k !== this); this.parentNode = null; }
    insertAdjacentHTML(_, html) { this.innerHTML += html; }
    focus() { page.activeElement = this; }
    blur() { if (page.activeElement === this) page.activeElement = page.body; }
    select() {}
    reset() {}
    scrollIntoView() {}
    showModal() { this.open = true; }
    close() { this.open = false; }
  }
  const els = new Map();
  Object.assign(page, {
    El, hidden: false, title: '', listeners: {}, all: {},
    body: new El('body'), head: new El('head'), documentElement: new El('html'),
    querySelector(sel) { if (!els.has(sel)) els.set(sel, new El(sel)); return els.get(sel); },
    querySelectorAll(sel) { return page.all[sel] || []; },
    createElement: tag => new El(tag),
    addEventListener(type, fn) { (page.listeners[type] ||= []).push(fn); },
    fire(type, ev = {}) { for (const fn of page.listeners[type] || []) fn({ preventDefault() {}, ...ev }); },
    execCommand: () => false,
  });
  page.activeElement = page.body;
  // As in index.html, these start hidden.
  for (const sel of ['#results', '#boot-fallback', '#more', '#empty', '#refine', '#emergency', '#map-wrap', '#suggestions', '#mic', '#q-clear', '#offline-bar', '#new-section']) {
    page.querySelector(sel).hidden = true;
  }
  return page;
}

/** Run app.js (minus its imports and its start() call) against a fresh page. */
function loadApp({ url = 'https://neighbor.github.io/fortbragg-local/', fetch, config = {} } = {}) {
  const page = makePage();
  const timers = [];
  const winListeners = {};
  const history = {
    state: null, log: [], backs: 0,
    pushState(s, _, u) { this.state = s; this.log.push({ push: true, s, u }); },
    replaceState(s, _, u) { this.state = s; this.log.push({ push: false, s, u }); },
    back() { this.backs++; },
  };
  const opened = [];
  const ctx = {
    ...searchModule, INTENTS, STOPWORDS, CATEGORIES, CATEGORY_BY_ID, FEATURED_CATEGORY_IDS, weekTable, localNow, hoursStatus, DAY_NAMES,
    CONFIG: { ...CONFIG, ...config },
    initSky() {}, greeting: () => '', fmtClock: () => '8:50 PM', sunNote: () => '',
    initOffline() {}, onOfflineChange() {}, promptInstall: async () => 'unavailable', keepSavedCopy() {},
    device: { ios: false, android: false, browser: 'chrome' },
    window: {
      matchMedia: () => ({ matches: false }), scrollTo() { ctx.scrolls = (ctx.scrolls || 0) + 1; }, open: (...a) => opened.push(a),
      addEventListener(type, fn) { (winListeners[type] ||= []).push(fn); },
    },
    navigator: { userAgent: 'Node', platform: 'Node', maxTouchPoints: 0, onLine: true, clipboard: { writeText: async () => {} } },
    document: page, location: new URL(url), history, Element: page.El,
    fetch: fetch || (async () => ({ ok: true, json: async () => DATA })),
    URL, URLSearchParams, AbortController,
    console: { log: console.log, warn() {}, error() {} },
    setTimeout(fn, ms = 0, ...args) { const t = setTimeout(fn, ms, ...args); t.unref(); timers.push({ ms }); return t; },
    clearTimeout,
    requestAnimationFrame: fn => setTimeout(fn, 0),
    cancelAnimationFrame: clearTimeout,
  };
  vm.createContext(ctx);
  const code = APP.replace(/^import .*;$/gm, '').replace(/^start\(\);\s*$/m, '');
  vm.runInContext(code, ctx, { filename: 'app.js' });
  const app = vm.runInContext('app', ctx);
  const run = src => vm.runInContext(src, ctx);
  return { ctx, page, app, history, timers, winListeners, opened, run, $: sel => page.querySelector(sel) };
}

const REAL = { businesses: DATA.businesses, areas: DATA.areas, index: searchModule.buildIndex(DATA.businesses, { areas: DATA.areas }) };

/** Give the sandboxed app its listings, the way start() does. */
function withListings(env, set = REAL) {
  const { app } = env;
  app.data = { meta: { built: '2026-11-22' }, comingSoon: [], businesses: set.businesses, areas: set.areas };
  app.areas = set.areas;
  app.areaById = Object.fromEntries(set.areas.map(a => [a.id, a]));
  app.index = set.index || searchModule.buildIndex(set.businesses, { areas: set.areas });
  for (const d of app.index.docs) app.docById.set(d.b.id, d);
  return env;
}

// A small, fixed set of listings, so these expectations don't move when the real data changes.
const AREAS = [{ id: 'downtown', name: 'Downtown Fort Bragg' }, { id: 'elsewhere', name: 'Around Fort Bragg' }];
const today = localNow().day;
let n = 0;
const biz = o => ({
  id: `t-${++n}`, sub: '', tags: [], desc: '', address: `${1000 + n} Test Road`, unit: '', zip: '95437', center: '', area: 'downtown',
  lat: 39.44, lon: -123.80, phone: `(707) 555-${String(1000 + n)}`, website: '', hours: '', status: 'open',
  verified: '2026-11-22', sources: [], ...o,
});
const FIXTURE = [
  biz({ id: 'night-owl-diner-1', name: 'Night Owl Diner', category: 'restaurants', sub: 'Diner', tags: ['diner', 'breakfast'], hours: '24/7' }),
  biz({ id: 'lakeside-inn-2', name: 'Lakeside Inn', category: 'hotels-events', sub: 'Hotel', tags: ['hotel'] }),
  biz({ id: 'noyo-suites-3', name: 'Noyo Suites', category: 'hotels-events', sub: 'Hotel', tags: ['hotel'] }),
  biz({ id: 'weekday-dental-4', name: 'Weekday Dental', category: 'dental', sub: 'Dentist', hours: `${DAY_CODES[(today + 3) % 7]} 09:00-17:00` }),
  biz({ id: 'website-only-cafe-5', name: 'Website Only Cafe', category: 'cafes-treats', sub: 'Cafe', address: '', phone: '', website: 'https://websiteonlycafe.com/' }),
  biz({ id: 'address-only-shop-6', name: 'Address Only Shop', category: 'shopping', sub: 'Gift shop', phone: '' }),
  biz({ id: 'corner-cafe-7', name: 'Corner Cafe', category: 'cafes-treats', sub: 'Cafe', website: 'https://cornercafe.com/',
    sources: ['https://cornercafe.com/about', 'https://www.openstreetmap.org/node/1'] }),
  biz({ id: 'old-map-entry-8', name: 'Old Map Entry', category: 'shopping', sub: 'Shop', verified: null, sources: ['https://www.openstreetmap.org/node/2'] }),
];
const SMALL = { businesses: FIXTURE, areas: AREAS };
const docOf = (env, id) => env.app.docById.get(id);

// ------------------------------------------------------------------------------------------ page markup

test('every name app.js imports exists in the module it comes from', () => {
  const exportsOf = src => new Set([
    ...[...src.matchAll(/^export (?:async )?(?:function\*?|const|let|var|class) (\w+)/gm)].map(m => m[1]),
    ...[...src.matchAll(/^export \{([^}]+)\}/gm)].flatMap(m => m[1].split(',').map(s => s.trim().split(/\s+as\s+/).pop())),
  ]);
  const imports = [...APP.matchAll(/^import \{([^}]+)\} from '\.\/([\w.-]+)';$/gm)];
  assert.ok(imports.length >= 5, 'found the imports');
  for (const [, names, file] of imports) {
    const have = exportsOf(read(`assets/js/${file}`));
    for (const name of names.split(',').map(s => s.trim())) assert.ok(have.has(name), `${file} exports ${name}`);
  }
});

test('the add/fix form accepts a website typed without https:// and marks the required field', () => {
  const form = HTML.match(/<form[^>]*id="suggest-form"[^>]*>/)[0];
  assert.match(form, /\bnovalidate\b/, 'our own friendly messages, not the browser’s');
  const site = HTML.match(/<input name="website"[^>]*>/)[0];
  assert.match(site, /type="text"/);
  assert.match(site, /inputmode="url"/);
  assert.doesNotMatch(site, /placeholder="https:\/\/"/);
  assert.match(HTML, /<span id="s-name-label">Business name \(required\)<\/span><input name="name" required/);
});

test('the voice button’s spoken name starts with the word on it, “Speak”', () => {
  const mic = HTML.match(/<button[^>]*id="mic"[^>]*>[\s\S]*?<\/button>/)[0];
  const visible = mic.match(/<span class="mic-label">([^<]+)<\/span>/)[1];
  assert.match(mic.match(/aria-label="([^"]+)"/)[1], new RegExp(`^${visible}\\b`));
  const resets = [...APP.matchAll(/mic\.setAttribute\('aria-label', '([^']+)'\)/g)].map(m => m[1]);
  assert.deepEqual(resets.sort(), ['Speak your search', 'Stop listening']);
});

test('each dialog has its own live region, and the toast isn’t a second, competing one', () => {
  const dialogs = [...HTML.matchAll(/<dialog[\s\S]*?<\/dialog>/g)].map(m => m[0]);
  assert.equal(dialogs.length, 3);
  for (const d of dialogs) assert.match(d, /<div class="visually-hidden" data-live aria-live="polite" aria-atomic="true"><\/div>/);
  const toastEl = HTML.match(/<div class="toast" id="toast"[^>]*>/)[0];
  assert.doesNotMatch(toastEl, /aria-live|role=/);
});

test('the “didn’t load” note sits right under the search box, not below the fold', () => {
  const hero = HTML.match(/<section class="hero"[\s\S]*?<\/section>/)[0];
  assert.match(hero, /<\/form>\s*<p class="boot-fallback" id="boot-fallback" hidden>/);
});

// ------------------------------------------------------------------------------------------ results

test('“Narrow it down” chips are only real kinds of place, and their numbers match the page they open', () => {
  const env = withListings(loadApp());
  const areas = ['downtown', 'north-main', 'south-main', 'noyo-harbor', 'boatyard', 'cleone'];
  const realList = (r, where) => {
    assert.ok(r.query.concepts.some(c => c.kind === 'intent'), `${where} is a kind of place, not a word-for-word fallback`);
    assert.deepEqual(r.query.corrections, [], `${where} isn’t respelled`);
    assert.equal(r.partial, false, `${where} matches every word`);
  };
  let checked = 0;
  for (const cat of ['groceries', 'health', 'kids', 'restaurants', 'cafes-treats']) {
    for (const st of [{ cat }, ...areas.map(area => ({ cat, area })), { cat, open: '1' }]) {
      env.ctx.renderRefine(st);
      const nav = env.$('#refine');
      if (nav.hidden) continue;
      const chips = [...nav.innerHTML.matchAll(/<a class="rchip[^"]*" href="\?([^"]+)"[^>]*>[^<]*(?: <span class="rchip-n">([\d,]+)<\/span>)?<\/a>/g)];
      for (const [, href, count] of chips) {
        const p = new URLSearchParams(href.replace(/&amp;/g, '&'));
        const q = p.get('q');
        if (!q) continue; // "All restaurants"
        const where = `${cat}${st.area ? ` in ${st.area}` : ''}${st.open ? ', open now' : ''}: “${q}”`;
        realList(searchModule.search(env.app.index, q, { category: cat }), `${cat}: “${q}”`);
        // The page the chip opens, with the neighborhood and Open now kept: what its number counts.
        const page = env.ctx.runSearch({ cat, area: p.get('area') || undefined, open: p.get('open') || undefined, q });
        realList(page, where);
        assert.equal(Number(String(count).replace(/,/g, '')), page.total, `${where} says ${count}, the page shows ${page.total}`);
        checked++;
      }
    }
  }
  assert.ok(checked >= 40, `checked ${checked} chips`);
});

test('hour words that hide everything offer to show all the places, with no spelling tip', () => {
  const env = withListings(loadApp(), SMALL);
  for (const q of ['hotel open late', 'hotel sunday']) {
    const st = { q };
    const res = env.ctx.runSearch(st);
    assert.equal(res.total, 0, `${q}: no hotel lists its hours`);
    env.ctx.renderEmpty(st, res);
    const html = env.$('#empty').innerHTML;
    assert.match(html, /data-nav="q=hotel">Show all 2 places for “hotel”<\/a>/, q);
    assert.match(html, /We don’t know the opening hours of every place/);
    assert.doesNotMatch(html, /Check the spelling/);
  }
});

test('when Open now hides everything, the page says nothing is open, and owns up to unknown hours', () => {
  const st = { q: 'dentist', open: '1' };
  // Weekday Dental is closed today; this dentist doesn't list its hours.
  const withUnknown = { businesses: [...FIXTURE, biz({ id: 'smile-studio-9', name: 'Smile Studio', category: 'dental', sub: 'Dentist' })], areas: AREAS };
  const env = withListings(loadApp(), withUnknown);
  const res = env.ctx.runSearch(st);
  assert.equal(res.total, 0);
  env.ctx.renderEmpty(st, res);
  const html = env.$('#empty').innerHTML;
  assert.match(html, /<h3>Nothing open right now for “dentist”<\/h3>/);
  assert.match(html, /<p>We don’t know the opening hours of every place, so searching by time leaves some out\.<\/p>/);
  assert.match(html, /data-widen="open">Show all 2 places<\/button>/, 'not “open or closed”: one has no hours');
  assert.doesNotMatch(html, /No matches|open or closed|Your filters/);

  const known = withListings(loadApp(), SMALL);
  known.ctx.renderEmpty(st, known.ctx.runSearch(st));
  const knownHtml = known.$('#empty').innerHTML;
  assert.match(knownHtml, /<h3>Nothing open right now for “dentist”<\/h3>/);
  assert.match(knownHtml, /data-widen="open">Show all 1 place, open or closed<\/button>/);
  assert.doesNotMatch(knownHtml, /We don’t know the opening hours/);
});

test('typing “open now” ticks the Open now button instead of quietly filtering', () => {
  const env = withListings(loadApp(), SMALL);
  const calls = [];
  env.ctx.navigate = next => calls.push(next);
  env.ctx.submitSearch('pharmacy open now');
  env.ctx.submitSearch('open now');
  env.ctx.submitSearch('diner open late');
  assert.deepEqual(JSON.parse(JSON.stringify(calls)), [{ q: 'pharmacy', open: '1' }, { open: '1' }, { q: 'diner open late' }]);
});

test('“what’s open now” opens the Open right now list, with Open now ticked and the search box empty', () => {
  // Relies on splitFilters() leaving rest '' when only filler words are left.
  for (const q of ['what’s open now', "what's open now?", 'anything open now', 'is anything open', 'open near me', 'places open now', 'open now please',
    "who's open now", 'who’s open?', 'whos open', 'whose open now', 'is anyone open', 'anybody open now', 'everything open now']) {
    const env = withListings(loadApp(), SMALL);
    env.$('#q').value = q;
    env.ctx.submitSearch(q);
    assert.equal(env.history.log.at(-1).u, '?open=1', q);
    assert.equal(env.$('#results-title').textContent, 'Open right now', q);
    assert.equal(env.$('#f-open').getAttribute('aria-pressed'), 'true', q);
    assert.equal(env.$('#q').value, '', q);
  }
});

test('an address with “open now” in its search ticks the Open now button too, and says so', async () => {
  // The 404 page turns /open-now into ?q=open now; bookmarks and search engines can send it too.
  const env = loadApp({ url: 'https://neighbor.github.io/fortbragg-local/?q=open+now' });
  await env.ctx.start();
  assert.deepEqual(env.history.log.map(e => [e.push, e.u]), [[false, '?open=1']]);
  assert.equal(env.$('#results-title').textContent, 'Open right now');
  assert.equal(env.$('#f-open').getAttribute('aria-pressed'), 'true');
  assert.equal(env.$('#q').value, '');

  const back = url => {
    env.ctx.location = new URL(`https://neighbor.github.io/fortbragg-local/${url}`);
    for (const fn of env.winListeners.popstate) fn({});
  };
  back('?q=pharmacy+open+now&sky=night');
  assert.equal(env.history.log.at(-1).u, '?q=pharmacy&open=1&sky=night', 'previews like ?sky= are kept');
  assert.equal(env.$('#q').value, 'pharmacy');
  assert.equal(env.$('#f-open').getAttribute('aria-pressed'), 'true');
  const entries = env.history.log.length;
  back('?q=diner+open+late');
  assert.equal(env.history.log.length, entries, 'other hour words stay in the search');
  assert.equal(env.$('#q').value, 'diner open late');
});

test('“open late” is described honestly, and the no-hours note shows whenever hours are filtered', () => {
  const env = withListings(loadApp(), SMALL);
  const late = { q: 'diner open late' };
  const sub = env.ctx.describe(late, env.ctx.runSearch(late)).sub;
  assert.match(sub, /that stays open until 10 PM or later tonight/);
  assert.doesNotMatch(sub, /“diner open late”/, 'the hour words aren’t quoted back');
  assert.match(sub, /Places with no hours listed aren’t included\./);
  const openInCat = { cat: 'restaurants', open: '1' };
  assert.match(env.ctx.describe(openInCat, env.ctx.runSearch(openInCat)).sub, /Places with no hours listed aren’t included\./);
  const plain = { cat: 'restaurants' };
  assert.doesNotMatch(env.ctx.describe(plain, env.ctx.runSearch(plain)).sub, /no hours listed/);
});

test('a typed day reads plainly: “open today”, and “open late” on another day names that day', () => {
  const env = withListings(loadApp(), SMALL);
  const sub = (q, more = {}) => env.ctx.describe({ q, ...more }, env.ctx.runSearch({ q, ...more })).sub;
  const days = ['sunday', 'saturday', 'monday']; // the days the search understands
  const other = days.find(d => d !== DAY_NAMES[today].toLowerCase());
  const Other = `${other[0].toUpperCase()}${other.slice(1)}`;

  assert.match(sub('diner open today'), /We found <strong>1 place<\/strong> for “diner” open today\./);
  // A typed weekday doesn't leave out places already closed for the day, so it doesn't say "today".
  if (days.includes(DAY_NAMES[today].toLowerCase())) assert.match(sub(`diner ${DAY_NAMES[today]}`), new RegExp(`“diner” open on ${DAY_NAMES[today]}s\\.`));
  assert.match(sub(`diner ${other}`), new RegExp(`“diner” open on ${Other}s\\.`));

  const late = sub(`diner open late on ${other}`);
  assert.match(late, new RegExp(`We found <strong>1 place</strong> for “diner” that stays open until 10 PM or later on ${Other}s\\.`));
  assert.doesNotMatch(late, /tonight|open on|“diner on”/, 'one day phrase, and no filler quoted back');

  // With the Open now button on as well.
  assert.match(sub(`diner ${other}`, { open: '1' }), new RegExp(`“diner” open now and on ${Other}s\\.`));
  assert.match(sub('diner open today', { open: '1' }), /“diner” open now\./);
});

test('switching off the last filter shows every place instead of the home page', async () => {
  const env = withListings(loadApp(), SMALL);
  const calls = [];
  env.ctx.navigate = next => calls.push(JSON.parse(JSON.stringify(next)));
  env.ctx.initToolbar();
  env.app.state = { open: '1' };
  env.$('#f-open').fire('click');
  env.app.state = { area: 'downtown' };
  env.$('#f-area').fire('change', { target: { value: '' } });
  assert.deepEqual(calls, [{ all: '1' }, { all: '1' }]);
  assert.deepEqual(JSON.parse(JSON.stringify(env.ctx.cleanState({ all: '1', cat: 'restaurants' }))), { cat: 'restaurants' });
  const all = { all: '1' };
  assert.equal(env.ctx.describe(all, env.ctx.runSearch(all)).title, 'Every place in Fort Bragg');
});

test('a business picked from the suggestions opens over its list, so closing it keeps the list', () => {
  const env = withListings(loadApp(), SMALL);
  env.ctx.render = st => { env.app.state = st; };
  env.ctx.chooseSuggestion({ type: 'business', label: 'Lakeside Inn', id: 'lakeside-inn-2' });
  const [list, detail] = env.history.log;
  assert.equal(env.history.log.length, 2);
  assert.deepEqual([list.push, list.s.detail, list.u], [true, false, '?q=Lakeside+Inn']);
  assert.deepEqual([detail.push, detail.s.detail, detail.u], [true, true, '?q=Lakeside+Inn&id=lakeside-inn-2']);
  // Changing the list and opening a listing in one step isn't "opening a listing over this list".
  env.ctx.navigate({ q: 'diner', id: 'night-owl-diner-1' });
  assert.equal(env.history.state.detail, false);
});

test('when the list disappears, focus moves to the search box and the change is announced', async () => {
  const env = withListings(loadApp(), SMALL);
  const results = env.$('#results');
  results.hidden = false;
  const toggle = new env.page.El('button');
  results.append(toggle);
  toggle.focus();
  env.ctx.render({});
  assert.equal(env.page.activeElement, env.$('#q'));
  await wait(90);
  assert.equal(env.$('#live').textContent, 'Back to the home page.');

  const fresh = withListings(loadApp(), SMALL); // first load: the list was never shown
  fresh.ctx.render({});
  assert.equal(fresh.page.activeElement, fresh.page.body);
});

test('closing a listing whose card lost focus puts focus back on that card', () => {
  const env = withListings(loadApp(), SMALL);
  env.ctx.initDialogs();
  env.ctx.location = new URL('https://neighbor.github.io/fortbragg-local/?q=Lakeside+Inn&id=lakeside-inn-2');
  env.history.state = { ml: 1, detail: true };
  env.app.res = { results: [], total: 0 };
  const link = new env.page.El('a');
  link.dataset.id = 'lakeside-inn-2';
  env.page.all['#cards .card-name a'] = [link];
  env.page.activeElement = env.page.body;
  env.$('#detail').fire('close');
  assert.equal(env.history.backs, 1, 'went back to the list');
  assert.equal(env.page.activeElement, link);
});

test('messages shown while a dialog is open appear in it and are read out from it', async () => {
  const env = loadApp();
  const dialog = new env.page.El('dialog');
  const live = new env.page.El('div');
  dialog.found['[data-live]'] = live;
  env.page.all['dialog[open]'] = [dialog];
  env.ctx.toast('Link copied.');
  assert.equal(env.$('#toast').parentNode, dialog);
  await wait(90);
  assert.equal(live.textContent, 'Link copied.');

  env.page.all['dialog[open]'] = [];
  env.ctx.toast('Text size: Larger');
  assert.equal(env.$('#toast').parentNode, env.page.body, 'back on the page once the dialog has closed');
});

/** A listing sheet that, like a real modal dialog, keeps focus and screen readers away from the page while open. */
function withSheet(env) {
  const sheet = env.$('#detail');
  const live = new env.page.El('div');
  sheet.found['[data-live]'] = live;
  Object.defineProperty(env.page.all, 'dialog[open]', { get: () => (sheet.open ? [sheet] : []) });
  const title = env.$('#results-title');
  title.focus = function () { if (!sheet.open) env.page.activeElement = this; };
  return { sheet, live, title };
}

test('a message goes wherever it can be heard when it’s written, even if a dialog closed meanwhile', async () => {
  const env = loadApp();
  const { sheet, live } = withSheet(env);
  sheet.open = true;
  env.ctx.announce('251 places found.');
  sheet.close();
  await wait(90);
  assert.equal(env.$('#live').textContent, '251 places found.');
  assert.equal(live.textContent, '', 'not into the closed listing, where nobody hears it');
});

test('a link inside a listing closes it before the new list is drawn, so focus and the count reach the page', async () => {
  const env = withListings(loadApp(), SMALL);
  const { sheet, live, title } = withSheet(env);
  env.app.state = { cat: 'restaurants', id: 'night-owl-diner-1' };
  sheet.open = true;
  env.ctx.navigate({ area: 'downtown' }); // the listing's Neighborhood link
  assert.equal(sheet.open, false);
  assert.equal(env.page.activeElement, title);
  await wait(90);
  assert.match(env.$('#live').textContent, /^\d+ places? found\.$/);
  assert.equal(live.textContent, '');
});

test('copying says whether it worked, so the form never claims a copy that failed', async () => {
  const env = loadApp();
  env.ctx.navigator.clipboard.writeText = async () => { throw new Error('blocked'); };
  assert.equal(await env.ctx.copyText('hello', 'Message copied.'), false);
  assert.equal(env.$('#toast').textContent, 'Sorry, copying didn’t work in this browser.');
  env.ctx.navigator.clipboard.writeText = async () => {};
  assert.equal(await env.ctx.copyText('hello', 'Message copied.'), true);
});

test('chips tapped while the listings load are remembered, and a failed load says so', () => {
  const env = loadApp();
  const calls = [];
  env.ctx.navigate = next => calls.push(JSON.parse(JSON.stringify(next)));
  env.ctx.initClicks();
  const chip = new env.page.El('a');
  chip.dataset.nav = 'cat=restaurants';
  chip.up['a[data-nav]'] = chip;
  const tap = () => env.page.fire('click', { target: chip, button: 0 });
  tap();
  assert.equal(env.$('#toast').textContent, 'One moment, still loading the directory…');
  assert.deepEqual(calls, []);
  env.app.pending();
  assert.deepEqual(calls, [{ cat: 'restaurants' }]);

  env.app.failed = true;
  tap();
  const note = env.$('#boot-fallback');
  assert.equal(note.hidden, false);
  assert.match(note.innerHTML, /data-reload>Try again<\/button>/);
  assert.match(note.innerHTML, /href="directory\.html"/);
});

test('a slow start hides the “Having trouble?” note once the listings arrive', async () => {
  const env = loadApp();
  env.$('#boot-fallback').hidden = false; // shown by index.html's six-second timer
  await env.ctx.start();
  assert.equal(env.$('#boot-fallback').hidden, true);
  assert.ok(env.app.index, 'the directory loaded');
});

test('a failed load is tried once more, then explained next to the search box', async () => {
  let tries = 0;
  const env = loadApp({ fetch: async () => { tries++; throw new Error('offline'); } });
  await env.ctx.start();
  assert.equal(tries, 2);
  assert.equal(env.app.failed, true);
  assert.match(env.$('#boot-fallback').innerHTML, /Sorry, the directory didn’t load/);
  env.ctx.submitSearch('pizza');
  assert.notEqual(env.$('#toast').textContent, 'One moment, still loading the directory…', 'never “still loading” forever');
});

test('an out-of-date shared link searches for the business instead of dropping the visitor', () => {
  const env = withListings(loadApp(), SMALL);
  const calls = [];
  env.ctx.navigate = (next, opts) => calls.push([JSON.parse(JSON.stringify(next)), opts.replace]);
  env.ctx.openDetail('akb-a-hotel-bar-7599');
  assert.deepEqual(calls, [[{ q: 'akb a hotel bar' }, true]]);
  assert.equal(env.$('#toast').textContent, '', 'no message that vanishes');
  const st = { q: 'akb a hotel bar' };
  const res = env.ctx.runSearch(st);
  assert.match(env.ctx.describe(st, res).sub, /That link is out of date, so we searched for the business instead\./);
});

test('an empty category says so, without telling the visitor to check their spelling', () => {
  const env = withListings(loadApp(), SMALL);
  const st = { cat: 'senior' };
  env.ctx.renderEmpty(st, env.ctx.runSearch(st));
  const html = env.$('#empty').innerHTML;
  assert.match(html, /We don’t have anything listed in Senior Care yet/);
  assert.doesNotMatch(html, /spelling/);
  assert.match(html, /Add it to the directory/);
  env.ctx.renderHome();
  assert.match(env.$('#tiles').innerHTML, /None listed yet/);
  assert.doesNotMatch(env.$('#tiles').innerHTML + env.$('#tiles-more').innerHTML, /Coming soon/);
});

// ------------------------------------------------------------------------------------------ a listing

test('a listing only suggests calling when it has a phone number', () => {
  const env = withListings(loadApp(), SMALL);
  const web = env.ctx.detailHTML(docOf(env, 'website-only-cafe-5'));
  assert.doesNotMatch(web, /call/i);
  assert.match(web, /Hours not listed<\/span> <span class="status-detail">· Check their website/);
  assert.match(web, /Their website may list them\./);
  assert.match(web, /Serves the Fort Bragg area\. See their website for details\./);
  const bare = env.ctx.detailHTML(docOf(env, 'address-only-shop-6'));
  assert.doesNotMatch(bare, /call/i);
  assert.match(bare, /We don’t have hours or a phone number for this place yet\./);
  const phone = env.ctx.detailHTML(docOf(env, 'lakeside-inn-2'));
  assert.match(phone, /· Call ahead/);
  assert.match(phone, /Please call ahead at <a href="tel:/);
});

test('a listing says when it was checked and where its details come from, in plain words', () => {
  const env = withListings(loadApp(), SMALL);
  assert.match(env.ctx.detailHTML(docOf(env, 'corner-cafe-7')),
    /We last checked these details on November 22, 2026, on <a href="https:\/\/cornercafe\.com\/about" rel="noopener">their own website \(cornercafe\.com\)<\/a> and <a href="https:\/\/www\.openstreetmap\.org\/node\/1" rel="noopener">OpenStreetMap<\/a> \(a free public map\)\./);
  const unchecked = env.ctx.detailHTML(docOf(env, 'old-map-entry-8'));
  assert.match(unchecked, /These details come from <a [^>]+>OpenStreetMap<\/a> \(a free public map\), but we haven’t noted when we last checked them\./);
  assert.doesNotMatch(unchecked, /checked by hand/);

  const real = withListings(loadApp());
  for (const d of real.app.index.docs) {
    const line = real.ctx.checkedHTML(d.b);
    if (d.b.verified) assert.match(line, /^We last checked these details on \w+ \d+, \d{4}/, d.b.id);
    assert.doesNotMatch(line, /Sources:|hasn’t been checked by hand/, d.b.id);
  }
});

// ------------------------------------------------------------------------------------------ the add/fix form

function formEnv(config, url) {
  const env = loadApp({ config, url });
  const fields = Object.fromEntries(['name', 'address', 'phone', 'website', 'notes'].map(k => [k, new env.page.El(k)]));
  const form = env.$('#suggest-form');
  form.elements = { namedItem: k => fields[k] };
  const send = (kind, values) => {
    for (const [k, el] of Object.entries(fields)) el.value = values[k] || '';
    form.found['input[name="kind"]:checked'] = { value: kind };
    form.fire('submit');
  };
  return { ...env, fields, send };
}

test('without an email address, the form says plainly that GitHub needs an account, and what to do', async () => {
  const env = formEnv({ contactEmail: '', github: null }); // the repository worked out from the github.io address
  env.ctx.setSuggestKind('add');
  assert.match(env.$('#s-lede').innerHTML, /needs a free GitHub account, and anyone can read what you send/);
  env.ctx.initSuggestForm();
  env.send('add', { name: 'Joe’s Pizza', website: 'joespizza.com' });
  assert.match(env.opened[0][0], /^https:\/\/github\.com\/neighbor\/fortbragg-local\/issues\/new\?/);
  assert.match(env.$('#s-status').innerHTML, /sign in or make a free GitHub account, then press <strong>Create<\/strong>/);
  assert.match(env.$('#s-status').innerHTML, /data-copy-message>copy your message<\/button> and paste it in/);

  const withEmail = formEnv({ contactEmail: 'hello@example.org' });
  withEmail.ctx.setSuggestKind('add');
  assert.match(withEmail.$('#s-lede').innerHTML, /your email app opens with your message to <strong>hello@example\.org<\/strong>/);
});

test('a problem with the website can be reported without a business name, but not without saying what’s wrong', () => {
  const env = formEnv({ contactEmail: '' });
  env.ctx.setSuggestKind('fix');
  assert.equal(env.fields.name.required, false);
  assert.equal(env.fields.notes.required, true);
  assert.match(env.$('#s-name-label').textContent, /Leave this blank if it’s about the website/);
  env.ctx.initSuggestForm();
  env.send('fix', {});
  assert.equal(env.$('#s-status').textContent, 'Please tell us what needs fixing.');
  assert.equal(env.page.activeElement, env.fields.notes);
  env.send('fix', { notes: 'The text is too small.' });
  const url = new URL(env.opened[0][0]);
  assert.equal(url.searchParams.get('title'), 'A problem with the website');
  assert.equal(url.searchParams.get('business_name'), 'The website', 'GitHub’s form insists on a name');

  env.ctx.setSuggestKind('add');
  assert.equal(env.fields.name.required, true);
  env.send('add', {});
  assert.equal(env.$('#s-status').textContent, 'Please type the name of the business.');
});

test('messages go to this site’s own GitHub repository, wherever the site is hosted', () => {
  const env = formEnv({}, 'https://fortbragglocal.example/');
  env.ctx.initSuggestForm();
  env.send('add', { name: 'Joe’s Pizza' });
  assert.match(env.opened[0][0], /^https:\/\/github\.com\/Glid-Tech\/hyperlocal-fortbragg-ca\/issues\/new\?/);
});

test('with nowhere to send a message, the button says it copies it, and the form says what to do next', async () => {
  const env = formEnv({ contactEmail: '', github: null }, 'https://fortbragglocal.example/'); // not on github.io, no email or repository set
  env.ctx.setSuggestKind('add');
  assert.match(env.$('#s-send').innerHTML, /<use href="#i-copy"\/><\/svg>Copy my message$/);
  const lede = env.$('#s-lede').innerHTML;
  assert.match(lede, /This site can’t receive messages yet\. When you press <strong>Copy my message<\/strong>/);
  assert.doesNotMatch(lede, /Send/);
  env.ctx.initSuggestForm();
  env.send('add', { name: 'Joe’s Pizza' });
  await wait(10);
  assert.deepEqual(env.opened, [], 'nothing pretends to send it');
  assert.equal(env.$('#s-status').textContent, 'We copied your message. To keep it, open a note or an email, then click where you’d like it to go and press Ctrl and V together (on a Mac, ⌘ and V).');
  env.ctx.device = { ...env.ctx.device, mobile: true };
  env.send('add', { name: 'Joe’s Pizza' });
  await wait(10);
  assert.match(env.$('#s-status').textContent, /then press and hold where you’d like it to go and tap Paste\.$/);

  for (const config of [{ contactEmail: '', github: null }, { contactEmail: 'hello@example.org' }]) {
    const sends = formEnv(config); // on github.io, or with an email address: it really sends
    sends.ctx.setSuggestKind('fix');
    assert.match(sends.$('#s-send').innerHTML, /<use href="#i-mail"\/><\/svg>Send$/, JSON.stringify(config));
  }
});

test('the blocked-microphone message says what to do, and stays up long enough to read', () => {
  const msg = APP.match(/toast\('(Your browser is blocking the microphone[^']+)'\)/)[1];
  assert.match(msg, /type instead/);
  assert.match(msg, /tap Speak again/);
  const toastTime = loadApp().run('toastTime');
  assert.ok(toastTime(msg) >= 8000, 'about 8 seconds or more');
  assert.equal(toastTime('Message copied.'), 3600);
});

// ------------------------------------------------------------------------------------------ open/closed over time

test('open/closed lines are rechecked each minute and whenever the visitor comes back', () => {
  const env = withListings(loadApp(), SMALL);
  let checks = 0;
  env.ctx.refreshHours = () => { checks++; };
  env.ctx.initHoursRefresh();
  const next = env.timers.at(-1).ms;
  assert.ok(next > 500 && next <= 60500, `next check at the next minute (${next} ms)`);
  env.page.fire('visibilitychange');
  for (const fn of env.winListeners.pageshow) fn({ persisted: true });
  for (const fn of env.winListeners.pageshow) fn({ persisted: false });
  assert.equal(checks, 2);
});

test('an “Open now” list drops places that have closed, keeping how many were shown, without announcing', () => {
  const env = withListings(loadApp(), SMALL);
  const shown = [];
  const said = [];
  env.ctx.showMore = (moveFocus, count) => shown.push([moveFocus, count]);
  env.ctx.announce = msg => said.push(msg);
  const closed = docOf(env, 'weekday-dental-4');
  env.app.state = { open: '1' };
  env.app.res = { results: [{ doc: closed, status: { state: 'open' } }], total: 1, partial: false, query: { filters: { open: true }, concepts: [], corrections: [] } };
  env.app.shown = 30;
  env.ctx.refreshResults();
  assert.deepEqual(shown, [[false, 30]]);
  assert.deepEqual(said, []);
  assert.ok(env.app.res.results.length > 0);
  assert.ok(env.app.res.results.every(r => r.status.state === 'open' && r.doc !== closed));
  assert.equal(env.ctx.scrolls || 0, 0, 'no scrolling');
});

test('the minute-by-minute recheck leaves the map alone, so it doesn’t close a popup or zoom back out', () => {
  const env = withListings(loadApp(), SMALL);
  let maps = 0;
  env.ctx.showMapFor = () => { maps++; };
  env.ctx.showMore = () => {};
  const closed = docOf(env, 'weekday-dental-4');
  env.app.state = { open: '1', view: 'map' };
  env.app.res = { results: [{ doc: closed, status: { state: 'open' } }], total: 1, partial: false, query: { filters: { open: true }, concepts: [], corrections: [] } };
  env.ctx.refreshResults();
  assert.ok(env.app.res.results.every(r => r.doc !== closed), 'the list itself was brought up to date');
  assert.equal(maps, 0);
  env.ctx.renderView(env.app.state); // the visitor's next change catches the map up
  assert.equal(maps, 1);
});

test('a card’s open/closed line is updated in place', () => {
  const env = withListings(loadApp(), SMALL);
  const box = new env.page.El('ol');
  const card = new env.page.El('li');
  const link = new env.page.El('a');
  const line = new env.page.El('p');
  link.dataset.id = 'night-owl-diner-1';
  line.outerHTML = '<p class="card-status status-closed">…Closed now…</p>';
  card.found['.card-name a[data-id]'] = link;
  card.found['.card-status'] = line;
  box.foundAll['.card'] = [card];
  env.ctx.patchStatuses(box, () => hoursStatus(docOf(env, 'night-owl-diner-1').parsedHours, localNow()));
  assert.match(line.outerHTML, /^<p class="card-status status-open">.*Open 24 hours/);
});

// ------------------------------------------------------------------------------------------ "Save to my phone"

/** Well-formed tags, and no block (a list, a paragraph...) inside a paragraph, heading or other inline element. */
function assertValidHTML(html, where) {
  const VOID = new Set(['br', 'img', 'input', 'hr', 'wbr']);
  const PHRASING_ONLY = new Set(['p', 'span', 'small', 'strong', 'em', 'a', 'button', 'summary', 'h2', 'h3']);
  const BLOCK = new Set(['p', 'div', 'ol', 'ul', 'li', 'section', 'details', 'h2', 'h3', 'dl']);
  assert.doesNotMatch(html.replace(/<[^>]*>/g, ''), /[<>]/, `${where}: no stray < or >`);
  const stack = [];
  for (const tag of html.match(/<[^>]*>/g) || []) {
    const m = tag.match(/^<(\/?)([a-z][a-z0-9-]*)(?:\s+[a-z-]+(?:="[^"<>]*")?)*\s*(\/?)>$/i);
    assert.ok(m, `${where}: a well-formed tag: ${tag}`);
    const [, close, name, selfClose] = m;
    if (close) {
      const open = stack.pop();
      assert.equal(open, name, `${where}: </${name}> closes <${open}>`);
      continue;
    }
    if (BLOCK.has(name)) assert.ok(!stack.some(t => PHRASING_ONLY.has(t)), `${where}: <${name}> inside <${stack.join('> <')}>`);
    if (name === 'li') assert.match(stack.at(-1) || '', /^[ou]l$/, `${where}: <li> is in a list`);
    if (name === 'summary') assert.equal(stack.at(-1), 'details', `${where}: <summary> is in <details>`);
    if (!VOID.has(name) && !selfClose) stack.push(name);
  }
  assert.deepEqual(stack, [], `${where}: every tag is closed`);
}

// Every kind of device offline.js can report.
const DEVICES = [
  ...['safari', 'chrome', 'firefox', 'edge'].flatMap(browser => [0, 17, 18, 26, 27].flatMap(version => [false, true].map(ipad =>
    ({ ios: true, ipad, android: false, mac: false, mobile: true, browser, version: browser === 'safari' ? version : 0 })))),
  ...['chrome', 'samsung', 'firefox', 'edge', 'other'].map(browser => ({ ios: false, ipad: false, android: true, mac: false, mobile: true, browser, version: 0 })),
  ...['chrome', 'edge', 'firefox', 'safari', 'other'].map(browser => ({ ios: false, ipad: false, android: false, mac: browser === 'safari', mobile: false, browser, version: browser === 'safari' ? 26 : 0 })),
];

test('every set of “Save to my phone” steps is shown to some device, and every device gets one', () => {
  const env = loadApp();
  const steps = env.run('INSTALL_STEPS');
  const reached = new Set();
  for (const d of DEVICES) {
    env.ctx.device = d;
    const k = env.run('installKey()');
    assert.ok(Object.hasOwn(steps, k), `${JSON.stringify(d)} gets steps (${k})`);
    reached.add(k);
  }
  assert.deepEqual([...reached].sort(), Object.keys(steps).sort());
});

test('the icons app.js asks for are all in the page’s icon sprite', () => {
  const sprite = new Set([...HTML.matchAll(/<symbol id="i-([\w-]+)"/g)].map(m => m[1]));
  const used = [...APP.matchAll(/\b(?:key|icon)\('([\w-]+)'/g)].map(m => m[1]);
  for (const name of ['share', 'menu', 'square-plus', 'ellipsis', 'ellipsis-vertical', 'download', 'copy']) assert.ok(used.includes(name), `found ${name}`);
  for (const name of new Set([...used, ...CATEGORIES.map(c => c.icon)])) assert.ok(sprite.has(name), `index.html has <symbol id="i-${name}">`);
});

test('the “Save to my phone” sheet is valid HTML for every device, app and install state', () => {
  const env = loadApp();
  const count = Object.keys(env.run('INSTALL_STEPS')).length;
  for (const d of DEVICES) {
    for (const inApp of [false, true]) {
      for (const installed of [false, true]) {
        env.ctx.device = { ...d, inApp };
        env.app.offline = { installed, online: true, supported: true, ready: false, canPrompt: false };
        env.ctx.openInstall();
        const html = env.$('#install-body').innerHTML;
        const where = `${JSON.stringify(env.ctx.device)}, installed: ${installed}`;
        assertValidHTML(html, where);
        assert.equal(html.match(/<details class="install-device">/g).length, count - 1, `${where}: every other device’s steps`);
        assert.equal(/id="install-mine"/.test(html), !installed, where);
      }
    }
  }
  assert.equal(env.$('#install').open, true);
});

test('the home page, the printable list and LICENSE name the same copyright owner', () => {
  // Compare the words people read: no-wrap spans and non-breaking spaces only change where the line breaks.
  const read = f => fs.readFileSync(new URL(`../${f}`, import.meta.url), 'utf8')
    .replace(/&copy;/g, '©').replace(/&nbsp;|\u00a0/g, ' ').replace(/<\/?span[^>]*>/g, '');
  const line = /Copyright © \d{4}(?:[–-]\d{4})? [^<.]+\. All Rights Reserved\./;
  const home = read('index.html').match(line)?.[0];
  assert.ok(home, 'index.html has a copyright line');
  assert.ok(read('directory.html').includes(home), `directory.html says "${home}" too (it's written by tools/build-data.mjs)`);
  assert.ok(read('tools/build-data.mjs').includes(home), 'and so does the template in tools/build-data.mjs');
  // The code is MIT-licensed by the same owner, so LICENSE carries the same year and name.
  const owner = home.replace(/^Copyright © /, '').replace(/\. All Rights Reserved\.$/, '');
  assert.ok(read('LICENSE').includes(`Copyright (c) ${owner}\n`), `LICENSE says "Copyright (c) ${owner}"`);
});
