// Willits Local: the app. Town names come from CONFIG (config.js). Plain ES modules, no framework, no build step, no server.
// Everything happens in the visitor's browser: data/businesses.json is searched locally.

import { buildIndex, search, suggest, normalize, tokenize, splitFilters } from './search.js';
import { INTENTS, STOPWORDS } from './intents.js';
import { CATEGORIES, CATEGORY_BY_ID, FEATURED_CATEGORY_IDS } from './taxonomy.js';
import { weekTable, localNow, hoursStatus, DAY_NAMES } from './hours.js';
import { initSky, greeting, fmtClock, sunNote } from './sky.js';
import { initOffline, onOfflineChange, promptInstall, keepSavedCopy, device } from './offline.js';
import { CONFIG } from './config.js';

clearTimeout(window.__mlBootTimer);

const PAGE = CONFIG.pageSize || 24;
const SITE = CONFIG.siteName; // "Willits Local"
const TOWN = CONFIG.town; // "Willits"
const SHORT = CONFIG.shortName || CONFIG.town; // the home-screen icon name, = short_name in site.webmanifest
const KEYS = ['q', 'cat', 'area', 'open', 'all', 'sort', 'view', 'id'];
const LIST_KEYS = ['q', 'cat', 'area', 'open', 'all', 'sort']; // a change to any of these means a new list
const KEEP_PARAMS = ['sky', 'skyHour', 'season', 'holiday']; // sky and season previews survive navigation
const REDUCED_MOTION = window.matchMedia('(prefers-reduced-motion: reduce)');
const IS_APPLE_MOBILE = /iPhone|iPad|iPod/.test(navigator.userAgent) ||
  (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ESC[c]);
const icon = (name, cls = 'icon') => `<svg class="${cls}" aria-hidden="true" focusable="false"><use href="#i-${name}"/></svg>`;
const num = n => n.toLocaleString('en-US');
const plural = (n, one, many = `${one}s`) => `${num(n)} ${n === 1 ? one : many}`;

const app = {
  data: null,
  index: null,
  docById: new Map(),
  areas: [],
  areaById: {},
  state: {},
  res: null,
  shown: 0,
  groups: null,
  pending: null, // what to do once the listings have loaded (a search or a tap made while loading)
  failed: false,
  notice: null,
  lastSub: '',
  lastMessage: '',
};

// ============================================================================ URL state

function cleanState(st) {
  const out = {};
  for (const k of KEYS) if (st[k] !== undefined && st[k] !== null && st[k] !== '') out[k] = String(st[k]).slice(0, 200);
  if (out.open && out.open !== '1') out.open = '1';
  if (out.cat && !CATEGORY_BY_ID[out.cat]) delete out.cat;
  if (out.area && app.areas.length && !app.areaById[out.area]) delete out.area;
  if (out.sort && !['best', 'name', 'open'].includes(out.sort)) delete out.sort;
  if (out.view && out.view !== 'map') delete out.view;
  if (out.all && (out.q || out.cat || out.area || out.open)) delete out.all;
  else if (out.all) out.all = '1';
  return out;
}

/** Taking away the last filter shows every place, instead of jumping back to the home page. */
function keepResults(st) {
  return st.q || st.cat || st.area || st.open ? st : { ...st, all: '1' };
}

function readState() {
  const p = new URLSearchParams(location.search);
  return cleanState(Object.fromEntries(KEYS.map(k => [k, p.get(k)])));
}

/**
 * The state in the address bar, for a page that has just loaded or gone back. "?q=open now" (from a bookmark,
 * the 404 page or a search engine) ticks the Open now button, as typing it does, and the address says so.
 */
function addressState() {
  const st = readState();
  const next = tickOpenNow(st);
  if (next !== st) history.replaceState(history.state, '', urlFor(next));
  return next;
}

function urlFor(st) {
  const p = new URLSearchParams();
  for (const k of KEYS) if (st[k]) p.set(k, st[k]);
  const cur = new URLSearchParams(location.search);
  for (const k of KEEP_PARAMS) if (cur.get(k)) p.set(k, cur.get(k));
  const qs = p.toString();
  return qs ? `?${qs}` : location.pathname;
}

/** Go somewhere new. `replace` swaps the current history entry instead of adding one. */
function navigate(next, { replace = false, focus = true, scroll = true } = {}) {
  const st = cleanState(next);
  // Only a listing opened over an unchanged list gets its own entry, so closing it goes back to that list.
  const openingDetail = !!st.id && st.id !== app.state.id && [...LIST_KEYS, 'view'].every(k => st[k] === app.state[k]);
  const url = urlFor(st);
  if (replace) history.replaceState({ ml: 1, detail: !!(history.state && history.state.detail && st.id) }, '', url);
  else history.pushState({ ml: 1, detail: openingDetail }, '', url);
  render(st, { focus, scroll });
}

// ============================================================================ rendering

function render(st, { focus = false, scroll = false } = {}) {
  const prev = app.state;
  app.state = st;
  const listChanged = !app.res || LIST_KEYS.some(k => prev[k] !== st[k]);
  const mode = st.q || st.cat || st.area || st.open || st.all ? 'results' : 'home';
  const hero = $('#hero');
  if (app.notice && app.notice.q !== st.q) app.notice = null;
  // Close a listing before drawing what's behind it: while it's open, the page can't take focus or be read out.
  if (!st.id) closeDetailForNavigation();

  if (document.activeElement !== $('#q') || listChanged) $('#q').value = st.q || '';
  updateClearButton();

  if (mode === 'home') {
    const results = $('#results');
    const active = document.activeElement;
    const focusLost = !results.hidden && (!active || active === document.body || results.contains(active));
    hero.dataset.mode = 'home';
    results.hidden = true;
    $('#browse').hidden = false;
    app.res = null;
    app.mapRes = null;
    document.title = `${SITE}: find local businesses in ${TOWN}, California`;
    if (scroll) window.scrollTo(0, 0);
    // The control the visitor was using has just disappeared with the list: start them at the search box.
    if (focusLost && !st.id) {
      $('#q').focus();
      announce('Back to the home page.');
    }
  } else {
    hero.dataset.mode = 'results';
    $('#results').hidden = false;
    $('#browse').hidden = true;
    if (listChanged) renderResults(st, { focus, scroll });
    renderView(st);
  }

  if (st.id) openDetail(st.id);
}

// ---------------------------------------------------------------------------- results

function runSearch(st, overrides = {}) {
  const o = { ...st, ...overrides };
  return search(app.index, o.q || '', {
    category: o.cat || undefined,
    area: o.area || undefined,
    open: !!o.open,
    sort: o.sort || undefined,
  });
}

function renderResults(st, { focus, scroll }) {
  const res = runSearch(st);
  app.res = res;
  app.mapRes = res;
  app.shown = 0;
  app.groups = groupInfo(res, st);

  const head = describe(st, res);
  $('#results-title').textContent = head.title;
  $('#results-sub').innerHTML = head.sub;
  app.lastSub = head.sub;
  renderRefine(st);
  renderToolbar(st, res);
  $('#emergency').hidden = !res.query.emergency;
  $('#cards').innerHTML = '';
  showMore(false);
  renderEmpty(st, res);

  document.title = `${head.title.replace(/[“”]/g, '"')} · ${SITE}`;
  announce(res.total ? `${plural(res.total, 'place')} found.` : 'No places found.');
  if (scroll) window.scrollTo(0, 0);
  if (focus) $('#results-title').focus({ preventScroll: true });
}

/**
 * Hour words typed into the search ("open now", "open late", "sunday"), split from the other words.
 * rest is '' when nothing but filler is left ("what's open now").
 */
function typedHours(st) {
  if (!st.q) return null;
  const { rest, filters } = splitFilters(app.index, st.q);
  return filters.open || filters.late || filters.day !== undefined ? { rest, filters } : null;
}

/** Typed "open now", with no other hour words, works like the Open now button: it shows ticked and can be switched off. */
function tickOpenNow(st) {
  const typed = typedHours(st);
  if (!typed || !typed.filters.open || typed.filters.late || typed.filters.day !== undefined) return st;
  return cleanState({ ...st, q: typed.rest || undefined, open: '1' });
}

function singleIntent(res, st) {
  const q = res.query;
  if (!st.q || q.concepts.length !== 1 || q.concepts[0].kind !== 'intent') return null;
  // Typing a business name that is also a kind of place ("Giant") keeps the visitor's words.
  const top = res.results[0];
  if (top && top.doc.nameNorm === normalize(st.q)) return null;
  return INTENTS[q.concepts[0].intents[0]];
}

function describe(st, res) {
  const q = res.query;
  const cat = st.cat && CATEGORY_BY_ID[st.cat];
  const area = st.area && app.areaById[st.area];
  const intent = singleIntent(res, st);
  let title;
  if (st.q) title = intent ? intent.label : `“${st.q.trim()}”`;
  else if (cat) title = cat.name;
  else if (area) title = area.name;
  else if (st.open) title = 'Open right now';
  else title = `Every place in ${TOWN}`;

  const bits = [];
  if (app.notice && app.notice.q === st.q) bits.push(esc(app.notice.text));
  if (!st.q && cat) bits.push(esc(cat.blurb));
  if (!st.q && !cat && area && area.blurb) bits.push(esc(area.blurb));

  const f = q.filters;
  const byHours = f.open || f.late || f.day !== undefined;
  if (res.total) {
    let line = st.open && !st.q && !cat && !area
      ? `As of ${esc(fmtClock(new Date()))}, <strong>${plural(res.total, 'place is', 'places are')}</strong> open`
      : `We found <strong>${plural(res.total, 'place')}</strong>`;
    // Quote what was typed without the hour words, which the rest of the sentence already says.
    const typed = typedHours(st);
    const words = trimFiller(typed ? typed.rest : st.q || '');
    if (st.q && intent && words && normalize(intent.label) !== normalize(words)) line += ` for “${esc(words)}”`;
    if (st.q && cat) line += ` in ${esc(cat.name)}`;
    if (area && (st.q || cat || st.open)) line += ` in ${esc(area.name)}`;
    const openNow = st.open ? !!(st.q || cat || area) : !!f.open;
    if (openNow) line += ' open now';
    line += hoursWords(f, res.total, openNow, q.today);
    bits.push(`${line}.`);
    if (byHours) bits.push('Places with no hours listed aren’t included.');
  }
  if (q.corrections.length) {
    const to = q.corrections.map(c => `“${esc(c.to)}”`).join(' and ');
    bits.push(`We think you meant ${to}, so that’s what we searched for.`);
  }
  if (res.partial) bits.push('No place matched every word, so these match some of them.');
  if (st.q && cat) bits.push(`<button type="button" class="linklike" data-widen="cat">Search all categories instead</button>`);
  return { title, sub: bits.join(' ') };
}

/** The end of "We found 3 places...": " open today", " open on Saturdays", " that stay open until 10 PM or later tonight".
 *  "Open today" is said only for the "open today" phrases, which also leave out places already closed for the day;
 *  "dentist monday" typed on a Monday evening still reads "open on Mondays". */
function hoursWords(f, total, openNow, typedToday) {
  const today = f.day === localNow().day;
  const day = f.day === undefined ? '' : `on ${DAY_NAMES[f.day]}s`;
  if (f.late) return ` that ${total === 1 ? 'stays' : 'stay'} open until 10 PM or later ${day && !today ? day : 'tonight'}`;
  if (!day || (today && openNow)) return ''; // "open now" already says today
  if (today && typedToday) return ' open today';
  return openNow ? ` and ${day}` : ` open ${day}`;
}

/** Typed words without filler left at either end, which reads oddly when quoted back ("bars on" -> "bars"). */
function trimFiller(text) {
  const words = String(text).trim().split(/\s+/);
  const filler = w => tokenize(w).every(t => STOPWORDS.has(t));
  while (words.length && filler(words[0])) words.shift();
  while (words.length && filler(words[words.length - 1])) words.pop();
  return words.join(' ');
}

function renderToolbar(st, res) {
  $('#f-open').setAttribute('aria-pressed', String(!!st.open));
  $('#f-area').value = st.area || '';
  $('#f-sort').value = st.sort || (res.query.concepts.length ? 'best' : 'name');
}

function renderView(st) {
  const isMap = st.view === 'map';
  $('#v-list').setAttribute('aria-pressed', String(!isMap));
  $('#v-map').setAttribute('aria-pressed', String(isMap));
  $('#map-wrap').hidden = !isMap;
  // The map keeps the list it was drawn for. The minute-by-minute recheck (refreshResults) changes app.res, and
  // redrawing the map then would close an open popup and zoom out behind an open listing.
  if (!isMap) { app.mapRes = null; return; }
  if (!app.mapRes) app.mapRes = app.res;
  if (app.mapRes) showMapFor(app.mapRes);
}

/** Split "best matches" from "also related" when a search has both kinds. */
function groupInfo(res, st) {
  const sort = st.sort || (res.query.concepts.length ? 'best' : 'name');
  if (sort !== 'best' || res.partial || !res.query.concepts.length) return null;
  const firstWeak = res.results.findIndex(r => !r.strong);
  if (firstWeak <= 0) return null;
  return { firstWeak };
}

function showMore(moveFocus = true, count = PAGE) {
  const res = app.res;
  const box = $('#cards');
  const from = app.shown;
  const to = Math.min(res.results.length, from + count);
  let firstNew = null;
  for (let k = from; k < to; k++) {
    const groupIdx = app.groups && k >= app.groups.firstWeak ? 1 : 0;
    let list = box.querySelector(`ol[data-group="${groupIdx}"]`);
    if (!list) {
      if (app.groups) {
        const h = document.createElement('h3');
        h.className = 'group-label';
        h.textContent = groupIdx === 0 ? 'Best matches' : 'Also related';
        box.append(h);
      }
      list = document.createElement('ol');
      list.className = 'cards';
      list.dataset.group = String(groupIdx);
      box.append(list);
    }
    list.insertAdjacentHTML('beforeend', cardHTML(res.results[k], k - from));
    if (!firstNew) firstNew = list.lastElementChild;
  }
  app.shown = to;
  const left = res.results.length - to;
  const more = $('#more');
  more.hidden = left <= 0;
  if (left > 0) more.innerHTML = `Show ${num(Math.min(PAGE, left))} more <span class="more-left">(${num(left)} left)</span>`;
  if (moveFocus && firstNew) firstNew.querySelector('.card-name a')?.focus();
}

// ---------------------------------------------------------------------------- keeping open/closed current

/**
 * Whether a place is open depends on the clock, so recheck every minute while the page is in view and
 * whenever the visitor comes back to it. Focus, scrolling, "Show more" and screen readers are left alone.
 */
function refreshHours() {
  if (!app.index || document.hidden) return;
  const now = localNow();
  if (app.res) refreshResults();
  patchStatuses($('#new-list'), id => app.docById.has(id) && hoursStatus(app.docById.get(id).parsedHours, now));
  const doc = app.docById.get(app.state.id);
  const pill = $('#detail-body .status-pill');
  if (doc && pill && $('#detail').open) {
    const html = pillHTML(doc, now);
    if (pill.outerHTML !== html) pill.outerHTML = html;
  }
}

function refreshResults() {
  const st = app.state;
  const before = app.res;
  const res = runSearch(st);
  app.res = res;
  const sub = describe(st, res).sub;
  const subEl = $('#results-sub');
  if (sub !== app.lastSub && !subEl.contains(document.activeElement)) {
    subEl.innerHTML = sub;
    app.lastSub = sub;
  }
  const same = res.results.length === before.results.length && res.results.every((r, k) => r.doc === before.results[k].doc);
  if (same) {
    const byId = new Map(res.results.map(r => [r.doc.b.id, r.status]));
    patchStatuses($('#cards'), id => byId.get(id));
    return;
  }
  // Places have opened or closed in an "Open now" list (or one sorted open-first): redraw as many cards as before.
  const hadFocus = $('#results').contains(document.activeElement);
  const keep = focusedCard();
  const shown = app.shown;
  app.groups = groupInfo(res, st);
  app.shown = 0;
  $('#cards').innerHTML = '';
  showMore(false, Math.max(shown, PAGE));
  for (const card of $$('#cards .card')) card.style.animation = 'none';
  renderEmpty(st, res);
  // The map is left alone: its dots don't show open or closed, and redrawing it would close the place the
  // visitor is reading and zoom back out. It catches up with the list on their next change.
  if (hadFocus) restoreCardFocus(keep);
}

function patchStatuses(box, statusOf) {
  for (const card of $$('.card', box)) {
    const link = card.querySelector('.card-name a[data-id]');
    const line = card.querySelector('.card-status');
    const status = link && line && statusOf(link.dataset.id);
    if (!status) continue;
    const html = statusLine(statusInfo(status), 'card-status');
    if (line.outerHTML !== html) line.outerHTML = html;
  }
}

function focusedCard() {
  const el = document.activeElement;
  const card = el && el.closest && el.closest('#cards .card');
  if (!card) return null;
  return { id: card.querySelector('.card-name a')?.dataset.id, at: $$('a, button', card).indexOf(el) };
}

function restoreCardFocus(keep) {
  const now = document.activeElement;
  if (now && now !== document.body) return; // what had focus is still on the page
  const link = keep && $$('#cards .card-name a').find(a => a.dataset.id === keep.id);
  const target = link ? $$('a, button', link.closest('.card'))[keep.at] || link : $('#results-title');
  target.focus({ preventScroll: true });
}

let hoursTimer = 0;
function scheduleHoursRefresh() {
  clearTimeout(hoursTimer);
  if (document.hidden) return;
  // Just after the next minute starts, which is when places open and close.
  hoursTimer = setTimeout(() => { refreshHours(); scheduleHoursRefresh(); }, 60500 - (Date.now() % 60000));
}

function initHoursRefresh() {
  const wake = () => { refreshHours(); scheduleHoursRefresh(); };
  document.addEventListener('visibilitychange', () => { if (document.hidden) clearTimeout(hoursTimer); else wake(); });
  window.addEventListener('pageshow', e => { if (e.persisted) wake(); });
  scheduleHoursRefresh();
}

function statusInfo(st) {
  if (st.state === 'open') {
    return st.closingSoon
      ? { cls: 'status-closing', label: 'Closing soon', detail: st.detail }
      : { cls: 'status-open', label: st.label, detail: st.detail };
  }
  if (st.state === 'closed') {
    return st.opensSoon
      ? { cls: 'status-closing', label: 'Opens soon', detail: st.detail }
      : { cls: 'status-closed', label: 'Closed now', detail: st.detail };
  }
  return { cls: 'status-unknown', label: 'Hours not listed', detail: '' };
}

function statusLine(si, cls) {
  const detail = si.detail ? ` <span class="status-detail">· ${esc(si.detail)}</span>` : '';
  return `<p class="${cls} ${si.cls}"><span class="st-dot" aria-hidden="true"></span><span class="st-text"><span class="st-label">${esc(si.label)}</span>${detail}</span></p>`;
}

function telHref(phone) {
  const d = String(phone || '').replace(/\D/g, '');
  if (d.length === 10) return `tel:+1${d}`;
  if (d.length === 11 && d[0] === '1') return `tel:+${d}`;
  return '';
}

function safeUrl(u) {
  try {
    const x = new URL(u);
    return x.protocol === 'https:' || x.protocol === 'http:' ? x.href : '';
  } catch { return ''; }
}

const domainOf = u => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return ''; } };

function directionsUrl(b) {
  const place = b.address ? `${b.address}, ${TOWN}, ${CONFIG.state} ${b.zip || ''}`.trim() : (b.lat && b.lon ? `${b.lat},${b.lon}` : '');
  if (!place) return '';
  if (IS_APPLE_MOBILE) return `https://maps.apple.com/?daddr=${encodeURIComponent(place)}&q=${encodeURIComponent(b.name)}`;
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(b.address ? `${b.name}, ${place}` : place)}`;
}

function addressLine(b) {
  const street = b.address ? b.address + (b.unit ? `, ${b.unit}` : '') : '';
  return [street, b.center].filter(Boolean).join(' · ');
}

function isNew(b) {
  if (!b.opened || !app.data) return false;
  return b.opened >= monthsBefore(app.data.meta.built, 12);
}

function monthsBefore(isoDate, months) {
  const [y, m] = String(isoDate || '').split('-').map(Number);
  if (!y || !m) return '9999';
  const t = y * 12 + (m - 1) - months;
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}`;
}

function fmtMonth(ym) {
  const [y, m] = String(ym || '').split('-').map(Number);
  if (!y || !m) return '';
  return new Date(Date.UTC(y, m - 1, 15)).toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
}

function fmtDate(iso) {
  const [y, m, d] = String(iso || '').split('-').map(Number);
  if (!y || !m || !d) return '';
  return new Date(Date.UTC(y, m - 1, d, 12)).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}

function cardHTML(r, k) {
  const b = r.doc.b;
  const cat = CATEGORY_BY_ID[b.category] || CATEGORIES[0];
  const si = statusInfo(r.status);
  const area = app.areaById[b.area];
  const sub = [b.sub || cat.short, area && area.id !== 'elsewhere' ? area.name : ''].filter(Boolean).join(' · ');
  const tel = telHref(b.phone);
  const web = safeUrl(b.website);
  const dir = directionsUrl(b);
  const addr = addressLine(b);
  const badge = isNew(b) ? `<div class="card-badges"><span class="badge">New</span></div>` : '';
  return `<li class="card cat-${esc(b.category)}" style="--i:${k}">
<div class="card-main">
<span class="card-icon">${icon(cat.icon)}</span>
<div class="card-text">
<h3 class="card-name"><a href="?id=${encodeURIComponent(b.id)}" data-id="${esc(b.id)}">${esc(b.name)}</a></h3>
<p class="card-sub">${esc(sub)}</p>${badge}
${statusLine(si, 'card-status')}
${addr ? `<p class="card-addr">${esc(addr)}</p>` : ''}
</div>
</div>
<div class="card-actions">${tel ? `<a class="btn btn-call" href="${tel}" aria-label="Call ${esc(b.phone)}, ${esc(b.name)}">${icon('phone')}<span>Call <span class="num">${esc(b.phone)}</span></span></a>` : ''}${dir ? `<a class="btn" href="${esc(dir)}" data-maps aria-label="Directions to ${esc(b.name)}">${icon('navigation')}Directions</a>` : ''}${web ? `<a class="btn" href="${esc(web)}" aria-label="Website for ${esc(b.name)}">${icon('globe')}Website</a>` : ''}</div>
</li>`;
}

/** A real list of that kind of place: not a respelled, partial or word-for-word fallback search. */
const isKindOfPlace = r => !r.partial && !r.query.corrections.length && r.query.concepts.some(c => c.kind === 'intent');

/** "Narrow it down" chips when browsing a category (cuisines, specialties...). */
const refineCache = new Map();
function refineOptions(catId) {
  if (refineCache.has(catId)) return refineCache.get(catId);
  const inCat = app.index.docs.filter(d => d.b.category === catId).length;
  const out = [];
  const seen = new Set();
  INTENTS.forEach(it => {
    if (it.scope && !it.scope.includes(catId)) return;
    if (!it.s && !(it.t && it.t.length)) return; // broad, category-wide intents
    if (it.c && it.c.length > 3) return;
    const r = search(app.index, it.label, { category: catId });
    if (!isKindOfPlace(r)) return; // only kinds of place this category really has
    const n = r.results.filter(x => x.strong).length;
    if (n >= 2 && n < inCat && !seen.has(it.label)) { seen.add(it.label); out.push({ label: it.label, n }); }
  });
  out.sort((a, b) => b.n - a.n || a.label.localeCompare(b.label));
  const top = out.slice(0, 10);
  refineCache.set(catId, top);
  return top;
}

function renderRefine(st) {
  const nav = $('#refine');
  if (!st.cat) { nav.hidden = true; nav.innerHTML = ''; return; }
  // Each number matches the list its chip opens, which keeps the neighborhood and Open now choices. Where that
  // list would only be a fallback ("No place matched every word"), the chip counts as empty.
  const isChosen = o => st.q && normalize(o.label) === normalize(st.q);
  const opts = refineOptions(st.cat)
    .map(o => {
      const r = runSearch({ cat: st.cat, area: st.area, open: st.open, q: o.label });
      return { label: o.label, n: isKindOfPlace(r) ? r.total : 0 };
    })
    .filter(o => o.n > 0 || isChosen(o));
  const active = opts.find(isChosen);
  if (!opts.length || (st.q && !active)) { nav.hidden = true; nav.innerHTML = ''; return; }
  const cat = CATEGORY_BY_ID[st.cat];
  const base = { cat: st.cat, ...(st.area ? { area: st.area } : {}), ...(st.open ? { open: '1' } : {}) };
  const href = extra => `?${new URLSearchParams({ ...base, ...extra })}`;
  const chip = (label, extra, isActive, count) =>
    `<a class="rchip" href="${esc(href(extra))}" data-nav="${esc(new URLSearchParams({ ...base, ...extra }).toString())}"${isActive ? ' aria-current="true"' : ''}>${esc(label)}${count ? ` <span class="rchip-n">${num(count)}</span>` : ''}</a>`;
  // On phones, show the first few choices and tuck the rest behind "More choices".
  const SHOW = 4;
  const activeAt = active ? opts.indexOf(active) : -1;
  const chips = opts.map((o, k) => {
    const html = chip(o.label, { q: o.label }, active && active.label === o.label, o.n);
    return k >= SHOW && k !== activeAt ? html.replace('class="rchip"', 'class="rchip rchip-extra"') : html;
  }).join('');
  const extra = opts.length - SHOW - (activeAt >= SHOW ? 1 : 0);
  const more = extra > 0 ? `<button type="button" class="rchip rchip-more" aria-expanded="false">${icon('plus')}${plural(extra, 'more choice')}</button>` : '';
  nav.innerHTML = `<span class="refine-label">Narrow it down:</span>${chip(`All ${cat.short.toLowerCase()}`, {}, !st.q)}${chips}${more}`;
  nav.dataset.collapsed = '';
  nav.hidden = false;
}

function renderEmpty(st, res) {
  const box = $('#empty');
  if (res.total) { box.hidden = true; box.innerHTML = ''; return; }
  const widen = [];
  // Hour words in the search ("open late", "sunday") leave out every place whose hours we don't know.
  const typed = typedHours(st);
  let hoursLink = '';
  let hiddenByOpen = null; // what switching off Open now would show
  if (typed) {
    const words = trimFiller(typed.rest || ''); // "florist on sunday" -> "florist", not "florist on"
    const next = cleanState(keepResults({ ...st, q: words || undefined, open: undefined, id: undefined }));
    const n = runSearch(next).total;
    const nav = new URLSearchParams(next).toString();
    const text = words ? `Show all ${plural(n, 'place')} for “${words}”` : `Show all ${plural(n, 'place')}`;
    if (n) hoursLink = `<a class="btn btn-primary btn-lg" href="?${esc(nav)}" data-nav="${esc(nav)}">${esc(text)}</a>`;
  } else if (st.open) {
    const r = runSearch(st, { open: undefined });
    if (r.total) hiddenByOpen = r;
  }
  // Open now hides places with no hours listed too, and we can't call those "open or closed".
  const noHours = !!hiddenByOpen && hiddenByOpen.results.some(r => r.status.state === 'unknown');
  if (hiddenByOpen) widen.push({ key: 'open', text: `Show all ${plural(hiddenByOpen.total, 'place')}${noHours ? '' : ', open or closed'}` });
  if (st.area) {
    const r = runSearch(st, { area: undefined });
    if (r.total) widen.push({ key: 'area', text: `Search all of ${TOWN} (${plural(r.total, 'place')})` });
  }
  if (st.cat && st.q) {
    const r = runSearch(st, { cat: undefined });
    if (r.total) widen.push({ key: 'cat', text: `Search every category (${plural(r.total, 'place')})` });
  }
  const corrected = res.query.corrections.length ? ` We searched for “${esc(res.query.corrections.map(c => c.to).join(' '))}”.` : '';
  const cat = st.cat && CATEGORY_BY_ID[st.cat];
  const what = hiddenByOpen && trimFiller(st.q || '');
  let heading = 'Nothing matches right now';
  if (hiddenByOpen) heading = `Nothing open right now${what ? ` for “${esc(what)}”` : ''}`;
  else if (st.q) heading = `No matches for “${esc(st.q.trim())}”`;
  else if (!widen.length) heading = cat ? `We don’t have anything listed in ${esc(cat.short)} yet` : 'Nothing is listed here yet';
  let tip = '';
  if (hoursLink || noHours) tip = 'We don’t know the opening hours of every place, so searching by time leaves some out.';
  else if (widen.length) tip = 'Your filters might be hiding some places.';
  else if (app.notice && app.notice.q === st.q) tip = 'The business may have changed its name, moved or closed.';
  else if (st.q) tip = `Check the spelling, or try a simpler word like “pizza”, “dentist” or “plumber”.${corrected}`;
  box.innerHTML = `<div class="empty-art">${icon('search')}</div>
<h3>${heading}</h3>
${tip ? `<p>${tip}</p>` : ''}
${hoursLink}${widen.map(w => `<button type="button" class="btn btn-primary btn-lg" data-widen="${w.key}">${esc(w.text)}</button>`).join('')}
<p>Or try one of these:</p>
<div class="chips">${popularChips()}</div>
<p>Know a place we’re missing? <button type="button" class="linklike" data-open-suggest>Add it to the directory</button>.</p>`;
  box.hidden = false;
}

function popularChips() {
  return [['Restaurants', 'cat=restaurants'], ['Coffee', 'q=coffee'], ['Doctors', 'cat=health'], ['Groceries', 'cat=groceries'], ['Hair & nails', 'cat=beauty'], ['Home repair', 'cat=home']]
    .map(([label, nav]) => `<a class="chip" href="?${nav}" data-nav="${nav}">${esc(label)}</a>`).join('');
}

// ---------------------------------------------------------------------------- map

let mapModule = null;
function showMapFor(res) {
  const el = $('#map');
  if (!navigator.onLine) {
    el.innerHTML = `<div class="map-offline">${icon('wifi-off')}<h3>The map needs the internet</h3><p>You’re offline right now, so the map can’t load. These places are all still here in the list, with their phone numbers and addresses.</p><button type="button" class="btn btn-primary" data-view-list>${icon('list')}Show the list</button></div>`;
    hideMapNote(el);
    return;
  }
  const places = res.results.map(r => r.doc.b);
  if (!mapModule) el.innerHTML = '<p class="map-loading">Loading the map…</p>';
  (mapModule ? Promise.resolve(mapModule) : import('./map.js').then(m => (mapModule = m)))
    .then(m => m.showMap(el, places, { onSelect: id => navigate({ ...app.state, id }, { focus: false, scroll: false }) }))
    .catch(err => {
      console.warn('Map failed to load', err);
      el.innerHTML = `<div class="map-offline">${icon('map')}<h3>The map couldn’t load</h3><p>Please try again in a moment. Every place is still in the list, with phone numbers and addresses.</p><button type="button" class="btn btn-primary" data-view-list>${icon('list')}Show the list</button></div>`;
      hideMapNote(el);
    });
}

// "Tap a dot to see the place" makes no sense under a message. app.css hides it with :has(), which Safari before
// 15.4 doesn't support; map.js shows it again once a map appears.
function hideMapNote(el) {
  const note = el.closest('.map-wrap')?.querySelector('.map-note');
  if (note) note.hidden = true;
}

// ---------------------------------------------------------------------------- detail

const FEATURES = [
  [/^(takeout|take out|carryout|carry out)$/, 'Takeout'],
  [/^delivery$/, 'Delivery'],
  [/^outdoor seating$|^patio$/, 'Outdoor seating'],
  [/^drive ?thru$|^drive.through$/, 'Drive-through'],
  [/^atm$/, 'ATM'],
  [/^vegan$/, 'Vegan options'],
  [/^vegetarian$/, 'Vegetarian options'],
  [/^gluten.free$/, 'Gluten-free options'],
  [/^halal$/, 'Halal'],
  [/^kosher$/, 'Kosher'],
  [/^wheelchair( accessible)?$/, 'Wheelchair accessible'],
  [/^(free )?wi.?fi$/, 'Wi-Fi'],
  [/^(free )?parking$/, 'Parking'],
  [/^catering$/, 'Catering'],
  [/^reservations$/, 'Takes reservations'],
  [/^kid.friendly$|^family.friendly$/, 'Kid-friendly'],
  [/^dog.friendly$|^pet.friendly$/, 'Dog-friendly'],
  [/^happy hour$/, 'Happy hour'],
  [/^live music$/, 'Live music'],
  [/^private dining$/, 'Private dining'],
  [/^walk.ins?( welcome)?$/, 'Walk-ins welcome'],
  [/^curbside( pickup)?$/, 'Curbside pickup'],
  [/^same.day( appointments)?$/, 'Same-day appointments'],
  [/^emergency service$|^24.hour emergency$/, '24-hour emergency service'],
  [/^free estimates$/, 'Free estimates'],
  [/^accepts medicare$|^medicare$/, 'Accepts Medicare'],
  [/^telehealth$/, 'Telehealth visits'],
];

function featureList(b) {
  const out = new Set();
  for (const t of b.tags || []) {
    const n = String(t).toLowerCase().trim();
    for (const [re, label] of FEATURES) if (re.test(n)) out.add(label);
  }
  return [...out];
}

function openDetail(id) {
  const doc = app.docById.get(id);
  const dlg = $('#detail');
  if (!doc) {
    // Links are named after the business and its street number, which can change: search for the name instead.
    const words = staleLinkWords(id);
    if (words) {
      app.notice = { q: words, text: 'That link is out of date, so we searched for the business instead.' };
      navigate({ q: words }, { replace: true, focus: false, scroll: false });
    } else {
      toast('Sorry, we couldn’t find that listing.');
      navigate({ ...app.state, id: undefined }, { replace: true, focus: false, scroll: false });
    }
    return;
  }
  $('#detail-body').innerHTML = detailHTML(doc);
  if (!dlg.open) dlg.showModal();
  dlg.scrollTop = 0;
  document.title = `${doc.b.name} · ${SITE}`;
}

/** 'akb-a-hotel-bar-7599' -> 'akb a hotel bar' */
function staleLinkWords(id) {
  return String(id || '').replace(/(-\d+)+$/, '').replace(/-/g, ' ').trim();
}

function closeDetailForNavigation() {
  const dlg = $('#detail');
  if (dlg.open) dlg.close();
}

function detailHTML(doc) {
  const b = doc.b;
  const cat = CATEGORY_BY_ID[b.category] || CATEGORIES[0];
  const area = app.areaById[b.area];
  const now = localNow();
  const rows = weekTable(doc.parsedHours, now);
  const tel = telHref(b.phone);
  const web = safeUrl(b.website);
  const dir = directionsUrl(b);
  const features = featureList(b);
  const how = askBy(b);

  const actions = [
    tel && `<a class="btn btn-call" href="${tel}">${icon('phone')}<span>Call</span><small>${esc(b.phone)}</small></a>`,
    dir && `<a class="btn" href="${esc(dir)}" rel="noopener" data-maps>${icon('navigation')}<span>Directions</span><small>Opens your map app</small></a>`,
    web && `<a class="btn" href="${esc(web)}" rel="noopener">${icon('globe')}<span>Website</span><small>${esc(domainOf(web))}</small></a>`,
    `<button class="btn" type="button" data-share="${esc(b.id)}">${icon('share-2')}<span>Share</span><small>Send to a friend</small></button>`,
  ].filter(Boolean).join('');

  const facts = [];
  if (b.address) {
    facts.push(fact('map-pin', 'Address', `${esc(b.address)}${b.unit ? `, ${esc(b.unit)}` : ''}<br>${esc(TOWN)}, ${esc(CONFIG.state)} ${esc(b.zip || '')}${b.center ? `<br><span class="fact-note">In ${esc(b.center)}</span>` : ''}`));
  } else {
    const details = how === 'call' ? ' Call for details.' : how === 'web' ? ' See their website for details.' : '';
    facts.push(fact('map-pin', 'Where', `Serves the ${esc(TOWN)} area.${details}`));
  }
  if (tel) facts.push(fact('phone', 'Phone', `<a href="${tel}">${esc(b.phone)}</a>`));
  if (web) facts.push(fact('globe', 'Website', `<a href="${esc(web)}" rel="noopener">${esc(domainOf(web))}</a>`));
  if (area && area.id !== 'elsewhere') {
    facts.push(fact('map', 'Neighborhood', `<a href="?area=${esc(area.id)}" data-nav="area=${esc(area.id)}">${esc(area.name)}</a>`));
  }

  const checkFirst = how === 'call' ? ' If it matters, call ahead.' : how === 'web' ? ' If it matters, check their website.' : '';
  const noHours = how === 'call'
    ? `We don’t have hours for this place yet. Please call ahead at <a href="${tel}">${esc(b.phone)}</a>.`
    : how === 'web' ? 'We don’t have hours for this place yet. Their website may list them.' : 'We don’t have hours or a phone number for this place yet.';
  const hours = rows.length
    ? `<table class="hours"><caption class="visually-hidden">Opening hours for ${esc(b.name)}</caption><tbody>${rows.map(r => `<tr${r.isToday ? ' class="today"' : ''}><th scope="row">${esc(r.day)}</th><td>${esc(r.text)}</td></tr>`).join('')}</tbody></table><p class="hours-note">Hours can change on holidays.${checkFirst}</p>`
    : `<p class="hours-none">${noHours}</p>`;

  return `<div class="sheet-hero cat-${esc(b.category)}">
  <div class="sheet-top"><button type="button" class="close" data-close>${icon('x')}<span>Close</span></button></div>
  <span class="sheet-icon">${icon(cat.icon)}</span>
  <p class="sheet-kicker">${esc(b.sub || cat.name)}${area && area.id !== 'elsewhere' ? ` · ${esc(area.name)}` : ''}</p>
  <h2 class="sheet-name" id="d-name">${esc(b.name)}</h2>
  ${b.desc ? `<p class="sheet-desc">${esc(b.desc)}</p>` : ''}
</div>
<div class="sheet-body">
  ${pillHTML(doc, now)}
  <div class="actions-big">${actions}</div>
  <dl class="facts">${facts.join('')}</dl>
  <section class="sheet-section" aria-labelledby="d-hours"><h3 id="d-hours">Hours</h3>${hours}</section>
  ${features.length ? `<section class="sheet-section" aria-labelledby="d-good"><h3 id="d-good">Good to know</h3><ul class="tags">${features.map(f => `<li>${esc(f)}</li>`).join('')}</ul></section>` : ''}
  <div class="sheet-meta">
    <p>${checkedHTML(b)}</p>
    <p>Something wrong or out of date? <button type="button" class="linklike" data-open-suggest="fix" data-name="${esc(b.name)}">Tell us</button> and we’ll fix it.</p>
  </div>
</div>`;
}

function fact(ic, label, html) {
  return `<div class="fact"><span class="fact-icon">${icon(ic)}</span><div><dt>${esc(label)}</dt><dd>${html}</dd></div></div>`;
}

/** How a visitor can check what we don't know: 'call', 'web', or '' when the listing has neither. */
function askBy(b) {
  return telHref(b.phone) ? 'call' : safeUrl(b.website) ? 'web' : '';
}

function pillHTML(doc, now) {
  const si = statusInfo(hoursStatus(doc.parsedHours, now));
  if (si.cls !== 'status-unknown') return statusLine(si, 'status-pill');
  const how = askBy(doc.b);
  return statusLine({ ...si, detail: how === 'call' ? 'Call ahead' : how === 'web' ? 'Check their website' : '' }, 'status-pill');
}

/** When we last checked a listing, and where its details come from. */
function checkedHTML(b) {
  const from = sourceList(b);
  const date = fmtDate(b.verified);
  if (date) return `We last checked these details on ${esc(date)}${from ? `, on ${from}` : ''}.`;
  const how = askBy(b);
  const advice = how === 'call' ? 'Please call before you go.' : how === 'web' ? 'Please check their website before you go.' : 'Please check before you go.';
  return from ? `These details come from ${from}, but we haven’t noted when we last checked them. ${advice}` : `We haven’t checked this listing yet. ${advice}`;
}

/** "their own website (example.com) and OpenStreetMap (a free public map)", as links. */
function sourceList(b) {
  const seen = new Set();
  const items = [];
  for (const u of (b.sources || []).map(safeUrl).filter(Boolean)) {
    const host = domainOf(u);
    // The data rules allow only these three kinds of source (see data/SOURCES.md).
    const kind = /(^|\.)(openstreetmap|osm)\.org$/.test(host) ? 'osm' : /\.(gov|mil)$|\.ca\.us$|(^|\.)(usps\.com|cityofwillits\.org|btcsd\.org|littlelakefire\.org|willitsunified\.com)$/.test(host) ? 'gov' : 'own';
    const label = kind === 'osm' ? 'OpenStreetMap' : kind === 'gov' ? `a government website (${host})` : `their own website (${host})`;
    if (seen.has(label)) continue;
    seen.add(label);
    items.push(`<a href="${esc(u)}" rel="noopener">${esc(label)}</a>${kind === 'osm' ? ' (a free public map)' : ''}`);
  }
  return items.length > 1 ? `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}` : items.join('');
}

async function shareListing(id) {
  const doc = app.docById.get(id);
  if (!doc) return;
  const url = new URL(`?id=${encodeURIComponent(id)}`, location.href).href;
  if (navigator.share) {
    try {
      await navigator.share({ title: doc.b.name, text: `${doc.b.name}${doc.b.sub ? ` (${doc.b.sub})` : ''} in ${TOWN}`, url });
      return;
    } catch (e) {
      if (e && e.name === 'AbortError') return;
    }
  }
  copyText(url, 'Link copied. You can paste it into an email or a text message.');
}

// ============================================================================ home page

function injectCategoryStyles() {
  const light = CATEGORIES.map(c => `.cat-${c.id}{--c-bg:${c.light.bg};--c-fg:${c.light.fg};--c-pin:${c.pin}}`).join('');
  const dark = CATEGORIES.map(c => `.cat-${c.id}{--c-bg:${c.dark.bg};--c-fg:${c.dark.fg}}`).join('');
  const el = document.createElement('style');
  el.textContent = `${light}@media (prefers-color-scheme: dark){${dark}}`;
  document.head.append(el);
}

function renderHome() {
  const data = app.data;
  const counts = {};
  for (const b of data.businesses) counts[b.category] = (counts[b.category] || 0) + 1;

  const tile = c => `<li class="tile cat-${c.id}"><a href="?cat=${c.id}" data-nav="cat=${c.id}">
<span class="tile-icon">${icon(c.icon)}</span>
<span class="tile-name">${esc(c.short)}</span>
<span class="tile-count">${counts[c.id] ? plural(counts[c.id], 'place') : 'None listed yet'}</span></a></li>`;
  const featured = FEATURED_CATEGORY_IDS.map(id => CATEGORY_BY_ID[id]).filter(Boolean);
  const rest = CATEGORIES.filter(c => !FEATURED_CATEGORY_IDS.includes(c.id));
  $('#tiles').innerHTML = featured.map(tile).join('');
  $('#tiles-more').innerHTML = rest.map(tile).join('');
  $('#cat-count').textContent = String(CATEGORIES.length);

  // Neighborhoods, each drawn as a little constellation of its businesses.
  const byArea = {};
  for (const b of data.businesses) (byArea[b.area] = byArea[b.area] || []).push(b);
  $('#areas').innerHTML = app.areas.filter(a => a.id !== 'elsewhere' && (byArea[a.id] || []).length >= 3).map(a => `<li class="area"><a href="?area=${esc(a.id)}" data-nav="area=${esc(a.id)}">
${areaViz(a, byArea[a.id])}
<span class="area-text"><span class="area-name">${esc(a.name)}</span>
<span class="area-blurb">${esc(a.blurb || '')}</span>
<span class="area-count">${plural(byArea[a.id].length, 'place')} ${icon('arrow-right')}</span></span></a></li>`).join('');

  // Neighborhood filter in the results toolbar.
  $('#f-area').innerHTML = `<option value="">All of ${esc(TOWN)}</option>` + app.areas
    .filter(a => (byArea[a.id] || []).length)
    .map(a => `<option value="${esc(a.id)}">${esc(a.name)}</option>`).join('');

  renderNew();

  if (data.businesses.length) $('#count-places').textContent = num(data.businesses.length);
  // Before the first listings are published, say so rather than "Search 0 local shops".
  else $('.hero-lede').textContent =`Listings for ${TOWN} are on their way: each one is being checked with the business itself.`;
  const built = fmtDate(data.meta && data.meta.built);
  if (built) $('#footer-updated').textContent = `Listings last updated ${built}.`;
}

function areaViz(area, list) {
  const pts = list.filter(b => b.lat && b.lon);
  if (!pts.length) return '<svg class="area-viz" viewBox="0 0 112 112" aria-hidden="true"></svg>';
  const lat0 = area.lat ?? pts.reduce((s, b) => s + b.lat, 0) / pts.length;
  const lon0 = area.lon ?? pts.reduce((s, b) => s + b.lon, 0) / pts.length;
  const kx = Math.cos((lat0 * Math.PI) / 180);
  const xy = pts.map(b => [(b.lon - lon0) * kx, b.lat - lat0, CATEGORY_BY_ID[b.category]?.pin || '#1f4a37']);
  const dists = xy.map(([x, y]) => Math.hypot(x, y)).sort((a, b) => a - b);
  const r = dists[Math.min(dists.length - 1, Math.floor(dists.length * 0.9))] || 0.002;
  const scale = 40 / r;
  const dots = xy.map(([x, y, color]) => {
    let px = x * scale, py = -y * scale;
    const d = Math.hypot(px, py);
    if (d > 47) { px *= 47 / d; py *= 47 / d; }
    return `<circle class="pt" cx="${(56 + px).toFixed(1)}" cy="${(56 + py).toFixed(1)}" r="2.6" fill="${color}"/>`;
  }).join('');
  return `<svg class="area-viz" viewBox="0 0 112 112" aria-hidden="true" focusable="false"><circle cx="56" cy="56" r="24" class="ring"/><circle cx="56" cy="56" r="44" class="ring"/>${dots}</svg>`;
}

function renderNew() {
  const sec = $('#new-section');
  const now = localNow();
  const recent = app.data.businesses.filter(isNew)
    .sort((a, b) => (b.opened > a.opened ? 1 : b.opened < a.opened ? -1 : 0)).slice(0, 6);
  const soon = (app.data.comingSoon || []).slice(0, 6);
  if (!recent.length && !soon.length) { sec.hidden = true; return; }
  const cards = recent.map((b, k) => {
    const doc = app.docById.get(b.id);
    const html = cardHTML({ doc, status: hoursStatus(doc.parsedHours, now) }, k);
    const when = fmtMonth(b.opened);
    return when ? html.replace('<span class="badge">New</span>', `<span class="badge">New · ${esc(when)}</span>`) : html;
  });
  const soonCards = soon.map((c, k) => {
    const cat = CATEGORY_BY_ID[c.category] || CATEGORIES[0];
    const web = safeUrl(c.website);
    return `<li class="card cat-${esc(c.category || 'shopping')}" style="--i:${recent.length + k}">
<div class="card-main">
<span class="card-icon">${icon(cat.icon)}</span>
<div class="card-text">
<h3 class="card-name">${esc(c.name)}</h3>
<p class="card-sub">${esc(c.sub || cat.short)}</p>
<div class="card-badges"><span class="badge badge-soon">Coming soon${c.expected ? ` · ${esc(c.expected)}` : ''}</span></div>
${c.address ? `<p class="card-addr">${esc(addressLine(c))}</p>` : ''}
${c.note ? `<p class="card-addr">${esc(c.note)}</p>` : ''}
</div>
</div>
${web ? `<div class="card-actions"><a class="btn" href="${esc(web)}" aria-label="Website for ${esc(c.name)}">${icon('globe')}Website</a></div>` : ''}
</li>`;
  });
  $('#new-list').innerHTML = cards.join('') + soonCards.join('');
  sec.hidden = false;
}

function initReveal() {
  if (!('IntersectionObserver' in window) || REDUCED_MOTION.matches) return;
  const io = new IntersectionObserver(entries => {
    for (const e of entries) if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); }
  }, { rootMargin: '0px 0px -8% 0px' });
  for (const el of $$('#browse .section')) {
    if (el.getBoundingClientRect().top < window.innerHeight) continue; // already on screen
    el.classList.add('reveal');
    io.observe(el);
  }
}

// ============================================================================ search box

function updateClearButton() {
  $('#q-clear').hidden = !$('#q').value;
}

function submitSearch(raw) {
  const q = String(raw || '').trim();
  closeSuggestions();
  if (!q) {
    $('#q').focus();
    toast('Type what you’re looking for, like “pizza” or “dentist”.');
    return;
  }
  if (!app.index) { whenLoaded(() => searchFor(q)); return; }
  $('#q').blur();
  searchFor(q);
}

function searchFor(q) {
  navigate(tickOpenNow({ q }));
}

/** Do something once the listings have loaded. Until then, say why nothing has happened yet. */
function whenLoaded(fn) {
  if (app.failed) { showLoadProblem(); return; }
  app.pending = fn;
  toast('One moment, still loading the directory…');
}

function showLoadProblem() {
  const fb = $('#boot-fallback');
  fb.innerHTML = navigator.onLine
    ? 'Sorry, the directory didn’t load. <button type="button" class="linklike" data-reload>Try again</button>, or <a href="directory.html">open the simple list of all our listings</a>.'
    : `You’re offline, and this device doesn’t have a saved copy of the directory yet. Open ${esc(SITE)} once while you’re connected, and it will save itself for next time.`;
  fb.hidden = false;
  announce(fb.textContent);
}

let sugItems = [];
let sugActive = -1;

function closeSuggestions() {
  const list = $('#suggestions');
  list.hidden = true;
  $('#hero').classList.remove('sug-open');
  $('#q').setAttribute('aria-expanded', 'false');
  $('#q').removeAttribute('aria-activedescendant');
  sugActive = -1;
}

function setActiveSuggestion(k) {
  sugActive = k;
  $$('#suggestions [role="option"]').forEach((li, i) => li.setAttribute('aria-selected', String(i === k)));
  const li = $(`#sug-${k}`);
  if (li) {
    $('#q').setAttribute('aria-activedescendant', li.id);
    li.scrollIntoView({ block: 'nearest' });
  } else {
    $('#q').removeAttribute('aria-activedescendant');
  }
}

function highlight(label, raw) {
  const words = tokenize(raw).filter(w => w.length >= 1);
  const frag = document.createDocumentFragment();
  if (!words.length) { frag.append(label); return frag; }
  const pattern = new RegExp(`(^|[^a-z0-9])(${words.map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'gi');
  let last = 0;
  let m;
  while ((m = pattern.exec(label))) {
    const start = m.index + m[1].length;
    const end = start + m[2].length;
    if (start > last) frag.append(label.slice(last, start));
    const mark = document.createElement('mark');
    mark.textContent = label.slice(start, end);
    frag.append(mark);
    last = end;
    if (m[0].length === 0) pattern.lastIndex++;
  }
  if (last < label.length) frag.append(label.slice(last));
  return frag;
}

function renderSuggestions() {
  const input = $('#q');
  const list = $('#suggestions');
  const raw = input.value;
  if (!app.index || normalize(raw).length < 2) { sugItems = []; closeSuggestions(); return; }
  sugItems = suggest(app.index, raw, 7);
  if (!sugItems.length) { closeSuggestions(); return; }
  list.innerHTML = '';
  sugItems.forEach((s, k) => {
    const li = document.createElement('li');
    li.id = `sug-${k}`;
    li.className = 'sug';
    li.setAttribute('role', 'option');
    li.setAttribute('aria-selected', 'false');
    li.dataset.k = String(k);
    const cat = s.category && CATEGORY_BY_ID[s.category];
    const iconWrap = document.createElement('span');
    iconWrap.className = `sug-icon${cat ? ` cat-${cat.id}` : ''}`;
    iconWrap.innerHTML = icon(s.type === 'area' ? 'map-pin' : s.type === 'intent' ? (cat ? cat.icon : 'search') : (cat ? cat.icon : 'store'));
    const text = document.createElement('span');
    text.className = 'sug-text';
    const label = document.createElement('span');
    label.className = 'sug-label';
    label.append(highlight(s.label, raw));
    text.append(label);
    const sub = document.createElement('span');
    sub.className = 'sug-sub';
    if (s.type === 'intent') sub.textContent = `See all ${s.count === 1 ? '1 place' : `${num(s.count)} places`}`;
    else if (s.type === 'area') sub.textContent = `Neighborhood · ${s.count === 1 ? '1 place' : `${num(s.count)} places`}`;
    else {
      const b = app.docById.get(s.id)?.b;
      const area = b && app.areaById[b.area];
      sub.textContent = [s.sub, b && b.address, area && area.id !== 'elsewhere' ? area.name : ''].filter(Boolean).slice(0, 2).join(' · ');
    }
    text.append(sub);
    li.append(iconWrap, text);
    list.append(li);
  });
  list.hidden = false;
  $('#hero').classList.add('sug-open');
  input.setAttribute('aria-expanded', 'true');
  sugActive = -1;
  input.removeAttribute('aria-activedescendant');
}

function chooseSuggestion(s) {
  closeSuggestions();
  if (!s) return;
  if (s.type === 'business') {
    $('#q').value = s.label;
    $('#q').blur();
    // The list first, then the listing over it, so closing the listing leaves the list.
    navigate({ q: s.label }, { focus: false });
    navigate({ q: s.label, id: s.id }, { focus: false, scroll: false });
  } else if (s.type === 'area') {
    $('#q').value = '';
    $('#q').blur();
    navigate({ area: s.id });
  } else {
    submitSearch(s.value);
  }
}

function initSearchBox() {
  const form = $('#search-form');
  const input = $('#q');
  const list = $('#suggestions');
  let raf = 0;

  form.addEventListener('submit', e => {
    e.preventDefault();
    if (sugActive >= 0 && !list.hidden) { chooseSuggestion(sugItems[sugActive]); return; }
    submitSearch(input.value);
  });
  input.addEventListener('input', () => {
    updateClearButton();
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(renderSuggestions);
  });
  input.addEventListener('keydown', e => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (list.hidden) { renderSuggestions(); if (list.hidden) return; }
      setActiveSuggestion((sugActive + 1) % sugItems.length);
    } else if (e.key === 'ArrowUp') {
      if (list.hidden) return;
      e.preventDefault();
      setActiveSuggestion(sugActive <= 0 ? sugItems.length - 1 : sugActive - 1);
    } else if (e.key === 'Escape') {
      if (!list.hidden) { e.preventDefault(); closeSuggestions(); }
      else if (input.value) { e.preventDefault(); input.value = ''; updateClearButton(); }
    } else if (e.key === 'Enter' && sugActive >= 0 && !list.hidden) {
      e.preventDefault();
      chooseSuggestion(sugItems[sugActive]);
    }
  });
  input.addEventListener('blur', () => setTimeout(() => { if (document.activeElement !== input) closeSuggestions(); }, 120));
  input.addEventListener('focus', () => { if (input.value && app.index) renderSuggestions(); });
  list.addEventListener('mousedown', e => e.preventDefault()); // keep focus in the box
  list.addEventListener('click', e => {
    const li = e.target.closest('[role="option"]');
    if (li) chooseSuggestion(sugItems[+li.dataset.k]);
  });
  $('#q-clear').addEventListener('click', () => {
    input.value = '';
    updateClearButton();
    closeSuggestions();
    input.focus();
  });
  // "/" jumps to the search box, as on many sites.
  document.addEventListener('keydown', e => {
    if (e.key !== '/' || e.metaKey || e.ctrlKey || e.altKey) return;
    const t = e.target;
    if (t.closest && t.closest('input, textarea, select, [contenteditable="true"], dialog[open]')) return;
    e.preventDefault();
    input.focus();
    input.select();
  });
}

function initVoice() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) return;
  const mic = $('#mic');
  const input = $('#q');
  const placeholder = input.placeholder;
  let rec = null;
  mic.hidden = false;
  mic.addEventListener('click', () => {
    if (rec) { rec.stop(); return; }
    if (!navigator.onLine) { toast('Voice search needs the internet. You can type instead.'); return; }
    let finalText = '';
    try {
      rec = new SR();
    } catch {
      toast('Sorry, voice search isn’t available in this browser.');
      return;
    }
    rec.lang = 'en-US';
    rec.interimResults = true;
    rec.maxAlternatives = 1;
    rec.onresult = e => {
      let text = '';
      for (const r of e.results) text += r[0].transcript;
      input.value = text;
      updateClearButton();
      if (e.results[e.results.length - 1].isFinal) finalText = text;
    };
    rec.onerror = e => {
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
        toast('Your browser is blocking the microphone for this site. You can type instead, or allow the microphone in your browser’s settings (tap the lock or microphone icon next to the web address), then tap Speak again.');
      } else if (e.error === 'no-speech') {
        toast('We didn’t hear anything. Tap Speak and try again.');
      } else if (e.error !== 'aborted') {
        toast('Voice search stopped. You can type instead.');
      }
    };
    rec.onend = () => {
      rec = null;
      delete mic.dataset.listening;
      mic.setAttribute('aria-label', 'Speak your search');
      mic.querySelector('.mic-label').textContent = 'Speak';
      input.placeholder = placeholder;
      if (finalText.trim()) submitSearch(finalText);
    };
    mic.dataset.listening = '';
    mic.setAttribute('aria-label', 'Stop listening');
    mic.querySelector('.mic-label').textContent = 'Listening';
    input.placeholder = 'Listening… say what you need';
    try { rec.start(); } catch { rec = null; delete mic.dataset.listening; }
  });
}

// ============================================================================ toolbar, menus, dialogs

function initToolbar() {
  const quiet = { replace: true, focus: false, scroll: false };
  $('#f-open').addEventListener('click', () => navigate(keepResults({ ...app.state, open: app.state.open ? undefined : '1' }), quiet));
  $('#f-area').addEventListener('change', e => navigate(keepResults({ ...app.state, area: e.target.value || undefined }), quiet));
  $('#f-sort').addEventListener('change', e => navigate({ ...app.state, sort: e.target.value }, quiet));
  $('#v-list').addEventListener('click', () => navigate({ ...app.state, view: undefined }, quiet));
  $('#v-map').addEventListener('click', () => navigate({ ...app.state, view: 'map' }, quiet));
  $('#more').addEventListener('click', () => showMore(true));
  $('#back-home').addEventListener('click', () => {
    navigate({});
    $('#q').focus({ preventScroll: true });
  });
}

function initTextSize() {
  const btn = $('#textsize-btn');
  const menu = $('#textsize-menu');
  const labels = { standard: 'Standard', large: 'Larger', xlarge: 'Largest' };
  const mark = size => $$('button[data-size]', menu).forEach(b => b.setAttribute('aria-pressed', String(b.dataset.size === size)));
  const close = () => { menu.hidden = true; btn.setAttribute('aria-expanded', 'false'); };
  mark(document.documentElement.dataset.textsize || 'standard');
  btn.addEventListener('click', () => {
    const open = menu.hidden;
    menu.hidden = !open;
    btn.setAttribute('aria-expanded', String(open));
    if (open) (menu.querySelector('[aria-pressed="true"]') || menu.querySelector('button')).focus();
  });
  menu.addEventListener('click', e => {
    const b = e.target.closest('button[data-size]');
    if (!b) return;
    const size = b.dataset.size;
    document.documentElement.dataset.textsize = size;
    try { localStorage.setItem('wl-textsize', size); } catch { /* private mode: fine */ }
    mark(size);
    close();
    btn.focus();
    toast(`Text size: ${labels[size] || size}`);
  });
  document.addEventListener('click', e => { if (!menu.hidden && !e.target.closest('.menu-wrap')) close(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && !menu.hidden) { close(); btn.focus(); } });
}

function initDialogs() {
  const detail = $('#detail');
  detail.addEventListener('close', () => {
    // Closed by the visitor (Close, Esc, or a tap outside): update the address too.
    const id = readState().id;
    if (!id) return;
    if (history.state && history.state.detail) history.back();
    else navigate({ ...app.state, id: undefined }, { replace: true, focus: false, scroll: false });
    if (!app.res) return;
    document.title = `${$('#results-title').textContent.replace(/[“”]/g, '"')} · ${SITE}`;
    // Nothing to go back to (opened from a suggestion, or its card was redrawn): continue from the place's card.
    const now = document.activeElement;
    if (now && now !== document.body) return;
    const card = $$('#cards .card-name a').find(a => a.dataset.id === id);
    if (card) card.focus();
    else $('#results-title').focus({ preventScroll: true });
  });
  for (const dlg of $$('dialog.sheet')) {
    dlg.addEventListener('click', e => { if (e.target === dlg) dlg.close(); });
  }
  initSuggestForm();
}

// ---------------------------------------------------------------------------- add / fix form

function contactChannel() {
  if (CONFIG.contactEmail) return { type: 'email', email: CONFIG.contactEmail };
  const gh = CONFIG.github || detectGitHub();
  if (gh && gh.owner && gh.repo) return { type: 'github', ...gh };
  return { type: 'copy' };
}

function detectGitHub() {
  const m = location.hostname.match(/^([a-z0-9-]+)\.github\.io$/i);
  if (!m) return null;
  const first = location.pathname.split('/').filter(Boolean)[0];
  const repo = first && !/\.html?$/i.test(first) ? first : `${m[1]}.github.io`;
  return { owner: m[1], repo };
}

/** What happens when the visitor presses the form's button, in plain words. */
function sendHow(ch) {
  if (ch.type === 'email') return `When you press <strong>Send</strong>, your email app opens with your message to <strong>${esc(ch.email)}</strong> filled in, ready to send.`;
  if (ch.type === 'github') {
    return 'When you press <strong>Send</strong>, a page opens on GitHub (the free website where this directory is kept) with your message filled in. Sending it from there needs a free GitHub account, and anyone can read what you send.';
  }
  return 'This site can’t receive messages yet. When you press <strong>Copy my message</strong>, we’ll copy what you wrote, so you can paste it into a note or an email to keep.';
}

/** How to paste, in plain words, on this kind of device. */
const pasteHow = () => (device.mobile
  ? 'press and hold where you’d like it to go and tap Paste'
  : 'click where you’d like it to go and press Ctrl and V together (on a Mac, ⌘ and V)');

function setSuggestKind(kind) {
  const fix = kind === 'fix';
  const el = $('#suggest-form').elements;
  $('#s-title').textContent = fix ? 'Report a problem' : 'Add a business';
  // A new listing needs a name. A problem may be about the website rather than one business, but needs describing.
  $('#s-name-label').textContent = fix ? 'Which business is it about? Leave this blank if it’s about the website.' : 'Business name (required)';
  $('#s-notes-label').textContent = fix ? 'What needs fixing? (required)' : 'Anything else we should know?';
  el.namedItem('name').required = !fix;
  el.namedItem('notes').required = fix;
  const ch = contactChannel();
  const lead = !fix ? `Listing a ${TOWN} business is free.` : ch.type === 'copy' ? 'Found something wrong?' : 'Tell us what’s wrong and we’ll fix it.';
  $('#s-lede').innerHTML = `${lead} ${sendHow(ch)}`;
  // With nowhere to send it, the button says what it really does.
  $('#s-send').innerHTML = ch.type === 'copy' ? `${icon('copy')}Copy my message` : `${icon('mail')}Send`;
  $('#s-status').innerHTML = '';
}

function openSuggest(kind = 'add', name = '') {
  const dlg = $('#suggest');
  const form = $('#suggest-form');
  form.reset();
  const el = form.elements;
  for (const r of form.querySelectorAll('input[name="kind"]')) r.checked = r.value === kind;
  if (name) el.namedItem('name').value = name;
  setSuggestKind(kind);
  if (!dlg.open) dlg.showModal();
  (name ? el.namedItem('notes') : el.namedItem('name')).focus();
}

function initSuggestForm() {
  const form = $('#suggest-form');
  form.addEventListener('change', e => { if (e.target.name === 'kind') setSuggestKind(e.target.value); });
  form.addEventListener('submit', e => {
    e.preventDefault();
    const el = form.elements;
    const get = n => String(el.namedItem(n)?.value || '').trim();
    const kind = form.querySelector('input[name="kind"]:checked')?.value === 'fix' ? 'fix' : 'add';
    const d = { name: get('name'), address: get('address'), phone: get('phone'), website: get('website'), notes: get('notes') };
    const status = $('#s-status');
    const missing = kind === 'add' ? !d.name && 'name' : !d.notes && 'notes';
    if (missing) {
      status.textContent = missing === 'name' ? 'Please type the name of the business.' : 'Please tell us what needs fixing.';
      el.namedItem(missing).focus();
      return;
    }
    const subject = kind === 'add' ? `Add a business: ${d.name}` : d.name ? `Fix a listing: ${d.name}` : 'A problem with the website';
    const body = [
      kind === 'add' ? `Please add this business to ${SITE}.` : d.name ? 'Something on this listing needs fixing.' : 'Something on the website needs fixing.',
      '',
      d.name && `Business name: ${d.name}`,
      d.address && `Address: ${d.address}`,
      d.phone && `Phone: ${d.phone}`,
      d.website && `Website: ${d.website}`,
      d.notes && `\n${kind === 'fix' ? 'What needs fixing' : 'Notes'}:\n${d.notes}`,
      '',
      `(Sent from the ${SITE} website)`,
    ].filter(x => x !== '' && x !== undefined && x !== null && x !== false).join('\n');
    app.lastMessage = `${subject}\n\n${body}`;
    const ch = contactChannel();
    const copyBtn = '<button type="button" class="linklike" data-copy-message>copy your message</button>';
    if (ch.type === 'email') {
      location.href = `mailto:${encodeURIComponent(ch.email).replace(/%40/g, '@')}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
      status.innerHTML = `Your email app should open now with your message. If it doesn’t, email <a href="mailto:${esc(ch.email)}">${esc(ch.email)}</a> and ${copyBtn} to paste in.`;
    } else if (ch.type === 'github' && !navigator.onLine) {
      copyText(app.lastMessage, 'Message copied.').then(ok => {
        status.innerHTML = `You’re offline right now${ok ? ', so we copied your message to keep it safe' : ''}. When you’re back online, press <strong>Send</strong> again.`;
      });
    } else if (ch.type === 'github') {
      const tpl = kind === 'fix' ? 'report-problem.yml' : 'add-business.yml';
      // The GitHub form insists on a business name, so say when a report is about the website itself.
      const p = new URLSearchParams({ template: tpl, title: subject, business_name: d.name || 'The website', address: d.address, phone: d.phone, website: d.website, details: d.notes });
      window.open(`https://github.com/${encodeURIComponent(ch.owner)}/${encodeURIComponent(ch.repo)}/issues/new?${p}`, '_blank', 'noopener');
      status.innerHTML = `We opened GitHub in a new tab with your message filled in. To send it, sign in or make a free GitHub account, then press <strong>Create</strong>. If your message isn’t there after you sign in, ${copyBtn} and paste it in.`;
    } else {
      copyText(app.lastMessage, 'Message copied.').then(ok => {
        status.textContent = ok
          ? `We copied your message. To keep it, open a note or an email, then ${pasteHow()}.`
          : 'Sorry, we couldn’t copy your message, and this site can’t receive messages yet. What you wrote is still in the form above.';
      });
    }
  });
  form.addEventListener('click', e => {
    if (e.target.closest('[data-copy-message]')) copyText(app.lastMessage, 'Message copied.');
  });
}

// ---------------------------------------------------------------------------- small helpers

// An open dialog covers the rest of the page and hides it from screen readers, so messages go inside it.
const topDialog = () => $$('dialog[open]').pop() || null;
const toastTime = msg => Math.min(12000, Math.max(3600, msg.length * 60)); // longer messages stay up longer

let toastTimer = 0;
function toast(msg) {
  const t = $('#toast');
  const host = topDialog() || document.body;
  if (t.parentNode !== host) {
    host.append(t);
    void t.offsetWidth; // let it slide in from its new place
  }
  t.textContent = msg;
  t.dataset.show = '';
  announce(msg);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { delete t.dataset.show; }, toastTime(msg));
}

function announce(msg) {
  // Cleared first, so the same message twice is read twice. Where it goes is decided when it's written, because
  // a dialog may close in between (a link inside a listing), and a closed dialog's region is never read.
  for (const live of [$('#live'), ...$$('[data-live]')]) live.textContent = '';
  setTimeout(() => { (topDialog()?.querySelector('[data-live]') || $('#live')).textContent = msg; }, 60);
}

/** Copy text, say whether it worked, and resolve to true or false. */
async function copyText(text, okMsg) {
  let ok = false;
  try {
    await navigator.clipboard.writeText(text);
    ok = true;
  } catch {
    ok = copyWithSelection(text);
  }
  toast(ok ? okMsg : 'Sorry, copying didn’t work in this browser.');
  return ok;
}

function copyWithSelection(text) {
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.setAttribute('readonly', '');
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  const back = document.activeElement;
  (topDialog() || document.body).append(ta);
  ta.select();
  let ok = false;
  try { ok = document.execCommand('copy'); } catch { ok = false; }
  ta.remove();
  if (back && back !== document.activeElement && back.focus) back.focus({ preventScroll: true });
  return ok;
}

// Delegated clicks: in-page links, listing links, buttons that open the form, share, close.
function initClicks() {
  document.addEventListener('click', e => {
    const more = e.target.closest('.rchip-more');
    if (!more) return;
    const nav = more.closest('.refine');
    delete nav.dataset.collapsed;
    more.setAttribute('aria-expanded', 'true');
    more.hidden = true;
    nav.querySelector('.rchip-extra')?.focus();
  });
  document.addEventListener('click', e => {
    const t = e.target;
    if (!(t instanceof Element)) return;
    const plain = e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey;

    // Offline, other websites can't open. Directions still can: they open the phone's map app.
    const ext = t.closest('a[href^="http"]');
    if (ext && !navigator.onLine && !ext.hasAttribute('data-maps') && ext.origin !== location.origin) {
      e.preventDefault();
      toast('That page needs the internet. Please try again when you’re connected.');
      return;
    }
    const inst = t.closest('[data-open-install]');
    if (inst) { openInstall(); return; }
    const toList = t.closest('[data-view-list]');
    if (toList) { navigate({ ...app.state, view: undefined }, { replace: true, focus: false, scroll: false }); return; }

    if (t.closest('[data-reload]')) { location.reload(); return; }

    const nav = t.closest('a[data-nav]');
    if (nav && plain) {
      e.preventDefault();
      const next = Object.fromEntries(new URLSearchParams(nav.dataset.nav));
      if (app.index) navigate(next);
      else whenLoaded(() => navigate(next));
      return;
    }
    const home = t.closest('a[data-home]');
    if (home && plain) {
      e.preventDefault();
      navigate({});
      return;
    }
    const listing = t.closest('a[data-id]');
    if (listing && plain) {
      e.preventDefault();
      navigate({ ...app.state, id: listing.dataset.id }, { focus: false, scroll: false });
      return;
    }
    const widen = t.closest('[data-widen]');
    if (widen) {
      navigate(keepResults({ ...app.state, [widen.dataset.widen]: undefined }), { replace: true, focus: true, scroll: false });
      return;
    }
    const sug = t.closest('[data-open-suggest]');
    if (sug) {
      openSuggest(sug.dataset.openSuggest === 'fix' ? 'fix' : 'add', sug.dataset.name || '');
      return;
    }
    const share = t.closest('[data-share]');
    if (share) { shareListing(share.dataset.share); return; }
    const close = t.closest('[data-close]');
    if (close) close.closest('dialog')?.close();
  });
}

// ============================================================================ offline and home screen

const key = (name, label = '') => `<span class="key">${name ? icon(name) : ''}${label ? `<span>${esc(label)}</span>` : ''}</span>`;
const word = label => `<span class="key">${esc(label)}</span>`;

// Steps checked against Apple, Google and Microsoft help pages and tester reports (November 2026). Safari's
// Share button moved twice: behind "•••" in iOS 26, behind the three-line page menu in iOS 27. A page can't tell
// which Safari layout someone uses, so each step says what to do if the button isn't there.
const OPEN_ONCE = where => `Go to your home screen and tap the new “${SHORT}” icon once while you still have internet. Wait until it says “Saved on this ${where}”. After that it works with no signal.`;
const WEB_APP = `If you see a switch called ${word('Open as Web App')}, make sure it’s green. Then tap the blue ${word('Add')} button at the top right.<small>A keyboard may pop up. You can ignore it. Don’t tap the X, because that cancels.</small>`;
const SHARE_SHEET = `Tap ${word('View More')} if you see it, or slide the panel up with your finger. Then tap ${key('square-plus', 'Add to Home Screen')}.`;
const NEEDS_IOS_16 = '<small>This needs iOS 16.4 or later. If you can’t find Add to Home Screen, use Safari instead.</small>';

const INSTALL_STEPS = {
  'ios-safari-27': {
    title: 'iPhone, in Safari (iOS 27)',
    steps: [
      `If you see the Share button ${key('share')} at the bottom of the screen, tap it. If not, tap the button with three short lines ${key('menu')} at the left of the web address, then tap ${word('Share')}.<small>The Share button is a square with an arrow pointing up.</small>`,
      SHARE_SHEET, WEB_APP, OPEN_ONCE('phone'),
    ],
  },
  'ios-safari-26': {
    title: 'iPhone, in Safari (iOS 26)',
    steps: [
      `If the bar at the bottom of the screen has shrunk to a thin strip, tap it so the buttons come back.`,
      `If you see the Share button ${key('share')}, tap it. If not, tap the round button ${key('ellipsis')} at the bottom right, then tap ${word('Share')}.<small>The Share button is a square with an arrow pointing up.</small>`,
      SHARE_SHEET, WEB_APP, OPEN_ONCE('phone'),
    ],
  },
  'ipad-safari': {
    title: 'iPad, in Safari',
    steps: [
      `Tap the Share button ${key('share')} near the top right of the screen.`,
      SHARE_SHEET, WEB_APP, OPEN_ONCE('iPad'),
    ],
  },
  'ios-safari-old': {
    title: 'Older iPhone or iPad (iOS 18 or earlier), in Safari',
    steps: [
      `Tap the Share button ${key('share')}. On an iPhone it’s in the middle of the bar at the bottom of the screen. On an iPad it’s at the top right.`,
      `Slide the panel up and tap ${key('square-plus', 'Add to Home Screen')}.`,
      `Tap ${word('Add')} at the top right.`,
      OPEN_ONCE('phone'),
    ],
  },
  'ios-chrome': {
    title: 'iPhone or iPad, in Chrome',
    steps: [
      `Tap the Share button ${key('share')} at the right end of the web address bar. If you don’t see it, tap ${key('ellipsis')} at the bottom right, then ${word('Share')}.`,
      `${SHARE_SHEET}${NEEDS_IOS_16}`, WEB_APP, OPEN_ONCE('phone'),
    ],
  },
  'ios-edge': {
    title: 'iPhone or iPad, in Edge',
    steps: [
      `Tap the menu button ${key('menu')} in the bar at the bottom of the screen, then tap ${word('Share')}.`,
      `${SHARE_SHEET}${NEEDS_IOS_16}`, WEB_APP, OPEN_ONCE('phone'),
    ],
  },
  'ios-firefox': {
    title: 'iPhone or iPad, in Firefox',
    steps: [
      `Tap the Share button ${key('share')} at the left end of the web address bar. If you don’t see it, tap the menu button ${key('menu')}, then ${word('Share')}.`,
      `${SHARE_SHEET}${NEEDS_IOS_16}`, WEB_APP, OPEN_ONCE('phone'),
    ],
  },
  'android-chrome': {
    title: 'Android phone, in Chrome',
    steps: [
      `Tap the three dots ${key('ellipsis-vertical')} at the top right of the screen. If they aren’t there, look at the bottom right.`,
      `Tap ${word('Install app')}. On some phones it says ${word('Install and create shortcut')} or ${word('Add to Home screen')}.`,
      `If you’re given a choice, choose ${word('Install')}, not “Create shortcut”. Then tap ${word('Install')} to confirm.`,
      `The “${SHORT}” icon appears on your home screen or in your list of apps. Tap it to open the directory, even with no signal.`,
    ],
  },
  'android-samsung': {
    title: 'Samsung phone, in Samsung Internet',
    steps: [
      `If you see a small install button in the web address bar at the top, tap it, then tap ${word('Install')}. That’s all.`,
      `If not, tap the menu button ${key('menu')} at the bottom right, then ${word('Add page to')}, then ${word('Home screen')}.`,
      `Tap ${word('Add')}. The “${SHORT}” icon appears on your home screen.`,
    ],
  },
  'android-firefox': {
    title: 'Android phone, in Firefox',
    steps: [
      `Tap the three dots ${key('ellipsis-vertical')} next to the web address.`,
      `Tap ${word('Add app to Home screen')}. If you don’t see it, tap ${word('More')} first.`,
      `Tap ${word('Add automatically')} or ${word('Add')}. The “${SHORT}” icon appears on your home screen.`,
    ],
  },
  'android-edge': {
    title: 'Android phone, in Edge',
    steps: [
      `Tap the menu button (${key('ellipsis')} or ${key('menu')}) in the bar at the bottom of the screen.`,
      `Tap ${word('Add to phone')}. Some versions say ${word('Install app')} or ${word('Add to home screen')}.`,
      `Tap ${word('Install')} or ${word('Add')}. The “${SHORT}” icon appears on your home screen.`,
    ],
  },
  'desktop-chrome': {
    title: 'Computer, in Chrome',
    steps: [
      `Click the install button ${key('download')} at the right end of the address bar, then click ${word('Install')}.`,
      `No install button? Click the three dots ${key('ellipsis-vertical')} at the top right, point to ${word('Cast, save, and share')}, then click ${word('Install page as app…')}.`,
      `${SITE} opens in its own window. Later, open it like any other program.`,
    ],
  },
  'desktop-edge': {
    title: 'Computer, in Edge',
    steps: [
      `Click the ${word('App available')} button at the right of the address bar, then click ${word('Install')}.`,
      `No button? Click ${key('ellipsis')} at the top right, then ${word('More tools')}, then ${word('Apps')}, then ${word('Install this site as an app')}.`,
      `${SITE} opens in its own window. Later, open it like any other program.`,
    ],
  },
  'mac-safari': {
    title: 'Mac, in Safari',
    steps: [
      `Open the ${word('File')} menu at the top of the screen and choose ${word('Add to Dock')}.`,
      `Click ${word('Add')}. ${SITE} appears in your Dock and opens in its own window.`,
    ],
  },
  'desktop-firefox': {
    title: 'Computer, in Firefox',
    steps: [
      `Firefox on a computer can’t save websites as apps, so bookmark this page instead: press ${word('Ctrl')} and ${word('D')} together (on a Mac, ${word('⌘')} and ${word('D')}).`,
      `After your first visit, ${SITE} keeps working in Firefox even without internet.`,
    ],
  },
};

function installKey() {
  if (device.ios) {
    if (device.browser !== 'safari') return `ios-${device.browser}`;
    if (device.version && device.version <= 18) return 'ios-safari-old';
    if (device.ipad) return 'ipad-safari';
    return device.version === 26 ? 'ios-safari-26' : 'ios-safari-27';
  }
  if (device.android) return { samsung: 'android-samsung', firefox: 'android-firefox', edge: 'android-edge' }[device.browser] || 'android-chrome';
  return { edge: 'desktop-edge', firefox: 'desktop-firefox', safari: 'mac-safari' }[device.browser] || 'desktop-chrome';
}

const thisDevice = () => (device.ipad ? 'iPad' : device.mobile ? 'phone' : 'computer');
const stepsHtml = k => `<ol class="install-steps">${INSTALL_STEPS[k].steps.map(s => `<li><span>${s}</span></li>`).join('')}</ol>`;

function openInstall() {
  const st = app.offline || {};
  // Chrome, Edge and Samsung Internet can install straight away with their own prompt.
  if (st.canPrompt && !st.installed && !device.inApp) {
    promptInstall().then(outcome => {
      if (outcome === 'accepted') toast(`Done! Look for the “${SHORT}” icon on your home screen.`);
      else if (outcome === 'unavailable') openInstall();
    });
    return;
  }
  keepSavedCopy();
  const mine = installKey();
  const site = CONFIG.siteUrl || `${location.origin}${location.pathname}`;
  let intro = '';
  if (st.installed) intro = `<p class="install-ok">${icon('circle-check')}<span>You’re already using the saved app. It works without internet.</span></p>`;
  else if (device.inApp) intro = `<p class="install-note">You’re looking at this inside another app, like Facebook or Instagram, and those can’t save websites. Tap ${key('ellipsis')} or ${key('ellipsis-vertical')} in a corner of the screen and choose ${word('Open in browser')} (it may say “Open in Safari” or “Open in Chrome”). Then tap “Save to my phone” again.</p>`;
  else if (!device.mobile) intro = `<p class="install-note">To put it on your phone, open this address on your phone, then tap <strong>Save to my phone</strong> there:<br><strong>${esc(site.replace(/^https?:\/\//, ''))}</strong></p><p class="install-note">To keep it on this computer:</p>`;
  const others = Object.keys(INSTALL_STEPS).filter(k => k !== mine)
    .map(k => `<details class="install-device"><summary>${esc(INSTALL_STEPS[k].title)}</summary>${stepsHtml(k)}</details>`).join('');
  const steps = st.installed ? '' : `<section aria-labelledby="install-mine"><h3 id="install-mine" class="visually-hidden">${esc(INSTALL_STEPS[mine].title)}</h3>${stepsHtml(mine)}</section>
<p class="install-note">Always open ${esc(SITE)} from its icon. Searching, opening hours and phone numbers work even with no signal. Open it with internet now and then to get the latest listings.</p>`;
  $('#install-body').innerHTML = `${intro}${steps}
<details class="install-other"><summary>Using a different phone or computer?</summary>${others}</details>`;
  const dlg = $('#install');
  if (!dlg.open) dlg.showModal();
}

function initOfflineUI() {
  onOfflineChange(st => {
    const wasOffline = app.offline && !app.offline.online;
    const wasReady = app.offline?.ready;
    app.offline = st;
    $('#offline-bar').hidden = st.online;
    const count = app.data?.businesses?.length || 0;
    const status = $('#offline-status');
    const where = thisDevice();
    if (st.installed && st.ready) status.innerHTML = `${icon('circle-check')}<span>Saved on this ${where}. It works without internet.</span>`;
    else if (st.installed && st.online && st.supported) status.textContent = `Saving a copy on this ${where} so it works without internet…`;
    else if (st.ready) status.innerHTML = `${icon('circle-check')}<span>All ${num(count)} listings are saved in this browser for when you’re offline.</span>`;
    else status.textContent = '';
    $('#install-btn').hidden = st.installed;
    // The first time the saved app finishes saving its copy, say so. On iPhone the app keeps its own copy,
    // separate from Safari's, so this is the moment it starts working offline.
    if (st.installed && st.ready && wasReady === false) {
      let shown = false;
      try { shown = localStorage.getItem('willits-saved-note') === '1'; localStorage.setItem('willits-saved-note', '1'); } catch { /* private mode */ }
      if (!shown) toast(`Saved on this ${where}. ${SITE} now works without internet.`);
    }
    // Back online on the map view: load the map now.
    if (st.online && wasOffline && app.state?.view === 'map' && $('#map .map-offline')) render(readState());
  });
}

// ============================================================================ start

async function start() {
  initOffline();
  injectCategoryStyles();
  initSky($('#hero'), {
    onTick: ({ now }) => {
      $('#hello-text').textContent = greeting(now);
      $('#hello-time').textContent = `${fmtClock(now)} in ${TOWN}`;
      $('#hello-sun').textContent = sunNote(now);
    },
  });
  initClicks();
  initTextSize();
  initSearchBox();
  initVoice();
  initToolbar();
  initDialogs();

  let data;
  try {
    data = await loadListings();
  } catch (err) {
    console.error('Could not load the directory', err);
    app.failed = true;
    app.pending = null;
    $('#offline-bar').hidden = navigator.onLine;
    showLoadProblem();
    return;
  }

  $('#boot-fallback').hidden = true; // the "Having trouble?" note may have appeared while a slow connection caught up
  app.data = data;
  app.areas = data.areas || [];
  app.areaById = Object.fromEntries(app.areas.map(a => [a.id, a]));
  app.index = buildIndex(data.businesses, { areas: app.areas });
  for (const d of app.index.docs) app.docById.set(d.b.id, d);

  renderHome();
  initOfflineUI();
  initReveal();
  window.addEventListener('popstate', () => render(addressState()));
  render(addressState());
  initHoursRefresh();

  const pending = app.pending;
  app.pending = null;
  if (pending) pending();
  else if (document.activeElement === $('#q') && $('#q').value) renderSuggestions();
  document.documentElement.classList.add('is-ready');
}

/** Fetch the listings. A stalled connection gets 20 seconds, then one more try. */
async function loadListings() {
  for (let attempt = 1; ; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 20000);
    try {
      const res = await fetch('data/businesses.json', { signal: ctrl.signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (err) {
      if (attempt >= 2) throw err;
    } finally {
      clearTimeout(timer);
    }
  }
}

start();
