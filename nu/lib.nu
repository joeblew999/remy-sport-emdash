# Shared helpers — everything here is used by more than one flow.
# Paths and names come from the project's mise.toml, as environment variables.

export def step [text: string] { print $"→ ($text)" }
export def ok [text: string] { print $"  ✓ ($text)" }

# Stop the whole flow with a message, and optionally what to do about it.
export def fail [text: string, hint?: string] {
  print --stderr $"✗ ($text)"
  if $hint != null { print --stderr $"  ($hint)" }
  exit 1
}

# Run a block and return its exit code instead of aborting. A failing external command ends a
# nushell script on the spot, so anything that must keep going — cleanup, "show every problem" —
# runs its commands through this.
export def code [block: closure]: nothing -> int {
  try { do $block; 0 } catch {|err| $err | get -o exit_code | default 1 }
}

# The harness-owned mise config: tools, tasks, daemons.
export def harness-file []: nothing -> string { $env.ROOT | path join ".config" "mise" "conf.d" "harness.toml" }

# Split a shell-quoted string into its arguments — what mise puts in `usage_args`. POSIX quoting:
# single quotes are literal, double quotes allow backslash escapes, a backslash escapes one character.
export def split-args [text: string]: nothing -> list<string> {
  mut out = []
  mut word = ""
  mut in_word = false
  mut mode = "plain"
  mut escaped = false
  for ch in ($text | split chars) {
    if $escaped {
      $word += $ch
      $escaped = false
      $in_word = true
    } else if $mode == "single" {
      if $ch == "'" { $mode = "plain" } else { $word += $ch }
    } else if $mode == "double" {
      if $ch == '"' { $mode = "plain" } else if $ch == '\' { $escaped = true } else { $word += $ch }
    } else if $ch == "'" {
      $mode = "single"
      $in_word = true
    } else if $ch == '"' {
      $mode = "double"
      $in_word = true
    } else if $ch == '\' {
      $escaped = true
    } else if $ch == " " {
      if $in_word { $out = ($out | append $word); $word = ""; $in_word = false }
    } else {
      $word += $ch
      $in_word = true
    }
  }
  if $in_word { $out | append $word } else { $out }
}

# A value from the environment, or "" when it is unset. Settings are optional by design.
export def setting [name: string]: nothing -> string {
  $env | get -o $name | default "" | into string
}

# Run an npm command-line tool at a pinned version, through `pnpm dlx`. Not installed as a mise
# npm tool: those cannot find their own dependencies on Windows. `packages` are name@version; the
# first one's binary is what runs unless `--bin` names another.
export def --wrapped dlx [packages: list<string>, bin: string, ...args: string] {
  ^pnpm dlx ...($packages | each {|p| ["--package" $p] } | flatten) $bin ...$args
}

# The packages released together with an EmDash version, e.g. {"@emdash-cms/plugin-cli": "0.13.2"}.
# EmDash tags them all on one commit, so EMDASH_VERSION alone decides the set — nothing to keep in
# step by hand. Read from the tags once per version and remembered in run/.
export def version-set [version?: string]: nothing -> record {
  let want = ($version | default $env.EMDASH_VERSION)
  let cache = ($env.RUN_DIR | path join $"emdash-($want).json")
  if ($cache | path exists) { return (open $cache) }
  let tags = ((^git ls-remote --tags --refs $env.EMDASH_REPO | complete).stdout | lines | parse "{commit}\trefs/tags/{tag}")
  let commit = ($tags | where tag == $"emdash@($want)" | get -o commit.0 | default "")
  if ($commit | is-empty) { fail $"there is no EmDash release ($want)" $"check EMDASH_VERSION in mise.toml against ($env.EMDASH_REPO)/releases" }
  let set = ($tags | where commit == $commit | reduce --fold {} {|t, acc|
    let at = ($t.tag | str index-of --end "@")
    $acc | upsert ($t.tag | str substring 0..<$at) ($t.tag | str substring ($at + 1)..)
  })
  mkdir $env.RUN_DIR
  $set | save --force $cache
  $set
}

# The emdash CLI, run where it must be run: in the site, which is its project root.
export def --wrapped emdash [...args: string] {
  cd $env.SITE_DIR
  ^emdash ...$args
}

# Run an emdash command and return its JSON, parsed; an error when the command fails or prints
# none. To target a deployment, set $env.EMDASH_URL — the CLI reads it itself, and flows that take
# `--url` do exactly that.
export def emdash-json [...args: string]: nothing -> any {
  let full = ($args | append "--json")
  let result = (do { cd $env.SITE_DIR; ^emdash ...$full | complete })
  # With --json the CLI writes only JSON to stdout (progress goes to stderr) and exits non-zero on error.
  if $result.exit_code != 0 or ($result.stdout | str trim | is-empty) {
    error make {msg: $"emdash ($full | str join ' ') failed: ($result.stderr | str trim) ($result.stdout | str trim)"}
  }
  $result.stdout | from json
}

# EmDash runs on Cloudflare (D1, R2, Workers) or on plain Node.js (a SQLite file, local uploads).
# The template decides: the Cloudflare ones ship a wrangler.jsonc.
export def on-cloudflare []: nothing -> bool { $env.SITE_DIR | path join "wrangler.jsonc" | path exists }

# The dev server's real database, as a file the CLI's file commands can be pointed at. On
# Cloudflare that is miniflare's D1 — NOT the ./data.db those commands default to. On Node it is
# the SQLite file the template configures.
export def devdb []: nothing -> string {
  let found = (
    if (on-cloudflare) {
      let d1 = ($env.SITE_DIR | path join ".wrangler" "state" "v3" "d1" "miniflare-D1DatabaseObject")
      if ($d1 | path exists) {
        ls $d1 | get name | where {|n| ($n | str ends-with ".sqlite") and (not ($n | str ends-with "metadata.sqlite")) }
      } else { [] }
    } else {
      [($env.SITE_DIR | path join "data.db")] | where {|f| $f | path exists }
    }
  )
  if ($found | is-empty) { fail "no local database yet" "run: mise run dev" }
  $found | first
}

# Is there a local database yet? False on a first start and after a wipe.
export def has-devdb []: nothing -> bool {
  if (on-cloudflare) {
    $env.SITE_DIR | path join ".wrangler" "state" "v3" "d1" | path exists
  } else {
    $env.SITE_DIR | path join "data.db" | path exists
  }
}

# Delete the local database and uploads. The site recreates them, seeded, when it next starts.
export def wipe-local-data [] {
  rm -f ($env.RUN_DIR | path join "seed-applied.txt")
  if (on-cloudflare) {
    rm -rf ($env.SITE_DIR | path join ".wrangler" "state")
  } else {
    for name in ["data.db" "data.db-shm" "data.db-wal" "uploads"] { rm -rf ($env.SITE_DIR | path join $name) }
  }
}

export def daemon-running [name: string]: nothing -> bool {
  let listed = (^mise daemons ls --json | complete)
  if $listed.exit_code != 0 { return false }
  $listed.stdout | from json | any {|d| $d.name == $name and $d.status == "running" }
}

export def daemon-stop [name: string] { ^mise daemons stop $name | complete | ignore }

# Run a block with the dev server stopped, then put it back — whatever the block did. Anything that
# re-runs the Vite optimizer in the site (a production build, astro check) breaks a running server.
export def with-site-paused [block: closure]: nothing -> int {
  let was_running = (daemon-running $env.SITE_DAEMON)
  if $was_running { daemon-stop $env.SITE_DAEMON }
  let rc = (code $block)
  rm -rf ($env.SITE_DIR | path join "node_modules" ".vite") ($env.SITE_DIR | path join ".astro")
  if $was_running {
    ^mise daemons start $env.SITE_DAEMON
    if not (wait-for $env.SITE_URL 90) { print "  ⚠ the site was restarted but is not answering yet — see: mise run logs" }
  }
  $rc
}

# One HTTP request, with nushell's own client (not curl: that is not on every OS). Returns
# {status, body}; status 0 means nothing answered. It never throws.
export def request [method: string, url: string, --headers: record = {}, --timeout: duration = 10sec]: nothing -> record {
  try {
    let response = (if $method == "POST" {
      http post --full --allow-errors --max-time $timeout --headers $headers --content-type application/json $url {}
    } else {
      http get --full --allow-errors --max-time $timeout --headers $headers $url
    })
    {status: $response.status, body: $response.body}
  } catch { {status: 0, body: null} }
}

# Files under a directory matching a pattern, e.g. `files-in $dir "**/*"`. Use this, never `glob`
# on a joined path: a glob pattern treats `\` as an escape, and `path join` produces `\` on Windows.
export def files-in [dir: string, pattern: string, --exclude: list<string> = []]: nothing -> list<string> {
  glob $"($dir | str replace --all '\' '/')/($pattern)" --exclude $exclude
}

# True when something answers at the URL without an error status.
export def answers [url: string, --timeout: duration = 2sec]: nothing -> bool {
  (request GET $url --timeout $timeout).status in 200..399
}

# Wait, bounded, until something answers. One PATIENT probe at a time: a cold dev server needs many
# seconds for its first answer, and short overlapping probes starve it. Nothing waits without a limit.
export def wait-for [url: string, seconds: int]: nothing -> bool {
  let deadline = ((date now) + ($seconds * 1sec))
  mut up = false
  while (not $up) and ((date now) <= $deadline) {
    $up = (answers $url --timeout 30sec)
    if not $up { sleep 1sec }
  }
  $up
}

# The last lines of a daemon's log — what to show when it would not come up.
export def daemon-log [name: string, lines: int = 30]: nothing -> string {
  (^mise daemons logs $name | complete).stdout | lines | last $lines | str join (char nl)
}

# Aim the emdash CLI at a deployment for the rest of the caller's flow: it reads EMDASH_URL itself.
export def --env target [url?: string] { if $url != null { $env.EMDASH_URL = $url } }
