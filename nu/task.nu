# The entry point of every task. mise names the task and hands over its arguments; this runs the
# matching command in main.nu — `plugin:new demo` becomes `main.nu plugin new demo`. The arguments
# come through mise's `usage` variable because mise does not append them on Windows.
use lib.nu split-args

def main [] {
  let command = ($env.MISE_TASK_NAME | split row ":")
  ^nu --no-config-file ($env.FILE_PWD | path join "main.nu") ...$command ...(split-args ($env.usage_args? | default ""))
}
