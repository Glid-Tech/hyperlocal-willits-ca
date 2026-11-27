// Checks on assets/css/app.css from the accessibility and robustness review: contrast in both
// themes, focus rings, wrapping at large text, motion, and small-screen sheets. The stylesheet is
// read as text and the colours are checked with the WCAG formula, so no browser is involved.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { paletteFor, heroTone, HERO_TEXT } from '../assets/js/sky.js';

const css = fs.readFileSync(new URL('../assets/css/app.css', import.meta.url), 'utf8');

// ------------------------------------------------------------------ a tiny CSS reader

/** Splits on `sep` outside quotes and brackets. */
function splitTop(s, sep) {
  const out = []; let cur = '', q = null, depth = 0;
  for (const c of s) {
    if (q) { if (c === q) q = null; } else if (c === '"' || c === "'") q = c;
    else if (c === '(') depth++; else if (c === ')') depth--;
    else if (c === sep && !depth) { out.push(cur); cur = ''; continue; }
    cur += c;
  }
  return [...out, cur].map(x => x.trim()).filter(Boolean);
}

/** Style rules in order, as { selectors, media: [enclosing @-rule preludes], decls: Map }. */
function parse(src) {
  src = src.replace(/\/\*[\s\S]*?\*\//g, '');
  const rules = [];
  let i = 0;
  const readUntil = stops => {
    let out = '', q = null, depth = 0;
    for (; i < src.length; i++) {
      const c = src[i];
      if (q) { if (c === q) q = null; } else if (c === '"' || c === "'") q = c;
      else if (c === '(') depth++; else if (c === ')') depth--;
      else if (!depth && stops.includes(c)) break;
      out += c;
    }
    return out;
  };
  const block = media => {
    while (i < src.length) {
      const prelude = readUntil('{}').trim().replace(/\s+/g, ' ');
      if (i >= src.length || src[i] === '}') { i++; return; }
      i++;
      if (prelude.startsWith('@')) { block([...media, prelude]); continue; }
      const body = readUntil('}'); i++;
      const decls = new Map();
      for (const d of splitTop(body, ';')) { const k = d.indexOf(':'); if (k > 0) decls.set(d.slice(0, k).trim(), d.slice(k + 1).trim()); }
      rules.push({ selectors: splitTop(prelude, ','), media, decls });
    }
  };
  block([]);
  return rules;
}

const RULES = parse(css);
const plain = m => m.length === 0;
const darkOnly = m => m.length === 1 && m[0] === '@media (prefers-color-scheme: dark)';
const phone = m => m.some(x => /max-width: 640px/.test(x));
const forced = m => m.some(x => /forced-colors: active/.test(x));
const rulesFor = (sel, media = plain) => RULES.filter(r => r.selectors.includes(sel) && media(r.media));
/** The winning value of `prop` for `sel` among rules in `media`, or undefined. */
const val = (sel, prop, media = plain) => rulesFor(sel, media).filter(r => r.decls.has(prop)).at(-1)?.decls.get(prop);
const tokens = media => Object.fromEntries(rulesFor(':root', media).flatMap(r => [...r.decls]).filter(([k]) => k.startsWith('--')));
const LIGHT = tokens(plain);
const DARK = { ...LIGHT, ...tokens(darkOnly) };
const SURFACES = ['--bg', '--bg-2', '--bg-3', '--surface', '--surface-2'];

// ------------------------------------------------------------------ colour maths (WCAG 2)

const rgb = h => { h = h.replace('#', ''); if (h.length === 3) h = [...h].map(c => c + c).join(''); return [0, 2, 4].map(k => parseInt(h.slice(k, k + 2), 16)); };
const lin = v => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
const lum = c => { const [r, g, b] = typeof c === 'string' ? rgb(c) : c; return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b); };
const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
const mix = (a, b, t) => { const x = typeof a === 'string' ? rgb(a) : a, y = typeof b === 'string' ? rgb(b) : b; return x.map((v, k) => v + (y[k] - v) * t); };
const over = ([r, g, b, a], under) => mix(under, [r, g, b], a);
const rgba = s => { const m = s.match(/rgba\(\s*(\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\s*\)/); assert.ok(m, `expected an rgba() colour in ${s}`); return m.slice(1).map(Number); };
/** Resolves var(--x) against a token set, or returns the hex as is. */
const colour = (v, t) => { const m = /var\((--[\w-]+)\)/.exec(v); return m ? colour(t[m[1]], t) : /#[0-9a-f]{3,6}\b/i.exec(v)[0]; };

/** Sky colour sky.js paints at fraction t down the hero (gradient stops at 0, .55 and 1). */
const skyAt = (p, t) => (t <= 0.55 ? mix(p.skyTop, p.skyMid, t / 0.55) : mix(p.skyMid, p.skyBot, (t - 0.55) / 0.45));
/** Every sky sky.js can paint, as palettes for each quarter degree of sun, morning and evening. */
const SKIES = [true, false].flatMap(morning => Array.from({ length: 305 }, (_, k) => ({ elev: -16 + k / 4, p: paletteFor(-16 + k / 4, morning) })));
/** The bare sky and the sky under a cloud, at each step down a band of the hero. */
const behind = (p, from, to) => Array.from({ length: 26 }, (_, k) => skyAt(p, from + (to - from) * k / 25))
  .flatMap(s => [s, mix(s, p.cloud, p.cloudOp)]);

// ------------------------------------------------------------------ the checks

test('the reader understands the stylesheet', () => {
  assert.ok(RULES.length > 300);
  for (const t of [LIGHT, DARK]) for (const k of ['--muted', '--surface', '--focus', '--primary']) assert.match(t[k], /^#[0-9a-f]{6}$/i, k);
  assert.notEqual(LIGHT['--surface'], DARK['--surface']);
});

test('"Increase contrast" in dark mode keeps grey text and borders light (a11y 1)', () => {
  const hc = RULES.filter(r => r.selectors.includes(':root') && r.media.length === 1 && /prefers-contrast: more/.test(r.media[0]));
  const general = hc.find(r => !/prefers-color-scheme/.test(r.media[0]));
  const dark = hc.filter(r => /prefers-color-scheme: dark/.test(r.media[0]));
  assert.ok(general && dark.length, 'separate high-contrast colours for dark mode');
  assert.ok(RULES.indexOf(dark.at(-1)) > RULES.indexOf(general), 'the dark-mode values come later, so they win');
  const lightHc = { ...LIGHT, ...Object.fromEntries(general.decls) };
  const darkHc = { ...DARK, ...Object.fromEntries(dark.flatMap(r => [...r.decls])) };
  for (const [name, t] of [['light', lightHc], ['dark', darkHc]]) {
    for (const s of SURFACES) {
      assert.ok(ratio(t['--muted'], t[s]) >= 7, `${name} --muted on ${s}: ${ratio(t['--muted'], t[s]).toFixed(2)}`);
      assert.ok(ratio(t['--line-strong'], t[s]) >= 3, `${name} --line-strong on ${s}`);
    }
  }
  for (const s of SURFACES) assert.ok(ratio(darkHc['--line'], darkHc[s]) >= 3, `dark --line on ${s}`);
});

test('focus rings show up on any sky, on the green band and in the footer (a11y 2)', () => {
  // Drawn inside the search box and the chips, so the sky behind them doesn't matter.
  assert.match(val('.search-box:focus-within', 'box-shadow'), /inset 0 0 0 3px var\(--focus\)/);
  for (const t of [LIGHT, DARK]) assert.ok(ratio(t['--focus'], t['--surface']) >= 3);
  assert.ok(val('.search-box', '--lift') && val('.search-box', '--lift', darkOnly), 'focus keeps the box’s shadow in both themes');
  assert.match(val('.hero .chip:focus-visible', 'box-shadow'), /inset 0 0 0 3px currentColor/);
  const ring = val('.add-band', '--focus');
  assert.equal(val('.footer', '--focus'), ring);
  const greens = val('.add-band', 'background').match(/#[0-9a-f]{6}/gi);
  for (const bg of [...greens, val('.footer', 'background')]) assert.ok(ratio(ring, bg) >= 3, `${ring} on ${bg}: ${ratio(ring, bg).toFixed(2)}`);
});

test('the highlighted suggestion and pressed buttons have a visible edge (a11y 3)', () => {
  assert.match(val('.sug[aria-selected="true"]', 'box-shadow'), /inset 0 0 0 3px var\(--focus\)/);
  assert.match(val('.seg button[aria-pressed="true"]', 'box-shadow'), /inset 0 0 0 2px var\(--primary\)/);
  assert.match(val('.menu button[aria-pressed="true"]', 'box-shadow'), /inset 0 0 0 2px var\(--primary\)/);
  for (const t of [LIGHT, DARK]) {
    for (const bg of ['--surface', '--bg-2']) assert.ok(ratio(t['--focus'], t[bg]) >= 3, `--focus on ${bg}`);
    for (const bg of ['--surface', '--primary-soft']) assert.ok(ratio(t['--primary'], t[bg]) >= 3, `--primary on ${bg}`);
  }
  for (const sel of ['.sug[aria-selected="true"]', '.seg button[aria-pressed="true"]', '.menu button[aria-pressed="true"]', '.rchip[aria-current="true"]']) {
    assert.equal(val(sel, 'background', forced), 'Highlight', `${sel} in Windows High Contrast`);
  }
});

test('the header and the results toolbar wrap instead of clipping at large text (a11y 5)', () => {
  assert.equal(val('.topbar-inner', 'flex-wrap'), 'wrap');
  assert.equal(val('.topnav', 'flex-wrap'), 'wrap');
  // On phones the List/Map switch must keep its full width and move to its own row when needed.
  assert.equal(val('.toolbar', 'grid-template-columns', phone), undefined, 'no fixed two-column grid');
  assert.equal(val('.toolbar > *', 'min-width', phone), undefined, 'items are not squeezed below their content');
  assert.equal(val('.seg', 'min-width', phone), undefined);
  assert.equal(val('.toolbar .select', 'min-width', phone), '0', 'the dropdowns can shrink and cut off long names');
});

test('the hero’s text stays readable whatever the sky (a11y 6)', () => {
  // The italic “Willits” on daytime skies, across the band where the headline sits on phones and desktops.
  const em = val('.hero-title em', 'color');
  for (const { elev, p } of SKIES.filter(s => s.elev >= 20)) {
    for (const bg of behind(p, 0.17, 0.42)) assert.ok(ratio(em, bg) >= 3, `“Willits” ${em} at ${elev}°: ${ratio(em, bg).toFixed(2)}`);
  }
  // The intro and the search instruction sit on a frosted backing in both sky tones.
  const back = { light: rgba(val('.hero-lede', 'background')), dark: rgba(val('.hero[data-sky-tone="dark"] :is(.hero-lede, .search-label)', 'background')) };
  assert.deepEqual(rgba(val('.search-label', 'background')), back.light);
  for (const ink of [val('.hero', '--hero-ink'), val('.hero', '--hero-ink-2')]) {
    assert.ok(ratio(ink, over(back.light, '#000000')) >= 4.5, `${ink} on the light backing even over black`);
  }
  // Each backing in the skies sky.js actually picks its tone for, on a desktop and on a phone, whichever tone it
  // starts from: 4.5:1 anywhere the intro and the instruction can sit, with or without a cloud behind.
  const inks = {
    light: [val('.hero', '--hero-ink'), val('.hero', '--hero-ink-2')],
    dark: [val('.hero[data-sky-tone="dark"]', '--hero-ink'), val('.hero[data-sky-tone="dark"]', '--hero-ink-2')],
  };
  const layouts = [ // SVG units (measured in Chrome, notes/measure.html), and a stretch of the headline with a cloud behind it
    { '.hero-title': [89, 239, [130, 160]], '.hero-title em': [156, 247], '.hero-lede': [253, 325], '.search-label': [355, 388] }, // 1440×800
    { '.hero-title': [79, 163, [79, 115]], '.hero-title em': [132, 166], '.hero-lede': [173, 244], '.search-label': [265, 306] }, // 320×640
  ].map(l => HERO_TEXT.map(t => ({ ...t, top: l[t.sel][0], bottom: l[t.sel][1], clouds: l[t.sel][2] ? [l[t.sel][2]] : [] })));
  for (const bands of layouts) {
    for (const { elev, p } of SKIES) {
      for (const start of ['light', 'dark']) {
        const tone = heroTone(p, bands, start);
        for (const ink of inks[tone]) {
          for (const bg of behind(p, 0.2, 0.66)) assert.ok(ratio(ink, over(back[tone], bg)) >= 4.5, `${ink} on the ${tone} backing at ${elev}°`);
        }
      }
    }
  }
});

test('the headline’s halo is in the opposite tone to its letters, so it adds contrast at sunrise and sunset (a11y 6)', () => {
  // The old glow used the sky's own colour, which lightened the sky behind white letters at dusk.
  for (const [rule, tone] of [['.hero-title', '.hero'], ['.hero[data-sky-tone="dark"] .hero-title', '.hero[data-sky-tone="dark"]']]) {
    const shadow = val(rule, 'text-shadow');
    assert.doesNotMatch(shadow, /--sky/, rule);
    const letters = [val(tone, '--hero-ink'), colour(val(tone === '.hero' ? '.hero-title em' : `${tone} .hero-title em`, 'color'), LIGHT)];
    for (const layer of shadow.split(/,\s*(?=0 )/)) {
      for (const ink of letters) assert.ok(ratio(rgba(layer), ink) >= 7, `${rule}: halo ${layer} against ${ink}`);
    }
  }
});

test('the “Having trouble?” note under the search box is a card you can read on any sky (app 5)', () => {
  assert.equal(val('.boot-fallback', 'background'), 'var(--surface)');
  assert.equal(val('.boot-fallback', 'display'), undefined, '[hidden] must still hide it');
  const colours = [val('.boot-fallback', 'color'), val('.boot-fallback .linklike', 'color'), val('a', 'color')]; // text, “Try again”, the link
  for (const [name, t] of [['light', LIGHT], ['dark', DARK]]) {
    for (const c of colours) assert.ok(ratio(colour(c, t), t['--surface']) >= 4.5, `${name}: ${c} on the card`);
  }
});

test('the form’s status line stays a live region while it’s empty (a11y 7)', () => {
  assert.notEqual(val('.form-status:empty', 'display'), 'none', 'text arriving in a display: none live region is often not read out');
  assert.equal(val('.form-status:empty', 'position'), 'absolute', 'and it adds no gap to the form while empty');
});

test('the toast lets taps through to the buttons under it', () => {
  assert.equal(val('.toast', 'pointer-events'), 'none');
});

test('map messages keep the site’s font inside a loaded map, and hide the “Tap a dot” note', () => {
  assert.equal(val('.map-offline', 'font'), '1rem/1.6 var(--font-body)', 'not MapLibre’s 12px Helvetica');
  assert.match(val('.map-offline h3', 'font-size') ?? '', /^[\d.]+rem$/, 'a size of its own, not 1.17 × 12px');
  assert.equal(val('.map-wrap:has(.map-offline) .map-note', 'display'), 'none');
});

test('the stars stop twinkling within 5 seconds of the page opening (a11y 12, WCAG 2.2.2)', () => {
  const [, secs, times = 1] = /^twinkle ([\d.]+)s [\w-]+(?: (\d+))?$/.exec(val('.scene .twinkle circle', 'animation'));
  const gen = fs.readFileSync(new URL('../tools/gen-hero.mjs', import.meta.url), 'utf8');
  const delay = /animation-delay:\$\{f\(r\(\) \* ([\d.]+)\)\}s/.exec(gen);
  assert.ok(delay, 'tools/gen-hero.mjs gives each star a random delay');
  assert.ok(+delay[1] + secs * times <= 5, `up to ${delay[1]}s of waiting, then ${secs * times}s of twinkling`);
  // And index.html was regenerated with it (node tools/gen-hero.mjs).
  const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const longest = Math.max(...[...html.matchAll(/animation-delay:([\d.]+)s/g)].map(m => +m[1]));
  assert.ok(longest + secs * times <= 5, `index.html has a star waiting ${longest}s`);
});

test('the install dialog lists other devices as tidy rows that open and close', () => {
  // Full-width rows, tall enough to tap, with the browser's own marker replaced by one chevron.
  assert.equal(val('.install-other summary', 'display'), 'flex');
  assert.equal(val('.install-other summary', 'justify-content'), 'space-between', 'the chevron sits at the far end of the row');
  assert.ok(parseFloat(val('.install-other summary', 'min-height')) >= 44);
  assert.equal(val('.install-other summary', 'list-style'), 'none');
  assert.equal(val('.install-other summary::-webkit-details-marker', 'display'), 'none', 'no second marker in older Safari');
  // The chevron is drawn in the row's own colour, and turns over when the row opens.
  assert.equal(val('.install-other summary::after', 'content'), "''");
  assert.match(val('.install-other summary::after', 'border'), /currentColor/);
  for (const open of ['.install-other[open] > summary::after', '.install-device[open] > summary::after']) {
    assert.notEqual(val(open, 'transform'), val('.install-other summary::after', 'transform'), open);
  }
  // Thin separators between devices, and the steps indented under an open one.
  assert.match(val('.install-device', 'border-bottom'), /^1px solid var\(--[\w-]+\)$/);
  assert.match(val('.install-device:first-of-type', 'border-top'), /^1px solid var\(--[\w-]+\)$/);
  assert.ok(parseFloat(val('.install-device > .install-steps', 'padding').split(' ')[3]) > 0, 'steps indented');
  // The rows' text and chevrons are readable on the dialog in both themes.
  for (const [name, t] of [['light', LIGHT], ['dark', DARK]]) {
    for (const sel of ['.install-device > summary', '.install-device[open] > summary', '.install-other > summary']) {
      const c = colour(val(sel, 'color'), t);
      assert.ok(ratio(c, t['--surface']) >= 4.5, `${name}: ${sel} ${ratio(c, t['--surface']).toFixed(2)}:1`);
    }
  }
});

test('form fields have edges you can see, in both themes (a11y 8)', () => {
  const border = val('.field input', 'border');
  assert.equal(val('.field textarea', 'border'), border);
  for (const t of [LIGHT, DARK]) {
    for (const bg of ['--surface', '--surface-2']) assert.ok(ratio(colour(border, t), t[bg]) >= 3, `field edge on ${bg}: ${border}`);
  }
  const chevron = s => '#' + /stroke='%23([0-9a-f]{6})'/i.exec(s)[1];
  assert.ok(ratio(chevron(val('.select select', 'background-image')), LIGHT['--surface']) >= 3);
  assert.ok(ratio(chevron(val('.select select', 'background-image', darkOnly)), DARK['--surface']) >= 3, 'dark-mode dropdown arrow');
});

test('map zoom buttons are big enough to tap and show the site’s focus ring (a11y 11)', () => {
  // MapLibre's own stylesheet loads later and makes them 29px with no outline, so ours must be more specific.
  for (const p of ['width', 'height']) {
    assert.equal(val('.map .maplibregl-ctrl-group button', p), '44px');
    assert.equal(val('.maplibregl-popup-close-button', p), '44px');
  }
  assert.match(val('.map .maplibregl-ctrl-group button:focus-visible', 'outline'), /3px solid var\(--focus\)/);
});

test('decorative animations stop by themselves, and reduced motion stops the rest (a11y 12, robustness 8)', () => {
  const infinite = RULES.filter(r => !r.media.some(m => m.startsWith('@keyframes')))
    .filter(r => [...r.decls].some(([k, v]) => k.startsWith('animation') && /\binfinite\b/.test(v)))
    .flatMap(r => r.selectors);
  assert.deepEqual(infinite, ['.search-mic[data-listening]'], 'only the microphone, while it is listening');
  for (const sel of ['.status-open .st-dot']) {
    const [, secs, times] = /\s([\d.]+)s\b.*\s(\d+)$/.exec(val(sel, 'animation'));
    assert.ok(secs * times <= 5, `${sel} moves for ${secs * times}s`);
  }
  assert.equal(val('.layer', 'will-change'), undefined);
  const reduce = m => m.some(x => /prefers-reduced-motion: reduce/.test(x));
  for (const [p, v] of [['animation-delay', '0s !important'], ['animation-iteration-count', '1 !important']]) {
    assert.equal(val('*', p, reduce), v);
  }
});

test('phone sheets fit the visible screen in iOS Safari (robustness 5)', () => {
  const h = val('dialog.sheet', 'max-height', phone);
  assert.doesNotMatch(h, /(^|[^sd])vh\b/, `plain vh is taller than the screen while Safari’s toolbars show: ${h}`);
});

test('long one-word names wrap inside cards, sheets and map popups (robustness 10)', () => {
  for (const sel of ['.card-name', '.sheet-name', '.pop-name']) assert.match(val(sel, 'overflow-wrap') ?? '', /anywhere|break-word/, sel);
});
