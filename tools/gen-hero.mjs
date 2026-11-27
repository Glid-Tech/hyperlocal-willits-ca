#!/usr/bin/env node
// Generate the layered hero landscape (inline SVG) and paste it into index.html
// between <!-- HERO:START --> and <!-- HERO:END -->.
//
//   node tools/gen-hero.mjs
//
// An original illustration of Willits at golden hour, looking south down Little Lake Valley: the oak-dotted east
// hills on the left, where the sun rises, and the redwood and fir ridge of the Coast Range on the right, where it
// sets just behind the ridge line. On the valley floor stand a small Main Street with a steel arch over it (its
// lettering drawn as plain blocks and dashes) and the Craftsman redwood depot (its sign boards left blank). In front
// of them a maroon diesel with yellow trim, a coach and an open car leave town heading west for the ridge, about to
// cross a short trestle over the creek. Redwoods frame the left edge and valley oaks the right. Colours were taken
// from CC-licensed Wikimedia Commons photos, as reference only (notes/research/hero-colours.md); nothing is copied
// from the railroad's or the city's logos or artwork.
//
// All colours are CSS variables, so assets/js/sky.js can repaint the scene for the time of day and the season:
// green grass and valley fog with snow on the ridge in winter, poppies and lupine in spring, gold grass in summer,
// straw and yellow creekside trees in fall. The hero's text sits in x 440-1155, y 60-419 of the scene
// (tests/skymap-review.test.mjs), so nothing tall reaches up there: only the sky is behind the words. Phones show
// only about x 640-960, so the depot, the arch and the train all sit in that band, low in the frame.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const INDEX = path.join(ROOT, 'index.html');
const W = 1600, H = 720;
const HORIZON = 526; // the 0° line: sky.js sets the sun here at sunset, behind the western ridge (y 490-515)
const VALLEY = 588; // the valley floor where Main Street and the depot stand
const RAIL = 624; // top of the rails the train runs on
const WATER = 664; // the creek in front of the embankment
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

/**
 * The tips of the same ridge's fur (same seed and options, so it follows the same furred line) down to `depth` below
 * its base line (a negative depth stops above it): a dusting of snow on the treetops, from x `from` on.
 */
function ridgeCap(seed, base, { x0 = -60, x1 = W + 60, step = [5, 11], fur = [2, 7] } = {}, depth = 3, from = x0) {
  const r = rng(seed);
  let x = x0;
  const top = [[x0, base(x0)]];
  while (x < x1) {
    const w = between(r, step), nx = Math.min(x + w, x1);
    top.push([x + w / 2, base(x + w / 2) - between(r, fur)], [nx, base(nx)]);
    x = nx;
  }
  const pts = top.filter(([px]) => px >= from);
  return poly([...pts, ...pts.map(([px]) => [px, base(px) + depth]).reverse()]);
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

/** A valley oak: a broad, low dome of rounded lumps on a short, stout trunk that forks into spreading limbs. */
function oak(r, x, base, s) {
  const cw = (64 + r() * 18) * s, ch = (34 + r() * 8) * s, crownY = base - 20 * s;
  let crown = '';
  for (let i = 0; i < 7; i++) {
    const t = i / 6, cx = x - cw / 2 + t * cw + (r() - 0.5) * 6 * s;
    const lift = Math.sin(t * Math.PI) * ch * 0.55, rad = (10 + Math.sin(t * Math.PI) * 9 + r() * 4) * s;
    crown += circle(cx, crownY - lift - rad * 0.3, rad);
  }
  crown += circle(x, crownY - ch * 0.62, ch * 0.42);
  const trunk = poly([[x - 3.2 * s, base], [x + 3.2 * s, base], [x + 2 * s, crownY + 2 * s], [x - 2 * s, crownY + 2 * s]])
    + poly([[x - 1.5 * s, crownY + 4 * s], [x + 0.5 * s, crownY + 4 * s], [x - cw * 0.28, crownY - 6 * s], [x - cw * 0.28 - 2 * s, crownY - 5 * s]])
    + poly([[x - 0.5 * s, crownY + 4 * s], [x + 1.5 * s, crownY + 4 * s], [x + cw * 0.3 + 2 * s, crownY - 5 * s], [x + cw * 0.3, crownY - 6 * s]]);
  return { crown, trunk };
}

/** A creekside tree (willow, ash, cottonwood): a tall, rounded clump of foliage. Yellow in fall (app.css .fall-leaves). */
function creekTree(r, x, base, h, w) {
  let d = '';
  const n = 4;
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1), y = base - h * 0.28 - t * h * 0.5, rad = (w / 2) * (1 - t * 0.35) * (0.8 + r() * 0.3);
    d += circle(x + (r() - 0.5) * w * 0.3, y, rad);
  }
  return d + rect(x - 1.2, base - h * 0.3, 2.4, h * 0.3);
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

/** Low valley fog: soft, flat banks lying on the valley floor at the foot of the hills (thickest on winter mornings). */
function valleyFog(seed) {
  const r = rng(seed);
  let out = '';
  for (let x = 240; x < W + 60; x += 40 + r() * 34) {
    out += `<ellipse cx="${f(x)}" cy="${f(VALLEY - 26 + r() * 12)}" rx="${f(56 + r() * 70)}" ry="${f(5 + r() * 7)}"/>`;
  }
  return out;
}

// ---------------------------------------------------------------- the valley and its ridges
// The far hills at the south end of the valley, and the higher Coast Range behind the western ridge.
const FAR = { x1: W + 60, step: [7, 15], fur: [1, 3.5] };
const farBase = profile([[-60, 470], [160, 482], [360, 500], [560, 512], [700, 507], [840, 514], [980, 509], [1100, 503], [1220, 500], [1350, 494], [1490, 490], [W + 60, 474]]);
// The western ridge: redwood and fir. Its line runs y 490-515 across x 1100-1490, so the sun sets just behind it.
const WEST = { x0: 860, fur: [3, 9], step: [4, 9] };
const westBase = profile([[860, 572], [960, 545], [1060, 516], [1150, 506], [1250, 501], [1350, 506], [1440, 497], [1530, 486], [W + 60, 472]]);
// The east hills: oak savanna, grass coloured by the season and hazed by distance, falling to the valley floor.
const EAST = { x1: 760, step: [10, 20], fur: [0.5, 2] };
const eastBase = profile([[-60, 452], [100, 446], [230, 462], [350, 470], [450, 488], [550, 513], [650, 540], [760, 566]]);

/** Oaks dotted over the east hills: small dark crowns, thicker in the draws lower down. */
function oakDots() {
  const r = rng(71);
  let d = '';
  for (let i = 0; i < 70; i++) {
    const x = -50 + r() * 760, top = eastBase(x) + 4, y = top + r() * Math.min(60, VALLEY - 12 - top);
    if (y > VALLEY - 10) continue;
    d += circle(x, y, 1.2 + r() * 1.8);
  }
  return d;
}

/** The Willits Bypass viaduct (US 101), a long, low concrete deck across the east side of the valley. */
function viaduct() {
  const x0 = 300, x1 = 560, deck = VALLEY - 26, depth = 4;
  let piers = '';
  for (let px = x0 + 14; px < x1 - 6; px += 26) piers += rect(px - 1.6, deck + depth, 3.2, 22);
  return { deck: rect(x0, deck, x1 - x0, depth) + rect(x0, deck - 1.6, x1 - x0, 1), piers };
}

// ---------------------------------------------------------------- Main Street
const valleyBase = profile([[-60, VALLEY + 4], [400, VALLEY + 1], [700, VALLEY], [1000, VALLEY], [1200, VALLEY + 2], [W + 60, VALLEY + 6]]);

function town() {
  // [x, ground y, width, wall height, roof: 'gable' | 'flat' | 'false-front' | 'cornice', walls: 'light' | 'house' | 'brick']
  const blocks = [
    [470, 590, 22, 11, 'gable', 'light'], [496, 590, 26, 12, 'gable', 'house'], [526, 590, 24, 10, 'gable', 'light'],
    [556, 590, 22, 12, 'gable', 'house'], [768, 588, 17, 21, 'false-front', 'light'],
    [896, 588, 30, 26, 'cornice', 'brick'], [928, 588, 26, 19, 'false-front', 'light'], [956, 588, 34, 22, 'flat', 'house'],
    [992, 589, 24, 14, 'gable', 'light'], [1020, 589, 30, 12, 'gable', 'house'], [1054, 590, 24, 11, 'gable', 'light'],
    [1082, 590, 22, 10, 'gable', 'house'],
  ];
  const out = { house: '', light: '', brick: '', roofs: '', trim: '', wins: '', lights: '' };
  let bulb = 0;
  const r = rng(77);
  for (const [x, y, w, h, roof, walls] of blocks) {
    const top = y - h;
    out[walls] += rect(x, top, w, h + 4);
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
    } else if (roof === 'cornice') {
      // A brick commercial block: a stepped cornice and a band between the storeys.
      out.trim += rect(x - 1.5, top - 3, w + 3, 3) + rect(x + w * 0.3, top - 5, w * 0.4, 2) + rect(x, top + h * 0.48, w, 1.2);
    } else {
      out.roofs += rect(x - 1, top - 2, w + 2, 2.4);
    }
    const rows = h >= 18 ? [top + 4, top + h * 0.56] : [top + 4];
    for (const wy of rows) for (let wx = x + 4; wx + 4 < x + w - 2; wx += 8) if (r() < 0.75) out.wins += rect(wx, wy, 4, wy === top + 4 ? 4 : 5);
  }
  return out;
}

/** Points along a quadratic curve, offset `off` to one side. */
function quad([x0, y0], [cx, cy], [x1, y1], n, off = 0) {
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n, u = 1 - t;
    const x = u * u * x0 + 2 * u * t * cx + t * t * x1, y = u * u * y0 + 2 * u * t * cy + t * t * y1;
    const dx = 2 * u * (cx - x0) + 2 * t * (x1 - cx), dy = 2 * u * (cy - y0) + 2 * t * (y1 - cy), len = Math.hypot(dx, dy) || 1;
    pts.push([x - (dy / len) * off, y + (dx / len) * off]);
  }
  return pts;
}
const line = pts => `M${pts.map(([x, y]) => `${f(x)},${f(y)}`).join('L')}`;

/**
 * The arch over Main Street, seen face on down the street: two tall needle pylons, steel lattice arches that cross on
 * their way to a long name board, and a curved banner under it. The board's lettering is plain blocks and the
 * banner's is dashes (no text, no seal or emblem; the round end panels are left blank). Bulbs light up after dark.
 */
function willitsArch(cx, ground) {
  const o = { steel: '', truss: '', lattice: '', rim: '', panel: '', banner: '', letters: '', bulbs: '' };
  // The board hangs about a third of the way up the pylons, as on the real arch, so it shows above the train.
  const x0 = cx - 36, x1 = cx + 36, y0 = ground - 54, y1 = ground - 40, yc = (y0 + y1) / 2;
  for (const s of [-1, 1]) {
    const x = cx + s * 52;
    o.steel += poly([[x - 2.4, ground], [x + 2.4, ground], [x + 0.9, ground - 66], [x, ground - 132], [x - 0.9, ground - 66]]);
    // Two lattice arches each side, crossing between the pylon and the board.
    for (const [a, c, b] of [
      [[cx + s * 68, ground - 16], [cx + s * 56, ground - 38], [cx + s * 35, ground - 47]],
      [[cx + s * 64, ground - 48], [cx + s * 48, ground - 40], [cx + s * 28, ground - 31]],
    ]) {
      const outer = quad(a, c, b, 10, 1.4), inner = quad(a, c, b, 10, -1.4);
      o.truss += line(outer) + line(inner);
      o.lattice += line(outer.map((p, i) => (i % 2 ? inner[i] : p)));
    }
  }
  const board = (ax, ay, bx, by, m) => `M${f(ax)},${f((ay + by) / 2)}L${f(ax + 6)},${f(ay)}Q${f(cx)},${f(ay - 4 - m)} ${f(bx - 6)},${f(ay)}L${f(bx)},${f((ay + by) / 2)}L${f(bx - 6)},${f(by)}Q${f(cx)},${f(by - 3 - m)} ${f(ax + 6)},${f(by)}Z`;
  o.rim = board(x0 - 1.8, y0 - 1.8, x1 + 1.8, y1 + 1.8, 0.4);
  o.panel = board(x0, y0, x1, y1, 0);
  o.letters += circle(x0 + 7.5, yc, 4) + circle(x1 - 7.5, yc, 4); // blank round end panels
  // The name as seven plain blocks: a wide one, narrow ones and middling ones.
  const widths = [6.4, 2, 4.1, 4.1, 2, 4.6, 4.6], gap = 2;
  let lx = cx - (widths.reduce((a, b) => a + b, 0) + gap * (widths.length - 1)) / 2;
  for (const w of widths) { o.letters += rect(lx, yc - 3.8, w, 7.4); lx += w + gap; }
  // The banner below, bowed like a smile, with its slogan as a row of dashes.
  const bx0 = cx - 29, bx1 = cx + 29, by0 = ground - 34, by1 = ground - 27;
  o.banner = `M${bx0},${by0}Q${cx},${by0 + 5} ${bx1},${by0}L${bx1},${by1}Q${cx},${by1 + 5} ${bx0},${by1}Z`;
  for (let dx = bx0 + 5; dx < bx1 - 5; dx += 2.3) {
    const t = (dx - bx0) / (bx1 - bx0), sag = 4 * t * (1 - t) * 2.5;
    o.letters += rect(dx, by0 + 2.2 + sag, 1.2, 2.4);
  }
  // Bulbs along the top and bottom of the board.
  for (let bx = x0 + 6; bx <= x1 - 6; bx += 4) {
    const t = (bx - x0) / (x1 - x0), sag = 4 * t * (1 - t);
    o.bulbs += circle(bx, y0 - 1 - sag * 4.4, 0.75) + circle(bx, y1 + 1 - sag * 3.4, 0.75);
  }
  return o;
}

/**
 * The Willits depot (1915, Craftsman, redwood): a long, dark-stained building under a broad hipped roof with deep
 * eaves carried on posts, a shed dormer with a row of windows, a brick chimney, and a lower annex. Its sign boards
 * are left blank.
 */
function depot(x, y) {
  const o = { walls: '', trim: '', roof: '', sash: '', glass: '', brick: '', sign: '' };
  const win = (wx, wy, w, h) => { o.sash += rect(wx, wy, w, h); o.glass += rect(wx + 0.8, wy + 0.8, w - 1.6, h - 1.6); };
  // The annex.
  o.walls += rect(x, y - 12, 34, 12);
  o.roof += poly([[x - 3, y - 12], [x + 6, y - 20], [x + 28, y - 20], [x + 37, y - 12]]);
  win(x + 8, y - 9, 5, 5); win(x + 21, y - 9, 5, 5);
  // The main building: walls under the arcade, posts, the eave and the hipped roof.
  const m = x + 38, w = 118;
  o.walls += rect(m, y - 15, w, 15);
  for (let px = m - 4; px <= m + w + 2; px += 13) o.trim += rect(px, y - 15, 2, 15);
  o.trim += rect(m - 7, y - 17, w + 14, 2.2);
  o.roof += poly([[m - 8, y - 16], [m + 9, y - 32], [m + w - 9, y - 32], [m + w + 8, y - 16]]);
  for (let wx = m + 4; wx < m + w - 6; wx += 13) if (Math.round((wx - m) / 13) % 3 !== 1) win(wx + 1, y - 12, 6, 8);
  win(m + 57, y - 13, 5, 13); // the door
  // The shed dormer with its row of windows, and the chimney.
  o.walls += rect(m + 42, y - 38, 34, 7);
  o.roof += poly([[m + 40, y - 38], [m + 78, y - 38], [m + 78, y - 39.6], [m + 40, y - 41]]);
  for (let i = 0; i < 4; i++) win(m + 45 + i * 7.5, y - 36.5, 5, 4);
  o.brick += rect(m + 94, y - 42, 6, 12) + rect(m + 93, y - 43, 8, 1.6);
  // Blank sign boards: one under the eave at each end of the building.
  o.sign += rect(m + 2, y - 15, 14, 4) + rect(m + w - 16, y - 15, 14, 4);
  return o;
}

// ---------------------------------------------------------------- the Skunk Train
// Proportions from the GP9 diesel and heavyweight coaches the line runs, drawn facing left and then mirrored (see
// the assembly below) so the train heads right: west, out of Willits toward the Coast Range.
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

function train() {
  const p = { side: '', sideTop: '', body: '', shade: '', coach: '', roof: '', iron: '', hub: '', glass: '', lit: '', trim: '', gold: '', cream: '', rod: '', beam: '', skin1: '', skin2: '', hair: '', coat1: '', coat2: '', coat3: '', coat4: '' };
  locomotive(p, 0);
  coach(p, 126);
  openCar(p, 282);
  return p;
}

/** A short timber trestle: a deck on bents of posts, X-braced between them, standing in the creek. */
function trestle(x0, x1) {
  const top = RAIL + 3;
  let timber = rect(x0, top, x1 - x0, 6), brace = '';
  for (let x = x0 + 6; x <= x1 - 6; x += 28) {
    timber += poly([[x - 2, top + 6], [x + 2, top + 6], [x + 3.4, WATER + 6], [x - 3.4, WATER + 6]]);
    if (x + 28 <= x1 - 6) brace += `M${x},${top + 8}L${x + 28},${WATER - 6}M${x + 28},${top + 8}L${x},${WATER - 6}M${x},${(top + WATER) / 2 + 2}h28`;
  }
  return { timber, brace };
}

/** Spring wildflowers in the meadows: California poppies, goldfields, lupine and owl's clover. */
function flowers() {
  const r = rng(31), out = ['', '', '', ''];
  for (let i = 0; i < 150; i++) {
    const k = r();
    const [x, y] = k < 0.5 ? [1290 + r() * 360, RAIL + 8 + r() * 34]
      : k < 0.8 ? [-40 + r() * 400, RAIL + 8 + r() * 28]
        : [380 + r() * 640, RAIL + 6 + r() * 14];
    out[i % 4] += circle(x, y, 1 + r() * 0.9);
  }
  return out;
}

// ---------------------------------------------------------------- assemble
const st = stars();
const tw = town();
const tr = train();
const ARCH_X = 840; // Main Street, in the middle of the phone band (a 375px phone shows about x 680-920)
const ar = willitsArch(ARCH_X, VALLEY);
const dp = depot(610, VALLEY + 3);
const vd = viaduct();
const ts = trestle(1040, 1250);
const fl = flowers();
// The train, drawn facing left from x 0, mirrored and scaled to 0.85 about the rail so it heads right with its
// nose at about x 925: on a phone the coach and most of the locomotive show below the chips, the depot's roof and
// the arch above them.
const TS = 0.85, TRAIN_X = 919;
const trainTransform = `matrix(${-TS} 0 0 ${TS} ${TRAIN_X} ${f(RAIL * (1 - TS))})`;

// Redwoods may stand tall at the left edge, but behind the words they stay below the text (y 419).
const midCap = x => (x < 430 ? 250 : 452);
const midStand = stand(21, { x0: -60, x1: 470, base: profile([[-60, 610], [300, 604], [420, 612], [470, 630]]), h: [110, 240], w: [26, 40], gap: [18, 34], cap: midCap });
// Douglas firs at the foot of the western ridge, kept below the ridge line so the sunset stays in view.
const firs = (() => {
  const r = rng(25), base = profile([[1170, VALLEY + 3], [1440, VALLEY + 7]]);
  let d = '';
  for (let x = 1176; x < 1440; x += between(r, [14, 30])) {
    const y = base(x), h = Math.min(between(r, [40, 84]), y - 512);
    if (h > 24) d += redwood(r, x, y, h, between(r, [11, 16]), 0.12).join('');
  }
  return d;
})();
const nearLeft = profile([[-60, RAIL + 2], [330, RAIL + 2], [380, RAIL + 14], [420, WATER + 6]]);
const embank = profile([[360, RAIL + 2], [1028, RAIL + 2], [1046, RAIL + 22], [1060, WATER + 2]]);
const nearRight = profile([[1220, WATER + 6], [1262, RAIL + 10], [1292, RAIL + 2], [W + 60, RAIL + 2]]);
const giants = (() => {
  const r = rng(33);
  let foliage = '', trunks = '';
  for (const [x, h, w] of [[-14, 720, 118], [112, 600, 92], [236, 470, 70]]) {
    const [fo, trk] = redwood(r, x, 704, h, w, 0.36);
    foliage += fo; trunks += trk;
  }
  return { foliage, trunks };
})();

const oaks = { crown: '', trunk: '' }, smallOaks = { crown: '', trunk: '' };
{
  const r = rng(12);
  for (const [x, s] of [[1388, 1.0], [1478, 1.28], [1590, 1.12]]) { const o = oak(r, x, RAIL + 4, s); oaks.crown += o.crown; oaks.trunk += o.trunk; }
  for (const [x, s] of [[1134, 0.34], [1160, 0.42], [1452, 0.4], [1500, 0.32], [588, 0.3]]) { const o = oak(r, x, valleyBase(x) + 1, s); smallOaks.crown += o.crown; smallOaks.trunk += o.trunk; }
}
const creekside = (() => {
  const r = rng(51);
  let d = '';
  for (const [x, base, h, w] of [[1252, WATER + 2, 58, 24], [1276, WATER - 2, 50, 20], [1306, RAIL + 18, 44, 18], [392, WATER - 2, 46, 20], [414, WATER + 3, 54, 22]]) d += creekTree(r, x, base, h, w);
  return d;
})();

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
<path class="far" d="${ridge(11, farBase, FAR)}"/>
<path class="snow" d="${ridgeCap(11, farBase, FAR, 0.5, 1180)}"/>
</g>
<g class="layer layer-hills" data-depth="0.12">
<path class="grass" d="${ridge(15, eastBase, EAST)}"/>
<path class="haze" d="${ridge(15, eastBase, EAST)}"/>
<path class="oak-dots" d="${oakDots()}"/>
<path class="hill-far" d="${ridge(19, westBase, WEST)}"/>
<path class="snow" d="${ridgeCap(19, westBase, WEST, -2, 1120)}"/>
<path class="bridge-piers" d="${vd.piers}"/>
<path class="bridge-deck" d="${vd.deck}"/>
<g class="fog">${valleyFog(8)}</g>
</g>
<g class="layer layer-town" data-depth="0.18">
<path class="grass" d="${ridge(17, valleyBase, { step: [10, 20], fur: [0.5, 2] })}"/>
<path class="hill-mid" d="${smallOaks.crown}${smallOaks.trunk}"/>
<path class="fall-oaks" d="${smallOaks.crown}"/>
<path class="street" d="${poly([[ARCH_X - 10, VALLEY - 3], [ARCH_X + 10, VALLEY - 3], [ARCH_X + 46, VALLEY + 14], [ARCH_X - 46, VALLEY + 14]])}"/>
<path class="houses" d="${tw.house}"/>
<path class="p-white houses-light" d="${tw.light}"/>
<path class="p-brick" d="${tw.brick}"/>
<path class="roofs" d="${tw.roofs}"/>
<path class="p-depot-trim" d="${tw.trim}"/>
<path class="windows house-windows" d="${tw.wins}"/>
<g class="holiday-lights">${tw.lights}</g>
<path class="p-depot" d="${dp.walls}"/><path class="p-shingle" d="${dp.roof}"/><path class="p-depot-trim" d="${dp.trim}"/>
<path class="p-sash" d="${dp.sash}"/><path class="p-glass" d="${dp.glass}"/><path class="windows depot-windows" d="${dp.glass}"/>
<path class="p-brick" d="${dp.brick}"/><path class="p-cream" d="${dp.sign}"/>
<g class="arch">
<path class="p-arch" d="${ar.steel}"/>
<path class="arch-truss" d="${ar.truss}"/><path class="arch-lattice" d="${ar.lattice}"/>
<path class="p-arch-banner" d="${ar.rim}${ar.banner}"/><path class="p-arch-panel" d="${ar.panel}"/>
<path class="p-arch-letter" d="${ar.letters}"/>
<path class="arch-bulbs" d="${ar.bulbs}"/>
</g>
</g>
<g class="layer layer-mid" data-depth="0.24">
<path class="hill-mid" d="${midStand.trees}"/>
<path class="hill-far" d="${firs}"/>
</g>
<g class="layer layer-near" data-depth="0.3">
<rect class="creek" x="360" y="${WATER - 4}" width="980" height="${FLOOR - WATER + 4}" fill="url(#sea-g)"/>
<path class="creek-shine" d="M440,${WATER + 6}h60M600,${WATER + 14}h90M780,${WATER + 7}h50M900,${WATER + 18}h110M1100,${WATER + 9}h70"/>
<path class="hill-near" d="${ridge(41, nearLeft, { x1: 440, step: [8, 16], fur: [0, 1.5] })}"/>
<path class="grass" d="${ridge(45, embank, { x0: 360, x1: 1062, step: [8, 16], fur: [0, 1.5], bottom: WATER - 2 })}"/>
<path class="grass" d="${ridge(43, nearRight, { x0: 1210, step: [8, 16], fur: [0, 1.5] })}"/>
<path class="hill-near" d="${creekside}"/>
<path class="fall-leaves" d="${creekside}"/>
<path class="hill-mid" d="${oaks.crown}"/>
<path class="fall-oaks" d="${oaks.crown}"/>
<path class="canopy-front" d="${oaks.trunk}"/>
<g class="flowers"><path class="f0" d="${fl[0]}"/><path class="f1" d="${fl[1]}"/><path class="f2" d="${fl[2]}"/><path class="f3" d="${fl[3]}"/></g>
<path class="p-timber" d="${ts.timber}"/>
<path class="trestle-brace" d="${ts.brace}"/>
<path class="rail" d="M-60,${RAIL + 1}H${W + 60}"/>
<g class="train" transform="${trainTransform}">
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
