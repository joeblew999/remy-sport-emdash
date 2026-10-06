import cloudflare from "@astrojs/cloudflare";
import react from "@astrojs/react";
import { d1, r2 } from "@emdash-cms/cloudflare";
import { defineConfig, fontProviders } from "astro/config";
import { cacheCloudflare } from "@astrojs/cloudflare/cache";
import emdash from "emdash/astro";

// The site's public address. The real domain is undecided, so it is a setting, not a constant:
// CANONICAL_URL, else the harness's DEPLOY_URL (mise.toml), else this machine. `astro dev` always
// uses this machine, so setting either for a deploy never breaks local sign-in.
const isDev = process.argv.includes("dev");
const localUrl = `http://localhost:${process.env.SITE_PORT || 4321}`;
const publicUrl = (!isDev && (process.env.CANONICAL_URL || process.env.DEPLOY_URL)) || "";
const site = publicUrl || localUrl;

// English is the default and has no prefix (a prefixed default locale 404s the EmDash admin);
// Thai is under /th/. Keep in step with `defaultLocale` in seed/seed.json and src/i18n/ui.ts.
export const locales = ["en", "th"];

export default defineConfig({
	site,
	output: "server",
	adapter: cloudflare(),
	i18n: {
		defaultLocale: "en",
		locales,
		// No `fallback`: every Thai route exists (src/pages/th/), and EmDash itself falls back to
		// the English entry when a page has no published Thai version.
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
