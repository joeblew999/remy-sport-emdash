# The optional local plugin registry (the EmDash aggregator), built from source.
use lib.nu *
use site.nu

def aggregator []: nothing -> string { $env.EMDASH_DIR | path join "apps" "aggregator" }

# Clone, install and build the EmDash monorepo once, then migrate the registry's local database.
export def prepare [] {
  site clone-source emdash
  if not ($env.EMDASH_DIR | path join "node_modules" ".modules.yaml" | path exists) {
    do { cd $env.EMDASH_DIR; ^pnpm install --frozen-lockfile; ^pnpm --filter @emdash-cms/aggregator run prebuild }
  }
  cd (aggregator)
  ^pnpm run db:migrate:local
  # Without .env the aggregator fails closed (it waits for labels that never arrive locally).
  if not (".env" | path exists) { cp .env.example .env }
}

# `wrangler dev`, not the package's `vite dev`: the vite plugin resolves a workerd build that
# crashes on Durable Object SQLite.
export def serve [] { cd (aggregator); ^pnpm exec wrangler dev --port $env.REGISTRY_PORT }

# POST to one of the aggregator's admin routes with its dev token.
export def admin [route: string] {
  let token = (
    open --raw (aggregator | path join ".env") | lines | where {|l| $l | str starts-with "ADMIN_TOKEN=" }
    | get -o 0 | default "" | str replace "ADMIN_TOKEN=" ""
  )
  if ($token | is-empty) { fail "the registry has no ADMIN_TOKEN in its .env" }
  let res = (request POST $"($env.REGISTRY_URL)($route)" --headers {authorization: $"Bearer ($token)"} --timeout 60sec)
  if not ($res.status in 200..299) { fail $"the registry refused ($route): status ($res.status)" }
}
