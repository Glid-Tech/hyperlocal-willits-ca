// Site settings. Edit these, commit, and GitHub Pages republishes the site.

export const CONFIG = {
  siteName: 'Willits Local',
  // The short name used where space is tight: the home-screen icon label, install steps and "in Willits" copy.
  // Keep it 12 characters or fewer, and the same as short_name in site.webmanifest.
  shortName: 'Willits',

  // The site's public address, ending in a slash, e.g. 'https://your-name.github.io/willits-local/'.
  // Set it with: node tools/set-site-url.mjs <address>  (that also updates the share tags, sitemap and robots.txt).
  // Empty until the site has a public address: share links then use the address it's opened from.
  siteUrl: 'https://glid-tech.github.io/hyperlocal-willits-ca/',

  // The place this directory covers. The data tools publish only listings in these ZIP codes.
  town: 'Willits',
  state: 'CA',
  zips: ['95490'],
  // The addr:city spellings that count as this town. Brooktrails addresses share ZIP 95490 and are kept too.
  placeNames: ['Willits', 'Brooktrails'],

  // [south, west, north, east] boxes, in degrees.
  // bbox: the ZCTA 95490 extent (TIGERweb), used for the OpenStreetMap (Overpass) fetch.
  bbox: [39.28, -123.67, 39.72, -123.08],
  // geocodeBox: a tighter box for geocoder hits. It keeps Longvale but cuts off Laytonville (ZIP 95454, about 39.69 N).
  geocodeBox: [39.28, -123.67, 39.66, -123.08],
  // The OpenStreetMap relation for the City of Willits (admin_level 8). Overpass area id = 3600000000 + this.
  osmCityRelation: 111764,
  // Downtown Willits, for the live sky (sun, moon and stars).
  lat: 39.4124,
  lon: -123.3544,

  // Where "Add a business" and "Report a problem" messages go.
  // Set an email address to have the form open the visitor's email app, e.g. 'hello@example.org'.
  // Leave it empty to use GitHub issues instead (the visitor needs a free GitHub account).
  // With neither (empty here, and the site isn't on *.github.io with `github` below left null), the form can't
  // send anything: its button becomes "Copy my message" and visitors are told the site can't receive messages yet.
  contactEmail: '',

  // The GitHub repository that hosts this site, e.g. { owner: 'your-name', repo: 'willits-local' }.
  // Left as null, it is worked out from the address on *.github.io sites.
  github: { owner: 'Glid-Tech', repo: 'hyperlocal-willits-ca' },

  // Free vector map tiles from OpenFreeMap (no key, no sign-up). https://openfreemap.org
  mapStyle: {
    light: 'https://tiles.openfreemap.org/styles/positron',
    dark: 'https://tiles.openfreemap.org/styles/dark',
  },
  mapCenter: [-123.366, 39.415], // [longitude, latitude]: Brooktrails down to the hospital fits on a phone (the map then fits the results)
  mapZoom: 11.9,

  // How many results to show before "Show more" (12 fills rows of 2, 3 or 4 cards evenly).
  pageSize: 12,
};
