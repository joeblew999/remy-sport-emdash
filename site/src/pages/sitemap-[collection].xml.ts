// EmDash serves a sitemap per collection at this address unless the site defines the route.
// This site has one sitemap, /sitemap.xml, so there is nothing here.

import type { APIRoute } from "astro";

export const GET: APIRoute = () => new Response("Not found. The sitemap is /sitemap.xml\n", { status: 404 });
