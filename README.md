# remy-sport-emdash

The public site for **Remy Sport** — the pages a person or a search engine can read without
signing in: what it is, who it is for, the blog, and (soon) events. Built on
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
| Repo | Private. No open licence |

## Not decided yet

- **The domain.** The site is built and reviewed on Cloudflare's default address. Pick the real one
  before editors are invited: sign-in is tied to the domain it was set up on.
- **Languages.** English and Thai are assumed.

## Where the thinking is

In the harness repo, under `docs/`: `remy-sport.md` (what Remy Sport is and what its site needs),
`plans/2026-10-06-our-site.md` (the plan for this site), and `remy-sport-app-and-site.md` (how the
app and this site can use each other).
