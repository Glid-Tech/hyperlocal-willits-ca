// Review fixes for the living hero (sky.js) and the map (map.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as nodeModule from 'node:module'; // registerHooks needs Node 22.15+; on older Node the map tests skip
import {
  luminance, contrast, backdropAt, sceneY, placeText, heroTone, HERO_TEXT, BACKING, HALO,
  paletteFor, sunTimes, sunNote, greeting, fmtClock, initSky, CSS_VARS, PAINT, PAINT_VARS,
} from '../assets/js/sky.js';

// ----------------------------------------------------------------------------- hero text tone

const flat = c => ({ skyTop: c, skyMid: c, skyBot: c, hillFar: c });
const text = sel => HERO_TEXT.find(t => t.sel === sel);
// Where the hero's text sits, in SVG units, measured in Chrome on the home page (notes/measure.html, iframes of each
// size): a 1440×800 view, a 1920×1040 one, a 375×667 phone and a 320×640 one. No cloud is drawn behind any of it
// (see the cloud test below).
const DESKTOP = { '.hero-title': [89, 239], '.hero-title em': [156, 247], '.hero-lede': [253, 325], '.search-label': [355, 388] };
const WIDE = { '.hero-title': [87, 249], '.hero-title em': [159, 257], '.hero-lede': [262, 333], '.search-label': [362, 395] };
const PHONE = { '.hero-title': [67, 127], '.hero-title em': [94, 130], '.hero-lede': [137, 213], '.search-label': [236, 279] };
const SMALL_PHONE = { '.hero-title': [79, 163], '.hero-title em': [132, 166], '.hero-lede': [173, 244], '.search-label': [265, 306] };
const bandsFor = (layout, cloud) => HERO_TEXT.map(t => ({
  ...t, top: layout[t.sel][0], bottom: layout[t.sel][1], clouds: cloud && t.sel === '.hero-title' ? [cloud] : [],
}));
const HOME = bandsFor(DESKTOP);
// A line of text drawn straight on the scene, with nothing behind it, to test how the scene is sampled.
const bare = (top, bottom, need = 4.5) => [{ ink: text('.search-label').ink, need, top, bottom }];

test('contrast is measured with real WCAG relative luminance', () => {
  assert.equal(luminance('#ffffff'), 1);
  assert.equal(luminance('#000000'), 0);
  assert.equal(contrast('#000000', '#ffffff'), 21);
  assert.equal(contrast('#ffffff', '#777777').toFixed(2), '4.48'); // the textbook example
  assert.equal(contrast('#777777', '#ffffff'), contrast('#ffffff', '#777777'));
});

test('a mid-grey sky gets dark text, which the old brightness formula got wrong', () => {
  // The old rule called #8c8c8c dark (brightness .549 < .55) and chose white text: 3.4:1.
  // Dark text reads at 5:1 there.
  assert.equal(heroTone(flat('#8c8c8c'), HOME), 'light');
  assert.ok(contrast('#10201a', '#8c8c8c') > 4.5 && contrast('#ffffff', '#8c8c8c') < 3.5);
});

test('night skies get light text and daytime skies get dark text', () => {
  assert.equal(heroTone(paletteFor(-20, false), HOME), 'dark');
  assert.equal(heroTone(paletteFor(45, true), HOME), 'light');
  assert.equal(heroTone(paletteFor(-20, false), HOME, 'light'), 'dark', 'a clear change still happens');
});

test('the tone follows the part of the scene right behind the text', () => {
  const golden = paletteFor(7, false); // deep blue overhead, peach in the middle of the sky
  assert.equal(heroTone(golden, bare(20, 80)), 'dark');
  assert.equal(heroTone(golden, bare(385, 411)), 'light');
  // On wide results pages the search label sits over the hills (from about y 498), not the sky.
  const hillsDark = { skyTop: '#f6e7c8', skyMid: '#f6e7c8', skyBot: '#f6e7c8', hillFar: '#1f3328' };
  assert.equal(backdropAt(hillsDark, 520), '#1f3328');
  assert.equal(heroTone(hillsDark, bare(511, 541)), 'dark');
  assert.equal(heroTone(hillsDark, bare(385, 411)), 'light');
});

test('a near tie keeps the current tone, so a one-pixel shift cannot make it flicker', () => {
  const grey = flat('#7d7d7d'); // white text 4.12:1, dark text 4.10:1: both short of 4.5:1
  assert.equal(heroTone(grey, bare(385, 411)), 'dark');
  assert.equal(heroTone(grey, bare(385, 411), 'light'), 'light');
  assert.equal(heroTone(grey, bare(385, 411), 'dark'), 'dark');
});

test('a tone that falls short gives way to one that doesn’t, however close the two are', () => {
  // Against a 4.11:1 target on this grey, white text just passes and dark text just falls short.
  const grey = flat('#7d7d7d');
  assert.ok(contrast('#ffffff', '#7d7d7d') >= 4.11 && contrast('#10201a', '#7d7d7d') < 4.11);
  assert.equal(heroTone(grey, bare(385, 411, 4.11), 'light'), 'dark');
  assert.equal(heroTone(grey, bare(385, 411, 4.11), 'dark'), 'dark');
});

test('the intro and the search label are judged on their frosted backing, so they no longer outvote the headline', () => {
  // Navy overhead, peach lower down: the headline needs white letters. On the bare sky the label would
  // want dark ones, and used to win; on its backing white letters read well too (the ?sky=dawn complaint).
  const sky = { skyTop: '#1f2a59', skyMid: '#f0b080', skyBot: '#f4c8a0', hillFar: '#334433' };
  const headline = { ...text('.hero-title'), top: 40, bottom: 140 };
  const label = { ...text('.search-label'), top: 385, bottom: 411 };
  assert.equal(heroTone(sky, [headline, label]), 'dark');
  assert.equal(heroTone(sky, [headline, { ...label, under: undefined }]), 'light', 'judged on the bare sky');
  assert.deepEqual(label.under, BACKING);
});

test('a cloud behind the headline counts', () => {
  // White letters would vanish on a bright cloud, even on a navy sky.
  const sky = { ...flat('#1f2a59'), cloud: '#ffffff', cloudOp: 0.9 };
  const headline = { ...text('.hero-title'), top: 60, bottom: 140 };
  assert.equal(heroTone(sky, [headline]), 'dark');
  assert.equal(heroTone(sky, [{ ...headline, clouds: [[80, 120]] }]), 'light');
});

test('the clouds behind each line are found from where they are on screen', () => {
  const box = { top: 0, bottom: 756, left: 0, right: 1440, width: 1440, height: 756 }; // scale 1.05
  const r = (left, top, right, bottom) => ({ left, top, right, bottom, width: right - left, height: bottom - top });
  const rects = { '.hero-title': r(345, 105, 1095, 286), '.hero-lede': r(300, 301, 1140, 368), '.search-label': r(0, 0, 0, 0) };
  const clouds = [
    r(932, 150, 1166, 232), // behind the end of the headline ("need")
    r(1200, 100, 1400, 200), // beside it
    r(0, 0, 0, 0), // hidden, as on results pages
  ];
  const bands = placeText(box, rects, clouds);
  assert.deepEqual(bands.map(b => b.sel), ['.hero-title', '.hero-lede'], 'text that isn’t on screen is left out');
  const [title, lede] = bands;
  assert.ok(Math.abs(title.top - 100) < 1e-9);
  assert.deepEqual(title.clouds.map(c => c.map(v => Math.round(v))), [[143, 221]], 'only the rows the cloud covers');
  assert.deepEqual(lede.clouds, []);
});

test('every line of the hero is readable at every height of the sun, on phones and desktops (a11y 6)', () => {
  // Each line, in the tone heroTone picks (whichever tone it starts from), against what is behind it:
  // the sky, any cloud, and the halo or backing app.css adds. Headline and “Willits” 3:1, intro and label 4.5:1.
  const layouts = [['desktop', bandsFor(DESKTOP)], ['wide desktop', bandsFor(WIDE)], ['phone', bandsFor(PHONE)], ['small phone', bandsFor(SMALL_PHONE)]];
  const mix = (a, b, t) => '#' + [1, 3, 5].map(i => {
    const x = parseInt(a.slice(i, i + 2), 16), y = parseInt(b.slice(i, i + 2), 16);
    return Math.round(x + (y - x) * t).toString(16).padStart(2, '0');
  }).join('');
  for (const [name, bands] of layouts) {
    for (const morning of [true, false]) {
      for (let elev = -16; elev <= 60; elev += 0.25) {
        const pal = paletteFor(elev, morning);
        for (const start of ['light', 'dark']) {
          const tone = heroTone(pal, bands, start);
          for (const { sel, ink, under, need, top, bottom, clouds } of bands) {
            for (const [a, b, cloud] of [[top, bottom, false], ...clouds.map(([ct, cb]) => [ct, cb, true])]) {
              for (let i = 0; i <= 8; i++) {
                let bg = backdropAt(pal, a + ((b - a) * i) / 8);
                if (cloud) bg = mix(bg, pal.cloud, pal.cloudOp);
                bg = mix(bg, under[tone][0], under[tone][1]);
                const c = contrast(ink[tone], bg);
                assert.ok(c >= need, `${name}, ${morning ? 'morning' : 'evening'}, sun at ${elev}°: ${sel} in ${tone} tone ${c.toFixed(2)}:1`);
              }
            }
          }
        }
      }
    }
  }
});

test('no cloud is drawn behind the hero’s text, at any screen size', () => {
  // Every line of hero text, at 320 to 1920px wide and all three text sizes, sits inside this part of the
  // scene (measured in Chrome: x 457-1143, y 66-395). A cloud behind the gold town name left no tone readable at dusk.
  const TEXT = { left: 440, right: 1155, top: 60, bottom: 419 };
  const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const clouds = [...html.matchAll(/<g class="cloud (c\d)">(.*?)<\/g>/g)];
  assert.equal(clouds.length, 4);
  for (const [, name, inner] of clouds) {
    const e = [...inner.matchAll(/cx="([\d.]+)" cy="([\d.]+)" rx="([\d.]+)" ry="([\d.]+)"/g)].map(m => m.slice(1).map(Number));
    const box = { left: Math.min(...e.map(([cx, , rx]) => cx - rx)), right: Math.max(...e.map(([cx, , rx]) => cx + rx)),
      top: Math.min(...e.map(([, cy, , ry]) => cy - ry)), bottom: Math.max(...e.map(([, cy, , ry]) => cy + ry)) };
    const overlaps = box.left < TEXT.right && box.right > TEXT.left && box.top < TEXT.bottom && box.bottom > TEXT.top;
    assert.ok(!overlaps, `cloud ${name} (x ${box.left.toFixed(0)}-${box.right.toFixed(0)}, y ${box.top.toFixed(0)}-${box.bottom.toFixed(0)}) is behind the text`);
  }
});

test('screen positions map onto the scene the way the SVG draws it (cover, pinned to the bottom)', () => {
  const desktopHome = { top: 0, bottom: 756, width: 1440, height: 756 }; // scaled by height: 1.05
  assert.equal(sceneY(desktopHome, 756), 720);
  assert.ok(Math.abs(sceneY(desktopHome, 0)) < 1e-9);
  assert.ok(Math.abs(sceneY(desktopHome, 105) - 100) < 1e-9);
  const desktopResults = { top: 100, bottom: 317, width: 1440, height: 217 }; // scaled by width: 0.9
  assert.equal(sceneY(desktopResults, 317), 720);
  assert.ok(sceneY(desktopResults, 130) > 505, 'the label is down on the hills');
});

test('the colours, backings and halo sky.js weighs are the ones app.css uses', () => {
  const css = fs.readFileSync(new URL('../assets/css/app.css', import.meta.url), 'utf8');
  const find = re => {
    const m = css.match(re);
    assert.ok(m, `app.css: ${re}`);
    return m.slice(1).map(v => v.toLowerCase());
  };
  const [ink, ink2] = find(/\.hero\s*\{[^}]*?--hero-ink:\s*(#[0-9a-f]{6})\s*;[^}]*?--hero-ink-2:\s*(#[0-9a-f]{6})/i);
  const [dark, dark2] = find(/\.hero\[data-sky-tone="dark"\]\s*\{[^}]*?--hero-ink:\s*(#[0-9a-f]{6})\s*;[^}]*?--hero-ink-2:\s*(#[0-9a-f]{6})/i);
  const [em] = find(/\n\.hero-title em\s*\{[^}]*?color:\s*(#[0-9a-f]{6})/i);
  const [emVar] = find(/\.hero\[data-sky-tone="dark"\] \.hero-title em\s*\{\s*color:\s*var\((--[\w-]+)\)/);
  const [emDark] = find(new RegExp(`:root\\s*\\{[^}]*?${emVar}:\\s*(#[0-9a-f]{6})`, 'i'));
  assert.deepEqual(HERO_TEXT.map(t => t.ink), [{ light: ink, dark }, { light: em, dark: emDark }, { light: ink2, dark: dark2 }, { light: ink, dark }],
    'update HERO_TEXT in sky.js to match --hero-ink, --hero-ink-2 and the “Willits” colours in app.css');

  // An rgba() colour as ['#rrggbb', alpha].
  const rgba = s => {
    const [r, g, b, a] = s.match(/rgba\((\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\)/).slice(1).map(Number);
    return ['#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join(''), a];
  };
  const [backLight] = find(/\n\.hero-lede, \.search-label\s*\{[^}]*?background:\s*(rgba\([^)]*\))/);
  const [backDark] = find(/\.hero\[data-sky-tone="dark"\] :is\(\.hero-lede, \.search-label\)\s*\{\s*background:\s*(rgba\([^)]*\))/);
  assert.deepEqual(BACKING, { light: rgba(backLight), dark: rgba(backDark) }, 'update BACKING in sky.js to match app.css');
  assert.equal(text('.hero-lede').under, BACKING);
  assert.equal(text('.search-label').under, BACKING);

  // The halo: sky.js assumes it moves the sky next to the letters about a fifth of the way to its colour,
  // which the .15em layer at .6 or more (with the wide glow) was measured to do.
  const halo = shadow => {
    const [tight, wide] = shadow.split(/,\s*(?=0 )/);
    const m = tight.match(/^0 0 ([\d.]+)em (rgba\([^)]*\))$/);
    assert.ok(m && +m[1] <= 0.15 && rgba(m[2])[1] >= 0.6, `a tight halo first: ${tight}`);
    assert.match(wide ?? '', /^0 2px 30px rgba/, 'then a wide glow');
    assert.equal(rgba(wide.match(/rgba\([^)]*\)/)[0])[0], rgba(m[2])[0], 'both in the same colour');
    return rgba(m[2])[0];
  };
  const [shadowLight] = find(/\n\.hero-title\s*\{[^}]*?text-shadow:\s*([^;]+);/);
  const [shadowDark] = find(/\.hero\[data-sky-tone="dark"\] \.hero-title\s*\{\s*text-shadow:\s*([^;]+);/);
  assert.deepEqual([halo(shadowLight), halo(shadowDark)], [HALO.light[0], HALO.dark[0]], 'update HALO in sky.js to match app.css');
  assert.ok(HALO.light[1] <= 0.2 && HALO.dark[1] <= 0.2, 'sky.js doesn’t count on more halo than app.css gives');
  assert.equal(text('.hero-title').under, HALO);
  assert.equal(text('.hero-title em').under, HALO);
});

// A stand-in hero: the SVG fills a 1440 x 756 hero, so a screen y is about 1.05 x its SVG height.
const stubbed = new WeakSet();
function fakeHero(t, search, layout, clouds = []) {
  if (!stubbed.has(t)) {
    stubbed.add(t);
    t.mock.timers.enable({ apis: ['setInterval'] }); // initSky repaints every minute
    t.after(() => { delete globalThis.location; delete globalThis.window; delete globalThis.ResizeObserver; });
  }
  let resized = () => {};
  globalThis.location = { search };
  globalThis.window = { matchMedia: () => ({ matches: false }), addEventListener() {}, scrollY: 0 };
  globalThis.ResizeObserver = class { constructor(cb) { resized = cb; } observe() {} };
  const vars = {};
  const rect = ([top, bottom] = [0, 0]) => ({ top, bottom, left: 300, right: 1140, height: bottom - top, width: 840 });
  const svg = {
    getBoundingClientRect: () => ({ top: 0, bottom: 756, left: 0, right: 1440, width: 1440, height: 756 }),
    querySelector: () => null,
    querySelectorAll: sel => (sel === '.cloud' ? clouds : []),
  };
  const hero = {
    dataset: {}, offsetHeight: 756,
    style: { setProperty: (k, v) => { vars[k] = v; } },
    querySelector: sel => (sel === '.scene-svg' ? svg : { getBoundingClientRect: () => rect(layout[sel]) }),
  };
  initSky(hero);
  return { hero, vars, resize: () => resized() };
}
const HOME_PX = { '.hero-title': [93, 251], '.hero-title em': [164, 259], '.hero-lede': [266, 341], '.search-label': [373, 407] }; // DESKTOP × 1.05

test('the ?sky=, ?season= and ?holiday= previews still work', t => {
  const night = fakeHero(t, '?sky=night', HOME_PX);
  assert.equal(night.hero.dataset.phase, 'night');
  assert.equal(night.hero.dataset.skyTone, 'dark');
  const day = fakeHero(t, '?sky=day&season=winter&holiday=1', HOME_PX);
  assert.equal(day.hero.dataset.phase, 'day');
  assert.equal(day.hero.dataset.skyTone, 'light');
  assert.equal(day.vars['--grass'], '#6e9a4e', 'the valley greens up in the rainy winter');
  assert.equal(day.vars['--season-accent'], '1.00', 'snow dusts the ridge in winter');
  assert.equal(day.vars['--fall'], '0.00');
  const fall = fakeHero(t, '?sky=day&season=fall', HOME_PX);
  assert.equal(fall.vars['--fall'], '1.00', 'the creekside trees turn yellow in fall');
  assert.equal(fall.vars['--season-accent'], '0.00');
  assert.equal(fakeHero(t, '?sky=day&season=summer', HOME_PX).vars['--grass'], '#c8a55a', 'gold grass in the dry summer');
  assert.equal(day.vars['--holiday'], '1');
  assert.equal(fakeHero(t, '?sky=day&holiday=0', HOME_PX).vars['--holiday'], '0');
});

test('the ?skyHour= preview still works', t => {
  const noon = fakeHero(t, '?skyHour=12', HOME_PX);
  assert.equal(noon.hero.dataset.phase, 'day');
  assert.equal(noon.hero.dataset.skyTone, 'light');
  assert.equal(fakeHero(t, '?skyHour=1', HOME_PX).hero.dataset.skyTone, 'dark');
});

test('the tone is checked again when the text moves, as after a resize or a change of text size', t => {
  const layout = { ...HOME_PX };
  const dawn = fakeHero(t, '?sky=dawn', layout);
  assert.equal(dawn.hero.dataset.skyTone, 'light'); // gold “Willits” would be hard to read on the mauve middle of the sky
  for (const sel of Object.keys(layout)) layout[sel] = layout[sel].map(y => y - 100); // the text moves up into the deep blue
  dawn.resize();
  assert.equal(dawn.hero.dataset.skyTone, 'dark');
});

test('initSky measures the clouds as well as the text, and copes with hidden ones', t => {
  let measured = 0;
  const cloud = box => ({ getBoundingClientRect: () => { measured++; return box; } });
  const hidden = { top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0 }; // results pages hide the clouds
  const night = fakeHero(t, '?sky=night', HOME_PX, [cloud({ top: 150, bottom: 232, left: 932, right: 1166, width: 234, height: 82 }), cloud(hidden)]);
  assert.equal(measured, 2);
  assert.equal(night.hero.dataset.skyTone, 'dark');
});

test('the scene looks right before sky.js runs: app.css starts with the daytime palette and paints', () => {
  const css = fs.readFileSync(new URL('../assets/css/app.css', import.meta.url), 'utf8');
  const root = css.match(/:root\s*\{([\s\S]*?)\n\}/)[1];
  const value = v => root.match(new RegExp(`${v}:\\s*([^;]+);`))?.[1].trim().toLowerCase();
  const day = paletteFor(45, true);
  for (const [k, v] of Object.entries(CSS_VARS)) {
    const want = typeof day[k] === 'number' ? day[k] : day[k].toLowerCase();
    assert.equal(typeof want === 'number' ? +value(v) : value(v), want, `${v} in app.css :root should be ${want} (P.day.${k})`);
  }
  for (const [k, v] of Object.entries(PAINT_VARS)) assert.equal(value(v), PAINT[k], `${v} in app.css :root should be ${PAINT[k]} (PAINT.${k})`);
  for (const v of ['--fog-op', '--season-accent', '--flowers', '--fall', '--holiday']) assert.ok(value(v) !== undefined, `${v} has a default`);
});

test('every colour and class the hero uses is defined, and nothing coastal is left over', () => {
  const css = fs.readFileSync(new URL('../assets/css/app.css', import.meta.url), 'utf8');
  const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const hero = html.match(/<!-- HERO:START -->([\s\S]*?)<!-- HERO:END -->/)[1];
  const classes = new Set([...hero.matchAll(/class="([^"]+)"/g)].flatMap(m => m[1].split(/\s+/)));
  const generic = new Set(['scene-svg', 'layer', 'cloud', 'c1', 'c2', 'c3', 'c4', 'twinkle', 'train', 'arch', 'house-windows', 'depot-windows', 'train-windows', 'houses-light',
    'layer-far', 'layer-hills', 'layer-town', 'layer-mid', 'layer-near', 'layer-front']);
  for (const c of classes) {
    if (generic.has(c)) continue;
    assert.match(css, new RegExp(`\\.${c}\\b[^{]*\\{`), `app.css has no rule for .${c}`);
  }
  for (const v of new Set([...css.matchAll(/var\((--p-[\w-]+)\)/g)].map(m => m[1]))) {
    assert.ok(Object.values(PAINT_VARS).includes(v), `${v} is used in app.css but sky.js PAINT doesn't set it`);
  }
  for (const gone of ['whale', 'lighthouse', 'beacon', 'sea-glass', 'boat', 'beach', 'bluff', 'surf', 'sea-shine']) {
    assert.ok(!classes.has(gone) && !new RegExp(`\\.${gone}\\b`).test(css), `.${gone} is left over from the coast`);
  }
  assert.doesNotMatch(css, /--whale\b/);
});

// ----------------------------------------------------------------------------- sunrise and sunset

const LOCAL_MIDNIGHT = Date.parse('2026-11-22T08:00:00Z'); // November 22, Pacific Standard Time

test('working out sunrise and sunset builds no date formatters (it used to build 1,500 a minute)', () => {
  const Real = Intl.DateTimeFormat;
  let made = 0;
  Intl.DateTimeFormat = new Proxy(Real, {
    construct: (T, args) => { made++; return new T(...args); },
    apply: (T, self, args) => { made++; return T(...args); },
  });
  try {
    for (let m = 0; m < 1440; m += 60) sunNote(new Date(LOCAL_MIDNIGHT + m * 60000));
    sunTimes(new Date('2026-06-21T16:00:00Z'));
    greeting(new Date(LOCAL_MIDNIGHT));
    fmtClock(new Date(LOCAL_MIDNIGHT));
  } finally {
    Intl.DateTimeFormat = Real;
  }
  assert.equal(made, 0);
});

test('sunrise and sunset come out the same at any moment of the day', () => {
  const seen = new Set();
  for (let m = 0; m < 1440; m += 37) {
    sunTimes(new Date('2026-06-21T16:00:00Z')); // a different day, so nothing is reused
    const { rise, set } = sunTimes(new Date(LOCAL_MIDNIGHT + m * 60000));
    seen.add(`${rise.getTime()} ${set.getTime()}`);
  }
  assert.equal(seen.size, 1);
  const { rise, set } = sunTimes(new Date(LOCAL_MIDNIGHT + 12 * 3600000));
  const minutes = d => (d - LOCAL_MIDNIGHT) / 60000;
  // Willits, November 22, over a flat horizon (as published; the ridge hides the sun a few minutes earlier).
  assert.ok(minutes(rise) >= 423 && minutes(rise) <= 433, `sunrise ${fmtClock(rise)}`); // about 7:06 AM
  assert.ok(minutes(set) >= 1011 && minutes(set) <= 1021, `sunset ${fmtClock(set)}`); // about 4:54 PM
  assert.match(sunNote(new Date(LOCAL_MIDNIGHT + (16 * 60 + 15) * 60000)), /^Sunset 4:5\d\sPM$/);
  assert.equal(sunNote(new Date(LOCAL_MIDNIGHT + 21 * 3600000)), '');
});

// ----------------------------------------------------------------------------- map

// Serve a stand-in for the bundled MapLibre, so the map can be tested without a browser. Node before 22.15
// can't, so the tests that load MapLibre are skipped there rather than stopping the whole file loading.
nodeModule.registerHooks?.({
  load(url, context, nextLoad) {
    if (url.endsWith('/assets/vendor/maplibre/maplibre-gl.mjs')) {
      return { format: 'module', shortCircuit: true, source: 'export const { Map, NavigationControl, LngLatBounds, Popup } = globalThis.fakeMapLibre;' };
    }
    return nextLoad(url, context);
  },
});
const LOADS_MAPLIBRE = { skip: !nodeModule.registerHooks && 'needs Node 22.15 or newer (module.registerHooks)' };

// Like #map inside .map-wrap, with the note under it: setting innerHTML takes the old elements off the page.
function fakeContainer() {
  const note = { hidden: false };
  const wrap = { querySelector: sel => (sel === '.map-note' ? note : null) };
  const c = { children: [], html: '', note, closest: sel => (sel === '.map-wrap' ? wrap : null) };
  Object.defineProperty(c, 'innerHTML', {
    get: () => c.html,
    set: html => { c.html = html; for (const el of c.children) el.parentNode = null; c.children = []; },
  });
  c.append = (...els) => { for (const el of els) { el.parentNode = c; c.children.push(el); } };
  c.replaceChildren = (...els) => { c.innerHTML = ''; c.append(...els); };
  return c;
}

const fake = { maps: [], attempts: 0, start: () => {} };
class FakeMap {
  constructor(opts) {
    fake.attempts++;
    this.opts = opts;
    this.listeners = {};
    this.removed = false;
    this.touchZoomRotate = { disableRotation() {} };
    this.keyboard = { disableRotation() {} };
    fake.start(this); // may throw, as MapLibre does without WebGL2
    this.canvasBox = { name: 'canvas container' };
    opts.container.append(this.canvasBox, { name: 'controls' });
    fake.maps.push(this);
  }
  getCanvasContainer() { return this.canvasBox; }
  on(type, layerOrFn, fn) {
    if (!fn) (this.listeners[type] ||= []).push(layerOrFn);
    return this;
  }
  once(type, fn) {
    const wrap = e => { this.off(type, wrap); fn(e); };
    return this.on(type, wrap);
  }
  off(type, fn) {
    this.listeners[type] = (this.listeners[type] || []).filter(f => f !== fn);
    return this;
  }
  fire(type, e = {}) { for (const fn of [...(this.listeners[type] || [])]) fn(e); }
  addControl() {}
  remove() {
    this.removed = true;
    this.opts.container.innerHTML = '';
  }
  resize() {}
  addSource() {}
  addLayer() {}
  getSource() { return { setData: data => { this.data = data; } }; }
  fitBounds() {}
  getCanvas() { return { style: {} }; }
}
globalThis.fakeMapLibre = {
  Map: FakeMap,
  NavigationControl: class {},
  LngLatBounds: class { extend() { return this; } },
  Popup: class {},
};

const PLACES = [
  { id: 'a', name: 'A', lat: 39.41, lon: -123.35, category: 'restaurants' },
  { id: 'b', name: 'B', lat: 39.42, lon: -123.36, category: 'health' },
  { id: 'c', name: 'C' }, // no location
];
const loads = m => queueMicrotask(() => { m.fire('style.load'); m.fire('load'); });

let fresh = 0;
async function freshMap(t, { webgl2 = true } = {}) {
  fake.maps = [];
  fake.attempts = 0;
  fake.start = () => {};
  const inserted = [];
  const site = { before: link => inserted.push(link) }; // app.css's <link>
  globalThis.document = {
    querySelector: sel => (sel === 'link[rel="stylesheet"]' ? site : null),
    createElement: () => ({ dataset: {} }),
    head: { append: () => assert.fail('the map stylesheet should go before app.css') },
  };
  globalThis.window = { matchMedia: () => ({ matches: false }) };
  if (webgl2) globalThis.WebGL2RenderingContext = class {};
  else delete globalThis.WebGL2RenderingContext;
  t.after(() => { delete globalThis.document; delete globalThis.window; delete globalThis.WebGL2RenderingContext; });
  const mod = await import(`../assets/js/map.js?case=${++fresh}`); // its own copy, starting afresh
  return { showMap: mod.showMap, inserted, container: fakeContainer() };
}

const TOO_OLD = 'This browser is too old to show the map.';
const NO_GRAPHICS = 'This device couldn’t start the map.';

function assertUnsupportedMessage(html, reason) {
  assert.match(html, /^<div class="map-offline"><svg class="icon" aria-hidden="true" focusable="false"><use href="#i-map"\/><\/svg>/);
  const heading = reason === TOO_OLD ? 'The map doesn’t work in this browser' : 'The map can’t be shown right now';
  assert.ok(html.includes(`<h3>${heading}</h3>`), html);
  assert.ok(html.includes(`<p>${reason} Every place is still in the list, with phone numbers and addresses.</p>`), html);
  assert.match(html, /<button type="button" class="btn btn-primary" data-view-list><svg class="icon" aria-hidden="true" focusable="false"><use href="#i-list"\/><\/svg>Show the list<\/button><\/div>$/);
}

test('without WebGL2 the map says so and offers the list, without downloading MapLibre', async t => {
  const { showMap, container } = await freshMap(t, { webgl2: false });
  await showMap(container, PLACES);
  assertUnsupportedMessage(container.innerHTML, TOO_OLD);
  assert.equal(fake.attempts, 0);
  assert.equal(container.note.hidden, true, 'no “Tap a dot” under a message, even without :has()');
});

test('when MapLibre cannot start WebGL2, the map says so once and stops trying', LOADS_MAPLIBRE, async t => {
  const { showMap, container } = await freshMap(t);
  fake.start = () => {
    const err = new Error('WebGL2 is required to display this map.');
    err.name = 'GPUInitializationError';
    throw err;
  };
  await showMap(container, PLACES);
  // The browser may be up to date: graphics turned off or blocked. So it isn’t called too old.
  assertUnsupportedMessage(container.innerHTML, NO_GRAPHICS);
  assert.equal(container.note.hidden, true);
  container.innerHTML = '';
  await showMap(container, PLACES);
  assertUnsupportedMessage(container.innerHTML, NO_GRAPHICS);
  assert.equal(fake.attempts, 1);
});

test('the note under the map comes back once a map is showing', LOADS_MAPLIBRE, async t => {
  const { showMap, container } = await freshMap(t);
  fake.start = loads;
  container.note.hidden = true;
  await showMap(container, PLACES);
  assert.equal(container.note.hidden, false);
});

test('a map whose style cannot load is removed at once, and a retry leaves just one map', LOADS_MAPLIBRE, async t => {
  const { showMap, container, inserted } = await freshMap(t);
  fake.start = m => queueMicrotask(() => m.fire('error', { error: new SyntaxError('Unexpected token <') }));
  await assert.rejects(showMap(container, PLACES), /Unexpected token/, 'a captive portal is a network problem, not an old browser');
  assert.equal(fake.maps.length, 1);
  assert.equal(fake.maps[0].removed, true);
  assert.match(inserted[0].href, /\/assets\/vendor\/maplibre\/maplibre-gl\.css$/);

  fake.start = loads;
  await showMap(container, PLACES);
  assert.equal(fake.maps.length, 2);
  assert.deepEqual(fake.maps.map(m => m.removed), [true, false]);
  assert.deepEqual(fake.maps[1].data.features.map(f => f.properties.id), ['a', 'b']);
});

test('errors after the style has arrived (a missing tile) do not stop the map', LOADS_MAPLIBRE, async t => {
  const { showMap, container } = await freshMap(t);
  fake.start = m => queueMicrotask(() => {
    m.fire('style.load');
    m.fire('error', { error: new Error('One tile failed') });
    m.fire('load');
  });
  await showMap(container, PLACES);
  assert.equal(fake.maps[0].removed, false);
  assert.deepEqual(fake.maps[0].listeners.error, [], 'MapLibre reports later errors itself again');
});

test('after the offline message, coming back online shows the same map again', LOADS_MAPLIBRE, async t => {
  const { showMap, container } = await freshMap(t);
  fake.start = loads;
  await showMap(container, PLACES);
  const [canvasBox, controls] = container.children;
  // app.js, offline: replaces the map with “The map needs the internet”.
  container.innerHTML = '<div class="map-offline"><h3>The map needs the internet</h3></div>';
  await showMap(container, PLACES); // back online
  assert.deepEqual(container.children, [canvasBox, controls]);
  assert.doesNotMatch(container.innerHTML, /map-offline/);
  assert.equal(fake.maps.length, 1, 'no second map');
});

test('a map that times out is removed before the next try', LOADS_MAPLIBRE, async t => {
  const { showMap, container } = await freshMap(t);
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const shown = showMap(container, PLACES);
  for (let i = 0; i < 100 && !fake.maps.length; i++) await new Promise(r => setImmediate(r));
  assert.equal(fake.maps.length, 1);
  t.mock.timers.tick(15000);
  await assert.rejects(shown, /timed out/);
  assert.equal(fake.maps[0].removed, true);

  fake.start = loads;
  await showMap(container, PLACES);
  assert.deepEqual(fake.maps.map(m => m.removed), [true, false]);
});
