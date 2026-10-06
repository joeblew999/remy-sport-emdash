# Unit tests for the pure logic. Run by `mise run check`; needs no site and no settings.
use std/assert
use lib.nu [split-args wait-for request]
use plugin.nu

# Task arguments, as mise hands them over: one shell-quoted string.
assert equal (split-args "") [] "no arguments"
assert equal (split-args "alpha 'two words' '{\"k\":1}' --dry") ["alpha" "two words" '{"k":1}' "--dry"] "quoted arguments and flags"
assert equal (split-args "'it'\\''s' 'say \"hi\"'") ["it's" 'say "hi"'] "a quote inside an argument"
assert equal (split-args "a   b") ["a" "b"] "runs of spaces"

# Waits are bounded, and a request to nothing reports status 0 rather than throwing.
let before = (date now)
assert equal (wait-for "http://127.0.0.1:9/" 2) false "waiting on a dead port gives up"
assert (((date now) - $before) < 40sec) "…within its limit"
assert equal (request GET "http://127.0.0.1:9/" --timeout 1sec).status 0 "a dead port is status 0, not an exception"

# Plugin registration.
assert equal (plugin registration []) "// GENERATED from plugins/ by the harness — do not edit.\n/** @type {any[]} */\nexport const sandboxed = [];\n" "no plugins is an empty list"
let two = (plugin registration ["zeta" "@scope/alpha"])
assert ($two | str contains 'import local0 from "@scope/alpha";') "plugins are imported in sorted order"
assert ($two | str contains 'export const sandboxed = [local0, local1];') "every plugin is registered"

print "  ✓ 10 unit tests"
