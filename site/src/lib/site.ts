// What every page needs to know about the site: its name, its address, which language a request
// is in, and how to read content with the English fallback.

import type { AstroGlobal } from "astro";
import {
	decodeSlug,
	getEmDashCollection,
	getEmDashEntry,
	getMenuWithCacheHint,
	getSiteSettingsWithCacheHint,
	getTaxonomyTermsWithCacheHint,
} from "emdash";

import { DEFAULT_LOCALE, isLocale, LOCALES, type Locale } from "../i18n/ui";

type Ctx = Pick<AstroGlobal, "originPathname" | "site" | "url" | "cache">;

/** The `pages` entry shown at "/". */
export const HOME_SLUG = "home";
/** The `pages` entries the landing page links to, in this order. */
export const AUDIENCE_SLUGS = ["organisers", "coaches", "parents"];

/**
 * The language of a request, from the address the visitor asked for: "/th/…" is Thai, anything
 * else is English. The original path, so the 404 page (a rewrite) keeps the visitor's language.
 */
export function localeOf(Astro: Pick<AstroGlobal, "originPathname" | "url">): Locale {
	const first = (Astro.originPathname || Astro.url.pathname).split("/")[1];
	return isLocale(first) ? first : DEFAULT_LOCALE;
}

/** A site path in a language: ("/blog", "th") → "/th/blog"; ("/", "th") → "/th/". */
export function localePath(path: string, locale: Locale): string {
	const clean = path === "/" ? "/" : `/${path.replace(/^\/+|\/+$/g, "")}`;
	if (locale === DEFAULT_LOCALE) return clean;
	return clean === "/" ? `/${locale}/` : `/${locale}${clean}`;
}

/** The language-neutral path of a request: "/th/blog/x" → "/blog/x". */
export function neutralPath(pathname: string): string {
	const [, first, ...rest] = pathname.split("/");
	const path = isLocale(first) && first !== DEFAULT_LOCALE ? `/${rest.join("/")}` : pathname;
	return path.length > 1 ? path.replace(/\/+$/, "") : "/";
}

/** An absolute URL on the site's public address (`site` in astro.config.mjs), never the request's host. */
export function absoluteUrl(Astro: Pick<AstroGlobal, "site" | "url">, path: string): string {
	return new URL(path, Astro.site ?? Astro.url.origin).href;
}

/**
 * The name and tagline, from EmDash's site settings. There is no brand name in this code: an
 * unset title shows the host name, so a missing setting is obvious and a rebrand is one edit.
 */
export function identity(settings: { title?: string; tagline?: string }, url: URL) {
	return { siteTitle: settings.title || url.hostname, siteTagline: settings.tagline || "" };
}

/** The `[slug]` of a request, decoded. Null when it cannot be one ("/blog/%25"). */
export function slugParam(Astro: Pick<AstroGlobal, "params">): string | null {
	try {
		return decodeSlug(Astro.params.slug) || null;
	} catch {
		return null;
	}
}

/** What ties the versions of one entry in different languages together. */
const groupOf = (entry: { id: string; data: object }) =>
	(entry.data as { translationGroup?: string }).translationGroup ?? entry.id;

function report(Astro: Ctx, hint: Parameters<NonNullable<AstroGlobal["cache"]>["set"]>[0]) {
	if (Astro.cache?.enabled) Astro.cache.set(hint);
}

/**
 * What the layout shows on every page: the site settings and the two menus. Every page calls
 * this in its own frontmatter and hands the result to the layout, because this is also where a
 * page tells the edge cache how long it may be kept and what it was made from — and Astro
 * fixes those headers before a layout runs.
 */
export async function loadShell(Astro: Ctx, options: { cacheable?: boolean } = {}) {
	const locale = localeOf(Astro);
	const [settings, primary, footer] = await Promise.all([
		getSiteSettingsWithCacheHint(),
		getMenuWithCacheHint("primary", { locale }),
		getMenuWithCacheHint("footer", { locale }),
	]);
	if (Astro.cache?.enabled) {
		if (options.cacheable === false) {
			Astro.cache.set(false);
		} else {
			for (const result of [settings, primary, footer]) Astro.cache.set(result.cacheHint);
			// Five minutes fresh, a day stale-while-revalidate. Publishing purges by tag sooner than either.
			Astro.cache.set({ maxAge: 300, swr: 86400 });
		}
	}
	return { settings: settings.data, primary: primary.data, footer: footer.data };
}
export type Shell = Awaited<ReturnType<typeof loadShell>>;

/** One entry in the request's language, or in English when it has not been translated. */
export async function loadEntry<C extends "pages" | "posts">(
	Astro: Ctx,
	collection: C,
	slug: string,
	locale: Locale = localeOf(Astro),
) {
	const { entry, error, fallbackLocale, cacheHint } = await getEmDashEntry(collection, slug, { locale });
	if (error) console.error(`[site] ${collection}/${slug}:`, error.message);
	if (!entry) return null;
	report(Astro, cacheHint);
	const isFallback = Boolean(fallbackLocale) && fallbackLocale !== locale;
	// A page standing in for a missing translation must go when that translation is published,
	// and the translation is a different entry: tag the page with the whole collection.
	if (isFallback) report(Astro, { tags: [collection] });
	return { entry, isFallback };
}

type PostFilter = { audience?: string; topic?: string };

/** Published posts, newest first, in the request's language; English when that language has none. */
export async function loadPosts(Astro: Ctx, options: { limit: number; where?: PostFilter }) {
	const locale = localeOf(Astro);
	const query = (inLocale: Locale) =>
		getEmDashCollection("posts", {
			locale: inLocale,
			status: "published",
			orderBy: { published_at: "desc" },
			limit: options.limit,
			where: options.where,
		});
	let result = await query(locale);
	let isFallback = false;
	if (result.entries.length === 0 && locale !== DEFAULT_LOCALE) {
		report(Astro, result.cacheHint);
		result = await query(DEFAULT_LOCALE);
		isFallback = result.entries.length > 0;
	}
	if (result.error) console.error("[site] posts:", result.error.message);
	report(Astro, result.cacheHint);
	return { posts: result.entries, isFallback };
}

/** The languages that have at least one published post. */
async function postLanguages(Astro: Ctx): Promise<Locale[]> {
	const found = await Promise.all(
		LOCALES.map(async (locale) => {
			const { entries, cacheHint } = await getEmDashCollection("posts", { locale, status: "published", limit: 1 });
			report(Astro, cacheHint);
			return entries.length > 0 ? locale : null;
		}),
	);
	return found.filter((locale) => locale !== null);
}

/** Everything the landing page shows. Null when there is no home entry at all. */
export async function loadHome(Astro: Ctx) {
	const [inEachLanguage, audiencePages, { posts }] = await Promise.all([
		Promise.all(LOCALES.map((locale) => loadEntry(Astro, "pages", HOME_SLUG, locale))),
		Promise.all(AUDIENCE_SLUGS.map((slug) => loadEntry(Astro, "pages", slug))),
		loadPosts(Astro, { limit: 3 }),
	]);
	const home = inEachLanguage[LOCALES.indexOf(localeOf(Astro))];
	if (!home) return null;
	return {
		home,
		audiences: audiencePages.flatMap((found) => (found ? [found.entry] : [])),
		posts,
		// The languages the home page is really written in — what hreflang may claim.
		languages: LOCALES.filter((_, i) => inEachLanguage[i] && !inEachLanguage[i].isFallback),
	};
}

/** The blog index: posts, the two filters, and which one is on. */
export async function loadBlogIndex(Astro: Ctx) {
	const locale = localeOf(Astro);
	const active = {
		audience: Astro.url.searchParams.get("audience") || undefined,
		topic: Astro.url.searchParams.get("topic") || undefined,
	};
	const isFiltered = Boolean(active.audience || active.topic);
	// Terms are stored per language; until a term is translated its English label is shown.
	const terms = async (name: string) => {
		const inLocale = await getTaxonomyTermsWithCacheHint(name, { locale });
		report(Astro, inLocale.cacheHint);
		if (inLocale.data.length > 0 || locale === DEFAULT_LOCALE) return inLocale.data;
		return (await getTaxonomyTermsWithCacheHint(name, { locale: DEFAULT_LOCALE })).data;
	};
	const [{ posts, isFallback }, audiences, topics, languages] = await Promise.all([
		loadPosts(Astro, { limit: 50, where: isFiltered ? active : undefined }),
		terms("audience"),
		terms("topic"),
		postLanguages(Astro),
	]);
	return { posts, isFallback, audiences, topics, active, isFiltered, languages };
}

/**
 * Every public, indexable address of this site's own content, grouped so that the versions of
 * one page in different languages sit together. The sitemap is written from this.
 * Left out: placeholder pages (drafts of legal text), filtered blog lists, and anything unpublished.
 */
export async function publicPages(): Promise<{ lastmod?: Date; versions: { locale: Locale; path: string }[] }[]> {
	const groups = new Map<string, { lastmod?: Date; versions: { locale: Locale; path: string }[] }>();
	const add = (key: string, locale: Locale, path: string, updated?: Date) => {
		const group = groups.get(key) ?? { versions: [] };
		group.versions.push({ locale, path: localePath(path, locale) });
		if (updated && (!group.lastmod || updated > group.lastmod)) group.lastmod = updated;
		groups.set(key, group);
	};
	for (const locale of LOCALES) {
		const [pages, posts] = await Promise.all([
			getEmDashCollection("pages", { locale, status: "published", limit: 1000 }),
			getEmDashCollection("posts", { locale, status: "published", limit: 1000 }),
		]);
		for (const page of pages.entries) {
			if (page.data.placeholder) continue;
			const path = page.id === HOME_SLUG ? "/" : `/${page.id}`;
			add(`pages:${groupOf(page)}`, locale, path, page.data.updatedAt);
		}
		if (posts.entries.length > 0) add("blog", locale, "/blog");
		for (const post of posts.entries) {
			add(`posts:${groupOf(post)}`, locale, `/blog/${post.id}`, post.data.updatedAt);
		}
	}
	return [...groups.values()];
}
