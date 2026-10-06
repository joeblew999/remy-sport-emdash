// The app and the help site: where they are, how this site links to them, and the only way this
// site may read the app's API. Everything that points at either goes through this file, because
// the app's URLs will change (hash routes today, real paths when its router plan lands).
//
// ────────────────────────────────────────────────────────────────────────────────────────────
// PRIVACY LINE — not negotiable.
// This site shows EVENTS and ORGANISATIONS only. It must never fetch, store, render or link to
// anything that names a person — players, rosters, coaches, parents, guardians — above all
// children. The app's API answers more than that without credentials (team rosters with
// children's names among it). That it answers is not permission. Never call a team, roster,
// player, people, game or standings endpoint from this site, and never add one to ALLOWED below.
// A `noindex` tag is not a privacy control: such a page must not be rendered at all.
// ────────────────────────────────────────────────────────────────────────────────────────────

import { env } from "cloudflare:workers";

type Vars = { APP_ORIGIN?: string; APP_API_ORIGIN?: string; HELP_ORIGIN?: string };
const vars = env as unknown as Vars;

const origin = (value: string | undefined, fallback: string) =>
	(value || fallback).replace(/\/+$/, "");

/** Where people sign in and do things. `vars.APP_ORIGIN` in wrangler.jsonc. */
export const APP_ORIGIN = origin(vars.APP_ORIGIN, "https://remy.ubuntusoftware.net");
/** Which app this site READS. Defaults to the one it links to; a local `.dev.vars` can point it at staging. */
export const APP_API_ORIGIN = origin(vars.APP_API_ORIGIN, APP_ORIGIN);
/** The how-to site. `vars.HELP_ORIGIN` in wrangler.jsonc. */
export const HELP_ORIGIN = origin(vars.HELP_ORIGIN, "https://help.remy.ubuntusoftware.net");

/** The app's screens this site links to. Not teams, players or games: see the privacy line. */
type AppRoute = { page: "home" } | { page: "discover" } | { page: "event" | "org"; id: string };

/**
 * A link into the app. `from` says which page of this site sent the visitor ("home",
 * "organisers", …); it travels as `ref=site-<from>` inside the hash, where the app's router reads it.
 */
export function appHref(route: AppRoute, from: string): string {
	const path = "id" in route ? `${route.page}/${encodeURIComponent(route.id)}` : route.page;
	const ref = `site-${from.replace(/[^a-z0-9-]/gi, "") || "page"}`;
	return `${APP_ORIGIN}/#/${path}?ref=${ref}`;
}

export function helpHref(): string {
	return `${HELP_ORIGIN}/`;
}

// The whole of what this site may ask the app: a list of events or organisations, or one of them
// by id. Anything else — and `/api/events/<id>/teams` is "anything else" — is refused here, before
// a request is made.
const ALLOWED = /^\/api\/(events|orgs)(\/[A-Za-z0-9_-]+)?$/;

export class AppApiRefused extends Error {}

/** GET one allowed path of the app's public API. No credentials are ever sent. */
export async function appApiGet(path: string, init: { signal?: AbortSignal } = {}): Promise<Response> {
	if (!ALLOWED.test(path)) {
		throw new AppApiRefused(`this site does not read ${path} — events and organisations only`);
	}
	return fetch(`${APP_API_ORIGIN}${path}`, {
		headers: { Accept: "application/json" },
		credentials: "omit",
		signal: init.signal,
	});
}
