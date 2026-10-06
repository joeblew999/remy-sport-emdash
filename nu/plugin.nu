# Local plugins: scaffolded by the official CLI into plugins/, fitted to this site, loaded into it.
use lib.nu *

# A plugin is a directory under plugins/ with a package.json. None at all is a normal state.
export def dirs []: nothing -> list<string> {
  if not ($env.PLUGINS_DIR | path exists) { return [] }
  ls $env.PLUGINS_DIR | where type == dir | get name | where {|dir| $dir | path join "package.json" | path exists }
}

export def dir-of [name: string]: nothing -> string {
  let dir = ($env.PLUGINS_DIR | path join $name)
  if not ($dir | path join "package.json" | path exists) {
    fail $"no such plugin: ($name)" $"available: (dirs | each {|p| $p | path basename } | str join ' ')"
  }
  $dir
}

def package-name [dir: string]: nothing -> string { open ($dir | path join "package.json") | get -o name | default ($dir | path basename) }

# The code this repo owns, for lint and formatting.
export def code-paths []: nothing -> list<string> {
  dirs | each {|dir| [($dir | path join "src") ($dir | path join "tests")] } | flatten | where {|p| $p | path exists }
}

# The module the site imports its local plugins from. Pure — see tests.nu. A sandboxed plugin's
# package ROOT is imported as-is: that is the descriptor `emdash-plugin build` generates.
export def registration [names: list<string>]: nothing -> string {
  let sorted = ($names | sort)
  let imports = ($sorted | enumerate | each {|p| $"import local($p.index) from ($p.item | to json);" })
  let list = ($sorted | enumerate | each {|p| $"local($p.index)" } | str join ", ")
  # The JSDoc type is for the site's type-check: an empty array literal is an implicit any[].
  (["// GENERATED from plugins/ by the harness — do not edit."] | append $imports
    | append "/** @type {any[]} */" | append $"export const sandboxed = [($list)];" | append "" | str join (char nl))
}

# Registration for whatever is in plugins/ now: every directory with an emdash-plugin.jsonc.
export def current-registration []: nothing -> string {
  registration (dirs | where {|dir| $dir | path join "emdash-plugin.jsonc" | path exists } | each {|dir| package-name $dir })
}

# Run one package script in every plugin that declares it (or in just one).
export def sweep [script: string, only?: string] {
  let targets = (if $only == null { dirs } else { [(dir-of $only)] })
  for dir in $targets {
    if (open ($dir | path join "package.json") | get -o scripts | default {} | get -o $script | is-not-empty) {
      step $"($script) ($dir | path basename)"
      ^pnpm --dir $dir run $script
    }
  }
}

# Copy every plugin into the site's node_modules, where the site resolves it. A copy, not a link:
# this repo allows no symlinks. Build first — the descriptor points at the built bundle.
export def link [] {
  let node_modules = ($env.SITE_DIR | path join "node_modules")
  for dir in (dirs) {
    let dest = ($node_modules | path join (package-name $dir))
    rm -rf $dest
    mkdir $dest
    for entry in (ls $dir | get name | where {|p| ($p | path basename) != "node_modules" }) {
      cp -r $entry ($dest | path join ($entry | path basename))
    }
  }
}

# Structural faults, each one found by hand first. Returns the list; empty means consistent.
export def audit []: nothing -> list<string> {
  let site_pkg = ($env.SITE_DIR | path join "node_modules" "emdash" "package.json")
  let site_emdash = (if ($site_pkg | path exists) { open $site_pkg | get -o version } else { null })
  dirs | each {|dir|
    let manifest = (open ($dir | path join "package.json"))
    let label = ($dir | path basename)
    let sandboxed = ($dir | path join "emdash-plugin.jsonc" | path exists)
    let scripts = ($manifest | get -o scripts | default {})
    let entry = ($manifest | get -o exports | default {} | get -o "./sandbox")
    let bundle = (if ($entry | describe) == "string" { $entry } else { null })
    let own_pkg = ($dir | path join "node_modules" "emdash" "package.json")
    let own_emdash = (if ($own_pkg | path exists) { open $own_pkg | get -o version } else { null })
    let raw = (if $sandboxed { open --raw ($dir | path join "emdash-plugin.jsonc") } else { "" })
    let capabilities = ($raw | parse --regex '(?s)"capabilities"\s*:\s*\[(?<v>[^\]]*)\]' | get -o v.0 | default "")
    let hosts = ($raw | parse --regex '(?s)"allowedHosts"\s*:\s*\[(?<v>[^\]]*)\]' | get -o v.0 | default "")
    [
      (if (not $sandboxed) and ($scripts | values | any {|c| $c | str contains "emdash-plugin" }) {
        $"($label): a script runs emdash-plugin but there is no emdash-plugin.jsonc — it can never succeed" })
      (if $sandboxed and $bundle != null and (not ($dir | path join $bundle | path exists)) {
        $"($label): exports ./sandbox to ($bundle), which is not built" })
      (if $site_emdash != null and $own_emdash != null and $own_emdash != $site_emdash {
        $"($label): has emdash ($own_emdash) but the site runs ($site_emdash) — its tests say nothing about the site" })
      (if ($capabilities | str contains '"network:request"') and ($hosts | str trim | is-empty) {
        $"($label): declares network:request with no allowedHosts — the bundler rejects it" })
    ] | compact
  } | flatten
}

# The official plugin CLI, through `pnpm dlx` at a pinned version (EmDash's docs use dlx for `init`).
# Installed as a mise npm tool it cannot find its own dependencies on Windows. Inside a plugin, its
# own scripts use the copy the scaffold installs.
export def --wrapped cli [...args: string] { dlx [$"@emdash-cms/plugin-cli@(version-set | get '@emdash-cms/plugin-cli')"] emdash-plugin ...$args }

# Stop the flow when a plugin is structurally broken.
export def require-consistent [] {
  let faults = (audit)
  if ($faults | is-not-empty) { fail $"plugins are inconsistent: ($faults | str join '; ')" }
}

# Scaffold with the official CLI. It refuses to run without a terminal unless told who the plugin
# is from, so those come from settings.
export def scaffold [name: string] {
  if ($env.PLUGINS_DIR | path join $name | path exists) { fail $"plugins/($name) already exists" $"remove it first: mise run plugin:remove -- ($name)" }
  mkdir $env.PLUGINS_DIR
  cd $env.PLUGINS_DIR
  (cli init $name --publisher $env.PLUGIN_PUBLISHER --author-name $env.PLUGIN_AUTHOR
    --security-url $env.PLUGIN_SECURITY_URL --package-manager pnpm)
}

# What the scaffold gets wrong for this site: it asks for EmDash 0.x and an old plugin-test, pins
# packageManager, and creates three symlinks.
export def fit [name: string] {
  let dir = (dir-of $name)
  let test_version = (version-set | get "@emdash-cms/plugin-test")
  open ($dir | path join "package.json")
  | reject -o packageManager
  | upsert peerDependencies {|p| $p | get -o peerDependencies | default {} | upsert emdash $"^($env.EMDASH_VERSION)" }
  | upsert devDependencies {|p|
    $p | get -o devDependencies | default {} | upsert emdash $env.EMDASH_VERSION | upsert "@emdash-cms/plugin-test" $"^($test_version)"
  }
  | to json --tabs 1
  | save --force ($dir | path join "package.json")
  rm -rf ($dir | path join ".agents") ($dir | path join ".claude")
}

export def install [name: string] { ^pnpm --dir (dir-of $name) install }

# Ask the RUNNING site to call a plugin's route. Build, test and link all pass without the site
# ever loading the plugin; this is the proof that it did.
export def probe [name: string, route: string] {
  let dir = (dir-of $name)
  let slug = (open --raw ($dir | path join "emdash-plugin.jsonc") | parse --regex '"slug"\s*:\s*"(?<slug>[^"]+)"' | get -o slug.0 | default $name)
  let token_file = ($env.RUN_DIR | path join "token-admin.txt")
  if not ($token_file | path exists) { fail "no admin token" "run: mise run dev" }
  let res = (
    request POST $"($env.SITE_URL)/_emdash/api/plugins/($slug)/($route)"
      --headers {Authorization: $"Bearer (open --raw $token_file | str trim)", "X-EmDash-Request": "1"}
  )
  if ($res.body | describe | str starts-with "record") and ($res.body | get -o success) == true {
    ok $"the site ran ($slug)/($route) → ($res.body | get -o data | to json --raw)"
  } else {
    fail $"the site did not run ($slug)/($route): status ($res.status) ($res.body | to json --raw)"
  }
}

# Take a plugin out: its directory and the copy in the site. The caller re-registers and restarts.
export def delete [name: string] {
  let dir = (dir-of $name)
  let pkg = (package-name $dir)
  rm -rf $dir ($env.SITE_DIR | path join "node_modules" $pkg)
}
