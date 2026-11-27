# Fort Bragg Local

A free, easy-to-search directory of local businesses in Fort Bragg, California, on the Mendocino Coast, built for
people who don't like computers. Type what you need in plain English ("pizza", "my sink is leaking", "dentsit") and it finds the right
places, even with typos.

- **No server, no database, no sign-ups, no accounts.** It's a set of plain files that GitHub Pages hosts for free.
- **Fast and private.** Searching happens inside the visitor's browser: nothing they type is sent anywhere, and there
  are no trackers, ads or cookies. (Map tiles come from OpenFreeMap, only when someone opens the map. Voice search uses
  the browser's built-in speech recognition, which in Chrome and Edge sends the audio to Google or Microsoft to turn it
  into text.)
- **Works without internet.** After the first visit the whole directory (under 2 MB) is saved on the device, so
  searching, opening hours and phone numbers keep working with no signal. Visitors can put it on their home screen and
  open it like an app ("Save to my phone" on the site explains how on each kind of phone).
- **Only facts, from sources we're allowed to use.** Every listing comes from the business's own website,
  OpenStreetMap or public government records, never from review sites, map apps or other directories, and every
  description is our own. See [`data/SOURCES.md`](data/SOURCES.md).
- **Accessible.** Large, legible type with a text-size control, full keyboard and screen-reader support, high-contrast
  and reduced-motion support, and a simple printable list (`directory.html`) for anyone who wants paper.

## Publish it on GitHub Pages (free)

1. Put these files in a **public** GitHub repository (Pages is free for public repos).
2. In the repository, open **Settings → Pages**. Under **Build and deployment**, choose **Deploy from a branch**, pick
   the `main` branch and the `/ (root)` folder, then **Save**.
3. After a minute or two the site is live at `https://YOUR-NAME.github.io/REPOSITORY-NAME/`.
4. Record that address so link previews and search engines work, then commit and push the change:

   ```sh
   node tools/set-site-url.mjs https://YOUR-NAME.github.io/REPOSITORY-NAME/
   ```

There is no build step: GitHub Pages serves the files exactly as they are.

## Day-to-day upkeep

### Where "Add a business" and "Report a problem" messages go

Open `assets/js/config.js`:

- Set `contactEmail` to an address, and the form opens the visitor's email app with the message filled in.
- Leave it empty, and on a `github.io` address the form opens a pre-filled GitHub issue
  (`.github/ISSUE_TEMPLATE/`). Posting one needs a free GitHub account.
- If neither applies, the form copies the message so the visitor can paste it into an email.

### Fix, hide or add a listing

Edit `data/overrides.json` (you can do it on github.com with the pencil icon), then run
`node tools/build-data.mjs final` and commit:

```json
{
  "remove": ["some-business-id"],
  "patch": { "starbucks-1234": { "phone": "(707) 555-0123", "hours": "Mo-Fr 06:00-19:00; Sa,Su 07:00-18:00",
                                 "sources": ["https://www.starbucks.com/store-locator/store/1234"] } },
  "add": [{ "name": "New Bakery", "category": "cafes-treats", "sub": "Bakery", "address": "123 North Main Street",
            "zip": "95437", "phone": "(707) 555-0100", "website": "https://newbakery.example", "tags": ["bread", "cakes"],
            "sources": ["https://newbakery.example/contact"] }]
}
```

Only use facts from the business itself (its website, or a message from the owner), OpenStreetMap or a government
record, and list where they came from in `sources` (see [`data/SOURCES.md`](data/SOURCES.md)). A new listing with no
allowed source is skipped, unless its own website is given. If a business has no website, add it to
[OpenStreetMap](https://www.openstreetmap.org/) first, then use its OpenStreetMap page as the source. Descriptions are
written automatically.

A listing's id is the `id=` part of its address when you open it on the site. Hours use the
[OpenStreetMap format](https://wiki.openstreetmap.org/wiki/Key:opening_hours), for example
`Mo-Fr 09:00-17:00; Sa 10:00-14:00`.

Fixes in `overrides.json` survive every data refresh. Editing `data/businesses.json` directly also works, but the next
rebuild overwrites it. The rebuild also works in a fresh copy of the repository, without the private working files: it
then applies `overrides.json` to the listings already published.

## How the data is made

Every published fact comes from the business's own website, OpenStreetMap or a public government record (the full
rules are in [`data/SOURCES.md`](data/SOURCES.md)):

| Step | Command | Output |
| --- | --- | --- |
| 1. Download Fort Bragg businesses from OpenStreetMap | `node tools/fetch-osm.mjs` | `data/sources/osm.json` |
| 2. Add leads: businesses heard about from news or harbor and shopping-center directories, with the facts confirmed at allowed sources | (research) | `data/sources/research/*.json` |
| 3. Merge and de-duplicate everything | `node tools/build-data.mjs candidates` | `data/sources/candidates.json` |
| 4. Find map coordinates for new addresses | `node tools/geocode.mjs`, then repeat step 3 | `data/sources/geocode-cache.json` |
| 5. Confirm each phone number and address on the business's own website | `node tools/check-firstparty.mjs` | `data/sources/firstparty.json` |
| 6. Turn the researchers' confirmed facts into checks, and check the rest by hand, using allowed sources only | `node tools/confirm-from-research.mjs`, then (checking) | `data/sources/confirmed/*.json` |
| 7. Re-check every hand-checked fact on the page it cites | `node tools/audit-confirmed.mjs` | `data/sources/confirmed/*.json` |
| 8. Publish the confirmed facts | `node tools/build-data.mjs final` | `data/businesses.json`, `directory.html`, `sw.js` |

`tools/check-firstparty.mjs` reads at most three pages of each business's own website. It respects `robots.txt`, waits
between requests to the same site, and names itself in its User-Agent. It takes opening hours only from the site's own
structured data (`--ids=a,b` checks just those listings again, for example after a holiday week, when chain stores'
pages show special hours). `tools/audit-confirmed.mjs` fetches each page a hand-checked fact cites, in the same polite
way, and rejects any fact the page doesn't show. Steps 2, 3, 5, 6 and 7 produce working files that stay on your computer (see
[`data/sources/README.md`](data/sources/README.md)).

`tools/geocode.mjs` asks the U.S. Census Bureau's free geocoder first. The few addresses it can't place go to
OpenStreetMap's **Nominatim** service. Please follow the
[Nominatim usage policy](https://operations.osmfoundation.org/policies/nominatim/) if you change the script: at most
one request per second, an identifying User-Agent, no bulk or repeated lookups (results are cached in
`data/sources/geocode-cache.json` for that reason), and credit to OpenStreetMap.

Only businesses in Fort Bragg's ZIP code, 95437 (the city plus Cleone, Noyo and the Highway 20 corridor), are
included (`zips` in `assets/js/config.js`). A listing with no address, phone or website is
left out. The site shows when each listing was last checked and links to its sources.

## How it works

```
index.html            the whole page; the icons and the hero landscape are inlined into it
assets/css/app.css    all styles: light and dark themes, three text sizes, print styles
assets/js/app.js      the app: search box, results, filters, details, map, forms
assets/js/search.js   the search engine: spelling correction, synonyms, plain-English intents
assets/js/intents.js  what people mean: "fix my sink" means plumbers, "teeth" means dentists...
assets/js/hours.js    opening hours: "open now", "closes at 7 PM", in Fort Bragg's time zone
assets/js/sky.js      colors the coast and the Skunk Train scene for the real time of day in Fort Bragg
assets/js/map.js      the map, loaded only when someone taps "Map"
assets/js/offline.js  "Save to my phone" and the offline notice
sw.js                 the service worker: keeps a copy of the whole site on the device for use without internet
site.webmanifest      the app name, icons and colors used when the site is saved to a home screen
data/businesses.json  the published listings
data/SOURCES.md       where the facts come from, and what is never used
directory.html        a plain, printable list (also the fallback if JavaScript is off)
404.html              friendly "page not found"; turns an address like .../pizza into a search
```

- **Search** runs entirely in the browser over a small index built when the page loads. It understands typos
  (`resturant`, `plumer`), synonyms, everyday phrases (`my tooth hurts`, `oil change`, `somewhere to take the kids`),
  and filters like "open now" and neighborhood.
- **Maps** use [MapLibre GL](https://maplibre.org/) (bundled in `assets/vendor/`) with free tiles from
  [OpenFreeMap](https://openfreemap.org/): no API key or account.
- **Offline**: `sw.js` saves every file the site needs the first time someone visits. It always tries the network
  first, so visitors get fresh listings whenever they're online, and falls back to the saved copy when there's no
  connection or it's too slow. The map and businesses' websites still need the internet, and the site says so.
- **Hero illustration** is drawn in code (`tools/gen-hero.mjs`): an original picture of the coast looking south, with
  the Skunk Train crossing a trestle over Pudding Creek toward the redwoods. It copies none of the railroad's logos or
  artwork. Try `?sky=dawn`, `?sky=golden`, `?sky=dusk` or `?sky=night` on the address to preview other times of day,
  `?season=winter|spring|summer|fall` for the coast's seasons (green hills in the rains, gold ones and fog in summer,
  whales offshore in winter) and `?holiday=1` for the December lights.

## Develop locally

Any static file server works. With Python, from this folder:

```sh
python3 -m http.server 8000
# then open http://localhost:8000
```

Run the tests (Node 20 or newer):

```sh
node --test tests/
```

Regenerate the inlined art after changing it: `node tools/build-icons.mjs` (icons) and `node tools/gen-hero.mjs`
(landscape).

After editing any site file, run `node tools/build-offline.mjs`. It updates the list of saved files and their
fingerprint in `sw.js`, so visitors' saved copies refresh (the data and art scripts run it for you, and the tests
remind you if you forget). Service workers run only on `https://` addresses and on `localhost`.

## Licenses

- **Code:** MIT (`LICENSE`).
- **Listing data:** Open Database License 1.0 (`data/LICENSE.md`). Includes data © OpenStreetMap contributors. Where
  the facts come from: `data/SOURCES.md`.
- **Bundled fonts, icons and map library:** see `THIRD-PARTY-NOTICES.md`.

Businesses don't pay to be listed, and a listing is not an endorsement. Please call ahead to confirm hours.
