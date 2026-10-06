// The app and the help site: where they are, how this site links to them, and the only way this
// site may read the app's API. Everything that points at either goes through this file, because
// the app's URLs will change (hash routes today, real paths when its router plan lands).
//
// ────────────────────────────────────────────────────────────────────────────────────────────
// PRIVACY LINE — not negotiable.
// This site shows EVENTS and ORGANISATIONS only. It must never fetch, store, render or link to
// anything that names a person — players, rosters, coaches, parents, guardians — above all
// children. Whatever else the app's API would answer is not permission. Never call a team, roster,
// player, people, game or standings endpoint from this site, and never add one to ALLOWED below.
// A `noindex` tag is not a privacy control: such a page must not be rendered at all.
//
// It holds by construction, in three ways:
//   1. This module exports four reads — listEvents, getEvent, listOrgs, getOrg — and no way to
//      ask for any other path. The one function that makes a request is private.
//   2. A response never leaves here as the app sent it. `toEvent` and `toOrg` build a new object
//      from named fields; a field that is not copied does not exist for a template. An event's
//      `organizerName` and `organizerUserId` name a person, so they are not copied. Neither is
//      its free-text `description` (nothing stops an organiser naming a coach in it), nor `can`,
//      nor the team, game and follower counts.
//   3. Only that projection is cached. What the app sent is dropped when the function returns.
// ────────────────────────────────────────────────────────────────────────────────────────────

import { env } from "cloudflare:workers";

type Vars = { APP_ORIGIN?: string; APP_API_ORIGIN?: string; HELP_ORIGIN?: string; APP_DATA_IS_REAL?: string };
const vars = env as unknown as Vars;

const origin = (value: string | undefined, fallback: string) =>
	(value || fallback).replace(/\/+$/, "");

/** Where people sign in and do things. `vars.APP_ORIGIN` in wrangler.jsonc. */
export const APP_ORIGIN = origin(vars.APP_ORIGIN, "https://remy.ubuntusoftware.net");
/** Which app this site READS. Defaults to the one it links to; a local `.dev.vars` can point it at staging. */
export const APP_API_ORIGIN = origin(vars.APP_API_ORIGIN, APP_ORIGIN);
/**
 * Are the app's events and organisations real ones? Only when `vars.APP_DATA_IS_REAL` is "true".
 * Until then they are the app's sample entries — invented events under real schools' names — so
 * the pages say so, ask not to be indexed, and stay out of the sitemap. This is about truth, not
 * privacy: the privacy line above holds either way.
 */
export const APP_DATA_IS_REAL = vars.APP_DATA_IS_REAL === "true";
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

// ── Reading the app ─────────────────────────────────────────────────────────────────────────

/** A name in the two languages this site has. The app sends up to 27; the rest are dropped. */
export type Names = { en: string | null; th: string | null };

/** An event, as far as this site is concerned. See the privacy line for what is left out. */
export type PublicEvent = {
	id: string;
	names: Names;
	/** The app's codes, as sent: "LEAGUE", "5x5", "CHIANG_MAI". */
	typeCode: string | null;
	formatCode: string | null;
	cityCode: string | null;
	/** Calendar dates, "2026-04-15", in the event's own timezone. */
	startDate: string | null;
	endDate: string | null;
	/** The organisation behind the event, when it has one. Never the person. */
	orgId: string | null;
	/** The primary venue. */
	venueNames: Names | null;
	divisionNames: Names[];
	updatedAt: string | null;
};

export type PublicOrg = {
	id: string;
	/** The app's own slug for the organisation. */
	slug: string | null;
	names: Names;
	orgTypeCode: string | null;
	cityCode: string | null;
};

/**
 * What a read can come to. `stale` means the app did not answer and this is the last copy it
 * gave. "missing" is the app saying there is no such thing; "unavailable" is the app not saying.
 */
export type AppRead<T> = { ok: true; data: T; stale: boolean } | { ok: false; reason: "missing" | "unavailable" };

type Raw = Record<string, unknown>;
const isObject = (value: unknown): value is Raw => typeof value === "object" && value !== null && !Array.isArray(value);
const text = (value: unknown) => (typeof value === "string" && value.trim() ? value.trim() : null);
const day = (value: unknown) => (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null);
// An id of the app's: "evt_003", "org_010", or a UUID. Every one has a digit in it, and none of
// the app's own route words has ("invitations", "mine", "members") — so a word in the place of an
// id is never sent to the app, where it would be a different operation.
const ID = /^(?=[A-Za-z_-]*\d)[A-Za-z0-9_-]{1,64}$/;
const id = (value: unknown) => (typeof value === "string" && ID.test(value) ? value : null);

function toNames(value: unknown, plain?: unknown): Names {
	const raw = isObject(value) ? value : {};
	return { en: text(raw.en) ?? text(plain), th: text(raw.th) };
}
const hasName = (names: Names) => Boolean(names.en || names.th);

/** The whole of what a template may know about an event. Every field is copied by name. */
function toEvent(value: unknown): PublicEvent | null {
	if (!isObject(value)) return null;
	const eventId = id(value.id);
	const names = toNames(value.names, value.name);
	if (!eventId || !hasName(names)) return null;
	const venue = toNames(value.venueNames);
	const divisions = Array.isArray(value.divisionNames) ? value.divisionNames.map((d) => toNames(d)) : [];
	return {
		id: eventId,
		names,
		typeCode: text(value.typeCode),
		formatCode: text(value.formatCode),
		cityCode: text(value.cityCode),
		startDate: day(value.startDate),
		endDate: day(value.endDate),
		orgId: id(value.orgId),
		venueNames: hasName(venue) ? venue : null,
		divisionNames: divisions.filter(hasName),
		updatedAt: text(value.updatedAt),
	};
}

function toOrg(value: unknown): PublicOrg | null {
	if (!isObject(value)) return null;
	const orgId = id(value.id);
	const names = toNames(value.names);
	if (!orgId || !hasName(names)) return null;
	return {
		id: orgId,
		slug: text(value.slug),
		names,
		orgTypeCode: text(value.orgTypeCode),
		cityCode: text(value.cityCode),
	};
}

const toList =
	<T>(key: string, one: (value: unknown) => T | null) =>
	(value: unknown): T[] | null => {
		const rows = isObject(value) ? value[key] : null;
		return Array.isArray(rows) ? rows.flatMap((row) => one(row) ?? []) : null;
	};

// The whole of what this site may ask the app: a list of events or organisations, or one of them
// by id. Anything else — and `/api/events/<id>/teams` is "anything else" — is refused here, before
// a request is made. The second segment must be an id (see ID): `/api/events/invitations` is the
// app's list of the people invited to co-organise, and is refused too.
const ALLOWED = /^\/api\/(events|orgs)(\/(?=[A-Za-z_-]*\d)[A-Za-z0-9_-]{1,64})?$/;

/** How long the app is given to answer before a page stops waiting. */
const TIMEOUT_MS = 4000;
/** How long a copy is used without asking again. The same five minutes a page is cached for. */
const FRESH_MS = 5 * 60 * 1000;
/** How long a copy is kept for the day the app does not answer. */
const KEEP_SECONDS = 24 * 60 * 60;

/** Where a copy lives in the Worker's cache (the Cache API). Not an address anything answers. */
const copyKey = (path: string) => `https://app-copy.invalid/v1/${encodeURIComponent(APP_API_ORIGIN)}${path}`;

async function copies(): Promise<Cache | null> {
	try {
		return await caches.open("app-copies");
	} catch {
		return null;
	}
}

/**
 * GET one allowed path, with no credentials, and hand back only what `project` copies out of it.
 * Private: the four functions below are the only callers there can be.
 */
async function read<T>(path: string, project: (value: unknown) => T | null): Promise<AppRead<T>> {
	if (!ALLOWED.test(path)) return { ok: false, reason: "missing" };

	const cache = await copies();
	const key = copyKey(path);
	let copy: { at: number; data: T } | null = null;
	try {
		const hit = await cache?.match(key);
		if (hit) copy = await hit.json();
	} catch {
		// A cache that cannot be read is a cache miss.
	}
	if (copy && Date.now() - copy.at < FRESH_MS) return { ok: true, data: copy.data, stale: false };

	const lastCopy = (why: string): AppRead<T> => {
		console.error(`[app] ${path}: ${why}`);
		return copy ? { ok: true, data: copy.data, stale: true } : { ok: false, reason: "unavailable" };
	};

	let response: Response;
	try {
		response = await fetch(`${APP_API_ORIGIN}${path}`, {
			headers: { Accept: "application/json" },
			credentials: "omit",
			// A redirect is not followed: it would be a request to a path this file did not check.
			redirect: "manual",
			signal: AbortSignal.timeout(TIMEOUT_MS),
		});
	} catch (error) {
		return lastCopy(error instanceof Error ? error.message : "no answer");
	}
	// 404 and 410: the app says it is gone. 401: it is something only a signed-in person may
	// read, which this site never shows. Either way there is no such page here, and no copy.
	if (response.status === 404 || response.status === 410 || response.status === 401) {
		await cache?.delete(key).catch(() => {});
		return { ok: false, reason: "missing" };
	}
	if (!response.ok) return lastCopy(`status ${response.status}`);

	let data: T | null;
	try {
		data = project(await response.json());
	} catch {
		data = null;
	}
	if (data === null) return lastCopy("not the shape this site reads");

	try {
		await cache?.put(
			key,
			new Response(JSON.stringify({ at: Date.now(), data }), {
				headers: { "Content-Type": "application/json", "Cache-Control": `public, max-age=${KEEP_SECONDS}` },
			}),
		);
	} catch {
		// Without a cache every page asks the app; nothing else changes.
	}
	return { ok: true, data, stale: false };
}

const missing = <T>(): Promise<AppRead<T>> => Promise.resolve({ ok: false, reason: "missing" });

/** `GET /api/events` — every event, in the app's order (by start date). */
export const listEvents = () => read("/api/events", toList("events", toEvent));

/** `GET /api/events/{id}` — one event. An id that cannot be one is "missing" without asking. */
export const getEvent = (eventId: string) =>
	ID.test(eventId) ? read(`/api/events/${eventId}`, toEvent) : missing<PublicEvent>();

/** `GET /api/orgs` — every organisation, in the app's order (by slug). */
export const listOrgs = () => read("/api/orgs", toList("orgs", toOrg));

/** `GET /api/orgs/{id}` — one organisation's profile. Never its members. */
export const getOrg = (orgId: string) => (ID.test(orgId) ? read(`/api/orgs/${orgId}`, toOrg) : missing<PublicOrg>());

