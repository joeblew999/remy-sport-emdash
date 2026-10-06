# The checks: the repo's own (does the harness hold together) and the live ones (does the running
# or deployed site match what the repo says).
use lib.nu *
use plugin.nu

# ── the harness checks itself ────────────────────────────────────────────────────────────────

# The only programs the harness may run: what mise installs, plus git and docker. Everything else
# has a nushell command that exists on every OS, and npm tools go through `dlx` (lib.nu).
const PORTABLE = [git pnpm mise nu fnox emdash docker]

# nushell's own checker over every module, plus the rules it cannot see: programs that are not on
# every OS, a bracketed word in an interpolated string, a swallowed exit code, Unix paths, a raw glob.
export def nu-problems [dir: string]: nothing -> list<string> {
  files-in $dir "*.nu" | sort | par-each {|file|
    let name = ($file | path basename)
    let diagnostics = (
      (^nu --ide-check 200 $file | complete).stdout | lines | where {|l| $l | str starts-with "{" } | each {|l| $l | from json }
      | where {|d| ($d | get -o type) == "diagnostic" and ($d | get -o severity | default "Error") == "Error" }
      | each {|d| $"($name): ($d | get -o message)" }
    )
    let traps = (
      open --raw $file | parse --regex '(?s)\$"(?<text>[^"]*)"' | get text
      | each {|text| $text | parse --regex '\((?<word>[a-z]+)\)' | get word } | flatten | uniq
      | each {|word| $"($name): a bracketed bare word inside an interpolated string runs a command named ($word)" }
    )
    let text = (open --raw $file)
    let foreign = (
      $text | parse --regex '(?m)(?:^|[\s({|;])\^(?<cmd>[a-zA-Z][a-zA-Z0-9_-]*)' | get cmd | uniq
      | where {|cmd| not ($cmd in $PORTABLE) }
      | each {|cmd| $"($name): runs the program ($cmd), which is not on every OS — use nushell's own command" }
    )
    # `glob` on a joined path breaks on Windows, where the separator is the pattern's escape character.
    let raw_glob = (
      $text | parse --regex '(?m)(?:^|[\s({|;])(?<cmd>glob) ' | get cmd | uniq
      | where {|_| $name != "lib.nu" }
      | each {|_| $"($name): calls `glob` directly — use files-in, which is safe on Windows paths" }
    )
    # A program called WITHOUT `^` is just as non-portable, and so is `run-external`. Checked on
    # code lines only, at the start of a command.
    let code_lines = ($text | lines | where {|l| not ($l | str trim | str starts-with "#") } | str join (char nl))
    let bare = (
      $code_lines | parse --regex '(?m)(?:^|[({|;])\s*(?<cmd>curl|wget|grep|sed|awk|printenv|xdg-open|bash|sh|chmod|tar|unzip|which|run-external)\s' | get cmd | uniq
      | each {|cmd| $"($name): runs ($cmd) — not on every OS; use nushell's own command" }
    )
    # An external piped into `ignore` cannot fail: the pipe swallows its exit code.
    let swallowed = (
      $code_lines | parse --regex '(?m)(?<line>\^[^\n|]*\|\s*ignore)' | get line
      | each {|l| $"($name): an external piped into ignore can never fail — use `| complete` and test exit_code" }
    )
    let null_device = (["/dev" "/null"] | str join)
    let unix_paths = (if ($text | str contains $null_device) { [$"($name): uses ($null_device), which does not exist on Windows"] } else { [] })
    $diagnostics | append $traps | append $foreign | append $bare | append $swallowed | append $unix_paths | append $raw_glob
  } | flatten
}

# The subcommands main.nu defines.
def commands [main: string]: nothing -> list<string> {
  open --raw $main | parse --regex '(?m)^def (?:--wrapped )?"main (?<cmd>[^"]+)"' | get cmd
}

# mise.toml and the module must agree: every task runs a subcommand that exists, every subcommand
# has a task, and every daemon runs a task that exists. Neither mise nor nushell checks any of it.
export def task-problems [toml: string, main: string]: nothing -> list<string> {
  let cfg = (open $toml)
  let defined = (commands $main)
  let tasks = ($cfg.tasks | transpose name def | insert cmd {|t| $t.name | str replace --all ":" " " })
  let missing = ($tasks | where {|t| not ($t.cmd in $defined) } | each {|t| $"task ($t.name) has no command `($t.cmd)` in main.nu" })
  let orphans = ($defined | where {|d| not ($d in ($tasks | get cmd)) } | each {|d| $"main.nu defines `($d)` but no task runs it" })
  let untemplated = ($tasks | where {|t| ($t.def | get -o extends) != "harness" } | each {|t| $"task ($t.name) does not extend the harness template — its arguments would be dropped on Windows" })
  let daemons = ($cfg | get -o daemons | default {} | transpose name def | each {|d|
    let ref = ($d.def.run | parse --regex 'mise run (?<task>\S+)' | get -o task.0 | default "")
    if ($ref in ($tasks | get name)) { null } else { $"daemon ($d.name) runs `mise run ($ref)`, which is not a task" }
  } | compact)
  $missing | append $orphans | append $untemplated | append $daemons
}

# Do a task's arguments arrive, intact? Asked through mise itself, because that is where they were
# lost: on Windows mise does not append arguments to a command, so every task declares a `usage`
# spec and task.nu reads them from the environment. Spaces, JSON, quotes and flags must survive.
export def argument-problems []: nothing -> list<string> {
  let sent = ["alpha" "two words" '{"k":1}' "it's" "--flag"]
  let result = (^mise run args ...$sent | complete)
  let got = ($result.stdout | lines | where {|l| $l | str starts-with "[" } | get -o 0 | default "")
  if $got == ($sent | to json --raw) { [] } else { [$"sent ($sent | to json --raw) and the command received ($got) ($result.stderr | lines | last 2 | str join ' ')"] }
}

# A check that cannot fail is worse than none. Each fault below has really happened here; it is
# planted in a COPY, and the checker must report it.
export def selftest-problems []: nothing -> list<string> {
  let scratch = ($env.RUN_DIR | path join "selftest")
  let nu_dir = ($env.ROOT | path join "nu")
  let toml = (harness-file)
  let cases = [
    {what: "a POSIX operator nushell does not have", line: "def planted [] { print 'a' && print 'b' }"}
    {what: "a variable that was never defined", line: "def planted [] { print $never_defined }"}
    {what: "brackets inside an interpolated string", line: (['def planted [n: int] { print $' '"found ($n) problem' '(s)' '" }'] | str join)}
    {what: "a program that is not on every OS", line: (["def planted [] { " "^" "curl http://localhost }"] | str join)}
    {what: "a program called without a caret", line: (["def planted [] { " "cu" "rl http://localhost }"] | str join)}
    {what: "an external whose failure is piped away", line: (["def planted [] { ^" "mise tasks validate | " "ignore }"] | str join)}
    {what: "a path that only exists on Unix", line: (["def planted [] { print '" "/dev" "/null' }"] | str join)}
    {what: "globbing a joined path", file: "site.nu", line: (["def planted [] { " "glob" " ($env.ROOT | path join '*.nu') }"] | str join)}
  ]
  let nu_missed = ($cases | each {|case|
    rm -rf $scratch
    mkdir $scratch
    for file in (files-in $nu_dir "*.nu") { cp $file $scratch }
    # Planted in lib.nu unless the case names another module (lib.nu is where `glob` is allowed).
    $"(char nl)($case.line)(char nl)" | save --append ($scratch | path join ($case | get -o file | default "lib.nu"))
    if (nu-problems $scratch | is-empty) { $"the nushell check passed a module with ($case.what)" } else { null }
  } | compact)
  rm -rf $scratch
  mkdir $scratch
  let planted = ($scratch | path join "mise.toml")
  $"(open --raw $toml)(char nl)[tasks.planted](char nl)extends = \"harness\"(char nl)" | save $planted
  let task_missed = (if (task-problems $planted ($nu_dir | path join "main.nu") | is-empty) { ["the task check passed a task that runs a missing command"] } else { [] })
  rm -rf $scratch
  $nu_missed | append $task_missed
}

# docs/tasks.md is generated from the tasks; fail if what is committed is not what would be generated.
export def docs-current []: nothing -> bool {
  # Only a repo that keeps the generated list is held to it.
  if not ($env.ROOT | path join "docs" "tasks.md" | path exists) { return true }
  let generated = (^mise generate task-docs | complete).stdout
  ($generated | str trim) == (open --raw ($env.ROOT | path join "docs" "tasks.md") | str trim)
}

# Where the site ships its EmDash skills, or "" before setup.
def shipped-skills []: nothing -> string {
  [".claude" ".agents"] | each {|d| $env.SITE_DIR | path join $d "skills" } | where {|p| $p | path exists } | get -o 0 | default ""
}

def tree-hashes [dir: string]: nothing -> record {
  files-in $dir "**/*" | where {|f| ($f | path type) == "file" }
  | reduce --fold {} {|file, acc| $acc | upsert ($file | path relative-to $dir) (open --raw $file | hash sha256) }
}

# Vendor the site's EmDash skills: committed under .github/skills (skills are discovered when an
# agent session STARTS, so a fresh clone needs them in git), copied to .claude/skills for Claude.
export def sync-skills [] {
  let shipped = (shipped-skills)
  if ($shipped | is-empty) { return }
  let names = (ls $shipped | where type == dir | get name | each {|p| $p | path basename })
  for target in [($env.ROOT | path join ".github" "skills") ($env.ROOT | path join ".claude" "skills" "emdash")] {
    rm -rf $target
    mkdir $target
    for name in $names { cp -r ($shipped | path join $name) ($target | path join $name) }
  }
}

export def skills-current []: nothing -> bool {
  let shipped = (shipped-skills)
  ($shipped | is-empty) or ((tree-hashes $shipped) == (tree-hashes ($env.ROOT | path join ".github" "skills")))
}

# git cannot make a symlink on Windows — it writes the target path into a file instead. None allowed.
export def symlinks []: nothing -> list<string> {
  let committed = ((^git -C $env.ROOT ls-files -s | complete).stdout | lines | where {|l| $l | str starts-with "120000" })
  # nushell's own glob, not the `find` program: on Windows `find` is a text search.
  let on_disk = (
    files-in $env.ROOT "**/*" --exclude ["**/node_modules/**" "**/.src/**" "**/.git/**"]
    | where {|path| ($path | path type) == "symlink" }
  )
  $committed | append $on_disk
}

# ── the live site ────────────────────────────────────────────────────────────────────────────

def report [passed: bool, label: string, detail: string]: nothing -> bool {
  print $"  (if $passed { '✓' } else { '✗' }) ($label)(if ($detail | is-empty) { '' } else { $' — ($detail)' })"
  $passed
}

# Is the running site (or the deployment in EMDASH_URL) alive and holding content? It answers, and
# — when VERIFY_COLLECTION names one — that collection has entries and every one carries data.
export def verify []: nothing -> bool {
  let target = (if (setting EMDASH_URL | is-empty) { (site-url) } else { $env.EMDASH_URL })
  if not (wait-for $target 60) { return (report false $"($target) responds" "no answer") }
  let up = (report true $"($target) responds" "")
  let collection = (setting VERIFY_COLLECTION)
  if ($collection | is-empty) { return $up }
  # `content list` is slim — no `data` — so each entry is fetched. A check that passes because it
  # read nothing is worse than one that fails, hence the count.
  let entries = (try {
    emdash-json content list $collection | get -o items | default [] | each {|item| emdash-json content get $collection $item.slug }
  } catch {|err| print --stderr $"    ($err.msg)"; [] })
  let with_data = ($entries | where {|e| $e | get -o data | is-not-empty } | length)
  report ($with_data > 0 and $with_data == ($entries | length)) $"($collection) entries carry data" $"($with_data) of ($entries | length)"
}

# The content model: the repo's seed against a live instance. Returns true when they agree.
export def schema-diff []: nothing -> bool {
  let seed = (open ($env.SITE_DIR | path join "seed" "seed.json"))
  let listed = (emdash-json schema list)
  let remote_collections = (if ($listed | describe | str starts-with "record") { $listed | get -o items | default ($listed | get -o collections | default []) } else { $listed })
  let remote = ($remote_collections | each {|c|
    let detail = (emdash-json schema get $c.slug)
    (if ($detail | describe | str starts-with "record") { $detail | get -o fields | default [] } else { [] })
    | each {|f| {key: $"($c.slug).($f.slug)", type: $f.type} }
  } | flatten)
  let local = ($seed | get -o collections | default [] | each {|c|
    $c | get -o fields | default [] | each {|f| {key: $"($c.slug).($f.slug)", type: $f.type} }
  } | flatten)
  let remote_keys = ($remote | get -o key | default [])
  let local_keys = ($local | get -o key | default [])
  let problems = (
    ($local | where {|l| not ($l.key in $remote_keys) } | each {|l| $"missing from the live site: ($l.key)" })
    | append ($remote | where {|r| not ($r.key in $local_keys) } | each {|r| $"only on the live site:      ($r.key)" })
    | append ($local | each {|l|
      let other = ($remote | where key == $l.key)
      if ($other | is-not-empty) and ($other | first | get type) != $l.type { $"type differs:               ($l.key) repo=($l.type) live=($other | first | get type)" }
    } | compact)
  )
  print $"  live: ($remote_collections | length) collections, ($remote_keys | length) fields — repo: ($seed | get -o collections | default [] | length) collections, ($local_keys | length) fields"
  for problem in $problems { print $"    ($problem)" }
  if ($problems | is-empty) { ok "the live content model matches the repo's seed" } else { print "  evolve the live model with `emdash schema` — a seed only applies at first boot" }
  $problems | is-empty
}
