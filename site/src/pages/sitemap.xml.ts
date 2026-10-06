// The sitemap, replacing EmDash's: one file listing every indexable page in every language it
// is published in, each with its hreflang alternates. Addresses are built on the site's public
// address (`site` in astro.config.mjs). EmDash's own cannot be used here: it would list the
// home entry at /home, and it does not know the blog index.
//
// Event and organisation pages are the app's facts (lib/entities.ts). When the app does not
// answer, the sitemap lists the rest and is kept for five minutes instead of an hour.

import type { APIRoute } from "astro";

import { DEFAULT_LOCALE, LOCALE_INFO } from "../i18n/ui";
import { appPages } from "../lib/entities";
import { absoluteUrl, publicPages } from "../lib/site";
import { escapeXml } from "../lib/xml";

export const GET: APIRoute = async (context) => {
	const url = (path: string) => escapeXml(absoluteUrl(context, path));
	const lines = [
		'<?xml version="1.0" encoding="UTF-8"?>',
		'<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">',
	];
	const [own, app] = await Promise.all([publicPages(), appPages()]);
	for (const { lastmod, versions } of [...own, ...app.groups]) {
		const fallback = versions.find((v) => v.locale === DEFAULT_LOCALE) ?? versions[0];
		for (const version of versions) {
			lines.push("  <url>", `    <loc>${url(version.path)}</loc>`);
			if (lastmod) lines.push(`    <lastmod>${lastmod.toISOString()}</lastmod>`);
			for (const other of versions) {
				lines.push(
					`    <xhtml:link rel="alternate" hreflang="${LOCALE_INFO[other.locale].htmlLang}" href="${url(other.path)}"/>`,
				);
			}
			lines.push(`    <xhtml:link rel="alternate" hreflang="x-default" href="${url(fallback.path)}"/>`, "  </url>");
		}
	}
	lines.push("</urlset>", "");

	return new Response(lines.join("\n"), {
		headers: { "Content-Type": "application/xml; charset=utf-8", "Cache-Control": `public, max-age=${app.complete ? 3600 : 300}` },
	});
};
