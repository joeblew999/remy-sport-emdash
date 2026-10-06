# remy-sport-emdash

The public site for **Remy Sport** — the pages a person or a search engine can read without
signing in: what it is, who it is for, the blog, and (next) events. Built on
[EmDash](https://docs.emdashcms.com) with the [emdash-run](https://github.com/joeblew999/emdash-run)
harness.

The Remy Sport **app** is a separate repo and a separate deployment. It stays the place where
people sign in and do things. This site is how they find it.

## Run it

You need [mise](https://mise.jdx.dev) and git.

```
mise trust --all
mise run setup       first time on a machine: install and bring the site up
mise run open        the admin, signed in
mise run status      what is running, and on what
mise run check       before a commit — the git hook runs it
```

Build the site in `site/` — pages, layouts, components, the seed. The dev server reloads your
edits. Run `mise run dev` after changing `mise.toml`, the seed, or a plugin.

## What is decided

| | |
|---|---|
| What this is | The public, crawlable side of Remy Sport: landing page, pages for organisers, coaches and parents, the blog, and event and organisation pages rendered from the app's public API |
| What it is not | A second app. Nobody signs in here except editors. Accounts, teams, players, games and live video stay in the app |
| Platform | Cloudflare (Workers, D1, R2), on the free plan to start |
| Started from | EmDash's `blog-cloudflare` template; `site/` is ours from here on |
| Name | "Remy Sport" is the working title. Keep the name in the site settings and the seed — never hardcode it in a page — so a rebrand is one edit |
| Privacy line | Only events and organisations are shown. Nothing that names a person — above all a child — is ever rendered here, whatever the app's API will hand over |
| Editors | Gerard as Admin, Remy as Editor |
| Repo | Public. No licence yet — all rights reserved until one is chosen |

## How the site is put together

Everything is in `site/`.

| where | what |
|---|---|
| `seed/seed.json` | The content model and the first content: two collections (`pages`, `posts`), two taxonomies on posts (`audience`, `topic`), the `primary` and `footer` menus in both languages, and the site settings that carry the name and tagline. No events, organisations, teams or people: those are the app's |
| `src/layouts/Base.astro` | The one layout: header, footer, menus, language switch, and the whole `<head>` — title, description, canonical, Open Graph and Twitter tags, `hreflang`, the RSS link |
| `src/lib/site.ts` | What every page needs: the language of a request, paths and absolute URLs, loading an entry with the English fallback, and `loadShell`, which every page calls first (settings, menus, and what the edge cache is told) |
| `src/lib/app.ts` | The only place that knows where the app and the help site are, builds links into them, and may read the app's API. The privacy line is written and enforced there |
| `src/i18n/ui.ts` | The words the templates print themselves (buttons, labels, notices), in English and Thai |
| `src/views/` | What each kind of page looks like |
| `src/pages/` | The routes. Each is a few lines: load, then hand to a view. `src/pages/th/` holds the same routes for Thai |

The name is never written in a page. It is the `title` setting (Settings in the admin; `settings` in
the seed). An unset title shows the host name, so a missing setting is obvious.

### Settings a deployment needs

| setting | where | what |
|---|---|---|
| `CANONICAL_URL`, else `DEPLOY_URL` | the environment of the build (`DEPLOY_URL` is in `mise.toml`) | The site's public address: `site:` in `astro.config.mjs`. Canonical links, the sitemap, `robots.txt`, RSS and share tags are all built from it, never from the host that answered. Unset, it is this machine. `astro dev` always uses this machine |
| `APP_ORIGIN`, `HELP_ORIGIN` | `vars` in `site/wrangler.jsonc` | Where "Open the app" and "Help" go |
| `APP_API_ORIGIN` | `site/.dev.vars` (gitignored), or `vars` | Which app the site reads. Defaults to `APP_ORIGIN`. Point a local or preview site at the app's staging twin, which holds fixtures only |
| `SITE_PORT` | `mise.local.toml` (gitignored) | The local port, when 4321 is taken |

### Two languages

English is the default and has no prefix; Thai is under `/th/`. (A prefixed default language breaks
the EmDash admin.) Each entry exists once per language, linked as translations of each other.

- A page with no **published** Thai version shows the English text at its `/th/` address, with a
  notice saying so, and its canonical link points at the English page. It is not a 404.
- `hreflang` and the sitemap name only the languages a page is really published in.
- **The Thai is not written.** The seed holds a Thai draft of every page, titled
  "[TH — needs translation]", and Thai menu labels and interface words (`src/i18n/ui.ts`) that no
  native speaker has reviewed. Translate in the admin, have a person who reads Thai review it, then
  publish. Nothing Thai is published until someone does.

### What it sets that the template did not

- `site:` from the environment (above), and a canonical link on every page.
- `robots.txt` (`src/pages/robots.txt.ts`) names the sitemap. On any host that is not the public
  address — this machine, a preview — it disallows everything.
- `sitemap.xml` (`src/pages/sitemap.xml.ts`): one file, every indexable page in every language it
  is published in. It replaces EmDash's, which would list the home entry at `/home`.
- RSS for the blog at `/rss.xml` and `/th/rss.xml`.
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
| `/th/…` | this site — every address above, in Thai | built; Thai text not written |
| `/events` | this site, from the app's `GET /api/events` — a list that links into the app | next stage |
| `/events/<id>/<slug>` | this site, from `GET /api/events/<id>`. The id is what is looked up; the slug is made from the name and a wrong one redirects to the right one | next stage |
| `/organisations`, `/organisations/<id>/<slug>` | this site, from `GET /api/orgs` and `/api/orgs/<id>`, same rules | next stage |
| `/_emdash/…` | this site — the admin and its API. Editors only; disallowed in `robots.txt` | built |
| everything a signed-in person does | the app, `https://remy.ubuntusoftware.net/#/…` today | the app's |
| how-to | the help site, `https://help.remy.ubuntusoftware.net/` | the app's |
| teams, rosters, players, coaches, games, live scores, standings | **nobody on this site, ever** — see the privacy line | — |

Links into the app are built by `appHref()` in `src/lib/app.ts` and carry `ref=site-<page>` inside
the hash, which the app's router already parses. When the app moves from hash routes to real paths,
that function is the one edit.

## What the owner still has to supply

- The privacy policy and the terms. Both pages say what they must cover.
- A contact address or form for `/about`. It says "not published yet".
- The Thai text, reviewed by a native speaker.
- A share image and a favicon (Settings in the admin).
- Whether posts carry a named author. None is seeded: the site names no person until that is decided.

## Not decided yet

- **The domain.** The site is built and reviewed on Cloudflare's default address. Pick the real one
  before editors are invited: sign-in is tied to the domain it was set up on.
- **Languages.** English and Thai are assumed.

## Where the thinking is

In the harness repo, under `docs/`: `remy-sport.md` (what Remy Sport is and what its site needs),
`plans/2026-10-06-our-site.md` (the plan for this site), and `remy-sport-app-and-site.md` (how the
app and this site can use each other). Every factual statement on the site comes from those.
