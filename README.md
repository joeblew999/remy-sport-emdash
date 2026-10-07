# remy-sport-emdash

The public site for **Remy Sport** — the pages a person or a search engine can read without
signing in: what it is, who it is for, the blog, and a page for every event and organisation. Built on
[EmDash](https://docs.emdashcms.com), on 1.2.0. Its `mise` tasks come from
[emdash-run](https://github.com/joeblew999/emdash-run) by one include line in `mise.toml`.

The Remy Sport **app** is a separate repo and a separate deployment. It stays the place where
people sign in and do things. This site is how they find it.

## Run it

You need [mise](https://mise.jdx.dev) and git.

```
mise trust
mise run site:start    install, and run the site in the background
mise run site:logs     follow its log
mise run site:stop
mise run site:check    before a commit: the seed, the types, the build
mise run model:sync    after a model change in the admin: record it in site/.emdash/
mise run emdash -- content list posts    anything else, through EmDash's CLI
```

The admin, signed in: `http://localhost:<SITE_PORT>/_emdash/api/setup/dev-bypass?redirect=/_emdash/admin`
(the port is 4321 unless `SITE_PORT` in `mise.toml` or `mise.local.toml` says otherwise).
`mise tasks ls` lists every task; what each does is in
[emdash-run's docs](https://joeblew999.github.io/emdash-run/).

## Deployed

`https://remy-sport-site.gedw99.workers.dev` — Cloudflare's default address, until the domain is
decided. The Worker and its D1 database are `remy-sport-site`; the R2 bucket is
`remy-sport-site-media`. The address is `LIVE_URL` in `mise.toml`.

```
mise run live:ship                       check, build, deploy, wait for it to answer
mise run live:undo                       back to the version before (code only)
mise run live:logs
mise run live:backup                     a database bookmark and a content package in site/backups/
mise run signin:token -- --live          once per machine: the CLI is signed in to the deployed site
mise run emdash -- content list posts --live
mise run model:sync -- --live
```

**Signing in.** The admin and its API (`/_emdash/…`) are behind Cloudflare Access: a person opens
`/_emdash/admin` and gets a code by email; only the address in `ADMIN_EMAIL` (in the gitignored
`mise.local.toml`) is let in. `mise run signin:access` set that up and is safe to run again. A
machine needs the Access pass that task saved in `~/.config/emdash-run/` and `signin:token -- --live`.
Uploaded media is under `/_emdash/` too and is **not public yet** — see the plan.

**Content does not travel with a deploy.** `live:ship` ships code. A change made on this machine
reaches the deployed site as an EmDash package (`mise run emdash -- site export --output <file>`,
then `site import <file> --analyze --live`, read the plan, then `--plan <digest> --confirm --live`),
and that import is for a site with no content of its own. From here on, write on the deployed site.

How the first deployment was done, step by step, with what failed: item 3 of
[the plan](docs/plans/2026-10-06-next.md).

Build the site in `site/` — pages, layouts, components, the seed. The dev server reloads your
edits.

## What is decided

| | |
|---|---|
| What this is | The public, crawlable side of Remy Sport: landing page, pages for organisers, coaches and parents, the blog, and event and organisation pages rendered from the app's public API |
| What it is not | A second app. Nobody signs in here except editors. Accounts, teams, players, games and live video stay in the app |
| Platform | Cloudflare (Workers, D1, R2) |
| Started from | EmDash's `blog-cloudflare` template; `site/` is ours from here on |
| Name | "Remy Sport" is the working title. Keep the name in the site settings and the seed — never hardcode it in a page — so a rebrand is one edit |
| Privacy line | Only events and organisations are shown. Nothing that names a person — above all a child — is ever rendered here, whatever the app's API will hand over |
| Editors | Gerard as Admin, Remy as Editor |
| Repo | Public. No licence yet — all rights reserved until one is chosen |

## How the site is put together

Everything is in `site/`.

| where | what |
|---|---|
| `seed/seed.json` | The content model and the first content: two collections (`pages`, `posts`), two taxonomies on posts (`audience`, `topic`), the `primary` and `footer` menus in English and Thai, and the site settings that carry the name and tagline. No events, organisations, teams or people: those are the app's |
| `src/layouts/Base.astro` | The one layout: header, footer, menus, language switch, and the whole `<head>` — title, description, canonical, Open Graph and Twitter tags, `hreflang`, the RSS link |
| `src/lib/site.ts` | What every page needs: the language of a request, paths and absolute URLs, loading an entry with the English fallback, and `loadShell`, which every page calls first (settings, menus, and what the edge cache is told) |
| `src/lib/app.ts` | The only place that knows where the app and the help site are, builds links into them, and reads the app's API: four typed reads, a timeout, a five-minute copy, and the filter that enforces the privacy line |
| `src/lib/entities.ts` | Event and organisation pages: their addresses and slugs, what each loads, what happens when the app does not answer, their sitemap entries and their schema.org data |
| `src/i18n/` | The words the templates print themselves (buttons, labels, notices): `messages/<code>.json`, one file per language, read through `ui.ts` |
| `src/components/LanguageSwitcher.astro` | The language switch in the footer |
| `src/views/` | What each kind of page looks like |
| `src/pages/` | The routes, once, for every language. Each is a few lines: load, then hand to a view. `[...path].astro` is the `pages` collection; `[...locale]/` holds the rest, and that first segment is the language |

The name is never written in a page. It is the `title` setting (Settings in the admin; `settings` in
the seed). An unset title shows the host name, so a missing setting is obvious.

### Settings a deployment needs

| setting | where | what |
|---|---|---|
| `CANONICAL_URL`, else `LIVE_URL` | the environment of the build (`LIVE_URL` is in `mise.toml`) | The site's public address: `site:` in `astro.config.mjs`. Canonical links, the sitemap, `robots.txt`, RSS and share tags are all built from it, never from the host that answered. Unset, it is this machine. `astro dev` always uses this machine |
| `APP_ORIGIN`, `HELP_ORIGIN` | `vars` in `site/wrangler.jsonc` | Where "Open the app" and "Help" go |
| `APP_API_ORIGIN` | `site/.dev.vars` (gitignored), or `vars` | Which app the site reads: its events and organisations come from `<APP_API_ORIGIN>/api`. Defaults to `APP_ORIGIN`, which defaults to production. Point a local or preview site at the app's staging twin, which holds fixtures only |
| `APP_DATA_IS_REAL` | `vars` in `site/wrangler.jsonc` | `"false"` today. The app's events are test entries: invented events under real schools' names. Until this is `"true"`, every event and organisation page shows a "Sample data" notice, carries `noindex`, and is left out of the sitemap. Set it to `"true"` when the app this site reads holds real events |
| `SITE_PORT` | `mise.local.toml` (gitignored) | The local port, when 4321 is taken |

### Languages

The site answers in the 27 languages the app speaks, under the same codes. The list is in one
place: `locales` in `site/astro.config.mjs`. Astro and EmDash are configured from it and the
site's code reads it back, so adding a language is one edit there (and, if it has words of its
own, one file in `src/i18n/messages/`).

- **Addresses.** English is the default and has no prefix; every other language is under its
  code: `/th/…`, `/ja/…`, `/zh-TW/…`. (A prefixed default language breaks the EmDash admin.) There
  is one set of routes: the language is the first segment of the address, checked against the
  list. `/xx/events` and `/en/events` are 404s; a code is matched as written, so `/zh-tw/` is too.
- **Content** is EmDash's: an entry exists once per language, linked as translations of each
  other, each with its own draft and published state. A page with no **published** version in a
  language shows the English text at that language's address, with a notice saying so, and its
  canonical link points at the English page. It is never a 404, and nothing unpublished is shown.
- **Interface words** (`src/i18n/messages/`). `en.json` holds all 54. Each other language holds
  the 21 the app already had in that language — "Venue", "Divisions", "Organised by", "Sample
  data", the theme switch — copied once from the app's own catalogues, with the language's own
  name and its direction. The other 33 show in English. `src/i18n/ui.ts` lists which key came from
  which; nothing in those files was translated for this site.
- **Right to left.** Arabic, Persian and Urdu pages are `dir="rtl"`. English text standing in
  for a missing translation is marked `lang="en" dir="ltr"`.
- **The language switch** lists every language by its own name and links to the same page in
  each; for an entry it uses the slug of that language's published translation.
- **`hreflang` and the sitemap** name only the languages a page is really published in — for an
  event or organisation, the languages the app names it in. The sitemap lists a language's pages
  once that language's home page is published.
- **Menus and taxonomy terms** are EmDash's too, one per language; a language without its own
  shows the English one.
- **Fonts.** Inter, and Noto Sans Thai on Thai pages. Other scripts use the reader's system fonts.

**Nothing but English is written yet.** The seed holds a Thai draft of every page, titled
"[TH — needs translation]", and Thai menu labels that no native speaker has reviewed. Translate
in the admin (open an entry, then **Translations** in the sidebar), have a person who reads the
language review it, then publish. Nothing is public in a language until someone does.

**Machine translation is not set up.** The plan was the LinguaDash plugin from EmDash's registry,
which drafts translations with DeepL, OpenAI or Cloudflare AI for a person to review. It asks for
content read and write, schema read, and network access to those three services only, and its
0.1.0 bundle does nothing else. EmDash 1.1.0 will not install it: the publisher's signed policy
requires build provenance and the one release in the registry has none (`PROVENANCE_REQUIRED`).
It is not installed, and the check was not worked around. Two things have to be true first:

- a release EmDash will verify — the publisher's to publish — or the owner's decision to take
  the plugin as an npm dependency instead (`emdash-plugin-linguadash`, added to `sandboxed` in
  `astro.config.mjs`), which also makes the install part of this repo;
- a plugin sandbox. A registry plugin runs on Cloudflare's Worker Loader: `sandboxRunner` in
  `astro.config.mjs` and the `LOADER` binding in `wrangler.jsonc`, both off here. Deploying with
  that binding needs the Workers Paid plan.

### What it sets that the template did not

- `site:` from the environment (above), and a canonical link on every page.
- `robots.txt` (`src/pages/robots.txt.ts`) names the sitemap. On any host that is not the public
  address — this machine, a preview — it disallows everything.
- `sitemap.xml` (`src/pages/sitemap.xml.ts`): one file, every indexable page in every language it
  is published in. It replaces EmDash's, which would list the home entry at `/home`.
- RSS for the blog at `/rss.xml`, and at `/<code>/rss.xml` for each other language.
- Open Graph and Twitter tags on every page. **There is no share image yet**: set one in the admin
  (Settings → SEO → default image) when there is artwork; a post's cover image is used for that post.
- The edge cache: `cacheCloudflare()` in the config. A page is fresh for five minutes, may be served
  stale for a day while it is refreshed, and is purged by tag when what it shows is published.
  `public/_headers` caches built assets for a year. The 404 page is never cached.
- Placeholder pages (privacy, terms) carry a visible draft banner and `noindex`, and are left out of
  the sitemap, until an editor unticks "Placeholder".

## URL plan

Who answers which address. Agreed here before any event page is published, so that moving a page
from this site to the app later changes who answers it and not the address.

| address | who renders it | status |
|---|---|---|
| `/` | this site — the `home` page entry | built |
| `/organisers`, `/coaches`, `/parents`, `/about` | this site — page entries; any new page an editor adds gets `/<slug>` | built |
| `/privacy`, `/terms` | this site — placeholders until the owner writes them. The app should link here | built, drafts |
| `/blog`, `/blog/<slug>` | this site — posts. `?audience=` and `?topic=` filter the list | built |
| `/rss.xml`, `/sitemap.xml`, `/robots.txt` | this site | built |
| `/<code>/…` | this site — every address above in another language: `/th/…`, `/ja/…`, `/ar/…`, 26 in all. Event and organisation names are the app's: Thai under `/th/`, English elsewhere | built; only English is written |
| `/events` | this site, from the app's `GET /api/events` — upcoming first, then finished | built |
| `/events/<id>/<slug>` | this site, from `GET /api/events/<id>`. The id is what is looked up; the slug is made from the English name, and `/events/<id>` or a wrong slug redirects (301) to the right one | built |
| `/organisations`, `/organisations/<id>/<slug>` | this site, from `GET /api/orgs` and `/api/orgs/<id>`, same rules; the slug is the app's own | built |
| `/_emdash/…` | this site — the admin and its API. Editors only; disallowed in `robots.txt` | built |
| everything a signed-in person does | the app, `https://remy.ubuntusoftware.net/#/…` today | the app's |
| how-to | the help site, `https://help.remy.ubuntusoftware.net/` | the app's |
| teams, rosters, players, coaches, games, live scores, standings | **nobody on this site, ever** — see the privacy line | — |

Links into the app are built by `appHref()` in `src/lib/app.ts` and carry `ref=site-<page>` inside
the hash, which the app's router already parses. When the app moves from hash routes to real paths,
that function is the one edit.

## Event and organisation pages

The app is a single-page application on hash routes: a search engine or a link preview sees one
empty page for the whole product. These pages are the experiment that fixes that without changing
the app — this site renders, on the server, a page for each event and organisation from the app's
public API. The facts stay the app's; nothing is copied into EmDash.

**What the site reads.** Four operations, without credentials, and nothing else. The app's team
cannot see this code, so this list is the contract: do not remove or rename any of it without
telling this site first.

| operation | fields read |
|---|---|
| `GET /api/events` → `events[]` | `id`, `name`, `names.en`, `names.th`, `typeCode`, `formatCode`, `cityCode`, `startDate`, `endDate`, `orgId`, `venueNames.en/th`, `divisionNames[].en/th`, `updatedAt` |
| `GET /api/events/{id}` | the same; a 404 is "no such event". The id must contain a digit (`evt_003`, a UUID) |
| `GET /api/orgs` → `orgs[]` | `id`, `slug`, `names.en`, `names.th`, `orgTypeCode`, `cityCode` |
| `GET /api/orgs/{id}` | the same; a 404 is "no such organisation" |

**What is filtered, and how.** `src/lib/app.ts` exports those four reads and no way to ask for
any other path. A response never reaches a template as the app sent it: a new object is built from
the fields above, by name, and only that object is returned or cached. So these are dropped before
anything can render them, whatever the app adds later:

- `organizerName` and `organizerUserId` — the person who created the event. "Organised by" on a
  page is the event's **organisation** (`orgId`), or absent. Never a person.
- `description` — free text. Nothing stops an organiser writing a coach's or a child's name in
  it, and no filter can tell. It is left out until the owner decides otherwise.
- `can` (what the reader may do), and `teamCount`, `gameCount`, `playedCount`, `followerCount`,
  `venueCount` — teams, games and followers are not this site's business.
- Names in the app's other 25 languages, `provinceCode`, `timezone`, `isFibaCertified`, `createdAt`.
- Never requested at all: an organisation's members, teams, rosters, players, coaches, games,
  standings, `/api/me`, `/api/people`. The paths are checked before a request is made:
  `/api/events` or `/api/orgs`, optionally followed by one id, and an id has a digit in it — so a
  route word of the app's in that place (`/events/invitations` is the people invited to
  co-organise) is a 404 here and is never sent. A redirect from the app is not followed.

An event's, a venue's, a division's and an organisation's own name is shown as the app has it. If
an organiser puts a person's name in one of those, it is shown: no filter can tell.

The button on each page opens the app's own screen for that event or organisation. What the app
shows there, and to whom, is the app's decision and is outside this site's privacy line.

**Sample data.** See `APP_DATA_IS_REAL` above: until the app holds real events these pages are
marked as sample data and kept away from search engines. That is about truth, not privacy.

**Freshness.** A read is kept for five minutes (the Worker's Cache API), and a page for five
minutes at the edge, so a change in the app shows here within about ten. The app has no way to
tell this site that something changed.

**When the app does not answer** (four seconds, an error, or a body that is not the shape above):

- there is an earlier copy, up to a day old → the page is served from it, status 200;
- there is none → status **503** with `Retry-After: 120`, `noindex`, not cached, and a page that
  says so plainly. Never a 404 and never an empty 200: both tell a search engine the page is gone;
- the app answers 404, 410 or 401 (sign-in required: not public) → this site answers **404**;
- the sitemap lists everything else and is kept five minutes instead of an hour.

The landing pages, the blog and the legal pages do not read the app and are not affected.

**Each page carries** its own title, a description made from its facts (type, dates, place), a
canonical link, Open Graph tags, `hreflang` for the languages the app names it in, a
schema.org `SportsEvent` or `Organization` block with only the properties the app really has (no
sport, status, image, price or performer: the app has none), and one button into the app:
`<APP_ORIGIN>/#/event/<id>?ref=site-event` or `#/org/<id>?ref=site-organisation`.

**Prove it.** With the site running (`mise run site:start` prints the address; 4321 unless
`SITE_PORT` says otherwise). No browser, no JavaScript:

```
SITE=http://localhost:4321
APP=https://remy.ubuntusoftware.net

# 1. An event the app has: its id and English name.
curl -s $APP/api/events | python3 -c "import json,sys; e=json.load(sys.stdin)['events'][0]; print(e['id'], e['name'])"

# 2. The site's address for it (/events/<id> redirects to the one with the slug).
curl -s -o /dev/null -w '%{http_code} %{redirect_url}\n' $SITE/events/evt_003

# 3. The name is in the HTML the server sent.
curl -sL $SITE/events/evt_003 | grep -o '<h1[^>]*>[^<]*</h1>'

# 4. The structured data parses, and says what it is.
curl -sL $SITE/events/evt_003 | python3 -c "
import json,re,sys
for block in re.findall(r'<script type=\"application/ld\+json\">(.*?)</script>', sys.stdin.read(), re.S):
    data = json.loads(block)
    print(data['@type'], '|', data['name'], '|', data.get('startDate', ''))"

# 5. No such event is a 404, and so is a word where an id belongs (it is never sent to the app).
curl -s -o /dev/null -w '%{http_code}\n' $SITE/events/evt_999
curl -s -o /dev/null -w '%{http_code}\n' $SITE/events/invitations

# 6. The sitemap: 0 event pages while APP_DATA_IS_REAL is "false", one per event and language after.
curl -s $SITE/sitemap.xml | grep -c '<loc>.*/events/'
```

Step 3 prints the event's name in an `<h1>`. Step 4 prints two lines: `WebSite` (EmDash's, on
every page) and `SportsEvent` with the event's name and start date. Use `org_003` under
`/organisations/` for an `Organization`.

**Not checked yet:** what Google's Rich Results Test and a LINE or Facebook preview make of a
page. Both need a deployed, public address.

## What the owner still has to supply

- The privacy policy and the terms. Both pages say what they must cover.
- A contact address or form for `/about`. It says "not published yet".
- The text in each language, reviewed by a person who reads it — Thai first. That includes the
  33 interface words the app does not have ("Dates", "Open the app", the sample-data sentence, the
  message shown when the app does not answer), which show in English until someone writes them
  in `src/i18n/messages/<code>.json`, and the Thai menu labels, which no native speaker has read.
- How content gets translated: see "Machine translation is not set up" above.
- Whether an event's free-text description may be shown (see "What is filtered").
- Real events. Production holds the app's fixture events; a page per event is worth little until
  the events are real. When they are, set `APP_DATA_IS_REAL` to `"true"` (above).
- A share image and a favicon (Settings in the admin).
- Whether posts carry a named author. None is seeded: the site names no person until that is decided.

## Not decided yet

- **The domain.** The site is deployed on Cloudflare's default address (see Deployed). Pick the real one
  before editors are invited: sign-in is tied to the domain it was set up on.

## Where the thinking is

In the emdash-run repo, under `docs/`: `remy-sport.md` (what Remy Sport is and what its site needs),
`plans/2026-10-06-our-site.md` (the plan for this site), and `remy-sport-app-and-site.md` (how the
app and this site can use each other). Every factual statement on the site comes from those.
