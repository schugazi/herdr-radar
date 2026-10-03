#!/bin/sh
# schu fork: the daemon watchdog, run every 2s as a tab-bar status command (~/.config/herdr/config.toml)
# that prints nothing. The manifest's own watchdog only fires on server start and agent detection, so a
# daemon that died mid-session stayed dead, freezing every spinner, until a new agent appeared.
# Healthy costs one /proc read; only a missing daemon pays a node start. A deliberate state-stop is
# undone within 2s too — to keep the daemon off (or uninstall), drop this from the status line first.
d=${XDG_STATE_HOME:-$HOME/.local/state}/herdr/plugins/hhdebb.herdr-radar
# The cmdline, not just kill -0: a pid file left by an unclean exit can name a reused pid.
grep -qs agent-state.js "/proc/$(cat "$d/animator.pid" 2>/dev/null)/cmdline" && exit 0
# Started in the foreground through the plugin's own launcher, never `setsid … &`: Herdr SIGKILLs a status
# command's whole process group the moment it exits, and a backgrounded child that has not reached setsid()
# yet dies with it (every time on multivac's WSL). Node's detached spawn returns only once the child has
# left the group.
cd "$(dirname "$0")/.." && exec sh bin/node bin/agent-state.js </dev/null >/dev/null 2>&1
