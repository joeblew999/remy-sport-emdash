// The blog's RSS feed, one per language: /rss.xml, /th/rss.xml, /ja/rss.xml, …. A language with no posts of
// its own serves the English posts, as its blog index does, and links to their English addresses.

import type { APIRoute } from "astro";
import { getSiteSettingsWithCacheHint } from "emdash";

import { DEFAULT_LOCALE } from "../i18n/ui";
import { absoluteUrl, identity, isLocalePrefix, loadPosts, localeOf, localePath } from "./site";
import { escapeXml } from "./xml";

export const GET: APIRoute = async (context) => {
	if (!isLocalePrefix(context.params.locale)) return new Response("Not found\n", { status: 404 });
	const locale = localeOf(context);
	const [settings, { posts, isFallback }] = await Promise.all([
		getSiteSettingsWithCacheHint(),
		loadPosts(context, { limit: 50 }),
	]);
	if (context.cache?.enabled) context.cache.set(settings.cacheHint);
	const { siteTitle, siteTagline } = identity(settings.data, context.site ?? context.url);
	const postLocale = isFallback ? DEFAULT_LOCALE : locale;

	const items = posts
		.filter((post) => post.data.publishedAt)
		.map((post) => {
			const link = escapeXml(absoluteUrl(context, localePath(`/blog/${post.id}`, postLocale)));
			return [
				"    <item>",
				`      <title>${escapeXml(post.data.title)}</title>`,
				`      <link>${link}</link>`,
				`      <guid isPermaLink="true">${link}</guid>`,
				`      <pubDate>${post.data.publishedAt!.toUTCString()}</pubDate>`,
				`      <description>${escapeXml(post.data.excerpt ?? "")}</description>`,
				"    </item>",
			].join("\n");
		});

	const rss = [
		'<?xml version="1.0" encoding="UTF-8"?>',
		'<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">',
		"  <channel>",
		`    <title>${escapeXml(siteTitle)}</title>`,
		`    <description>${escapeXml(siteTagline)}</description>`,
		`    <link>${escapeXml(absoluteUrl(context, localePath("/blog", locale)))}</link>`,
		`    <atom:link href="${escapeXml(absoluteUrl(context, localePath("/rss.xml", locale)))}" rel="self" type="application/rss+xml"/>`,
		`    <language>${postLocale}</language>`,
		...items,
		"  </channel>",
		"</rss>",
		"",
	].join("\n");

	return new Response(rss, {
		headers: {
			"Content-Type": "application/rss+xml; charset=utf-8",
			"Cache-Control": "public, max-age=3600",
		},
	});
};
