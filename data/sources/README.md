# Working files

`tools/build-data.mjs` builds the published listings (`../businesses.json`) from these files. The rules for what may
be published are in `../SOURCES.md`.

| File | What it is | In the repository? |
| --- | --- | --- |
| `osm.json` | Willits-area businesses downloaded from OpenStreetMap (`node tools/fetch-osm.mjs`). Open Database License. | Yes |
| `geocode-cache.json` | Map coordinates for addresses, from the U.S. Census Bureau geocoder and OpenStreetMap's Nominatim (`node tools/geocode.mjs`). | Yes |
| `research/*.json` | Leads: businesses we heard about from news stories, shopping-center directories or the chamber of commerce, each with the facts a researcher confirmed at an allowed source (format below). Never published as they are. | No |
| `candidates.json` | Every possible listing, merged and de-duplicated (`node tools/build-data.mjs candidates`). | No |
| `firstparty.json` | What `node tools/check-firstparty.mjs` found on each business's own website: whether the phone number and address appear there, and any opening hours the site publishes. | No |
| `confirmed/*.json` | Listings checked by hand against allowed sources only (format below). | No |

The files marked "No" are listed in `.gitignore`, because they hold notes about leads that we don't redistribute.
**Keep a private backup of them.** Without them, `node tools/build-data.mjs final` still works: it applies
`../overrides.json` to the listings already published, so nothing is lost.

## Format of `research/*.json`

Each file is an array of leads: `name`, `category`, `subcategory`, `tags`, `address`, `suite`, `zip`, `phone`,
`website`, `hours`, `status` (`open`, `coming_soon`, `closed`, `relocated` or `uncertain`), `status_evidence`,
`sources` (every page read, leads included) and `osm` (the OpenStreetMap id, such as `node/123`, when it's the same
place). A lead can also carry `facts`, in the same shape as below: only the facts seen at an allowed source, each
with the exact page that shows it.

`node tools/confirm-from-research.mjs` (after `node tools/build-data.mjs candidates`) turns those facts into checks
in `confirmed/research-*.json`, and leads marked `closed` or `relocated` into `closed` checks. Run
`node tools/audit-confirmed.mjs` next, as for any hand check: nothing is published on a researcher's word alone.

## Format of `confirmed/*.json`

Each file is an array of checks:

```json
[
  {
    "id": "joes-pizza-1234",
    "verdict": "open",
    "duplicateOf": null,
    "facts": {
      "phone": { "value": "(707) 555-0100", "source": "https://joespizza.example/contact" },
      "hours": { "value": "Mo-Su 11:00-22:00", "source": "https://joespizza.example/contact" }
    },
    "evidence": "Phone and hours on the contact page.",
    "checked": "2026-11-22"
  }
]
```

- **`verdict`** is one of `open`, `coming_soon`, `closed`, `relocated`, `duplicate`, `out_of_scope` or
  `not_confirmed`. Only `open` and `coming_soon` are published. `not_confirmed` means "couldn't confirm", not
  "closed", so the build ignores it and leaves the listing to the automatic website check.
- **`duplicateOf`** is the id of the other listing. The build only treats a check as a duplicate when it points
  at a different listing (by id, or by the same name at the same street number). A listing reported as a duplicate
  of itself counts as confirmed if facts were recorded, and as unchecked if not.
- **`facts`** can include `name`, `address`, `unit`, `zip`, `center`, `phone`, `website`, `hours` and `opened` (as
  YYYY-MM). Each fact's `source` must be the business's own website, its OpenStreetMap page or a government record.
  The build ignores any other source.
- **`category`** (optional) moves the listing to another category, for example `"beauty"` when a salon was filed
  under restaurants.
- **`ignore`** (optional) lists details on file that belong to a different business: `"website"` (the website on
  file) and/or `"osm"` (the linked OpenStreetMap entry). The build then takes nothing from them.
- **`evidence`** is a short note in our own words, never text copied from a website.

If two files check the same listing, the later file (in name order) wins. When both say `open`, their facts are
combined, so a later file can add a fact without repeating the others.

After adding or editing these files, run `node tools/audit-confirmed.mjs` (or name the files to check). It fetches each
cited page again (politely, and only where `robots.txt` allows) and moves any fact the page doesn't show into
`rejected`, with the reason. The build ignores rejected facts. Along the way it checks that:

- a **website** loads, stays on its own domain or shows the business's name, phone or address, and doesn't look parked,
  for sale or taken over (gambling spam is the usual sign of a lapsed domain bought by someone else);
- a fact from a **government list** (such as a license list with one license per line) is on the same line as the
  business's name and street address, not just somewhere in the file;
- a **shopping center** name appears on the page as a whole phrase.

`--dry` reports what would change without saving, and `--websites` re-checks only the websites.
