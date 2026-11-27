#!/usr/bin/env node
// Generate the layered hero landscape (inline SVG) and paste it into index.html
// between <!-- HERO:START --> and <!-- HERO:END -->.
//
//   node tools/gen-hero.mjs
//
// An original illustration of Fort Bragg, looking south down the coast: the Pacific on the right, where the sun
// sets, and the redwood ridges of the Coast Range on the left, where it rises. In the foreground the Skunk Train
// (a maroon diesel with yellow trim, two coaches and an open car, as the California Western runs it today) crosses
// a timber trestle over Pudding Creek and heads east into the redwoods, leaving the depot behind. Beyond it lie the
// town on its marine terrace, the level deck of the Noyo River Bridge, sea stacks and a fishing boat, and Point
// Cabrillo's light on the far headland. Nothing is copied from the railroad's logos or artwork.
//
// All colours are CSS variables, so assets/js/sky.js can repaint the scene for the time of day and the season:
// green hills in the rainy months, gold ones in the dry, summer fog on the horizon, whales passing in winter.
// The hero's text sits in x 440-1155, y 76-419 of the scene (tests/skymap-review.test.mjs), so nothing tall
// reaches up there: only the sky is behind the words.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const INDEX = path.join(ROOT, 'index.html');
const W = 1600, H = 720;
const HORIZON = 526; // the sea horizon: sky.js sets the sun at about this height
const RAIL = 622; // top of the rails the train runs on
const WATER = 662; // Pudding Creek under the trestle
// Every layer is filled this far below the scene, so the parallax (which lifts the near layers further as the page
// scrolls) never opens a gap at the bottom.
const FLOOR = H + 320;
const f = n => Math.round(n * 10) / 10;

function rng(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const between = (r, [a, b]) => a + r() * (b - a);

// ---------------------------------------------------------------- shapes
const rect = (x, y, w, h) => `M${f(x)},${f(y)}h${f(w)}v${f(h)}h${f(-w)}z`;
const circle = (cx, cy, r) => `M${f(cx - r)},${f(cy)}a${f(r)},${f(r)} 0 1,0 ${f(2 * r)},0a${f(r)},${f(r)} 0 1,0 ${f(-2 * r)},0z`;
const poly = pts => `M${pts.map(([x, y]) => `${f(x)},${f(y)}`).join('L')}z`;
/** A box with its top corners rounded, as on a locomotive's hood. */
const hood = (x, y, w, h, r) => `M${f(x)},${f(y + h)}V${f(y + r)}Q${f(x)},${f(y)} ${f(x + r)},${f(y)}H${f(x + w - r)}Q${f(x + w)},${f(y)} ${f(x + w)},${f(y + r)}V${f(y + h)}z`;

/** A smooth line through [x, y] points, as a function of x (cosine easing between points). */
function profile(pts) {
  return x => {
    if (x <= pts[0][0]) return pts[0][1];
    for (let i = 1; i < pts.length; i++) {
      const [x0, y0] = pts[i - 1], [x1, y1] = pts[i];
      if (x <= x1) { const t = (1 - Math.cos(((x - x0) / (x1 - x0)) * Math.PI)) / 2; return y0 + (y1 - y0) * t; }
    }
    return pts[pts.length - 1][1];
  };
}

/** A ridge filled to the bottom of the scene, its top furred with small conifer points. */
function ridge(seed, base, { x0 = -60, x1 = W + 60, step = [5, 11], fur = [2, 7], bottom = FLOOR } = {}) {
  const r = rng(seed);
  let x = x0;
  let d = `M${x0},${bottom}L${x0},${f(base(x0))}`;
  while (x < x1) {
    const w = between(r, step), nx = Math.min(x + w, x1);
    d += `L${f(x + w / 2)},${f(base(x + w / 2) - between(r, fur))}L${f(nx)},${f(base(nx))}`;
    x = nx;
  }
  return d + `L${x1},${bottom}Z`;
}

/** One redwood: a tall, narrow column of drooping sprays on a long, straight trunk. Returns [foliage, trunk]. */
function redwood(r, x, base, h, w, bare = 0.22) {
  const top = base - h, crownBottom = base - h * bare, tiers = 9 + Math.floor(r() * 5);
  const right = [], left = [];
  for (let i = 1; i <= tiers; i++) {
    const t = i / tiers, y = top + (crownBottom - top) * t;
    // Narrow at the very top, then a column that barely widens; each spray juts out and droops.
    const hw = (w / 2) * (0.3 + 0.7 * Math.min(1, t * 2.4)) * (0.75 + r() * 0.5);
    const sag = ((crownBottom - top) / tiers) * 0.6;
    right.push([x + hw * 0.45, y - sag], [x + hw, y + sag * 0.15]);
    left.unshift([x - hw * (0.85 + r() * 0.3), y + sag * 0.1], [x - hw * 0.45, y - sag]);
  }
  const foliage = poly([[x + w * 0.02, top - 3], ...right, [x + w * 0.1, crownBottom - 2], [x - w * 0.1, crownBottom - 2], ...left]);
  const trunk = poly([[x - w * 0.05, crownBottom - 10], [x + w * 0.05, crownBottom - 10], [x + w * 0.09, base + 2], [x - w * 0.09, base + 2]]);
  return [foliage, trunk];
}

/** A stand of redwoods on a ground line, filled down to the bottom. `cap(x)` is the highest a tree may reach there. */
function stand(seed, { x0, x1, base, h, w, gap, cap = () => 0, bottom = FLOOR, bare }) {
  const r = rng(seed);
  let trees = '', trunks = '';
  for (let x = x0 + between(r, gap) / 2; x < x1; x += between(r, gap)) {
    const y = base(x), tw = between(r, w);
    const ht = Math.min(between(r, h), y - cap(x));
    if (ht < 30) continue;
    const [fo, tr] = redwood(r, x, y, ht, tw, bare);
    trees += fo; trunks += tr;
  }
  const ground = ridge(seed + 1, base, { x0, x1, step: [14, 26], fur: [1, 4], bottom });
  return { trees: trees + trunks + ground };
}

/** A wind-shorn coastal cypress: a low, flat crown in lumps, swept inland (left), on a short, thick, crooked trunk. */
function cypress(r, x, base, s) {
  const crownY = base - 26 * s, cw = (54 + r() * 18) * s, lean = -10 * s;
  let crown = '';
  for (let i = 0; i < 4; i++) {
    const cx = x + lean - cw * 0.42 + (i / 3) * cw * 0.84, rise = (i === 1 || i === 2 ? 9 : 5 + r() * 3) * s;
    crown += `M${f(cx - cw * 0.2)},${f(crownY + 5 * s)}C${f(cx - cw * 0.2)},${f(crownY - rise)} ${f(cx + cw * 0.2)},${f(crownY - rise - 2 * s)} ${f(cx + cw * 0.22)},${f(crownY + 5 * s)}Z`;
  }
  crown += rect(x + lean - cw * 0.5, crownY - 1 * s, cw, 7 * s);
  const trunk = poly([[x - 3 * s, base], [x + 3 * s, base], [x + lean * 0.4 + 2.2 * s, crownY + 4 * s], [x + lean * 0.4 - 2.2 * s, crownY + 4 * s]])
    + poly([[x + lean * 0.2, crownY + 12 * s], [x + lean * 0.2 + 1.6 * s, crownY + 12 * s], [x + lean * 1.1, crownY + 4 * s], [x + lean * 1.1 - 1.6 * s, crownY + 4 * s]]);
  return crown + trunk;
}

/** A row of low, rounded shrubs along a ground line (ferns, huckleberry, coyote brush). */
function brush(seed, base, { x0 = -60, x1 = W + 60, h = [6, 16], w = [14, 30], bottom = FLOOR } = {}) {
  const r = rng(seed);
  let x = x0, y = base(x0);
  let d = `M${x0},${bottom}L${x0},${f(y)}`;
  while (x < x1) {
    const ww = between(r, w), nx = Math.min(x + ww, x1), ny = base(nx), hh = between(r, h);
    d += `C${f(x - ww * 0.05)},${f(y - hh * 1.3)} ${f(nx + ww * 0.05)},${f(ny - hh * 1.3)} ${f(nx)},${f(ny)}`;
    x = nx; y = ny;
  }
  return d + `L${x1},${bottom}Z`;
}

// ---------------------------------------------------------------- sky details
function cloud(cx, cy, s, seed) {
  const r = rng(seed);
  let out = '';
  const puffs = 6;
  for (let i = 0; i < puffs; i++) {
    const px = cx + (i - puffs / 2) * 26 * s + (r() - 0.5) * 10 * s;
    const py = cy - Math.sin((i / (puffs - 1)) * Math.PI) * 18 * s + (r() - 0.5) * 6 * s;
    out += `<ellipse cx="${f(px)}" cy="${f(py)}" rx="${f((34 + r() * 18) * s)}" ry="${f((18 + r() * 10) * s)}"/>`;
  }
  return out;
}

function stars() {
  const r = rng(42);
  let plain = '', twinkle = '';
  for (let i = 0; i < 120; i++) {
    const x = r() * W, y = r() * 440;
    const rad = 0.5 + r() * 1.3;
    // Up to 2s, then a 3s twinkle (app.css): every star is still within 5s of the page opening (WCAG 2.2.2).
    if (r() < 0.25) twinkle += `<circle cx="${f(x)}" cy="${f(y)}" r="${f(rad + 0.3)}" style="animation-delay:${f(r() * 2)}s"/>`;
    else plain += `<circle cx="${f(x)}" cy="${f(y)}" r="${f(rad)}"/>`;
  }
  return { plain, twinkle };
}

/** A soft bank of sea fog lying on the horizon. */
function fogBank(seed) {
  const r = rng(seed);
  let out = '';
  for (let x = 830; x < W + 80; x += 46 + r() * 30) {
    out += `<ellipse cx="${f(x)}" cy="${f(HORIZON - 3 + r() * 6)}" rx="${f(60 + r() * 60)}" ry="${f(6 + r() * 7)}"/>`;
  }
  return out;
}

// ---------------------------------------------------------------- the far coast
const farBase = profile([[-60, 470], [120, 452], [300, 476], [470, 462], [640, 488], [760, 500], [830, 516], [880, HORIZON - 2], [900, HORIZON + 4]]);
const hillBase = profile([[-60, 500], [160, 488], [360, 504], [540, 496], [660, 512], [730, 532], [760, 544]]);

/** Point Cabrillo Light, a white fog-signal house with a red roof and a small lantern, tiny on the far headland. */
function lighthouse() {
  const x = 846, y = HORIZON - 6;
  return {
    walls: rect(x, y - 4, 9, 4) + rect(x + 3, y - 8, 3, 4),
    roof: poly([[x - 1, y - 4], [x + 4.5, y - 6.5], [x + 10, y - 4]]),
    lamp: [x + 4.5, y - 9],
  };
}

/** The Noyo River Bridge: a long, level concrete deck on two tall piers, each a pair of plain columns. */
function noyoBridge() {
  const x0 = 700, x1 = 892, deck = 546, depth = 6;
  let piers = '';
  for (const px of [762, 834]) piers += rect(px - 5, deck + depth, 3.6, 34) + rect(px + 1.4, deck + depth, 3.6, 34);
  const lamps = Array.from({ length: 7 }, (_, i) => circle(x0 + 14 + i * 27, deck - 3, 1.2)).join('');
  return {
    deck: rect(x0, deck, x1 - x0, depth) + rect(x0, deck - 2, x1 - x0, 1.2),
    piers, lamps,
    posts: Array.from({ length: 7 }, (_, i) => rect(x0 + 13.6 + i * 27, deck - 3, 0.8, 3)).join(''),
  };
}

/** Sea stacks off the bluffs, each with a line of surf at its foot. */
function seaStacks() {
  const stacks = [[1046, 578, 26, 16], [1088, 584, 14, 9], [1214, 566, 34, 22], [1262, 572, 16, 12], [1390, 560, 22, 13], [1536, 590, 40, 26]];
  let rock = '', surf = '';
  for (const [x, y, w, h] of stacks) {
    rock += `M${x - w / 2},${y}C${f(x - w * 0.45)},${f(y - h * 0.8)} ${f(x - w * 0.15)},${f(y - h)} ${f(x + w * 0.05)},${f(y - h)}C${f(x + w * 0.3)},${f(y - h * 0.95)} ${f(x + w * 0.5)},${f(y - h * 0.5)} ${f(x + w / 2)},${y}Z`;
    surf += `M${f(x - w * 0.7)},${y + 1}h${f(w * 1.4)}`;
  }
  return { rock, surf };
}

/** A small troller heading home, with its outrigger poles up. */
function boat(x, y) {
  return {
    hull: `M${x - 16},${y - 6}h32l-4,6h-24z`,
    cabin: rect(x - 6, y - 12, 12, 6) + rect(x - 3, y - 15, 6, 3),
    rig: `M${x + 1},${y - 15}V${y - 28}M${x},${y - 12}L${x - 16},${y - 36}M${x + 2},${y - 12}L${x + 18},${y - 36}`,
    glass: rect(x - 4, y - 10.5, 3, 2.5) + rect(x + 1, y - 10.5, 3, 2.5),
    wake: `M${x + 18},${y + 1}h22M${x + 24},${y + 4}h30`,
  };
}

/** A grey whale surfacing offshore in winter and spring: a dark back and a spout. */
function whale(x, y) {
  return {
    back: `M${x - 14},${y}C${x - 10},${y - 6} ${x + 6},${y - 7} ${x + 14},${y}Z`,
    spout: `<ellipse cx="${x - 6}" cy="${y - 12}" rx="3" ry="6"/><ellipse cx="${x - 9}" cy="${y - 18}" rx="4" ry="3"/><ellipse cx="${x - 3}" cy="${y - 18}" rx="4" ry="3"/>`,
  };
}

// ---------------------------------------------------------------- the town on its terrace
const terraceBase = profile([[-60, 584], [400, 580], [760, 578], [940, 576], [990, 578], [1012, 600], [1030, 640]]);

function town() {
  // [x, ground y, width, wall height, roof: 'gable' | 'flat' | 'false-front', light walls?]
  const blocks = [
    [520, 582, 30, 14, 'gable', 1], [556, 581, 40, 12, 'flat', 0], [602, 581, 26, 16, 'false-front', 1],
    [634, 580, 44, 13, 'flat', 0], [684, 580, 24, 15, 'gable', 1], [714, 580, 36, 18, 'false-front', 0],
    [756, 579, 30, 12, 'gable', 1], [792, 579, 46, 14, 'flat', 1], [844, 578, 26, 16, 'gable', 0],
    [876, 578, 34, 11, 'flat', 1], [916, 577, 24, 14, 'gable', 1], [946, 577, 22, 10, 'gable', 0],
  ];
  const out = { walls: '', light: '', roofs: '', wins: '', lights: '' };
  let bulb = 0;
  const r = rng(77);
  for (const [x, y, w, h, roof, light] of blocks) {
    const top = y - h;
    out[light ? 'light' : 'walls'] += rect(x, top, w, h + 4);
    if (roof === 'gable') {
      const peak = top - Math.min(10, w * 0.32);
      out.roofs += poly([[x - 2, top + 1], [x + w / 2, peak], [x + w + 2, top + 1]]);
      // Holiday lights along the eaves and up the gable (December only).
      for (const [a, b] of [[[x - 2, top + 1], [x + w / 2, peak]], [[x + w / 2, peak], [x + w + 2, top + 1]]]) {
        for (let i = 0; i < 5; i++) {
          const t = (i + 0.5) / 5;
          out.lights += `<circle class="l${bulb++ % 4}" cx="${f(a[0] + (b[0] - a[0]) * t)}" cy="${f(a[1] + (b[1] - a[1]) * t - 1)}" r="1.2"/>`;
        }
      }
    } else if (roof === 'false-front') {
      out.roofs += rect(x - 1, top - 4, w + 2, 4) + rect(x - 1, top - 6, w + 2, 1.4);
    } else {
      out.roofs += rect(x - 1, top - 2, w + 2, 2.4);
    }
    for (let wx = x + 4; wx + 4 < x + w - 2; wx += 8) if (r() < 0.75) out.wins += rect(wx, top + 4, 4, 4);
  }
  return out;
}

// ---------------------------------------------------------------- the Skunk Train
// Proportions from the GP9 diesel and heavyweight coaches the line runs (notes/research/geography-and-design.md §4.6),
// heading left: east, out of town and into the redwoods along Pudding Creek.
const U = 30; // body height

function wheels(p, cx, spread, r) {
  p.iron += rect(cx - spread - r - 3, RAIL - r * 2 - 2, spread * 2 + r * 2 + 6, 5);
  for (const wx of [cx - spread, cx + spread]) { p.iron += circle(wx, RAIL - r, r); p.hub += circle(wx, RAIL - r, r * 0.35); }
}

function locomotive(p, X) {
  const deck = RAIL - 15; // the walkway
  p.iron += rect(X, deck, 120, 6); // frame
  p.iron += poly([[X, deck], [X - 4, deck], [X - 7, RAIL - 5], [X + 4, RAIL - 5]]); // pilot
  p.iron += poly([[X + 120, deck], [X + 124, deck], [X + 127, RAIL - 5], [X + 116, RAIL - 5]]);
  p.iron += rect(X - 9, RAIL - 13, 6, 3) + rect(X + 123, RAIL - 13, 6, 3); // couplers
  p.iron += hood(X + 42, RAIL - 12, 36, 7, 2.5); // fuel tank
  wheels(p, X + 21, 9, 5); wheels(p, X + 99, 9, 5);
  // Short hood (front), cab, long hood.
  p.body += hood(X + 2, deck - 21, 26, 21, 3);
  p.body += rect(X + 28, deck - 36, 26, 36);
  p.body += hood(X + 54, deck - 25, 64, 25, 3);
  p.shade += rect(X + 2, deck - 3, 116, 3);
  p.iron += rect(X + 26.5, deck - 38.5, 29, 3); // cab roof
  p.iron += rect(X + 37, deck - 41, 8, 2.5); // number board
  p.iron += rect(X + 61, deck - 28, 3, 3) + rect(X + 102, deck - 27, 13, 2); // exhaust stack, fan
  p.glass += rect(X + 31, deck - 31, 8, 8) + rect(X + 43, deck - 31, 8, 8);
  p.lit += rect(X + 31, deck - 31, 8, 8) + rect(X + 43, deck - 31, 8, 8);
  for (let lx = X + 58; lx < X + 70; lx += 2.6) p.shade += rect(lx, deck - 21, 1.1, 11); // louvres
  for (let lx = X + 103; lx < X + 115; lx += 2.6) p.shade += rect(lx, deck - 21, 1.1, 11);
  // Yellow: the walkway stripe, the handrails and their posts, the nose chevron and the lettering panel.
  p.trim += rect(X - 2, deck - 1, 124, 2.2);
  p.trim += rect(X + 1, deck - 12, 27, 1.2) + rect(X + 54, deck - 12, 66, 1.2);
  for (const px of [X + 2, X + 11, X + 20, X + 56, X + 70, X + 84, X + 98, X + 112, X + 119]) p.trim += rect(px, deck - 12, 1, 12);
  p.trim += poly([[X + 3, deck - 11], [X + 13, deck - 19], [X + 17, deck - 19], [X + 7, deck - 11], [X + 17, deck - 3], [X + 13, deck - 3]]);
  p.trim += `M${X + 72},${deck - 22}h34v9h-34z M${X + 73},${deck - 21}v7h32v-7z`;
  for (let lx = X + 75; lx < X + 103; lx += 2.3) p.gold += rect(lx, deck - 19.5, 1.3, 4);
  p.trim += `M${X + 31},${deck - 20}h14v8h-14z M${X + 32},${deck - 19}v6h12v-6z`; // the cab number box
  p.gold += rect(X + 35, deck - 18, 2.2, 4) + rect(X + 39, deck - 18, 2.2, 4);
  // The headlight, and its beam after dark.
  p.cream += circle(X + 4, deck - 18, 1.8);
  p.beam = poly([[X + 3, deck - 20], [X - 150, deck - 42], [X - 150, deck + 10], [X + 3, deck - 16]]);
}

function coach(p, X, len = 150) {
  p.iron += rect(X + 2, RAIL - 15, len - 4, 4);
  p.rod += `M${X + 30},${RAIL - 12}L${X + 48},${RAIL - 7}H${X + len - 48}L${X + len - 30},${RAIL - 12}`; // truss rods
  wheels(p, X + 20, 8, 4.5); wheels(p, X + len - 20, 8, 4.5);
  p.coach += rect(X + 4, RAIL - 48, len - 8, 34);
  p.shade += rect(X + 4, RAIL - 46, 8, 32) + rect(X + len - 12, RAIL - 46, 8, 32); // vestibules
  p.iron += rect(X + 5, RAIL - 15, 6, 4) + rect(X + len - 11, RAIL - 15, 6, 4); // steps
  p.iron += rect(X - 3, RAIL - 13, 6, 3);
  // Arched roof with a raised clerestory, and its little vent windows.
  p.roof += `M${X + 2},${RAIL - 47}Q${X + 3},${RAIL - 52} ${X + 12},${RAIL - 53}H${X + len - 12}Q${X + len - 3},${RAIL - 52} ${X + len - 2},${RAIL - 47}Z`;
  p.roof += hood(X + 16, RAIL - 58, len - 32, 6, 2);
  for (let vx = X + 22; vx < X + len - 24; vx += 9) p.glass += rect(vx, RAIL - 56.5, 4, 2.2);
  // A long row of tall, narrow windows, lit after dark.
  const n = 12, step = (len - 36) / (n - 1);
  for (let i = 0; i < n; i++) {
    const wx = X + 16 + i * step;
    p.glass += rect(wx, RAIL - 43, 6, 12);
    p.lit += rect(wx, RAIL - 43, 6, 12);
  }
  // Gold lettering below the windows, with a small round herald in the middle.
  for (const [a, b] of [[X + 26, X + len / 2 - 10], [X + len / 2 + 10, X + len - 26]]) for (let lx = a; lx < b; lx += 2.4) p.gold += rect(lx, RAIL - 27, 1.3, 3.6);
  p.gold += circle(X + len / 2, RAIL - 25.5, 3.6);
  p.coach += circle(X + len / 2, RAIL - 25.5, 2.4);
}

function openCar(p, X, len = 120) {
  p.iron += rect(X + 2, RAIL - 15, len - 4, 4);
  wheels(p, X + 18, 8, 4.5); wheels(p, X + len - 18, 8, 4.5);
  p.iron += rect(X - 3, RAIL - 13, 6, 3);
  // Riders first, so the low side hides their laps.
  const r = rng(5);
  const coats = ['coat1', 'coat2', 'coat3', 'coat4'];
  for (let i = 0, x = X + 14; x < X + len - 10; i++, x += 11.5 + r() * 3) {
    const head = RAIL - 38 - r() * 2.5;
    p[coats[i % 4]] += hood(x - 4.5, head + 3.2, 9, 12, 3.5);
    p[i % 3 === 1 ? 'skin2' : 'skin1'] += circle(x, head, 3.2);
    if (r() < 0.55) p.hair += `M${f(x - 3.4)},${f(head)}a3.4,3.4 0 0,1 6.8,0z`;
    if (i === 3) p.skin1 += poly([[x + 3, head + 5], [x + 9, head - 7], [x + 10.6, head - 6.2], [x + 5, head + 6]]); // a wave
  }
  p.side += rect(X + 4, RAIL - 30, len - 8, 16);
  p.sideTop += rect(X + 4, RAIL - 31, len - 8, 1.6);
  p.iron += rect(X + 5, RAIL - 44, 1.6, 14) + rect(X + len - 6.6, RAIL - 44, 1.6, 14) + rect(X + 5, RAIL - 44, len - 10, 1.2); // end posts and rail
  for (let lx = X + 22; lx < X + len - 22; lx += 2.4) p.cream += rect(lx, RAIL - 25, 1.3, 3.6);
}

function train(x0) {
  const p = { side: '', sideTop: '', body: '', shade: '', coach: '', roof: '', iron: '', hub: '', glass: '', lit: '', trim: '', gold: '', cream: '', rod: '', beam: '', skin1: '', skin2: '', hair: '', coat1: '', coat2: '', coat3: '', coat4: '' };
  locomotive(p, x0);
  coach(p, x0 + 126);
  coach(p, x0 + 282);
  openCar(p, x0 + 438);
  return p;
}

/** The timber trestle: a deck on bents of posts, X-braced between them, standing in the creek. */
function trestle(x0, x1) {
  const top = RAIL + 3;
  let timber = rect(x0, top, x1 - x0, 6), brace = '';
  for (let x = x0 + 6; x <= x1 - 6; x += 28) {
    timber += poly([[x - 2, top + 6], [x + 2, top + 6], [x + 3.4, WATER + 6], [x - 3.4, WATER + 6]]);
    if (x + 28 <= x1 - 6) brace += `M${x},${top + 8}L${x + 28},${WATER - 6}M${x + 28},${top + 8}L${x},${WATER - 6}M${x},${(top + WATER) / 2 + 2}h28`;
  }
  return { timber, brace };
}

/** The Fort Bragg depot: a long, single-storey cream building with dark green trim and a raised middle parapet. */
function depot(x, y) {
  const w = 128, h = 24;
  let walls = rect(x, y - h, w, h) + rect(x + 46, y - h - 6, 36, 6), trim = '', sash = '', sign = '';
  trim += rect(x - 2, y - h - 2, w + 4, 3) + rect(x + 44, y - h - 8, 40, 3);
  for (const px of [x, x + 30, x + 46, x + 82, x + 98, x + w - 3]) trim += rect(px, y - h, 3, h);
  for (const wx of [x + 8, x + 18, x + 106, x + 116]) sash += rect(wx, y - 17, 7, 10);
  sash += rect(x + 58, y - 18, 12, 18); // the door
  sign += rect(x + 6, y - h + 2, 22, 4) + rect(x + 100, y - h + 2, 22, 4);
  return { walls, trim, sash, sign, platform: rect(x - 20, y, w + 40, 3) };
}

/** The depot's water tower: a red wooden tank on a red timber frame, with a white diamond sign. */
function waterTower(x, y) {
  return {
    red: rect(x - 12, y - 56, 24, 18) + poly([[x - 14, y - 56], [x, y - 64], [x + 14, y - 56]])
      + poly([[x - 11, y - 38], [x - 8, y - 38], [x - 12, y], [x - 15, y]]) + poly([[x + 8, y - 38], [x + 11, y - 38], [x + 15, y], [x + 12, y]]),
    brace: `M${x - 11},${y - 34}L${x + 12},${y - 6}M${x + 11},${y - 34}L${x - 12},${y - 6}M${x - 12},${y - 20}h24`,
    sign: poly([[x, y - 52], [x + 4, y - 47], [x, y - 42], [x - 4, y - 47]]),
  };
}

/** Sea glass glinting on the beach below the bluff: mostly white and brown, some green, the odd cobalt. */
function seaGlass() {
  const r = rng(99), out = { g1: '', g2: '', g3: '', g4: '' };
  for (let i = 0; i < 90; i++) {
    const x = 1236 + r() * 420, y = 668 + r() * 24, k = r();
    out[k < 0.45 ? 'g1' : k < 0.72 ? 'g2' : k < 0.95 ? 'g3' : 'g4'] += circle(x, y, 0.9 + r() * 1.2);
  }
  return out;
}

/** Spring wildflowers on the bluff tops: poppies, yellow, lupine and sea thrift. */
function flowers() {
  const r = rng(31), out = ['', '', '', ''];
  for (let i = 0; i < 120; i++) {
    const x = r() < 0.6 ? 1180 + r() * 470 : -40 + r() * 520;
    const y = x > 1100 ? 626 + r() * 30 : 628 + r() * 26;
    out[i % 4] += circle(x, y, 1 + r() * 0.9);
  }
  return out;
}

// ---------------------------------------------------------------- assemble
const st = stars();
const lh = lighthouse();
const nb = noyoBridge();
const ss = seaStacks();
const bt = boat(1318, 556);
const wh = whale(1140, 546);
const tw = town();
const tr = train(700);
const ts = trestle(470, 1250);
const dp = depot(1296, RAIL - 2);
const wt = waterTower(1452, RAIL - 2);
const sg = seaGlass();
const fl = flowers();
const cyp = rng(12);

// Redwoods may stand tall at the left edge, but behind the words they stay below the text (y 419).
const midCap = x => (x < 430 ? 250 : 452);
const midStand = stand(21, { x0: -60, x1: 560, base: profile([[-60, 610], [300, 604], [460, 612], [560, 640]]), h: [110, 240], w: [26, 40], gap: [18, 34], cap: midCap });
const nearLeft = profile([[-60, RAIL + 2], [450, RAIL + 2], [505, RAIL + 14], [560, WATER + 6]]);
const nearRight = profile([[1170, WATER + 6], [1226, RAIL + 8], [1262, RAIL + 1], [W + 60, RAIL + 1]]);
const giants = (() => {
  const r = rng(33);
  let foliage = '', trunks = '';
  for (const [x, h, w] of [[-14, 720, 118], [112, 600, 92], [236, 470, 70]]) {
    const [fo, tr] = redwood(r, x, 704, h, w, 0.36);
    foliage += fo; trunks += tr;
  }
  return { foliage, trunks };
})();

let cypresses = '';
for (const [x, s] of [[1498, 1.1], [1556, 0.9], [1612, 1.2]]) cypresses += cypress(cyp, x, RAIL + 2, s);

const svg = `<svg class="scene-svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMax slice" xmlns="http://www.w3.org/2000/svg" role="presentation" focusable="false">
<defs>
<linearGradient id="sky-g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" style="stop-color:var(--sky-top)"/><stop offset=".55" style="stop-color:var(--sky-mid)"/><stop offset="1" style="stop-color:var(--sky-bot)"/></linearGradient>
<radialGradient id="sun-glow"><stop offset="0" style="stop-color:var(--sun-glow);stop-opacity:.85"/><stop offset=".35" style="stop-color:var(--sun-glow);stop-opacity:.28"/><stop offset="1" style="stop-color:var(--sun-glow);stop-opacity:0"/></radialGradient>
<radialGradient id="moon-glow"><stop offset="0" style="stop-color:#dfe8ff;stop-opacity:.35"/><stop offset="1" style="stop-color:#dfe8ff;stop-opacity:0"/></radialGradient>
<linearGradient id="sea-g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" style="stop-color:var(--sea-top)"/><stop offset="1" style="stop-color:var(--sea-bot)"/></linearGradient>
<linearGradient id="beam-g" x1="1" y1="0" x2="0" y2="0"><stop offset="0" style="stop-color:#fff3c4;stop-opacity:.75"/><stop offset="1" style="stop-color:#fff3c4;stop-opacity:0"/></linearGradient>
<clipPath id="moon-clip"><circle cx="0" cy="0" r="22"/></clipPath>
</defs>
<rect width="${W}" height="${H}" fill="url(#sky-g)"/>
<g class="stars">${st.plain}<g class="twinkle">${st.twinkle}</g></g>
<g id="sun" class="sun" transform="translate(1180 300)"><circle r="190" fill="url(#sun-glow)"/><circle r="30" class="sun-disk"/></g>
<g id="moon" class="moon" transform="translate(1260 130)"><circle r="80" fill="url(#moon-glow)"/><g clip-path="url(#moon-clip)"><circle r="22" class="moon-disk"/><circle id="moon-shade" r="22" cx="10" class="moon-shade"/></g></g>
<g class="clouds">
<g class="cloud c1">${cloud(260, 150, 1.1, 3)}</g>
<g class="cloud c2">${cloud(320, 50, 0.8, 5)}</g>
<g class="cloud c3">${cloud(1310, 200, 1.0, 9)}</g>
<g class="cloud c4">${cloud(1460, 120, 0.75, 13)}</g>
</g>
<g class="layer layer-far" data-depth="0.06">
<rect class="sea" x="700" y="${HORIZON}" width="${W - 700 + 60}" height="${FLOOR - HORIZON}" fill="url(#sea-g)"/>
<path class="sea-shine" d="M1000,540h60M1150,552h90M1330,544h50M1440,560h110M1100,590h70M1300,600h120M1480,620h60"/>
<g class="whale"><path class="whale-back" d="${wh.back}"/><g class="whale-spout">${wh.spout}</g></g>
<g class="fog">${fogBank(8)}</g>
<path class="far" d="${ridge(11, farBase, { x1: 910, fur: [2, 6] })}"/>
<path class="lighthouse" d="${lh.walls}"/><path class="lighthouse-roof" d="${lh.roof}"/>
<circle class="beacon" cx="${lh.lamp[0]}" cy="${lh.lamp[1]}" r="2.2"/>
</g>
<g class="layer layer-hills" data-depth="0.12">
<path class="hill-far" d="${ridge(15, hillBase, { x1: 770, fur: [3, 9] })}"/>
<path class="bridge-piers" d="${nb.piers}"/>
<path class="bridge-deck" d="${nb.deck}${nb.posts}"/>
<path class="bridge-lamps" d="${nb.lamps}"/>
<path class="rock" d="${ss.rock}"/>
<path class="surf" d="${ss.surf}"/>
<path class="boat-wake" d="${bt.wake}"/>
<path class="boat-rig" d="${bt.rig}"/>
<path class="p-white" d="${bt.hull}${bt.cabin}"/>
<path class="boat-glass" d="${bt.glass}"/>
</g>
<g class="layer layer-town" data-depth="0.18">
<path class="grass" d="${ridge(17, terraceBase, { x1: 1030, step: [10, 20], fur: [0.5, 2] })}"/>
<path class="bluff" d="M990,578C1004,586 1008,600 1014,612C1020,626 1026,636 1034,648L1034,${FLOOR}L990,${FLOOR}Z"/>
<path class="houses" d="${tw.walls}"/>
<path class="p-white houses-light" d="${tw.light}"/>
<path class="roofs" d="${tw.roofs}"/>
<path class="windows house-windows" d="${tw.wins}"/>
<g class="holiday-lights">${tw.lights}</g>
</g>
<g class="layer layer-mid" data-depth="0.24">
<path class="hill-mid" d="${midStand.trees}"/>
</g>
<g class="layer layer-near" data-depth="0.3">
<rect class="creek" x="440" y="${WATER - 4}" width="800" height="${FLOOR - WATER + 4}" fill="url(#sea-g)"/>
<path class="creek-shine" d="M520,${WATER + 6}h60M640,${WATER + 14}h90M800,${WATER + 7}h50M900,${WATER + 18}h110M1060,${WATER + 9}h70"/>
<path class="hill-near" d="${ridge(41, nearLeft, { x1: 580, step: [8, 16], fur: [0, 1.5] })}"/>
<path class="grass" d="${ridge(43, nearRight, { x0: 1160, step: [8, 16], fur: [0, 1.5] })}"/>
<path class="hill-mid" d="${cypresses}"/>
<g class="flowers"><path class="f0" d="${fl[0]}"/><path class="f1" d="${fl[1]}"/><path class="f2" d="${fl[2]}"/><path class="f3" d="${fl[3]}"/></g>
<path class="beach" d="M1226,${FLOOR}L1240,676C1320,664 1460,662 ${W + 60},666L${W + 60},${FLOOR}Z"/>
<g class="sea-glass"><path class="g1" d="${sg.g1}"/><path class="g2" d="${sg.g2}"/><path class="g3" d="${sg.g3}"/><path class="g4" d="${sg.g4}"/></g>
<path class="p-depot" d="${dp.walls}"/><path class="p-depot-trim" d="${dp.trim}"/><path class="p-sash" d="${dp.sash}"/><path class="p-maroon" d="${dp.sign}"/>
<path class="windows depot-windows" d="${dp.sash}"/>
<path class="p-iron" d="${dp.platform}"/>
<path class="p-tower" d="${wt.red}"/><path class="tower-brace" d="${wt.brace}"/><path class="p-white" d="${wt.sign}"/>
<path class="p-timber" d="${ts.timber}"/>
<path class="trestle-brace" d="${ts.brace}"/>
<path class="rail" d="M-60,${RAIL + 1}H${W + 60}"/>
<g class="train">
<path class="p-maroon" d="${tr.body}"/>
<path class="p-coach" d="${tr.coach}"/>
<path class="p-shade" d="${tr.shade}"/>
<path class="p-roof" d="${tr.roof}"/>
<path class="p-glass" d="${tr.glass}"/>
<path class="windows train-windows" d="${tr.lit}"/>
<path class="p-coat1" d="${tr.coat1}"/><path class="p-coat2" d="${tr.coat2}"/><path class="p-coat3" d="${tr.coat3}"/><path class="p-coat4" d="${tr.coat4}"/>
<path class="p-skin1" d="${tr.skin1}"/><path class="p-skin2" d="${tr.skin2}"/><path class="p-hair" d="${tr.hair}"/>
<path class="p-coach" d="${tr.side}"/><path class="p-shade" d="${tr.sideTop}"/>
<path class="p-iron" d="${tr.iron}"/>
<path class="truss-rod" d="${tr.rod}"/>
<path class="p-hub" d="${tr.hub}"/>
<path class="p-trim" d="${tr.trim}"/>
<path class="p-gold" d="${tr.gold}"/>
<path class="p-cream" d="${tr.cream}"/>
<path class="headlight" d="${tr.beam}" fill="url(#beam-g)"/>
</g>
</g>
<g class="layer layer-front" data-depth="0.4">
<path class="canopy-front" d="${giants.foliage}"/>
<path class="p-bark" d="${giants.trunks}"/>
<path class="canopy-front" d="${brush(61, profile([[-60, 660], [380, 664], [470, 690]]), { x1: 480, h: [8, 22], w: [18, 40] })}"/>
<path class="canopy-front" d="${brush(63, profile([[1200, 700], [1300, 684], [W + 60, 690]]), { x0: 1200, h: [6, 16], w: [16, 34] })}"/>
<path class="canopy-front" d="${ridge(57, profile([[-60, 690], [300, 694], [420, 712], [1300, 716], [1420, 704], [W + 60, 698]]), { step: [10, 22], fur: [3, 12] })}"/>
</g>
</svg>`;

const html = fs.readFileSync(INDEX, 'utf8');
const re = /<!-- HERO:START -->[\s\S]*?<!-- HERO:END -->/;
if (!re.test(html)) { console.error('index.html is missing the HERO markers'); process.exit(1); }
fs.writeFileSync(INDEX, html.replace(re, `<!-- HERO:START -->\n${svg}\n<!-- HERO:END -->`));
console.log(`hero: ${(svg.length / 1024).toFixed(1)} KB -> index.html`);

// index.html changed, so refresh the offline copy's fingerprint in sw.js.
await import('./build-offline.mjs').then(m => m.buildOffline());
