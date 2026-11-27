// Site settings. Edit these, commit, and GitHub Pages republishes the site.

export const CONFIG = {
  siteName: 'Fort Bragg Local',

  // The site's public address, ending in a slash, e.g. 'https://your-name.github.io/fortbragg-local/'.
  // Set it with: node tools/set-site-url.mjs <address>  (that also updates the share tags, sitemap and robots.txt).
  // Empty until the site has a public address: share links then use the address it's opened from.
  siteUrl: 'https://fortbragg-ca.info/',

  // The place this directory covers. The data tools publish only listings in these ZIP codes.
  town: 'Fort Bragg',
  state: 'CA',
  zips: ['95437'],

  // Where "Add a business" and "Report a problem" messages go.
  // Set an email address to have the form open the visitor's email app, e.g. 'hello@example.org'.
  // Leave it empty to use GitHub issues instead (the visitor needs a free GitHub account).
  // With neither (empty here, and the site isn't on *.github.io with `github` below left null), the form can't
  // send anything: its button becomes "Copy my message" and visitors are told the site can't receive messages yet.
  contactEmail: '',

  // The GitHub repository that hosts this site, e.g. { owner: 'your-name', repo: 'fortbragg-local' }.
  // Left as null, it is worked out from the address on *.github.io sites.
  github: { owner: 'Glid-Tech', repo: 'hyperlocal-fortbragg-ca' },

  // Free vector map tiles from OpenFreeMap (no key, no sign-up). https://openfreemap.org
  mapStyle: {
    light: 'https://tiles.openfreemap.org/styles/positron',
    dark: 'https://tiles.openfreemap.org/styles/dark',
  },
  mapCenter: [-123.798, 39.459], // [longitude, latitude]: Cleone to the Noyo River fits on a phone (the map then fits the results)
  mapZoom: 11.7,

  // How many results to show before "Show more" (12 fills rows of 2, 3 or 4 cards evenly).
  pageSize: 12,
};
