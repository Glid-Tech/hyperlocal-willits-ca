// The living hero: paints the Willits landscape (Little Lake Valley, looking south) for the real time of day.
// Sun position comes from a standard solar-position approximation for the town's coordinates (CONFIG.lat/lon);
// the palette blends between dawn, morning, day, golden hour, dusk and night.
// The valley follows its seasons too: green grass, morning fog and snow on the ridge in winter, wildflowers in
// spring, gold grass in summer, straw and yellow creekside trees in fall.
// Preview any time with ?sky=dawn|morning|day|golden|dusk|night or ?skyHour=19.5,
// any season with ?season=spring|summer|fall|winter, and the December lights with ?holiday=1

import { TIME_ZONE } from './hours.js';
import { CONFIG } from './config.js';

const LAT = CONFIG.lat, LON = CONFIG.lon; // downtown Willits (assets/js/config.js)
const RAD = Math.PI / 180;
// Date formatters are slow to build, so each one is made once and reused.
const DAY_FMT = new Intl.DateTimeFormat('en-CA', { timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' });
const HOUR_FMT = new Intl.DateTimeFormat('en-US', { timeZone: TIME_ZONE, hour: 'numeric', hourCycle: 'h23' });
const CLOCK_FMT = new Intl.DateTimeFormat('en-US', { timeZone: TIME_ZONE, hour: 'numeric', minute: '2-digit' });

const P = {
  night:   { skyTop: '#081229', skyMid: '#13234a', skyBot: '#283c66', sun: '#fff4d6', sunGlow: '#ffd9a0', cloud: '#2e3d63', far: '#1c2742', hillFar: '#141f30', seaTop: '#1d2d4e', seaBot: '#0b1424', bridge: '#2a3550', rock: '#121925', hillMid: '#0d1a15', house: '#0f1b15', hillNear: '#0a140f', canopy: '#050c08', grass: '#1a2418', stars: 1, windows: 1, cloudOp: 0.35 },
  dawn:    { skyTop: '#2c3f74', skyMid: '#b98aa6', skyBot: '#f4bd96', sun: '#ffd7a3', sunGlow: '#ffb27a', cloud: '#f2b8a8', far: '#69678a', hillFar: '#4c5a6c', seaTop: '#d9a4a4', seaBot: '#4c5676', bridge: '#5d586e', rock: '#3b3a4a', hillMid: '#28402f', house: '#2a3b31', hillNear: '#1d3125', canopy: '#11211a', grass: '#56613f', stars: 0.15, windows: 0.55, cloudOp: 0.75 },
  morning: { skyTop: '#5b9fdc', skyMid: '#a9d3f0', skyBot: '#f3e6cf', sun: '#fff3d1', sunGlow: '#ffe3a8', cloud: '#ffffff', far: '#9db0c2', hillFar: '#7d9c8c', seaTop: '#94c3df', seaBot: '#3d7499', bridge: '#9aa0a2', rock: '#6a6660', hillMid: '#4c7a58', house: '#c9b79c', hillNear: '#3a6544', canopy: '#21462f', grass: '#8fa35e', stars: 0, windows: 0, cloudOp: 0.85 },
  day:     { skyTop: '#3f8fd6', skyMid: '#8cc4ec', skyBot: '#dff0f9', sun: '#fffbe8', sunGlow: '#fff0bf', cloud: '#ffffff', far: '#98adc0', hillFar: '#7a9a8a', seaTop: '#86bde0', seaBot: '#2c6892', bridge: '#9ea3a3', rock: '#67625a', hillMid: '#46755a', house: '#d3c3a6', hillNear: '#335f42', canopy: '#1f432d', grass: '#9aae62', stars: 0, windows: 0, cloudOp: 0.9 },
  golden:  { skyTop: '#4f86c0', skyMid: '#f2c58f', skyBot: '#f8d9a8', sun: '#ffe2a6', sunGlow: '#ffbf6b', cloud: '#fff0d4', far: '#ae978a', hillFar: '#82866a', seaTop: '#f3c890', seaBot: '#556983', bridge: '#a08e7c', rock: '#6a5646', hillMid: '#56683f', house: '#d9b98c', hillNear: '#3f5530', canopy: '#273c20', grass: '#b4a25a', stars: 0, windows: 0.15, cloudOp: 0.8 },
  dusk:    { skyTop: '#1f2a59', skyMid: '#8a5a8c', skyBot: '#f0915f', sun: '#ffb98a', sunGlow: '#ff8f5a', cloud: '#ee9c86', far: '#463f63', hillFar: '#343b50', seaTop: '#e0906f', seaBot: '#3a3656', bridge: '#4a4258', rock: '#2a2532', hillMid: '#22352d', house: '#1f2f28', hillNear: '#18271f', canopy: '#0d1812', grass: '#383a2a', stars: 0.35, windows: 0.95, cloudOp: 0.6 },
};
// seaTop/seaBot colour water: the creek in front of the train (the #sea-g gradient in tools/gen-hero.mjs).
// bridge is the concrete of the US 101 bypass viaduct and the street; rock is the town's roofs.
// Keyframes by solar elevation (degrees), separately for morning and evening.
const MORNING = [[-14, 'night'], [-4, 'dawn'], [5, 'morning'], [20, 'day']];
const EVENING = [[-14, 'night'], [-7, ['dusk', 'night', 0.5]], [0.5, 'dusk'], [9, 'golden'], [20, 'day']];

export const CSS_VARS = {
  skyTop: '--sky-top', skyMid: '--sky-mid', skyBot: '--sky-bot', sun: '--sun', sunGlow: '--sun-glow', cloud: '--cloud',
  far: '--far', hillFar: '--hill-far', seaTop: '--sea-top', seaBot: '--sea-bot', bridge: '--bridge', rock: '--rock',
  hillMid: '--hill-mid', house: '--house', hillNear: '--hill-near', canopy: '--canopy', grass: '--grass',
  stars: '--stars', windows: '--windows', cloudOp: '--cloud-op',
};

// Things painted their own colours (the train, the depot, the arch, brick fronts, snow, fall leaves, people's coats)
// as they look in daylight; the train, depot and arch from CC-licensed Commons photos (notes/research/hero-colours.md).
// sky.js relights them by the same light that falls on the town, so the maroon train glows at golden hour and is a
// dark shape with lit windows at night.
// Each becomes a CSS variable: --p-maroon and so on (app.css).
export const PAINT = {
  maroon: '#7a2b36', coach: '#74293a', shade: '#561e28', roof: '#2e2f33', iron: '#1e1e22', hub: '#5b5b60',
  trim: '#e8b630', gold: '#d9b45a', cream: '#efe2b8', glass: '#2b3440', white: '#f1efe6',
  depot: '#6b4636', depotTrim: '#3f2b25', shingle: '#8b857b', sash: '#e4ddcb', brick: '#8c4a3c', timber: '#7a6a55', bark: '#7a3e2a',
  arch: '#2e5a4b', archPanel: '#24495a', archBanner: '#8e3c35', archLetter: '#efe8d6',
  snow: '#f3f6f9', leafFall: '#d8a93a', oakFall: '#a98447',
  skin1: '#d7a47c', skin2: '#8d5a3b', hair: '#3a2a20', coat1: '#2f6f8f', coat2: '#c9573a', coat3: '#e2c35a', coat4: '#4f7a4a',
};
export const PAINT_VARS = Object.fromEntries(Object.keys(PAINT).map(k => [k, '--p-' + k.replace(/[A-Z]/g, c => '-' + c.toLowerCase())]));

// ----------------------------------------------------------------------------- astronomy

export function sunPosition(date, lat = LAT, lon = LON) {
  const n = date.getTime() / 86400000 + 2440587.5 - 2451545.0;
  const L = (280.46 + 0.9856474 * n) % 360;
  const g = ((357.528 + 0.9856003 * n) % 360) * RAD;
  const lambda = (L + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * RAD;
  const eps = (23.439 - 0.0000004 * n) * RAD;
  const ra = Math.atan2(Math.cos(eps) * Math.sin(lambda), Math.cos(lambda)) / RAD;
  const dec = Math.asin(Math.sin(eps) * Math.sin(lambda));
  const gmst = (280.46061837 + 360.98564736629 * n) % 360;
  const ha = ((((gmst + lon - ra) % 360) + 540) % 360 - 180) * RAD;
  const la = lat * RAD;
  const elev = Math.asin(Math.sin(la) * Math.sin(dec) + Math.cos(la) * Math.cos(dec) * Math.cos(ha)) / RAD;
  const az = (Math.atan2(-Math.sin(ha), Math.tan(dec) * Math.cos(la) - Math.sin(la) * Math.cos(ha)) / RAD + 360) % 360;
  return { elev, az, morning: ha < 0 };
}

let sunCache = { day: '', times: null };

/** Sunrise and sunset (Date objects) for the town's calendar day containing `date` (a flat horizon, as published). */
export function sunTimes(date) {
  const today = DAY_FMT.format(date);
  if (sunCache.day === today) return sunCache.times;
  let rise = null, set = null;
  const step = 2 * 60000;
  // Steps on a fixed 2-minute grid, so every moment of the day gets the same answer.
  const start = Math.floor(date.getTime() / step) * step - 26 * 3600000;
  let prev = sunPosition(new Date(start)).elev;
  for (let t = start + step; t < start + 52 * 3600000; t += step) {
    const d = new Date(t);
    const e = sunPosition(d).elev;
    // Only a crossing needs the slower check that it falls on the same local day.
    if (prev < -0.833 && e >= -0.833 && !rise && DAY_FMT.format(d) === today) rise = d;
    if (prev >= -0.833 && e < -0.833 && !set && DAY_FMT.format(d) === today) set = d;
    prev = e;
  }
  sunCache = { day: today, times: { rise, set } };
  return sunCache.times;
}

/** Moon age as a fraction of the synodic month: 0 = new, 0.5 = full. */
export function moonAge(date) {
  const jd = date.getTime() / 86400000 + 2440587.5;
  const age = ((jd - 2451550.1) / 29.530588853) % 1;
  return age < 0 ? age + 1 : age;
}

// ----------------------------------------------------------------------------- palette

const hex2rgb = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
const rgb2hex = c => '#' + c.map(v => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('');
function mix(a, b, t) {
  const out = {};
  for (const k of Object.keys(a)) {
    out[k] = typeof a[k] === 'number' ? a[k] + (b[k] - a[k]) * t : rgb2hex(hex2rgb(a[k]).map((v, i) => v + (hex2rgb(b[k])[i] - v) * t));
  }
  return out;
}
const resolve = k => (Array.isArray(k) ? mix(P[k[0]], P[k[1]], k[2]) : P[k]);

export function paletteFor(elev, morning) {
  const frames = morning ? MORNING : EVENING;
  if (elev <= frames[0][0]) return resolve(frames[0][1]);
  for (let i = 1; i < frames.length; i++) {
    if (elev <= frames[i][0]) {
      const [e0, k0] = frames[i - 1], [e1, k1] = frames[i];
      return mix(resolve(k0), resolve(k1), (elev - e0) / (e1 - e0));
    }
  }
  return resolve(frames[frames.length - 1][1]);
}

const PRESETS = { night: [-20, false], dawn: [-3, true], morning: [8, true], day: [45, true], golden: [7, false], dusk: [-1, false] };

// ----------------------------------------------------------------------------- seasons

// How the land looks in full daylight in each season. The time-of-day palette then "relights" it, so gold grass
// glows at golden hour and goes near-black at night. Little Lake Valley is inland (NOAA 1991-2020 normals for
// Willits 1 NE: July 83.5/48.0 °F, January 53.7/33.3 °F, 49 in of rain a year, a few inches of snow): the redwoods
// and firs stay dark green all year, the grass greens after the first winter rains, flowers in spring (poppies and
// lupine) and cures to gold from June, then fades to straw. Winter mornings bring valley fog and, now and then, a
// dusting of snow on the ridge (`accent`); in fall the creekside trees turn yellow (`fall`).
const VEG = ['hillFar', 'hillMid', 'hillNear', 'canopy', 'grass'];
const SEASONS = {
  winter: { hillFar: P.day.hillFar, hillMid: P.day.hillMid, hillNear: '#3b6a45', canopy: P.day.canopy, grass: '#6e9a4e', fog: 0.85, accent: 1, flowers: 0, fall: 0 },
  spring: { hillFar: '#80a28c', hillMid: '#4f7f5b', hillNear: '#477b48', canopy: '#25502f', grass: '#7daf52', fog: 0.35, accent: 0, flowers: 1, fall: 0 },
  summer: { hillFar: '#7a9584', hillMid: '#56704f', hillNear: '#5e6b3c', canopy: P.day.canopy, grass: '#c8a55a', fog: 0, accent: 0, flowers: 0, fall: 0 },
  fall:   { hillFar: P.day.hillFar, hillMid: '#5a6e48', hillNear: '#5d6a3e', canopy: P.day.canopy, grass: '#c2aa76', fog: 0.45, accent: 0, flowers: 0, fall: 1 },
};
// Day of the year -> season, easing between them: winter December to February, spring March to May, the dry
// summer June to September, fall October to November.
const SEASON_FRAMES = [[0, 'winter'], [52, 'winter'], [75, 'spring'], [135, 'spring'], [160, 'summer'], [250, 'summer'], [275, 'fall'], [318, 'fall'], [340, 'winter'], [366, 'winter']];

function dayOfYear(date) {
  const [y, m, d] = DAY_FMT.format(date).split('-').map(Number);
  return Math.round((Date.UTC(y, m - 1, d) - Date.UTC(y, 0, 1)) / 86400000);
}

export function seasonColors(date, force) {
  if (force && SEASONS[force]) return SEASONS[force];
  const doy = dayOfYear(date);
  for (let i = 1; i < SEASON_FRAMES.length; i++) {
    const [d0, s0] = SEASON_FRAMES[i - 1], [d1, s1] = SEASON_FRAMES[i];
    if (doy <= d1) return mix(SEASONS[s0], SEASONS[s1], d1 === d0 ? 0 : (doy - d0) / (d1 - d0));
  }
  return SEASONS.winter;
}

/** December 1 to January 6, local time: string lights on the houses at night. */
export function isHolidaySeason(date) {
  const [, m, d] = DAY_FMT.format(date).split('-').map(Number);
  return m === 12 || (m === 1 && d <= 6);
}

export function relight(pal, season) {
  const out = { ...pal };
  for (const k of VEG) {
    const lit = hex2rgb(pal[k]), day = hex2rgb(P.day[k]), base = hex2rgb(season[k]);
    out[k] = rgb2hex(base.map((v, i) => v * (lit[i] / Math.max(day[i], 1))));
  }
  return out;
}

/** The painted things (PAINT) in the light of `pal`: lit the way the town's walls are, against how they look by day. */
export function paints(pal) {
  const lit = hex2rgb(pal.house), day = hex2rgb(P.day.house);
  const gain = lit.map((v, i) => Math.min(1.15, v / Math.max(day[i], 1)));
  return Object.fromEntries(Object.entries(PAINT).map(([k, hex]) => [k, rgb2hex(hex2rgb(hex).map((v, i) => v * gain[i]))]));
}

// ----------------------------------------------------------------------------- legibility

// The hero SVG's viewBox, and the height where the hills start behind the text band, x 440-1155 (tools/gen-hero.mjs):
// the east hills reach about y 486 at its left edge, the far hills and the western ridge about 500-515 further right.
const VIEW_W = 1600, VIEW_H = 720, HILLS_Y = 498;

// What app.css lays over the scene right behind the text, in each tone, as [colour, opacity]. The intro and
// the search label sit on frosted backings. The headline's halo (its text-shadow) moves the sky next to the
// letters about a quarter of the way to its colour, measured on the rendered headline; 0.2 errs on the safe side.
export const BACKING = { light: ['#ffffff', 0.7], dark: ['#08101c', 0.55] };
export const HALO = { light: ['#ffffff', 0.2], dark: ['#08101c', 0.2] };

// The hero's text, its colour in each tone (keep in step with app.css), what lies right behind it,
// and the contrast WCAG asks of it: 3:1 is enough for the big headline.
export const HERO_TEXT = [
  { sel: '.hero-title', ink: { light: '#10201a', dark: '#ffffff' }, under: HALO, need: 3 },
  { sel: '.hero-title em', ink: { light: '#462b06', dark: '#e6b558' }, under: HALO, need: 3 },
  { sel: '.hero-lede', ink: { light: '#263a30', dark: '#e7ecf5' }, under: BACKING, need: 4.5 },
  { sel: '.search-label', ink: { light: '#10201a', dark: '#ffffff' }, under: BACKING, need: 4.5 },
];

/** WCAG relative luminance of a #rrggbb colour: 0 for black, 1 for white. */
export function luminance(hex) {
  const [r, g, b] = hex2rgb(hex).map(v => ((v /= 255) <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio of two #rrggbb colours, from 1 to 21. */
export function contrast(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** The scene's colour at height y of the hero SVG (viewBox units): the sky gradient, then the far hills. */
export function backdropAt(pal, y) {
  if (y >= HILLS_Y) return pal.hillFar;
  const t = Math.max(0, y) / VIEW_H; // the #sky-g gradient: skyTop at 0, skyMid at .55, skyBot at 1
  const [a, b, f] = t < 0.55 ? [pal.skyTop, pal.skyMid, t / 0.55] : [pal.skyMid, pal.skyBot, (t - 0.55) / 0.45];
  return rgb2hex(hex2rgb(a).map((v, i) => v + (hex2rgb(b)[i] - v) * f));
}

/** Height in the hero SVG (viewBox units) of a point `y` px down the screen, given the SVG's box. */
export function sceneY(box, y) {
  const scale = Math.max(box.width / VIEW_W, box.height / VIEW_H); // "slice": the scene covers the hero
  return VIEW_H + (y - box.bottom) / scale; // "YMax": pinned to the hero's bottom edge
}

/**
 * The hero's text placed on the scene, from screen boxes: `rects` maps each HERO_TEXT selector to its box, and
 * `clouds` are the clouds' boxes. Each band is a HERO_TEXT entry on screen, with its top and bottom in SVG units
 * and `clouds`: the stretches of it, [top, bottom], that have a cloud behind them.
 */
export function placeText(box, rects, clouds = []) {
  const bands = [];
  for (const text of HERO_TEXT) {
    const r = rects[text.sel];
    if (!r?.height) continue;
    const behind = clouds.filter(c => c.height && c.left < r.right && c.right > r.left && c.top < r.bottom && c.bottom > r.top);
    bands.push({
      ...text, top: sceneY(box, r.top), bottom: sceneY(box, r.bottom),
      clouds: behind.map(c => [sceneY(box, Math.max(c.top, r.top)), sceneY(box, Math.min(c.bottom, r.bottom))]),
    });
  }
  return bands;
}

const blend = (top, alpha, under) => rgb2hex(hex2rgb(top).map((v, i) => v * alpha + hex2rgb(under)[i] * (1 - alpha)));

/** The lowest contrast of `ink` down a stretch of the scene (SVG units), under a cloud or not, with `veil` on top. */
function worstContrast(pal, ink, veil, top, bottom, cloud) {
  let worst = Infinity;
  for (let i = 0; i <= 8; i++) {
    let bg = backdropAt(pal, top + ((bottom - top) * i) / 8);
    if (cloud) bg = blend(pal.cloud, pal.cloudOp, bg);
    if (veil) bg = blend(veil[0], veil[1], bg);
    worst = Math.min(worst, contrast(ink, bg));
  }
  return worst;
}

/**
 * 'dark' (light text) or 'light' (dark text): whichever keeps the hardest line to read the most legible against
 * what is right behind it. Each band is a HERO_TEXT entry plus its top and bottom in SVG units, and `clouds`:
 * the stretches of it, [top, bottom], that have a cloud behind them.
 */
export function heroTone(pal, bands, current) {
  const score = tone => Math.min(...bands.map(({ ink, under, need, top, bottom, clouds = [] }) => Math.min(
    worstContrast(pal, ink[tone], under?.[tone], top, bottom, false),
    ...clouds.map(([a, b]) => worstContrast(pal, ink[tone], under?.[tone], a, b, true)),
  ) / need));
  const s = { dark: score('dark'), light: score('light') };
  const other = current === 'dark' ? 'light' : 'dark';
  // The current tone stays unless the other is clearly better, so a one-pixel shift can't make it flicker.
  // But a tone that falls short gives way to one that doesn't.
  if (current in s && (s[current] >= 1 || s[other] < 1)) s[current] *= 1.03;
  return s.dark > s.light ? 'dark' : 'light';
}

// ----------------------------------------------------------------------------- runtime

export function initSky(hero, { onTick } = {}) {
  if (!hero) return;
  const svg = hero.querySelector('.scene-svg');
  const sun = svg?.querySelector('#sun');
  const moon = svg?.querySelector('#moon');
  const shade = svg?.querySelector('#moon-shade');
  const params = new URLSearchParams(location.search);
  const preset = params.get('sky');
  const hourOverride = params.get('skyHour');
  const seasonOverride = params.get('season');
  const holidayOverride = params.get('holiday');
  let pal = null;

  // Where each piece of hero text sits on the scene. The clouds are measured too: the crop moves them as the
  // window changes shape, and results pages hide them.
  function textBands() {
    const box = svg?.getBoundingClientRect();
    if (box?.height) {
      const rects = Object.fromEntries(HERO_TEXT.map(t => [t.sel, hero.querySelector(t.sel)?.getBoundingClientRect()]));
      const bands = placeText(box, rects, [...svg.querySelectorAll('.cloud')].map(c => c.getBoundingClientRect()));
      if (bands.length) return bands;
    }
    return HERO_TEXT.map(text => ({ ...text, top: 90, bottom: 410 })); // where it usually sits
  }

  // Light text on dark skies, dark text on bright ones, judged by the sky behind the text.
  function paintTone() {
    if (!pal) return;
    const tone = heroTone(pal, textBands(), hero.dataset.skyTone);
    if (hero.dataset.skyTone !== tone) hero.dataset.skyTone = tone;
  }

  function frame() {
    let now = new Date();
    if (hourOverride !== null && !isNaN(+hourOverride)) {
      // Interpret the override as the town's local hours today.
      const h = +hourOverride;
      const local = DAY_FMT.format(now);
      const guess = new Date(`${local}T00:00:00Z`);
      const offset = (new Date(guess.toLocaleString('en-US', { timeZone: TIME_ZONE })) - new Date(guess.toLocaleString('en-US', { timeZone: 'UTC' }))) / 60000;
      now = new Date(guess.getTime() - offset * 60000 + h * 3600000);
    }
    let { elev, az, morning } = sunPosition(now);
    if (preset && PRESETS[preset]) { [elev, morning] = PRESETS[preset]; az = morning ? 120 : 240; }
    const season = seasonColors(now, seasonOverride);
    pal = relight(paletteFor(elev, morning), season);
    for (const [k, v] of Object.entries(CSS_VARS)) hero.style.setProperty(v, String(pal[k]));
    for (const [k, v] of Object.entries(paints(pal))) hero.style.setProperty(PAINT_VARS[k], v);
    // Valley fog (thickest on winter mornings, thinning by afternoon), snow on the ridge, wildflowers, fall colour.
    const foggy = season.fog * (morning ? 1 : elev > 20 ? 0.45 : 0.7);
    hero.style.setProperty('--fog-op', foggy.toFixed(2));
    hero.style.setProperty('--season-accent', season.accent.toFixed(2));
    hero.style.setProperty('--flowers', season.flowers.toFixed(2));
    hero.style.setProperty('--fall', season.fall.toFixed(2));

    // Sun: azimuth 60..300 maps across the scene (it faces south: east on the left, west on the right),
    // elevation -12..65 maps bottom..top, with 0° at y 526, just below the western ridge (y 490-515).
    const sx = 120 + ((Math.max(60, Math.min(300, az)) - 60) / 240) * 1360;
    const sy = 610 - ((Math.max(-12, Math.min(65, elev)) + 12) / 77) * 540;
    sun?.setAttribute('transform', `translate(${sx.toFixed(1)} ${sy.toFixed(1)})`);
    hero.style.setProperty('--sun-op', elev > -4 ? '1' : String(Math.max(0, (elev + 8) / 4)));
    hero.style.setProperty('--holiday', holidayOverride !== null ? (holidayOverride === '0' ? '0' : '1') : isHolidaySeason(now) ? '1' : '0');

    // Moon: visible when the sun is down; phase from the synodic month.
    const age = moonAge(now);
    const moonVisible = elev < -2 ? 1 : elev < 6 ? Math.max(0, (6 - elev) / 8) * 0.6 : 0;
    hero.style.setProperty('--moon-op', moonVisible.toFixed(2));
    const offset = age < 0.5 ? -44 * (age / 0.5) : 44 * (1 - (age - 0.5) / 0.5);
    shade?.setAttribute('cx', offset.toFixed(1));
    if (moon) moon.setAttribute('transform', `translate(${morning ? 330 : 1270} ${elev < -10 ? 120 : 170})`);

    paintTone();
    hero.dataset.phase = preset || (elev < -6 ? 'night' : elev < 2 ? (morning ? 'dawn' : 'dusk') : elev < 10 ? (morning ? 'morning' : 'golden') : 'day');
    onTick?.({ now, elev, morning, phase: hero.dataset.phase });
  }
  frame();
  setInterval(frame, 60000);

  // The text moves when the page switches to results, the text size changes or the window resizes.
  if (typeof ResizeObserver === 'function') {
    const resized = new ResizeObserver(paintTone);
    resized.observe(hero);
    const inner = hero.querySelector('.hero-inner');
    if (inner) resized.observe(inner);
  }

  // Gentle parallax while the hero is on screen.
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)');
  const layers = [...svg.querySelectorAll('.layer')].map(el => ({ el, depth: +el.dataset.depth || 0 }));
  let ticking = false;
  const onScroll = () => {
    if (ticking || reduce.matches) return;
    ticking = true;
    requestAnimationFrame(() => {
      // On a phone the hero is taller than the screen, and its foot (the arch, the depot and the train) only comes
      // into view once the page has scrolled down to it. The layers start to lift only from there, as the hero
      // leaves the screen, so they never slide up behind the chips first. On a desktop the whole hero fits, so
      // they lift from the top of the page.
      const start = Math.max(0, hero.getBoundingClientRect().bottom + window.scrollY - window.innerHeight);
      const y = Math.min(Math.max(0, window.scrollY - start), hero.offsetHeight);
      for (const { el, depth } of layers) el.style.transform = `translate3d(0, ${(y * depth * -0.6).toFixed(1)}px, 0)`;
      ticking = false;
    });
  };
  window.addEventListener('scroll', onScroll, { passive: true });
}

/** "Sunset 4:51 PM" in daylight, "Sunrise 7:02 AM" before dawn, '' after dark. */
export function sunNote(date = new Date()) {
  const { rise, set } = sunTimes(date);
  if (rise && date < rise) return `Sunrise ${fmtClock(rise)}`;
  if (set && date < set) return `Sunset ${fmtClock(set)}`;
  return '';
}

/** "Good evening" etc. for the town's local clock. */
export function greeting(date = new Date()) {
  const h = +HOUR_FMT.format(date);
  if (h >= 5 && h < 12) return 'Good morning';
  if (h >= 12 && h < 17) return 'Good afternoon';
  if (h >= 17 && h < 23) return 'Good evening';
  return 'Hello, night owl';
}

export function fmtClock(date) {
  return CLOCK_FMT.format(date);
}
