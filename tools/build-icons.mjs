#!/usr/bin/env node
// Build the inline SVG icon sprite and paste it into index.html between
// <!-- ICONS:START --> and <!-- ICONS:END -->.
//
//   node tools/build-icons.mjs
//
// Icons come from Lucide (ISC licence, tools/vendor-icons/LUCIDE-LICENSE.txt) plus a
// few drawn for this site (tooth, logo mark) in the same 24px, round-stroke style.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'tools/vendor-icons');
const INDEX = path.join(ROOT, 'index.html');

const CUSTOM = {
  // A molar: crown with two cusps, two roots.
  tooth: '<path d="M7.6 3.2c-2.6 0-4.3 2-4.3 4.7 0 2.1.7 3.5 1.5 5.1.7 1.4.9 3 1.2 4.6.3 1.7 1 3.2 2.2 3.2 1.4 0 1.7-1.7 2.1-3.4.3-1.3.7-2.2 1.7-2.2s1.4.9 1.7 2.2c.4 1.7.7 3.4 2.1 3.4 1.2 0 1.9-1.5 2.2-3.2.3-1.6.5-3.2 1.2-4.6.8-1.6 1.5-3 1.5-5.1 0-2.7-1.7-4.7-4.3-4.7-1.7 0-2.8.9-4.4.9S9.3 3.2 7.6 3.2z"/><path d="M9.3 6.4c.9.4 1.8.6 2.7.6"/>',
};

// Presentation attributes go on each symbol so <use> clones inherit them (CSS on .icon can override).
const ATTRS = ' fill="none" stroke="currentColor" stroke-width="1.85" stroke-linecap="round" stroke-linejoin="round"';
const names = fs.readdirSync(SRC).filter(f => f.endsWith('.svg')).map(f => f.replace(/\.svg$/, '')).sort();
const symbols = [];
for (const n of names) {
  const svg = fs.readFileSync(path.join(SRC, `${n}.svg`), 'utf8');
  const inner = svg.replace(/<!--[\s\S]*?-->/g, '').replace(/^[\s\S]*?<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '').replace(/\s*\n\s*/g, '').trim();
  symbols.push(`<symbol id="i-${n}" viewBox="0 0 24 24"${ATTRS}>${inner}</symbol>`);
}
for (const [n, inner] of Object.entries(CUSTOM)) symbols.push(`<symbol id="i-${n}" viewBox="0 0 24 24"${ATTRS}>${inner}</symbol>`);

const sprite = `<svg xmlns="http://www.w3.org/2000/svg" class="sprite" aria-hidden="true" focusable="false">\n${symbols.join('\n')}\n</svg>`;

const html = fs.readFileSync(INDEX, 'utf8');
const re = /<!-- ICONS:START -->[\s\S]*?<!-- ICONS:END -->/;
if (!re.test(html)) { console.error('index.html is missing the ICONS markers'); process.exit(1); }
fs.writeFileSync(INDEX, html.replace(re, `<!-- ICONS:START -->\n${sprite}\n<!-- ICONS:END -->`));
console.log(`sprite: ${symbols.length} icons -> index.html`);

// index.html changed, so refresh the offline copy's fingerprint in sw.js.
await import('./build-offline.mjs').then(m => m.buildOffline());
