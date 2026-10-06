// robots.txt, replacing EmDash's default: the sitemap is named on the site's public address
// (`site` in astro.config.mjs), and a host that is not that address asks not to be indexed —
// a local machine, a preview, or workers.dev once a real domain is set.

import type { APIRoute } from "astro";

import { absoluteUrl } from "../lib/site";

export const GET: APIRoute = (context) => {
	const isPublicHost = Boolean(context.site) && context.url.host === context.site!.host;
	const isLocal = ["localhost", "127.0.0.1"].includes(context.url.hostname);
	const lines =
		isPublicHost && !isLocal
			? [
					"User-agent: *",
					"Allow: /",
					"# The admin and its API. Media files are served from under it and may be indexed.",
					"Disallow: /_emdash/",
					"Allow: /_emdash/api/media/file/",
				]
			: ["# Not the public address of this site: nothing here should be indexed.", "User-agent: *", "Disallow: /"];
	lines.push("", `Sitemap: ${absoluteUrl(context, "/sitemap.xml")}`, "");

	return new Response(lines.join("\n"), {
		headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "public, max-age=3600" },
	});
};
