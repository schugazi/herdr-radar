'use strict';

// The one Herdr surface the CLI does not wrap: `agent.view.set` / `clear`,
// the socket API that reorders the sidebar's Agents panel. Newline-delimited
// JSON over a local socket; the server answers one request and hangs up, so
// every call opens its own connection.
//
// While a view override is active Herdr disables the panel's own
// grouped/priority toggle, so whoever installs one owns the way back out —
// bin/agent-view.js keeps an on-disk flag for exactly that.

const fs = require('node:fs');
const path = require('node:path');

const { runtimeRoot, ensureDir } = require('./paths');
const { call } = require('./ipc');
const { source } = require('./herdr');

// schu fork: runtimeRoot, not stateRoot. The override lives in one Herdr
// server, so the flag that records it is per session too: a shared flag made
// the other session's daemon paint for an order its server never applied.
// The default session's path is unchanged.
const FLAG = () => path.join(runtimeRoot, 'agent-view.on');

// Both orders sort by recency and nothing else. Attention states deliberately
// do not outrank it: a question left hanging on purpose should sink with time
// like everything else — the colours already say what each row is.
//
// `grouped` keeps the workspace grouping: the first key is the workspace's
// place in the Spaces list ($ws_key, equal across a workspace's panes, so a
// stable sort keeps each workspace contiguous; schu fork — upstream ranks it
// by recency), the second is the pane's own recency ($sort_key). `recent` drops the
// grouping and ranks every pane flat.
const SORTS = {
  grouped: {
    label: 'active',
    sort: [
      { field: { token: 'ws_key' }, order: 'desc' },
      // Between the workspace and the pane: panes sharing a tab are one split
      // screen and rank as a unit (lib/frame.js sortKeys).
      { field: { token: 'tab_key' }, order: 'desc' },
      { field: { token: 'sort_key' }, order: 'desc' },
    ],
  },
  recent: {
    label: 'recent',
    sort: [{ field: { token: 'sort_key' }, order: 'desc' }],
  },
};

function apply(mode) {
  const spec = SORTS[mode];
  if (!spec) return Promise.resolve(null);
  return call('agent.view.set', { source: source(), label: spec.label, sort: spec.sort });
}

function clear() {
  return call('agent.view.clear', { source: source() });
}

// The order nobody has chosen yet: active first, stale last. Sorting by
// activity is the plugin's point, so a fresh install gets it without a key
// press; `off` is the choice that has to be made explicitly.
const DEFAULT_MODE = 'grouped';

// The persisted intent, not the server state: the override dies with the
// server, and the startup hook re-applies whatever this says. Values are the
// SORTS keys, or `off`; null means no view (Herdr's own order). A missing or
// unreadable flag is the default, NOT off — off is written out as a word so
// that "never chose" and "chose Herdr's order" stay distinguishable.
function mode() {
  try {
    const value = fs.readFileSync(FLAG(), 'utf8').trim();
    if (value === 'off') return null;
    return value in SORTS ? value : DEFAULT_MODE;
  } catch {
    return DEFAULT_MODE;
  }
}

// The panel's OTHER layer. `apply`/`clear` above reorder the rows; this decides
// whether the rows are ours at all — the `[ui.sidebar.*]` block that paints the
// logos, the state colours and the group headers. Herdr exposes no socket call
// for it, so switching it means rewriting config.toml and reloading the server:
// a file write and a process spawn against `apply`'s single socket roundtrip,
// which is why only the native<->plugin toggle pays for it and the
// active<->recent flip does not.
//
// Lazily required: this is the cold path, and bin/configure pulls in the whole
// palette to rebuild the block.
// Callers run this BEFORE apply()/clear(): the reload it triggers is the one
// event that could plausibly drop a socket-installed override, so the socket
// call goes last and the ordering stops mattering.
//
// schu fork: the rows are hand-written in config.toml and never switched, so
// this is a no-op that keeps the callers' shape.
function setRows() {
  return { changed: false };
}

// The mode a request lands on, from the current one. One table for the daemon
// and the thin client, so a key does the same thing whether or not a daemon
// answered it. `op` is a transition (flip / native / cycle); `set` names a
// mode outright, or `off`.
function resolve(current, { op, set } = {}) {
  if (op === 'flip') return current === 'grouped' ? 'recent' : 'grouped';
  if (op === 'native') return current ? null : 'grouped';
  if (op === 'cycle') return current === null ? 'grouped' : current === 'grouped' ? 'recent' : null;
  if (set === 'off') return null;
  if (set === 'grouped' || set === 'recent') return set;
  return current;
}

// Put the chosen order back on the panel, whether or not it is still there.
// Herdr keeps the override in the server's memory and nowhere else, so it is
// gone after anything that replaces the server, and the startup hook only
// covers a server that runs it. With the override gone the panel falls back
// to Herdr's own order while the group headers are still placed for ours, so
// a header lands mid-group and the panes above it read as part of the
// project before (#49). Herdr has no call to read the override back, and
// setting the same one again is a plain assignment there, with no event and
// no redraw, so the daemon simply sets it again on a slow timer.
// Through module.exports so a test can stand in for either half.
function reassert() {
  const chosen = module.exports.mode();
  if (!chosen) return Promise.resolve(null);
  return module.exports.apply(chosen);
}

// The timed re-apply and the view switches, kept from overlapping. A switch
// waits out a re-apply already sent, and a tick stands down while a switch
// runs: the mode it would read is persisted only once the switch has landed,
// so a switch to `off` could otherwise be undone by a re-apply of the old
// mode, with nothing to correct it afterwards.
function keeper() {
  let reasserting = null;
  let switching = 0;
  return {
    // The re-apply's own promise, for the caller to log a failure; null when
    // it stood down.
    tick() {
      if (reasserting || switching) return null;
      const run = module.exports.reassert();
      reasserting = run
        .then(
          () => {},
          () => {},
        )
        .finally(() => {
          reasserting = null;
        });
      return run;
    },
    async during(task) {
      switching += 1;
      try {
        await reasserting;
        return await task();
      } finally {
        switching -= 1;
      }
    },
  };
}

// Always a write, never a delete: removing the flag would mean "default"
// (see mode()), and the default is not off.
function setMode(value) {
  try {
    ensureDir(runtimeRoot);
    fs.writeFileSync(FLAG(), value ?? 'off', 'utf8');
  } catch {
    // The view still switched; only persistence failed.
  }
}

module.exports = { call, apply, clear, mode, setMode, setRows, resolve, reassert, keeper, DEFAULT_MODE };
