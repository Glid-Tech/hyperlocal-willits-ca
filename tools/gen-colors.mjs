// Generates accessible category colour sets from OKLCH hues (prints JSON).
// Usage: node tools/gen-colors.mjs
// Each category gets: light tile bg/fg, dark tile bg/fg, and a map marker colour,
// with WCAG contrast ratios checked so labels and icons stay readable.

const HUES = {
  restaurants: 32, 'cafes-treats': 62, groceries: 140, health: 198, dental: 222, 'eye-care': 248,
  beauty: 352, fitness: 18, home: 78, auto: 262, pets: 48, kids: 100, shopping: 322, errands: 182,
  money: 158, professional: 278, 'real-estate': 115, 'hotels-events': 300, 'arts-fun': 338,
  community: 232, senior: 290,
};

function oklchToRgb(L, C, h) {
  const hr = (h * Math.PI) / 180;
  const a = C * Math.cos(hr), b = C * Math.sin(hr);
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.291485548 * b;
  const l = l_ ** 3, m = m_ ** 3, s = s_ ** 3;
  let r = 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s;
  let g = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s;
  let bl = -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s;
  const enc = x => { x = Math.min(1, Math.max(0, x)); return x <= 0.0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - 0.055; };
  return [enc(r), enc(g), enc(bl)];
}
const hex = rgb => '#' + rgb.map(x => Math.round(x * 255).toString(16).padStart(2, '0')).join('');
const lum = rgb => { const f = x => (x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4); const [r, g, b] = rgb.map(f); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const contrast = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

const out = {}; const warn = [];
for (const [id, h] of Object.entries(HUES)) {
  const lbg = oklchToRgb(0.955, 0.035, h), lfg = oklchToRgb(0.43, 0.115, h);
  const dbg = oklchToRgb(0.31, 0.045, h), dfg = oklchToRgb(0.86, 0.085, h);
  const pin = oklchToRgb(0.58, 0.14, h);
  const c1 = contrast(lbg, lfg), c2 = contrast(dbg, dfg), cpin = contrast(pin, [1, 1, 1]);
  if (c1 < 4.5 || c2 < 4.5) warn.push(`${id}: light ${c1.toFixed(2)} dark ${c2.toFixed(2)}`);
  out[id] = { hue: h, light: { bg: hex(lbg), fg: hex(lfg) }, dark: { bg: hex(dbg), fg: hex(dfg) }, pin: hex(pin), contrast: { light: +c1.toFixed(2), dark: +c2.toFixed(2), pinOnWhite: +cpin.toFixed(2) } };
}
console.log(JSON.stringify(out, null, 1));
if (warn.length) console.error('LOW CONTRAST:\n' + warn.join('\n'));
