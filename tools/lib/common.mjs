// Shared helpers for the directory's data tools.

export const STREET_SUFFIXES = [
  ['Rd', 'Road'], ['Dr', 'Drive'], ['St', 'Street'], ['Ave', 'Avenue'], ['Av', 'Avenue'], ['Blvd', 'Boulevard'],
  ['Ln', 'Lane'], ['Ct', 'Court'], ['Pl', 'Place'], ['Pkwy', 'Parkway'], ['Cir', 'Circle'], ['Hwy', 'Highway'],
  ['Ter', 'Terrace'], ['Sq', 'Square'], ['Tpke', 'Turnpike'], ['Trl', 'Trail'], ['Plz', 'Plaza'], ['Ctr', 'Center'],
];

/** "401 n main st." -> "401 North Main Street", "18100 hwy 20" -> "18100 Highway 20" (full words read better for older eyes). */
export function prettyStreet(addr) {
  if (!addr) return '';
  let s = String(addr).replace(/\s+/g, ' ').replace(/,.*$/, '').trim();
  if (/\bp\.?\s*o\.?\s*box\b/i.test(s)) return ''; // a mailing box is not a place to visit
  s = s.replace(/\b(suite|ste|unit|#)\s*[\w-]+$/i, '').trim();
  s = s.replace(/\./g, '');
  for (const [abbr, full] of STREET_SUFFIXES) s = s.replace(new RegExp(`\\b${abbr}\\b`, 'gi'), full);
  // State routes have many spellings ("CA-20", "SR 20", "State Hwy 20", "State Route 1"): use "Highway 20".
  s = s.replace(/\b(?:CA|SR|State\s+(?:Route|Highway))[\s-]*(\d{1,3})\b/i, 'Highway $1')
    // Highway 20 is also called the Fort Bragg-Willits Road, and the Boatyard Shopping Center's street is spelt both ways.
    .replace(/\bFort\s+Bragg[\s-]+Willits\s+(?:Road|Rd\.?)/i, 'Highway 20').replace(/\bBoat\s+Yard\b/i, 'Boatyard');
  s = s.replace(/\bHighway One\b/i, 'Highway 1');
  // A compass point after the house number is part of the street's name: "401 N Main St" -> "401 North Main Street".
  s = s.replace(/^(\d+(?:-?[A-Za-z]|-\d+)?\s+)([NSEW])\s+(?=\S)/i, (m, num, d) => num + { n: 'North', s: 'South', e: 'East', w: 'West' }[d.toLowerCase()] + ' ');
  // Title-case words that are all lower or all upper, keep things like "McKerricher".
  s = s.split(' ').map(w => /^\d+-?[a-z]$/i.test(w) ? w.toUpperCase() // a house number with a letter: 7917-B, 8377A
    : (w === w.toLowerCase() || w === w.toUpperCase()) && /[a-z]/i.test(w) ? w[0].toUpperCase() + w.slice(1).toLowerCase() : w).join(' ');
  return s.replace(/\bMc([a-z])/g, (m, c) => 'Mc' + c.toUpperCase()) // "Mckerricher" -> "McKerricher"
    .replace(/\b(Ii|Iii|Iv)\b/g, m => m.toUpperCase()) // "Building II"
    .replace(/(?<=\S )(At|Of|The)(?= )/g, w => w.toLowerCase());
}

/** Suite / unit pulled out of a free-form address, if present. */
export function extractUnit(addr) {
  const m = String(addr || '').match(/\b(suite|ste\.?|unit|#)\s*([\w-]+)\s*$/i);
  return m ? `Suite ${m[2]}` : '';
}

/** "+1-707-964-5555" / "7079645555" -> "(707) 964-5555"; '' if not a US number. */
export function formatPhone(raw) {
  if (!raw) return '';
  const first = String(raw).split(/[;,/]| or /)[0];
  let d = first.replace(/\D/g, '');
  if (d.length === 11 && d[0] === '1') d = d.slice(1);
  if (d.length !== 10) return '';
  return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
}

export function slugify(s) {
  return String(s || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/['’]/g, '').replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
}

/** Clean a website URL: add https, drop tracking parameters and fragments. */
export function cleanUrl(u) {
  if (!u) return '';
  let s = String(u).trim().split(/[\s;]+/)[0];
  if (!/^https?:\/\//i.test(s)) s = 'https://' + s.replace(/^\/+/, '');
  try {
    const url = new URL(s);
    for (const k of [...url.searchParams.keys()]) if (/^(utm_|fbclid|gclid|y_source|mc_)/i.test(k)) url.searchParams.delete(k);
    url.hash = '';
    let out = url.toString();
    if (url.pathname === '/' && !url.search) out = out.replace(/\/$/, '');
    return out;
  } catch { return ''; }
}

const NAME_NOISE = new Set(['the', 'of', 'and', 'at', 'in', 'fort', 'ft', 'bragg', 'ca', 'california', 'llc', 'inc',
  'co', 'corp', 'ltd', 'pc', 'pllc', 'plc', 'dds', 'dmd', 'md', 'od', 'cpa', 'esq', 'company', 'restaurant', 'cafe',
  'store', 'shop', 'location', 'branch', 'office', 'group', 'associates']);

/** Tokens that identify a business name, minus legal suffixes and filler. */
export function nameTokens(name) {
  return String(name || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/['’]/g, '').replace(/&/g, ' and ')
    .split(/[^a-z0-9]+/).filter(t => t && !NAME_NOISE.has(t));
}

export function nameKey(name) { return nameTokens(name).join(' '); }

/** Similarity 0..1 between two business names (token overlap with a prefix-friendly twist). */
export function nameSimilarity(a, b) {
  const A = nameTokens(a), B = nameTokens(b);
  if (!A.length || !B.length) return 0;
  const ja = A.join(''), jb = B.join('');
  if (ja === jb) return 1;
  if (ja.length >= 5 && jb.length >= 5 && (ja.startsWith(jb) || jb.startsWith(ja))) return 0.85;
  const setB = new Set(B);
  const inter = A.filter(t => setB.has(t) || B.some(x => x.length >= 4 && t.length >= 4 && (x.startsWith(t) || t.startsWith(x)))).length;
  return inter / Math.max(A.length, B.length);
}

// Words that say where a place is or what kind of place it is, but not which business it is. Two names at one
// address that share only these (Noyo Harbor Inn and Noyo Fish Company, Wells Fargo Bank and Chase Bank, Coast
// Cinemas and Coast Dental) are different businesses.
const WEAK_TOKENS = new Set([
  'corner', 'center', 'centre', 'mall', 'plaza', 'square', 'shopping', 'village', 'station', 'depot',
  'tower', 'building', 'suite', 'ste', 'level', 'floor', 'unit', 'ii', 'north', 'south', 'east', 'west',
  'rd', 'road', 'dr', 'drive', 'st', 'street', 'ave', 'avenue', 'blvd', 'boulevard', 'ln', 'lane', 'hwy', 'highway',
  'way', 'pl', 'place', 'ct', 'court', 'main',
  'mendocino', 'coast', 'coastal', 'noyo', 'harbor', 'harbour', 'ocean', 'pacific', 'sea', 'seaside', 'beach', 'bay',
  'redwood', 'redwoods', 'cleone', 'glass', 'headlands',
  'bank', 'bakery', 'factory', 'express', 'pizza', 'dentistry', 'dental', 'dentist', 'smiles', 'smile', 'orthodontics',
  'eyecare', 'eye', 'vision', 'optical', 'health', 'healthcare', 'medical', 'medicine', 'pharmacy', 'clinic', 'care',
  'studio', 'studios', 'salon', 'spa', 'nails', 'nail', 'hair', 'beauty', 'barber', 'wellness', 'fitness', 'gym', 'yoga',
  'pilates', 'market', 'foods', 'food', 'grill', 'kitchen', 'bar', 'pub', 'lounge', 'coffee', 'tea', 'house', 'services',
  'service', 'cleaners', 'cleaning', 'auto', 'car', 'wash', 'mobile', 'wireless', 'phone', 'insurance', 'realty', 'real',
  'estate', 'law', 'legal', 'family', 'kids', 'children', 'learning', 'school', 'academy', 'primary', 'urgent',
  'physical', 'therapy',
]);
const identifying = t => t.length > 1 && !WEAK_TOKENS.has(t) && !/^\d{3,}$/.test(t);

/** True when two names share a word that identifies the business, not just its kind or where it is. */
export function sharesIdentifyingWord(a, b) {
  const A = nameTokens(a).filter(identifying), B = nameTokens(b).filter(identifying);
  return A.some(t => B.some(x => x === t || (x.length >= 4 && t.length >= 4 && (x.startsWith(t) || t.startsWith(x)))));
}

/** "401 North Main Street" -> "401 north main" for address matching. */
export function addressKey(addr) {
  const s = prettyStreet(addr).toLowerCase();
  const m = s.match(/^(\d+)[a-z]?\s+(.*)$/);
  if (!m) return '';
  // Highway 1's county addresses carry a direction ("North Highway 1") that the post office often leaves off; the
  // house numbers north and south of town don't overlap, so the number and the route are enough.
  const street = m[2].replace(/\b(?:north|south|east|west)\s+(?=highway\b)/g, '')
    .replace(/\b(road|drive|street|avenue|boulevard|lane|court|place|parkway|circle|highway|terrace|square|pike)\b/g, '').replace(/\s+/g, ' ').trim();
  return `${m[1]} ${street}`;
}

export function haversine(lat1, lon1, lat2, lon2) {
  const R = 6371000, toRad = x => (x * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1), dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

export function uniq(arr) { return [...new Set(arr.filter(Boolean))]; }
