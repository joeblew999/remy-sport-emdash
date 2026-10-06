// The words the templates print themselves (buttons, labels, notices). Page and post text is
// content, edited in the admin. Locales here must match `i18n.locales` in astro.config.mjs.
//
// THAI IS NOT REVIEWED. The `th` strings are plain interface words written without a native
// speaker. Have one review them before the Thai site is announced; a missing key falls back to
// English.

export const DEFAULT_LOCALE = "en";
export const LOCALES = ["en", "th"] as const;
export type Locale = (typeof LOCALES)[number];

/** What a reader sees in the language switch, and what `lang=` and feeds are told. */
export const LOCALE_INFO: Record<Locale, { label: string; htmlLang: string; dateLocale: string }> = {
	en: { label: "English", htmlLang: "en", dateLocale: "en-GB" },
	th: { label: "ไทย", htmlLang: "th", dateLocale: "th-TH" },
};

const en = {
	skipToContent: "Skip to content",
	openApp: "Open the app",
	help: "Help",
	rss: "RSS feed",
	language: "Language",
	primaryNav: "Main",
	footerNav: "Site",
	whoItIsFor: "Who it is for",
	readMore: "Read more",
	latestPosts: "From the blog",
	allPosts: "All posts",
	blogTitle: "Blog",
	blogDescription: "Guides to basketball events in Thailand, and news about the product.",
	noPosts: "Nothing has been published yet.",
	filterAll: "All",
	filterAudience: "For",
	filterTopic: "About",
	minRead: "min read",
	published: "Published",
	updated: "Updated",
	backToBlog: "Back to the blog",
	notTranslated: "This page is not available in Thai yet. You are reading the English version.",
	placeholder:
		"Draft. This page is a placeholder and has no legal effect. The owner's text has not been written yet.",
	notFoundTitle: "Page not found",
	notFoundBody: "There is nothing at this address.",
	goHome: "Go to the home page",
	theme: "Theme",
	themeLight: "Light",
	themeDark: "Dark",
	themeSystem: "Match my device",
};

type Key = keyof typeof en;

const th: Partial<Record<Key, string>> = {
	skipToContent: "ข้ามไปยังเนื้อหา",
	openApp: "เปิดแอป",
	help: "ช่วยเหลือ",
	rss: "ฟีด RSS",
	language: "ภาษา",
	primaryNav: "เมนูหลัก",
	footerNav: "เว็บไซต์",
	whoItIsFor: "สำหรับใคร",
	readMore: "อ่านต่อ",
	latestPosts: "จากบล็อก",
	allPosts: "โพสต์ทั้งหมด",
	blogTitle: "บล็อก",
	noPosts: "ยังไม่มีโพสต์",
	filterAll: "ทั้งหมด",
	published: "เผยแพร่เมื่อ",
	updated: "อัปเดตเมื่อ",
	backToBlog: "กลับไปที่บล็อก",
	notTranslated: "หน้านี้ยังไม่มีภาษาไทย คุณกำลังอ่านฉบับภาษาอังกฤษ",
	notFoundTitle: "ไม่พบหน้านี้",
	goHome: "ไปที่หน้าแรก",
};

const dictionaries: Record<Locale, Partial<Record<Key, string>>> = { en, th };

export function isLocale(value: string | undefined): value is Locale {
	return LOCALES.includes(value as Locale);
}

/** The interface string for `key`, in `locale` when it has one, in English when it does not. */
export function t(locale: Locale, key: Key): string {
	return dictionaries[locale][key] ?? en[key];
}

export function formatDate(locale: Locale, date: Date | null | undefined): string | null {
	if (!date) return null;
	return date.toLocaleDateString(LOCALE_INFO[locale].dateLocale, {
		year: "numeric",
		month: "long",
		day: "numeric",
	});
}
