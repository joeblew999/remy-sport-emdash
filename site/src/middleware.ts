// Astro asks for this file because `i18n.routing` is "manual" (astro.config.mjs): the site does
// its own language routing, and it does it in the routes — src/pages/[...locale]/ — not here.
// So there is nothing to do on the way in or out.

import type { MiddlewareHandler } from "astro";

export const onRequest: MiddlewareHandler = (_context, next) => next();
