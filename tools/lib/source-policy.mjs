// Where listing facts may come from. See data/SOURCES.md for the plain-English version.
//
// Facts (a business's name, address, phone, hours, website) are not protected by copyright in the
// United States (Feist v. Rural Telephone, 1991). What can be protected is other people's wording,
// photos, reviews and creative selections, and many websites' terms of service forbid collecting
// their data. So the directory only publishes facts that are backed by one of three kinds of source:
//
//   osm    OpenStreetMap, used under the Open Database License with attribution
//   first  the business's own website (including its parent brand's store pages)
//   gov    government websites and public records
//
// Everything else is "other". Some of it (local news, shopping-center directories, the chamber of
// commerce) may be read to learn that a business exists, but no fact is ever published from it.
// The sites in NEVER_VISIT are not used at all, not even as tips.

export const SOURCE_KINDS = ['osm', 'first', 'gov'];

// Review sites, map apps, booking and delivery platforms, data brokers and social networks: their terms
// restrict automated collection or reuse, or their content is other people's reviews.
export const NEVER_VISIT = [
  'google.com', 'goo.gl', 'g.page', 'business.site', 'yelp.com', 'tripadvisor.com', 'facebook.com', 'fb.com',
  'instagram.com', 'threads.net', 'x.com', 'twitter.com', 'tiktok.com', 'linkedin.com', 'nextdoor.com', 'pinterest.com',
  'mapquest.com', 'bing.com', 'apple.com', 'foursquare.com', 'yellowpages.com', 'yp.com', 'superpages.com',
  'dexknows.com', 'citysearch.com', 'manta.com', 'bizapedia.com', 'chamberofcommerce.com', 'merchantcircle.com',
  'hotfrog.com', 'cylex.us.com', 'n49.com', 'brownbook.net', 'loc8nearme.com', 'birdeye.com', 'bbb.org',
  'opentable.com', 'resy.com', 'exploretock.com', 'sevenrooms.com', 'doordash.com', 'ubereats.com', 'grubhub.com',
  'seamless.com', 'postmates.com', 'slicelife.com', 'chownow.com', 'toasttab.com', 'order.online', 'menufy.com',
  'allmenus.com', 'menupages.com', 'zmenu.com', 'restaurantji.com', 'singleplatform.com', 'wanderlog.com',
  'gasbuddy.com', 'fresha.com', 'vagaro.com', 'booksy.com', 'styleseat.com', 'setmore.com', 'schedulicity.com',
  'mindbodyonline.com', 'mindbody.io', 'classpass.com', 'square.site', 'squareup.com', 'clover.com', 'angi.com',
  'angieslist.com', 'homeadvisor.com', 'thumbtack.com', 'houzz.com', 'porch.com', 'checkbook.org', 'care.com',
  'privateschoolreview.com', 'childcarecenter.us', 'greatschools.org', 'niche.com', 'winnie.com', 'findlaw.com',
  'avvo.com', 'justia.com', 'martindale.com', 'lawyers.com', 'healthgrades.com', 'zocdoc.com', 'vitals.com',
  'webmd.com', 'sharecare.com', 'doximity.com', 'ratemds.com', 'cargurus.com', 'cars.com', 'edmunds.com',
  'dealerrater.com', 'storelocators.com', 'bestprosintown.com', 'expertise.com', 'groupon.com', 'linktr.ee',
  // Travel booking, vacation rentals and tour marketplaces, which a coastal tourist town draws plenty of.
  'airbnb.com', 'vrbo.com', 'homeaway.com', 'booking.com', 'expedia.com', 'hotels.com', 'kayak.com', 'priceline.com',
  'trivago.com', 'orbitz.com', 'travelocity.com', 'agoda.com', 'hipcamp.com', 'campendium.com', 'rvparky.com',
  'goodsam.com', 'koa.com', 'viator.com', 'getyourguide.com', 'fareharbor.com', 'peek.com', 'rezdy.com',
  'tockify.com', 'eventbrite.com', 'hostaway.com', 'lodgify.com', 'tripadvisor.co.uk',
];

// Tips only: fine for learning that a business exists or has closed, never a source of published facts.
export const TIPS_ONLY = [
  // Local and regional news
  'advocate-news.com', 'mendocinobeacon.com', 'mendovoice.com', 'theava.com', 'kzyx.org', 'mendofever.com',
  'ukiahdailyjournal.com', 'willitsnews.com', 'pressdemocrat.com', 'sfgate.com', 'sfchronicle.com', 'patch.com',
  'lostcoastoutpost.com', 'northbaybiz.com', 'bizjournals.com', 'mendocinosportsplus.com',
  // Tourism boards, the chamber of commerce and business associations
  'mendocinocoast.com', 'visitmendocino.com', 'visitfortbragg.com', 'visitcalifornia.com', 'fortbraggmainstreet.org',
  'macaronikid.com', 'beehiiv.com', 'substack.com',
];

// Website builders whose subdomains are separate businesses' own sites.
const SITE_BUILDERS = ['squarespace.com', 'wixsite.com', 'godaddysites.com', 'weebly.com', 'wordpress.com', 'webflow.io',
  'carrd.co', 'myshopify.com', 'github.io', 'netlify.app', 'vercel.app', 'mystrikingly.com', 'jimdosite.com'];

export function hostOf(url) {
  try { return new URL(url).hostname.toLowerCase().replace(/^www\./, '').replace(/\.$/, ''); } catch { return ''; }
}

const endsWithDomain = (host, d) => host === d || host.endsWith('.' + d);
const inList = (host, list) => list.some(d => endsWithDomain(host, d));

/** The part of a host that identifies one owner: "stores.cvs.com" -> "cvs.com", "acme.squarespace.com" stays whole. */
export function siteKey(host) {
  if (!host) return '';
  if (SITE_BUILDERS.some(d => host.endsWith('.' + d))) return host;
  const parts = host.split('.');
  // keep three labels for country and state second levels: example.co.uk, co.mendocino.ca.us
  const tld = parts.at(-1), sld = parts.at(-2) || '';
  const keep3 = parts.length > 2 && tld.length === 2 &&
    (['co', 'com', 'net', 'org', 'gov', 'ac', 'edu', 'k12'].includes(sld) || (tld === 'us' && sld.length === 2));
  return parts.slice(keep3 ? -3 : -2).join('.');
}

// Government records published somewhere other than a .gov or .ca.us address. (California's Department of Consumer
// Affairs posts its licence lists on its Box account, but Box's robots.txt asks automated tools not to download them,
// so they aren't used.)
export const GOV_HOSTS = [
  'usps.com', // the U.S. Postal Service, an independent federal agency (post office addresses and hours)
  'noyoharbordistrict.org', // the Noyo Harbor District, the public special district that runs the harbor
];

export const isGovHost = host =>
  /\.(gov|mil)$/.test(host) || /\.ca\.us$/.test(host) || inList(host, GOV_HOSTS);
export const isOsmHost = host => endsWithDomain(host, 'openstreetmap.org') || endsWithDomain(host, 'osm.org');
export const isNeverVisit = url => inList(hostOf(url), NEVER_VISIT);
export const isTipsOnly = url => inList(hostOf(url), TIPS_ONLY);

const squash = s => String(s || '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]/g, '');

/**
 * Can this URL serve as the business's own website? Review and booking platforms never can.
 * A shopping-center or news site can only be the website of that center or paper itself.
 */
export function isOwnWebsite(url, name) {
  const host = hostOf(url);
  if (!host || isOsmHost(host) || inList(host, NEVER_VISIT)) return false;
  if (inList(host, TIPS_ONLY)) {
    // only the paper or board itself: "Mendocino Voice" -> mendovoice.com, but not "Mendocino Coast Clinics"
    // Many names here start with the same place words ("Mendocino Coast..."), so the site's own name must match the
    // whole business name, not just its first words: mendocinocoast.com is not Mendocino Coast Clinics' website.
    const n = squash(name), label = siteKey(host).split('.')[0];
    return n.length >= 5 && label.startsWith(n);
  }
  return true;
}

/** 'osm' | 'first' | 'gov' | 'other' for one source URL, given the listing's own website and name. */
export function classifySource(url, { website = '', name = '' } = {}) {
  const host = hostOf(url);
  if (!host) return 'other';
  if (isOsmHost(host)) return 'osm';
  if (isGovHost(host)) return 'gov';
  if (website && isOwnWebsite(website, name) && isOwnWebsite(url, name) && siteKey(host) === siteKey(hostOf(website))) return 'first';
  return 'other';
}

export const isAllowedSource = (url, listing) => SOURCE_KINDS.includes(classifySource(url, listing));
