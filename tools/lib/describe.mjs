// The one-line description shown on every listing. It is always written by us from the published
// facts (kind of business, street or shopping center, neighborhood) and never copied from anywhere.
import { CATEGORY_BY_ID } from '../../assets/js/taxonomy.js';

export function describe(r, areas = []) {
  const area = areas.find(a => a.id === r.area);
  const street = String(r.address || '').replace(/^\d+(?:\s*-?\s*[a-z])?\s+/i, ''); // "8347-A Greensboro Drive" -> "Greensboro Drive"
  const where = r.center ? `at ${r.center}` : street ? `on ${street}` : 'in Fort Bragg';
  const inArea = area && area.id !== 'elsewhere' && !r.center ? ` in ${area.name}` : '';
  return `${r.sub || CATEGORY_BY_ID[r.category]?.short || 'Business'} ${where}${inArea}.`;
}
