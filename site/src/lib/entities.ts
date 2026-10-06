// Event and organisation pages: their addresses, what each one loads, and the structured data it
// carries. The facts are the app's, read through lib/app.ts — which is also where the privacy
// line is enforced. Nothing here can reach a field that file did not copy.

import type { AstroGlobal } from "astro";

import { DEFAULT_LOCALE, LOCALE_INFO, LOCALES, type Locale } from "../i18n/ui";
import { APP_DATA_IS_REAL, getEvent, getOrg, listEvents, listOrgs, type Names, type PublicEvent, type PublicOrg } from "./app";
import { absoluteUrl, localeOf, localePath } from "./site";

type Ctx = Pick<AstroGlobal, "originPathname" | "site" | "url" | "params">;

// ── Names, codes and dates ──────────────────────────────────────────────────────────────────

/** A name in a language, or in the other one when the app has none in that language. */
export function nameIn(names: Names, locale: Locale): string {
	return names[locale] ?? names.en ?? names.th ?? "";
}

/** The languages a thing is really named in: what hreflang and the sitemap may claim. */
export function languagesOf(names: Names): Locale[] {
	const named = LOCALES.filter((locale) => names[locale]);
	return named.length > 0 ? named : [DEFAULT_LOCALE];
}

/** One of the app's codes, readable: "CHIANG_MAI" → "Chiang Mai", "LEAGUE" → "League", "5x5" → "5x5". */
export function codeLabel(code: string | null): string | null {
	if (!code) return null;
	if (!/^[A-Z][A-Z_]*$/.test(code)) return code;
	return code
		.split("_")
		.map((word) => word[0] + word.slice(1).toLowerCase())
		.join(" ");
}

const asDate = (day: string) => new Date(`${day}T00:00:00Z`);

/** "15 April 2026", from a calendar date. Formatted in UTC so the day never slips. */
export function dayLabel(locale: Locale, day: string): string {
	return asDate(day).toLocaleDateString(LOCALE_INFO[locale].dateLocale, {
		year: "numeric",
		month: "long",
		day: "numeric",
		timeZone: "UTC",
	});
}

/** "15 April 2026 – 19 April 2026", one date when it is one day, null when the app has neither. */
export function dateRange(locale: Locale, event: Pick<PublicEvent, "startDate" | "endDate">): string | null {
	const { startDate, endDate } = event;
	if (!startDate) return endDate ? dayLabel(locale, endDate) : null;
	if (!endDate || endDate === startDate) return dayLabel(locale, startDate);
	return `${dayLabel(locale, startDate)} – ${dayLabel(locale, endDate)}`;
}

/** Has it finished? By the calendar date, which is all the app gives. */
export function isPast(event: PublicEvent, today = new Date().toISOString().slice(0, 10)): boolean {
	const last = event.endDate ?? event.startDate;
	return last !== null && last < today;
}

/** Venue and city on one line, as far as the app knows either. */
export function placeLabel(locale: Locale, event: PublicEvent): string | null {
	const parts = [event.venueNames && nameIn(event.venueNames, locale), codeLabel(event.cityCode)];
	return parts.filter(Boolean).join(", ") || null;
}

// ── Addresses ───────────────────────────────────────────────────────────────────────────────

/** A name as a URL segment: "Saint Gabriel's College" → "saint-gabriels-college". Empty for a name with no Latin letters. */
export function slugify(name: string | null): string {
	return (name ?? "")
		.normalize("NFKD")
		.replace(/[̀-ͯ]/g, "")
		.replace(/['’]/g, "")
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 80);
}

// The id is what is looked up. The slug is for people, is made from the English name so both
// languages share it, and may change when the name does — a stale one redirects.
const eventSlug = (event: PublicEvent) => slugify(event.names.en);
const orgSlug = (org: PublicOrg) => slugify(org.slug) || slugify(org.names.en);
const withSlug = (base: string, slug: string) => (slug ? `${base}/${slug}` : base);

/** "/events/evt_002/bangkok-schools-basketball-league-2026", without a language prefix. */
export const eventPath = (event: PublicEvent) => withSlug(`/events/${event.id}`, eventSlug(event));
/** "/organisations/org_003/montfort-college", without a language prefix. */
export const orgPath = (org: PublicOrg) => withSlug(`/organisations/${org.id}`, orgSlug(org));

// ── What each page loads ────────────────────────────────────────────────────────────────────

/**
 * What a detail page can come to. "missing" is a 404. "moved" is a redirect to the address with
 * the right slug. "unavailable" is the app not answering and no copy to show: a 503, never a 404
 * and never an empty 200, because both tell a search engine the page is gone.
 */
type Found<T> = { kind: "missing" } | { kind: "unavailable" } | { kind: "moved"; to: string } | ({ kind: "ok" } & T);

/** The address a request should have had, when it is not the one it has. */
function movedFrom(Astro: Ctx, path: string): string | null {
	const right = localePath(path, localeOf(Astro));
	return Astro.url.pathname.replace(/\/+$/, "") === right ? null : right;
}

/** "/events/<id>/<slug>" */
export async function loadEventPage(Astro: Ctx): Promise<Found<{ event: PublicEvent; org: PublicOrg | null }>> {
	const found = await getEvent(Astro.params.id ?? "");
	if (!found.ok) return { kind: found.reason };
	const event = found.data;
	const to = movedFrom(Astro, eventPath(event));
	if (to) return { kind: "moved", to };
	// The organiser is a link, not the page: if the app will not say, the page does without.
	const org = event.orgId ? await getOrg(event.orgId) : null;
	return { kind: "ok", event, org: org?.ok ? org.data : null };
}

/** "/organisations/<id>/<slug>" */
export async function loadOrgPage(Astro: Ctx): Promise<Found<{ org: PublicOrg; events: PublicEvent[] }>> {
	const found = await getOrg(Astro.params.id ?? "");
	if (!found.ok) return { kind: found.reason };
	const org = found.data;
	const to = movedFrom(Astro, orgPath(org));
	if (to) return { kind: "moved", to };
	const events = await listEvents();
	return { kind: "ok", org, events: events.ok ? events.data.filter((event) => event.orgId === org.id) : [] };
}

/** "/events". Null when the app did not answer and there is no copy. */
export async function loadEventsIndex(): Promise<{ upcoming: PublicEvent[]; past: PublicEvent[] } | null> {
	const found = await listEvents();
	if (!found.ok) return null;
	return {
		upcoming: found.data.filter((event) => !isPast(event)),
		// The app lists oldest first; the most recently finished event is the one people look for.
		past: found.data.filter((event) => isPast(event)).reverse(),
	};
}

/** "/organisations". Null when the app did not answer and there is no copy. */
export async function loadOrgsIndex(): Promise<PublicOrg[] | null> {
	const found = await listOrgs();
	return found.ok ? found.data : null;
}

/**
 * A page that could not be built because the app did not answer: 503, try again in two minutes,
 * and nothing is cached. Call before `loadShell(Astro, { cacheable: false })`.
 */
export function markUnavailable(Astro: Pick<AstroGlobal, "response">) {
	Astro.response.status = 503;
	Astro.response.headers.set("Retry-After", "120");
}

// ── The sitemap ─────────────────────────────────────────────────────────────────────────────

type SitemapGroup = { lastmod?: Date; versions: { locale: Locale; path: string }[] };

/**
 * Every event and organisation page, for the sitemap, in the languages each is named in —
 * once the app's data is real (APP_DATA_IS_REAL). Until then, none.
 * `complete` is false when the app did not answer: the sitemap then lists what it can and is
 * not kept for long.
 */
export async function appPages(): Promise<{ groups: SitemapGroup[]; complete: boolean }> {
	// Sample data is not offered to a search engine: nothing is listed, and the app is not asked.
	if (!APP_DATA_IS_REAL) return { groups: [], complete: true };
	const [events, orgs] = await Promise.all([listEvents(), listOrgs()]);
	const groups: SitemapGroup[] = [];
	const add = (path: string, locales: readonly Locale[], updated?: string | null) => {
		const lastmod = updated ? new Date(updated) : undefined;
		groups.push({
			lastmod: lastmod && !Number.isNaN(lastmod.getTime()) ? lastmod : undefined,
			versions: locales.map((locale) => ({ locale, path: localePath(path, locale) })),
		});
	};
	if (events.ok) {
		add("/events", LOCALES);
		for (const event of events.data) add(eventPath(event), languagesOf(event.names), event.updatedAt);
	}
	if (orgs.ok) {
		add("/organisations", LOCALES);
		for (const org of orgs.data) add(orgPath(org), languagesOf(org.names));
	}
	return { groups, complete: events.ok && orgs.ok };
}

// ── Structured data ─────────────────────────────────────────────────────────────────────────
// schema.org, from fields the app really gave. A property with nothing behind it is left out,
// not guessed: there is no sport, status, image, price or performer because the app has none.

type Site = Pick<AstroGlobal, "site" | "url">;
type JsonLd = Record<string, unknown>;

const dropEmpty = (thing: JsonLd): JsonLd =>
	Object.fromEntries(Object.entries(thing).filter(([, value]) => value !== null && value !== undefined));

/** The name in the page's language, and the other language's as `alternateName`. */
function named(names: Names, locale: Locale) {
	const name = nameIn(names, locale);
	const other = LOCALES.map((l) => names[l]).find((n) => n && n !== name);
	return { name, alternateName: other ?? null };
}

export function organizationJsonLd(Astro: Site, org: PublicOrg, locale: Locale): JsonLd {
	const city = codeLabel(org.cityCode);
	return dropEmpty({
		"@context": "https://schema.org",
		"@type": "Organization",
		...named(org.names, locale),
		url: absoluteUrl(Astro, localePath(orgPath(org), locale)),
		address: city ? { "@type": "PostalAddress", addressLocality: city } : null,
	});
}

export function sportsEventJsonLd(Astro: Site, event: PublicEvent, org: PublicOrg | null, locale: Locale): JsonLd {
	const city = codeLabel(event.cityCode);
	const venue = event.venueNames ? nameIn(event.venueNames, locale) : null;
	const address = city ? { "@type": "PostalAddress", addressLocality: city } : null;
	return dropEmpty({
		"@context": "https://schema.org",
		"@type": "SportsEvent",
		...named(event.names, locale),
		url: absoluteUrl(Astro, localePath(eventPath(event), locale)),
		startDate: event.startDate,
		endDate: event.endDate,
		location: venue || address ? dropEmpty({ "@type": "Place", name: venue ?? city, address }) : null,
		organizer: org
			? dropEmpty({
					"@type": "Organization",
					name: nameIn(org.names, locale),
					url: absoluteUrl(Astro, localePath(orgPath(org), locale)),
				})
			: null,
	});
}
