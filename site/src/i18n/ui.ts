// The words the templates print themselves (buttons, labels, notices). Page and post text is
// content, edited in the admin.
//
// WHICH LANGUAGES: `i18n.locales` in astro.config.mjs, read back here. Nothing in this file lists
// them again.
//
// THE WORDS: messages/<code>.json, one file per language.
//   - en.json holds every label. It is the fallback: a label a language does not have is shown
//     in English.
//   - Every other file holds only the labels the app already had in that language. They were
//     copied once, by key, from the app's own message catalogues (messages/<code>.json in the
//     app's repo, which is private — so the site carries a copy and cannot read it at build time):
//
//       language ← language            eventsTitle, orgEvents ← events   orgsTitle ← orgs_heading
//       eventsPast ← status_finished   noEvents, orgNoEvents ← no_events_yet   noOrgs ← orgs_empty
//       eventDatesUnknown ← dates_tbc  eventVenue ← venue                eventCity ← event_city
//       eventFormat ← format           eventDivisions ← event_divisions  eventOrganiser ← organised_by
//       sampleData ← sample_data       filterAll ← tab_all               notFoundBody ← route_not_found
//       theme, themeLight, themeDark, themeSystem ← theme, theme_light, theme_dark, theme_system
//
//     `_language` (the language's own name) and `_direction` are the app's `endonym` and
//     `direction` for that language.
//   - Nothing else is translated here. A label the app does not have stays English until a
//     person who reads the language writes it into that language's file. Do not machine-translate
//     into these files.

import { i18n } from "astro:config/server";

/** Every label there is: the keys of en.json. */
import en from "./messages/en.json";

export type Locale = string;
type Messages = Partial<Record<Key, string>> & { _language?: string; _direction?: string };
type Key = Exclude<keyof typeof en, "_language" | "_direction">;

if (!i18n) throw new Error("astro.config.mjs has no i18n block: the site has no languages");

export const DEFAULT_LOCALE: Locale = i18n.defaultLocale;
/** The languages the site answers in, default first: `i18n.locales` in astro.config.mjs. */
export const LOCALES: readonly Locale[] = i18n.locales.map((locale) => (typeof locale === "string" ? locale : locale.path));

const files = import.meta.glob<Messages>("./messages/*.json", { eager: true, import: "default" });
const dictionaries = new Map<Locale, Messages>(
	Object.entries(files).map(([path, messages]) => [path.slice(path.lastIndexOf("/") + 1, -".json".length), messages]),
);

export function isLocale(value: string | undefined): value is Locale {
	return value !== undefined && LOCALES.includes(value);
}

/** The interface string for `key`, in `locale` when it has one, in English when it does not. */
export function t(locale: Locale, key: Key): string {
	return dictionaries.get(locale)?.[key] ?? en[key];
}

/** Does `locale` have its own word for `key`, or is `t` handing back the English? */
export function hasLabel(locale: Locale, key: Key): boolean {
	return locale === DEFAULT_LOCALE || Boolean(dictionaries.get(locale)?.[key]);
}

/** A language's name in that language — what the language switch shows. The code when unknown. */
export function languageName(locale: Locale): string {
	return dictionaries.get(locale)?._language ?? locale;
}

/** "rtl" for a language written right to left (Arabic, Persian, Urdu); "ltr" for the rest. */
export function directionOf(locale: Locale): "ltr" | "rtl" {
	return dictionaries.get(locale)?._direction === "rtl" ? "rtl" : "ltr";
}

/** What `Intl` is asked to format dates in. English dates are written day first. */
export function dateLocale(locale: Locale): string {
	return locale === "en" ? "en-GB" : locale;
}

export function formatDate(locale: Locale, date: Date | null | undefined): string | null {
	if (!date) return null;
	return date.toLocaleDateString(dateLocale(locale), {
		year: "numeric",
		month: "long",
		day: "numeric",
	});
}
