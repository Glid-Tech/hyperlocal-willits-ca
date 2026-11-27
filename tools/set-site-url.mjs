// Record the site's public address everywhere it's needed (share previews, search engines).
//
//   node tools/set-site-url.mjs https://your-name.github.io/willits-local/
//
// Updates assets/js/config.js (siteUrl), the share and canonical tags in index.html, the
// structured data, directory.html, robots.txt and sitemap.xml. Safe to run again.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const file = rel => path.join(ROOT, rel);
const read = rel => fs.readFileSync(file(rel), 'utf8');
const write = (rel, text) => { fs.writeFileSync(file(rel), text); console.log('updated', rel); };

let raw = (process.argv[2] || '').trim();
let url;
try { url = new URL(raw); } catch { url = null; }
if (!url || !/^https?:$/.test(url.protocol) || url.search || url.hash) {
  console.error('usage: node tools/set-site-url.mjs https://your-name.github.io/willits-local/');
  process.exit(1);
}
if (!url.pathname.endsWith('/')) url.pathname += '/';
const SITE = url.href;
const attr = s => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

// 1. config.js
{
  const s = read('assets/js/config.js');
  const next = s.replace(/siteUrl:\s*'[^']*'/, `siteUrl: '${SITE.replace(/'/g, "\\'")}'`);
  if (next === s && !s.includes(`siteUrl: '${SITE}'`)) throw new Error('siteUrl not found in config.js');
  write('assets/js/config.js', next);
}

// 2. index.html: canonical, og:url, absolute og:image / twitter:image, JSON-LD
{
  let s = read('index.html');
  const block = [
    '<!-- SITE-URL:START (written by tools/set-site-url.mjs) -->',
    `<link rel="canonical" href="${attr(SITE)}">`,
    `<meta property="og:url" content="${attr(SITE)}">`,
    `<meta name="twitter:image" content="${attr(SITE)}assets/img/og-image.png">`,
    '<!-- SITE-URL:END -->',
  ].join('\n');
  if (/<!-- SITE-URL:START[\s\S]*?SITE-URL:END -->/.test(s)) s = s.replace(/<!-- SITE-URL:START[\s\S]*?SITE-URL:END -->/, block);
  else s = s.replace(/(<meta name="twitter:card"[^>]*>)/, `$1\n${block}`);
  s = s.replace(/<meta property="og:image" content="[^"]*">/, `<meta property="og:image" content="${attr(SITE)}assets/img/og-image.png">`);
  s = s.replace(/(<script type="application\/ld\+json">\s*)([\s\S]*?)(\s*<\/script>)/, (m, a, json, b) => {
    const data = JSON.parse(json);
    data.url = SITE;
    if (data.potentialAction) data.potentialAction.target = `${SITE}?q={search_term_string}`;
    return a + JSON.stringify(data) + b;
  });
  write('index.html', s);
}

// 3. directory.html canonical
if (fs.existsSync(file('directory.html'))) {
  const s = read('directory.html');
  write('directory.html', s.replace(/<link rel="canonical" href="[^"]*">/, `<link rel="canonical" href="${attr(SITE)}directory.html">`));
}

// 4. robots.txt + sitemap.xml
write('robots.txt', `User-agent: *\nAllow: /\n\nSitemap: ${SITE}sitemap.xml\n`);
let built = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' }).format(new Date());
try { built = JSON.parse(read('data/businesses.json')).meta.built || built; } catch { /* keep today */ }
const urls = ['', 'directory.html'];
write('sitemap.xml', `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map(u => `  <url><loc>${attr(SITE + u)}</loc><lastmod>${built}</lastmod></url>`).join('\n')}\n</urlset>\n`);

console.log(`\nSite address set to ${SITE}`);

// index.html changed, so refresh the offline copy's fingerprint in sw.js.
await import('./build-offline.mjs').then(m => m.buildOffline());
