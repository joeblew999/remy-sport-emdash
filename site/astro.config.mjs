import cloudflare from "@astrojs/cloudflare";
import react from "@astrojs/react";
import { access, d1, r2 } from "@emdash-cms/cloudflare";
import { defineConfig, fontProviders } from "astro/config";
import { cacheCloudflare } from "@astrojs/cloudflare/cache";
import emdash from "emdash/astro";

// The site's public address. The real domain is undecided, so it is a setting, not a constant:
// CANONICAL_URL, else LIVE_URL (mise.toml), else this machine. `astro dev` always
// uses this machine, so setting either for a deploy never breaks local sign-in.
const isDev = process.argv.includes("dev");
const localUrl = `http://localhost:${process.env.SITE_PORT || 4321}`;
const publicUrl = (!isDev && (process.env.CANONICAL_URL || process.env.LIVE_URL)) || "";
const site = publicUrl || localUrl;

// THE LANGUAGES. This is the one list: Astro and EmDash are both configured from it, and the
// site's own code reads it back (src/i18n/ui.ts, through `astro:config/server`). It is the app's
// list — `locales` in the app's project.inlang/settings.json — so the site and the app speak the
// same languages under the same codes. English is the default and has no prefix (a prefixed
// default locale 404s the EmDash admin); every other language is under /<code>/.
const defaultLocale = "en";
const locales = [
	"en", "th", "ja", "zh", "es", "pt", "id", "fr", "tl", "vi", "ko", "de", "ru", "tr",
	"it", "pl", "uk", "hi", "ar", "ms", "bn", "zh-TW", "zh-HK", "ur", "fa", "sw", "nl",
];
// Every other language falls back to English. (`any`: Astro types `fallback` from a literal list
// of locales, and this one is computed.)
const fallback = /** @type {any} */ (
	Object.fromEntries(locales.filter((l) => l !== defaultLocale).map((l) => [l, defaultLocale]))
);

export default defineConfig({
	site,
	output: "server",
	adapter: cloudflare(),
	i18n: {
		defaultLocale,
		locales,
		// EmDash's fallback chain: an entry with no published translation is served in English.
		fallback,
		// One set of routes serves every language: src/pages/[...locale]/ takes the language from
		// the address, and nothing is redirected or rewritten on the way. "manual" keeps Astro's
		// own fallback out of it — tried first, it answered /about/fr with the About page and
		// served the admin a second time under every language prefix.
		routing: "manual",
	},
	// Edge cache: pages report what they read (Astro.cache.set), EmDash purges by tag on publish.
	// Cloudflare only — in dev there is no cache in front of the Worker.
	cache: { provider: cacheCloudflare() },
	image: {
		layout: "constrained",
		responsiveStyles: true,
	},
	integrations: [
		react(),
		emdash({
			database: d1({ binding: "DB", session: "auto" }),
			storage: r2({ binding: "MEDIA" }),
			// Sign-in on the deployed site is Cloudflare Access, in front of /_emdash: people by a code
			// sent to their address, machines by a service token (mise run signin:access set both up
			// and printed this line). The audience is CF_ACCESS_AUDIENCE in wrangler.jsonc. The dev
			// site (site:start) still signs you in by itself.
			auth: access({ teamDomain: "gedw99.cloudflareaccess.com", audienceEnvVar: "CF_ACCESS_AUDIENCE" }),
		}),
	],
	fonts: [
		{
			provider: fontProviders.google(),
			name: "Inter",
			cssVariable: "--font-body",
			weights: [400, 500, 600, 700],
			fallbacks: ["sans-serif"],
		},
		{
			provider: fontProviders.google(),
			name: "Noto Sans Thai",
			cssVariable: "--font-thai",
			weights: [400, 500, 600, 700],
			fallbacks: ["sans-serif"],
		},
	],
	devToolbar: { enabled: false },
});
