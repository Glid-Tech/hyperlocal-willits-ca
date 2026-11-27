// The offline copy (sw.js) and the home-screen app (site.webmanifest).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { offlineFiles, offlineVersion } from '../tools/build-offline.mjs';
import { CONFIG } from '../assets/js/config.js';

const read = f => fs.readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');

test('sw.js saves every file the site needs, and its fingerprint is current', () => {
  const src = read('sw.js');
  const core = JSON.parse(src.match(/const CORE = (\[[\s\S]*?\]);/)[1].replace(/'/g, '"'));
  assert.deepEqual(core, offlineFiles(), 'run: node tools/build-offline.mjs');
  assert.equal(src.match(/const VERSION = '([^']+)'/)[1], offlineVersion(), 'a site file changed: run node tools/build-offline.mjs');
});

test('the offline copy includes the page, every script and the listings', () => {
  const files = offlineFiles();
  for (const f of ['./', 'data/businesses.json', 'assets/css/app.css', 'directory.html', '404.html']) assert.ok(files.includes(f), f);
  for (const js of fs.readdirSync(new URL('../assets/js/', import.meta.url)).filter(f => f.endsWith('.js'))) assert.ok(files.includes(`assets/js/${js}`), js);
});

test('the manifest can be installed as an app that opens full screen', () => {
  const m = JSON.parse(read('site.webmanifest'));
  assert.equal(m.display, 'standalone');
  assert.equal(m.start_url, './');
  assert.equal(m.scope, './');
  assert.ok(m.name && m.short_name && m.short_name.length <= 12, 'short_name fits under the icon');
  for (const size of ['192x192', '512x512']) assert.ok(m.icons.some(i => i.sizes === size && i.purpose === 'any'), size);
  for (const i of m.icons) assert.ok(fs.existsSync(new URL(`../${i.src}`, import.meta.url)), i.src);
});

test('the page links the manifest and the iPhone home-screen details', () => {
  const html = read('index.html');
  assert.match(html, /<link rel="manifest" href="site\.webmanifest">/);
  assert.match(html, /<link rel="apple-touch-icon" href="assets\/img\/apple-touch-icon\.png">/);
  assert.match(html, /apple-mobile-web-app-title" content="Willits"/);
  // The home-screen name is the same everywhere: the manifest, the iPhone title and the app's install steps (CONFIG.shortName).
  const shortName = JSON.parse(read('site.webmanifest')).short_name;
  assert.equal(shortName, CONFIG.shortName, 'site.webmanifest short_name = CONFIG.shortName');
  assert.match(html, new RegExp(`apple-mobile-web-app-title" content="${shortName}"`));
});
