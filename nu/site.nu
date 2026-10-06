# The project's site (site/): creating it from a template, installing, seeding, serving, shipping.
use lib.nu *

def site-file [...parts: string]: nothing -> string { $env.SITE_DIR | path join ...$parts }

# Shallow clone, or update, at one ref.
def checkout [repo: string, dir: string, ref: string] {
  mkdir ($dir | path dirname)
  if ($dir | path join ".git" | path exists) {
    ^git -C $dir fetch --quiet --depth 1 origin $ref
    ^git -C $dir checkout -q FETCH_HEAD
  } else {
    ^git clone --quiet --depth 1 --branch $ref $repo $dir
  }
}

# What the harness generates must not be committed. Adds any missing line to the project's .gitignore.
export def ensure-ignored [] {
  let file = ($env.ROOT | path join ".gitignore")
  let have = (if ($file | path exists) { open --raw $file | lines } else { [] })
  let missing = ([".src/" "/run/" "node_modules/" ".env" "/.claude/skills/"] | where {|line| not ($line in $have) })
  if ($missing | is-not-empty) {
    $"($missing | str join (char nl))(char nl)" | save --append $file
    ok $".gitignore ← ($missing | str join ' ')"
  }
}

# The reference checkouts under .src/: the official templates, the EmDash source at the version the
# site runs, and EmDash's own production site — the one real EmDash site whose source we can read.
def sources []: nothing -> table {
  [
    [name repo ref];
    [templates $env.TEMPLATES_REPO "main"]
    [emdash $env.EMDASH_REPO $"emdash@($env.EMDASH_VERSION)"]
    ["emdashcms.com" $env.SITE_EXAMPLE_REPO "main"]
  ]
}

# Clone or update one of them by name.
export def clone-source [name: string] {
  let source = (sources | where name == $name | get -o 0)
  if $source == null { fail $"no reference checkout called ($name)" $"known: (sources | get name | str join ', ')" }
  let dir = ($env.SRC_DIR | path join $name)
  checkout $source.repo $dir $source.ref
  ok $"($name) @ (^git -C $dir rev-parse --short HEAD | str trim) → .src/($name)"
}

# The reference checkouts that exist, each with its short head.
export def source-heads []: nothing -> list<string> {
  sources | where {|s| $env.SRC_DIR | path join $s.name ".git" | path exists }
  | each {|s| $"($s.name)@(^git -C ($env.SRC_DIR | path join $s.name) rev-parse --short HEAD | str trim)" }
}

# The site is the project's own: `site/`, made ONCE from the template and edited freely after that —
# pages, layouts, config, seed. The harness never overwrites it. (Template updates are yours to
# merge; `mise run source -- templates` keeps the current one under .src/ to compare against.)
export def create [] {
  if (site-file "package.json" | path exists) { return }
  let src = ($env.TEMPLATES_DIR | path join $env.TEMPLATE)
  if not ($src | path exists) {
    fail $"template ($env.TEMPLATE) not found" $"available: (ls $env.TEMPLATES_DIR | where type == dir | get name | each {|p| $p | path basename } | str join ' ')"
  }
  cp -r $src $env.SITE_DIR
  # The template links .claude/skills to .agents/skills; this repo allows no symlinks.
  for link in (files-in $env.SITE_DIR "**/*" | where {|f| ($f | path type) == "symlink" }) { rm $link }
  ok $"site/ ← the ($env.TEMPLATE) template — it is yours now"
}

# Pin EmDash to EMDASH_VERSION and install. Run by setup, and by dev when the version changes.
export def install [] {
  mut pkg = (open (site-file "package.json") | reject -o packageManager)
  $pkg.dependencies.emdash = $env.EMDASH_VERSION
  if "@emdash-cms/cloudflare" in ($pkg.dependencies | columns) { $pkg.dependencies."@emdash-cms/cloudflare" = $env.EMDASH_VERSION }
  if not (on-cloudflare) {
    # On Node, sandboxed plugins run in workerd, which the Node templates do not ship.
    $pkg.dependencies."@emdash-cms/sandbox-workerd" = (version-set | get "@emdash-cms/sandbox-workerd")
    if not ("workerd" in ($pkg.dependencies | columns)) { $pkg.dependencies.workerd = "latest" }
    let workspace = (site-file "pnpm-workspace.yaml")
    open $workspace | upsert allowBuilds {|w| $w | get -o allowBuilds | default {} | upsert workerd true } | to yaml | save -f $workspace
  }
  # The templates' tsconfig asks for node types they never depend on.
  $pkg = ($pkg | upsert devDependencies {|p| $p | get -o devDependencies | default {} | upsert "@types/node" ($p | get -o devDependencies."@types/node" | default "latest") })
  $pkg | to json --indent 4 | save -f (site-file "package.json")
  ^pnpm --dir $env.SITE_DIR install
  ok $"site installed — emdash@($env.EMDASH_VERSION)"
}


# The key EmDash encrypts secret plugin settings with. Made once into site/.env (gitignored by the
# template — back it up: a database backup does not contain it). Without one, secrets fail closed.
export def ensure-key [] {
  let file = (site-file ".env")
  if ($file | path exists) and (open --raw $file | str contains "EMDASH_ENCRYPTION_KEY=") { return }
  emdash secrets generate --write $file
  ok "site/.env ← a new EMDASH_ENCRYPTION_KEY — keep a copy somewhere safe"
}

# Does the deployed Worker have an encryption key? Its value cannot be read back, only its presence.
export def deployed-has-key []: nothing -> bool {
  let listed = (do { cd $env.SITE_DIR; ^fnox exec -- pnpm exec wrangler secret list | complete })
  $listed.exit_code == 0 and ($listed.stdout | str contains "EMDASH_ENCRYPTION_KEY")
}

# The EmDash the site has installed, or "" before the first install.
export def installed-version []: nothing -> string {
  let pkg = (site-file "node_modules" "emdash" "package.json")
  if ($pkg | path exists) { open $pkg | get version } else { "" }
}

# Upgrading EmDash is changing EMDASH_VERSION and running `dev`. When the installed version differs,
# keep a copy of the local database first — EmDash's migrations only go forward — then re-pin and
# install in place. The site, and its data, stay.
export def sync-version []: nothing -> bool {
  let have = (installed-version)
  if ($have | is-empty) { fail "site/ is not installed" "run: mise run setup" }
  if $have == $env.EMDASH_VERSION { return false }
  step $"EmDash ($have) → ($env.EMDASH_VERSION)"
  version-set | ignore
  if (has-devdb) {
    let backup = ($env.RUN_DIR | path join "backups" $"emdash-($have)-(date now | format date '%Y%m%d-%H%M%S')")
    mkdir $backup
    cp (devdb) $backup
    ok $"database as it was on ($have) → ($backup | path relative-to $env.ROOT)"
    print $"    to go back: set EMDASH_VERSION to ($have), put that file back, run mise run dev — both, together"
  }
  install
  true
}

# Does the project's site config load local plugins? plugin:new needs it to.
export def loads-local-plugins []: nothing -> bool {
  open --raw (site-file "astro.config.mjs") | str contains "local-plugins.mjs"
}

# Make the project's site config load local plugins — sandboxed, on either platform: Cloudflare's
# Worker Loader, or workerd under Node. Edits the official templates' config; returns false,
# changing nothing, when the config is not shaped like a template's (then docs/plugin.md says how).
export def enable-local-plugins []: nothing -> bool {
  if (loads-local-plugins) { return true }
  let astro = (site-file "astro.config.mjs")
  let config = (open --raw $astro)
  let load = 'import { sandboxed as localSandboxed } from "./local-plugins.mjs";'
  let tabs = (char tab | fill --character (char tab) --width 3)
  let registered = $"($tabs)// Local plugins from plugins/ — generated by the harness.(char nl)($tabs)sandboxed: [...localSandboxed],"
  if (on-cloudflare) {
    let wrangler = (site-file "wrangler.jsonc")
    let import_line = 'import { d1, r2 } from "@emdash-cms/cloudflare";'
    let anchor = 'storage: r2({ binding: "MEDIA" }),'
    let loader_line = '// "worker_loaders": [{ "binding": "LOADER" }],'
    let bindings = (open --raw $wrangler)
    let has_loader = ($bindings | str contains $loader_line) or ($bindings | str contains '"worker_loaders"')
    if not (($config | str contains $import_line) and ($config | str contains $anchor) and $has_loader) { return false }
    $config
    | str replace $import_line $"import { d1, r2, sandbox } from \"@emdash-cms/cloudflare\";(char nl)($load)"
    | str replace $anchor $"($anchor)(char nl)($registered)(char nl)($tabs)sandboxRunner: sandbox\(\),"
    | save --force $astro
    $bindings | str replace $loader_line '"worker_loaders": [{ "binding": "LOADER" }],' | save --force $wrangler
  } else {
    let import_line = 'import { sqlite } from "emdash/db";'
    let anchor = 'database: sqlite({ url: "file:./data.db" }),'
    if not (($config | str contains $import_line) and ($config | str contains $anchor)) { return false }
    $config
    | str replace $import_line $"($import_line)(char nl)($load)"
    | str replace $anchor $"($anchor)(char nl)($registered)(char nl)($tabs)sandboxRunner: \"@emdash-cms/sandbox-workerd/sandbox\","
    | save --force $astro
  }
  ok "site/astro.config.mjs now loads local plugins"
  if (on-cloudflare) { print "    this switches on the Worker Loader binding — deploying with it needs the Workers Paid plan" }
  true
}

# What `dev` makes sure of before the site starts: an encryption key, the generated plugin
# registration, and a seed EmDash will accept — it silently skips an invalid one.
export def prepare [registration: string] {
  if not (site-file "package.json" | path exists) { fail "there is no site/ yet" "run: mise run setup" }
  ensure-key
  $registration | save --force (site-file "local-plugins.mjs")
  if (site-file "seed" "seed.json" | path exists) { emdash seed --validate seed/seed.json }
}

# Get the seed into the RUNNING site's database, updating entries that already exist. The site's
# own first-request seeding skips anything that exists, so edits to the seed never land without this.
# Carry seed EDITS into an existing database, and only when the seed has changed since it was last
# applied: re-applying overwrites admin edits and (until emdash#3919) duplicates every image. A
# fresh database needs nothing — the site has just seeded itself.
export def apply-seed [--fresh] {
  let seed = (site-file "seed" "seed.json")
  let mark = ($env.RUN_DIR | path join "seed-applied.txt")
  let db = (devdb)
  let now = $"(open --raw $seed | hash sha256) ($db)"
  mkdir $env.RUN_DIR
  if $fresh {
    $now | save --force $mark
    return
  }
  if ($mark | path exists) and (open --raw $mark | str trim) == $now {
    ok "seed unchanged since it was last applied"
    return
  }
  emdash seed seed/seed.json --database $db --on-conflict=update
  if (on-cloudflare) { uploads-to-r2 }
  $now | save --force $mark
}

# `emdash seed` always writes a seed's media files to ./uploads — right for Node, where the site
# reads them from there. A Cloudflare site reads local R2, so its seeded images would be rows with
# no file behind them: broken in the admin, and `snapshot` refuses to export them. Move them across.
def uploads-to-r2 [] {
  let uploads = (site-file "uploads")
  if not ($uploads | path exists) { return }
  let bucket = (open --raw (site-file "wrangler.jsonc") | parse --regex '"bucket_name"\s*:\s*"(?<name>[^"]+)"' | get -o name.0 | default "")
  if ($bucket | is-empty) { return }
  let types = {jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", gif: "image/gif", webp: "image/webp", avif: "image/avif", svg: "image/svg+xml", pdf: "application/pdf", mp4: "video/mp4"}
  cd $env.SITE_DIR
  for file in (ls $uploads | where type == file | get name) {
    let kind = ($types | get -o ($file | path parse | get extension | str lowercase) | default "application/octet-stream")
    let put = (^pnpm exec wrangler r2 object put $"($bucket)/($file | path basename)" --file $file --content-type $kind --local | complete)
    if $put.exit_code != 0 { fail $"could not copy ($file | path basename) into local R2: ($put.stderr | str trim)" }
    rm $file
  }
}

# (Re)start the dev server and make ONE call to EmDash's dev-bypass: it migrates, completes setup,
# seeds through the site's own storage, and with `?token=1` returns an admin token. `--empty` leaves
# the seed's content out, which a site must be to receive a restore. Bounded: two starts, then fail.
export def restart [--empty] {
  let query = (if $empty { "?token=1&content=0" } else { "?token=1" })
  for attempt in 1..2 {
    daemon-stop $env.SITE_DAEMON
    rm -rf (site-file "node_modules" ".vite")
    ^mise daemons start $env.SITE_DAEMON
    # Refused at once until the server listens (retried for 90s); once accepted, the call gets five
    # minutes — the first request compiles the site. Never many short calls: they starve it.
    let deadline = ((date now) + 90sec)
    mut setup: any = {status: 0, body: null}
    loop {
      $setup = (request POST $"(site-url)/_emdash/api/setup/dev-bypass($query)" --timeout 5min)
      if $setup.status != 0 or (date now) > $deadline { break }
      sleep 1sec
    }
    let token = ($setup.body | get -o data.token | default "")
    if $setup.status in 200..299 and ($token | is-not-empty) {
      mkdir $env.RUN_DIR
      $"($token)(char nl)" | save -f ($env.RUN_DIR | path join "token-admin.txt")
      # mise loads this file into the environment; .mcp.json reads EMDASH_MCP_TOKEN from there.
      $"EMDASH_MCP_TOKEN=($token)(char nl)" | save -f ($env.RUN_DIR | path join "token-admin.env")
      return
    }
    print --stderr $"  setup answered ($setup.status): ($setup.body | to json --raw)"
    if $attempt == 1 { print "  the site is not ready — restarting it once more" }
  }
  print --stderr (daemon-log $env.SITE_DAEMON)
  fail "the site did not come up after two starts" "the last lines of its log are above; more: mise run logs"
}

export def admin-url []: nothing -> string { $"(site-url)/_emdash/api/setup/dev-bypass?redirect=/_emdash/admin" }

# What a dev can do next — printed when the site comes up.
export def next-steps [] {
  print ""
  print "  mise run open                     the admin, signed in"
  print "  mise run dev                      after you change settings, the seed or a plugin (page edits reload by themselves)"
  print "  mise run plugin:new -- <name>     scaffold a plugin and load it"
  print "  mise run emdash -- schema list    the official CLI, any command"
  print "  mise run status                   what is running, at a glance"
  print "  mise tasks ls                     everything else"
  print "  mise run report                   something broke? this prints what to paste into an issue"
}

export def urls [] {
  print $"  site    (site-url)"
  print $"  admin   (admin-url)"
  print $"  mcp     (site-url)/_emdash/api/mcp — bearer token in run/token-admin.txt"
  if (setting DEPLOY_URL | is-not-empty) { print $"  live    ($env.DEPLOY_URL)" }
}

# nushell's own `start` opens a URL with the default browser on every OS.
export def open-admin [] { start (admin-url) }

# The dev server itself — what the site daemon runs. Astro detaches into the background when it
# detects an AI-agent environment, which orphans it from the daemon manager; ASTRO_DEV_BACKGROUND
# keeps it in the foreground.
export def serve [] {
  $env.ASTRO_DEV_BACKGROUND = "1"
  # Plugin discovery uses the hosted registry unless the optional local one is really answering.
  if (answers $"($env.REGISTRY_URL)/health") { $env.EMDASH_REGISTRY_URL = $env.REGISTRY_URL }
  # Bound to IPv4 on purpose. Astro's default listens on [::1] only, and on Linux `localhost`
  # resolves to 127.0.0.1 first — so the emdash CLI was refused there while curl worked.
  ^pnpm --dir $env.SITE_DIR dev --host 127.0.0.1 --port $env.SITE_PORT
}

# Type-check the site: astro check loads the config, tsc checks the config's types. Both re-run
# the Vite optimizer, so the dev server is paused around them.
export def typecheck []: nothing -> int {
  with-site-paused {
    ^pnpm --dir $env.SITE_DIR exec astro check
    (^pnpm --dir $env.SITE_DIR exec tsc --noEmit --ignoreConfig --allowJs --checkJs --moduleResolution bundler
      --module esnext --target es2022 --skipLibCheck (site-file "astro.config.mjs"))
  }
}

# Production build; on Cloudflare optionally a dry-run bundle or the real deploy. Returns the exit
# code. On Node the build IS the artefact — where it runs is the project's business.
export def ship [mode: string]: nothing -> int {
  let cloudflare = (on-cloudflare)
  with-site-paused {
    if (not $cloudflare) or $mode == "build" {
      ^pnpm --dir $env.SITE_DIR build
    } else if $mode == "dry" {
      ^pnpm --dir $env.SITE_DIR build
      do { cd $env.SITE_DIR; ^pnpm exec wrangler deploy --dry-run --outdir dist }
    } else {
      ^fnox exec -- pnpm --dir $env.SITE_DIR run deploy
    }
  }
}

# wrangler, with Cloudflare credentials, in the site.
export def --wrapped wrangler [...args: string] {
  cd $env.SITE_DIR
  ^fnox exec -- pnpm exec wrangler ...$args
}

# The deployed D1's name, from our wrangler config.
export def d1-name []: nothing -> string {
  let hits = (open --raw (site-file "wrangler.jsonc") | parse --regex '"database_name"\s*:\s*"(?<name>[^"]+)"')
  if ($hits | is-empty) { fail "no d1_databases[].database_name in site/wrangler.jsonc" }
  $hits | first | get name
}
