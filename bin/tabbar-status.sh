#!/bin/sh
# schu fork: the daemon watchdog, run every 2s as a tab-bar status command (~/.config/herdr/config.toml)
# that prints nothing. The manifest's own watchdog only fires on server start and agent detection, so a
# daemon that died mid-session stayed dead, freezing every spinner, until a new agent appeared.
# Healthy costs one /proc read; only a missing daemon pays a node start. A deliberate state-stop is
# undone within 2s too — to keep the daemon off (or uninstall), drop this from the status line first.
d=${XDG_STATE_HOME:-$HOME/.local/state}/herdr/plugins/hhdebb.herdr-radar
# The cmdline, not just kill -0: a pid file left by an unclean exit can name a reused pid.
grep -qs agent-state.js "/proc/$(cat "$d/animator.pid" 2>/dev/null)/cmdline" && exit 0
cd "$(dirname "$0")/.." && setsid sh bin/node bin/agent-state.js </dev/null >/dev/null 2>&1 &
