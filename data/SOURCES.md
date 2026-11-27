# Where our facts come from

Willits Local publishes **facts** about local businesses: name, kind of business, address, phone number, website,
opening hours, place on the map, and the date we last checked. This page explains where those facts come from and what
we never use. The same rules are written into the code and checked by the tests (see "How it's enforced" below).

## Allowed sources

Every published fact comes from one of these:

1. **The business itself**: its own website. When an owner sends a correction, we record it with a link to the
   business's website or its OpenStreetMap page.
2. **OpenStreetMap**: the free, community-built map, used under the Open Database License and credited on every page.
3. **Public government records**: for example the websites of the City of Willits (`cityofwillits.org`), the
   Brooktrails Township Community Services District (`btcsd.org`) and Mendocino County, and California's license
   lookups: the Department of Consumer Affairs, the Contractors State License Board (CSLB), Alcoholic Beverage Control
   (ABC), the Department of Cannabis Control (DCC), the Department of Real Estate (DRE), the State Bar of California
   (CalBar) and the Department of Social Services' child-care licensing search. Bank branches can also be confirmed in
   the Federal Deposit Insurance Corporation's (FDIC) public data.

Each listing links to the sources its facts came from and says when they were last checked.

## Never used

- Review and rating sites and apps: Yelp, Google Maps and Google Business Profiles, Tripadvisor, Angi, Nextdoor,
  Healthgrades, Zocdoc and the like.
- Social media: Facebook, Instagram, X, TikTok, LinkedIn and the like.
- Booking, ordering and delivery platforms: OpenTable, Resy, DoorDash, Toast, Vagaro and the like.
- Travel booking, vacation-rental and tour marketplaces: Airbnb, Vrbo, Booking.com, Expedia, Hipcamp, Viator,
  FareHarbor and the like.
- Other directories and data sellers: Yellow Pages, BBB, MapQuest and the like.
- Anything behind a login, anything a site's `robots.txt` asks automated tools to stay away from, and anything a site's
  terms forbid copying.

## Leads only

News stories (for example Willits Weekly and The Mendocino Voice), the Willits Chamber of Commerce (`willits.org`)
and the Chamber's Visit Willits site (`visitwillits.com`), Visit Mendocino County, and shopping-center directories can
tell us that a business exists. We use them only as a to-do list. Every published fact is then confirmed at an allowed
source, and nothing from the lead is copied: not its wording, photos or ratings, and not the way it chose or arranged
its list. The lead notes stay off the public site. Some news sites ask automated tools not to visit them at all (for
example The Willits News and the Ukiah Daily Journal); we respect that and never fetch them.

## Who gets listed

- **A place customers can visit, or a business that comes to them.** Shops, offices and services with a walk-in
  location are listed. So are licensed trades that work at the customer's place (contractors, for example), listed by
  their license record and ZIP code, without a home address. A business with neither, such as a mail-only publisher,
  an online-only agency or a company whose only local presence is a phone number, isn't listed.
- **Cannabis.** Only state-licensed dispensaries are listed, under Doctors & Health, with the Department of Cannabis
  Control's license record as the source. A description says "adult-use" only when the license shows it. The City of
  Willits permits medical dispensaries only (see its Cannabis Activity Program page). OpenStreetMap's cannabis shops
  aren't imported on their own, and there is no cannabis search shortcut.

## Our own words

Every description is written by a template from the facts, for example "Pizza delivery & carryout on North Main
Street in Downtown." We never publish anyone else's descriptions, reviews, ratings, photos or logos.

## How it's enforced

- `tools/lib/source-policy.mjs` holds the lists above.
- `tools/check-firstparty.mjs` visits each business's own website, slowly and identifying itself, and respects
  `robots.txt`. It confirms that the phone number and address appear there. Opening hours are taken only from the
  site's own structured data, where a day marked "00:00 to 00:00" means closed. Many chain stores publish only this
  week's hours, so hours read in a holiday week aren't used if they show the holiday as a weekly closure.
- `tools/audit-confirmed.mjs` re-reads every page a checker cited and drops any fact the page doesn't show. It also
  makes sure a website still belongs to the business: an address that now shows a "for sale" page or gambling spam
  (what often happens when a business lets its domain lapse) is not linked.
- `tools/build-data.mjs` publishes a fact only when its source is the business's own website, OpenStreetMap or a
  government record. It writes every description itself, and it never lends one business's phone, website or
  map entry to another business at the same address (a mall or office building).
- `node --test tests/` fails if any of these is true:
  - a published source isn't allowed;
  - a listing's website isn't the business's own;
  - a description isn't our template;
  - anything other than these facts appears in the data.

## Why

In the United States, facts themselves aren't protected by copyright (*Feist Publications v. Rural Telephone Service*,
1991). Creative expression can be protected: the way someone wrote a description, a photo, or a creative choice and
arrangement of a list. Many websites' terms of use also forbid copying or automated collection. Taking facts only from
the businesses themselves, the open map and the government, and writing our own descriptions, keeps clear of both.
This is our policy, not legal advice.

## Corrections and removals

If something is wrong, or a business wants its listing changed or removed, use **Report a problem** on the site, and
we'll act on it quickly. Business names and trademarks belong to their owners. A listing isn't an endorsement, and
businesses don't pay to be listed.
