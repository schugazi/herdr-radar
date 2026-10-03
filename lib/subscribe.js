'use strict';

// The daemon's long-lived event subscription — the reason it can sleep.
//
// One read-only connection carries `events.subscribe`; every line that
// arrives after the ack is treated as a WAKE HINT and nothing more. The
// payloads are deliberately ignored: replays (up to 512 historical events on
// every connect), the 10-events-per-second per-subscription throttle, and the
// two envelope naming styles (snake_case for broadcast kinds, dotted for
// parameterised ones) all stop mattering when the only response to any event
// is "go take a fresh snapshot".
//
// The connection must stay write-silent after the initial request: the server
// treats client bytes on a streaming connection as a disconnect (unix) or
// lets them rot unread (windows). Ordinary requests go through lib/ipc.js on
// their own short connections.
//
// Neither `workspace.metadata_updated` nor `pane.updated` is subscribed: both
// are almost entirely the echo of this plugin's own token writes, and that
// echo is not merely noise. Herdr's server answers other requests late while
// it is flushing events to a subscriber — measured here at ~110ms per write
// with `pane.updated` on, against 1-2ms with it off — so listening to our own
// writes made every write slow, which an animation shows as a stutter. What
// `pane.updated` was kept for, agent status, has had its own event since 0.9.
// Title and cwd changes no longer arrive as events; the daemon's own slow
// heartbeat picks those up.
//
// schu fork: `pane.agent_status_changed` needs a `pane_id` (Herdr 0.9.3), and
// one bare entry rejects the whole request — the daemon then woke only on its
// 2s heartbeat and never saw a turn shorter than that working, so it finished
// without a done badge. It is subscribed per agent pane instead; the daemon
// reports the live set each frame and a changed set resubscribes.

const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');

const { herdrConfigPath } = require('./paths');

const PANE_KINDS = ['pane.agent_status_changed'];

const KINDS = [
  'pane.created',
  'pane.closed',
  'pane.exited',
  'pane.agent_detected',
  'pane.focused',
  'workspace.created',
  'workspace.closed',
  'workspace.renamed',
  'workspace.focused',
  'tab.renamed',
];

// Only worth waking for when this plugin is the one moving workspaces
// (lib/workspace-order.js). Off - which is the default - nothing reacts to a
// reorder, so subscribing buys every user a wake they cannot use.
const REORDER_KINDS = ['workspace.moved', 'workspace.reordered'];

function kinds() {
  return require('./config').reorderWorkspaces ? [...KINDS, ...REORDER_KINDS] : KINDS;
}

function subscriptions(paneIds) {
  return [
    ...kinds().map((type) => ({ type })),
    ...paneIds.flatMap((pane_id) => PANE_KINDS.map((type) => ({ type, pane_id }))),
  ];
}

const RETRY_BASE_MS = 500;
const RETRY_CAP_MS = 30000;

function socketFile() {
  return process.env.HERDR_SOCKET_PATH ?? path.join(path.dirname(herdrConfigPath()), 'herdr.sock');
}

function pipePath() {
  const file = socketFile();
  return process.platform === 'win32' ? `\\\\.\\pipe\\${file}` : file;
}

// onWake(): any event arrived, or the stream just (re)connected — resync.
// onGone(): the server is gone for good (its socket marker vanished).
// Reconnects forever with capped backoff otherwise: a reload hiccup or a
// live handoff is a disconnect too, and dying over one would leave the
// sidebar frozen until the next herdr restart.
function start({ onWake, onGone }) {
  let stopped = false;
  let attempts = 0;
  let current = null;
  let paneIds = [];
  let retryTimer = null;

  const connect = () => {
    clearTimeout(retryTimer);
    if (stopped) return;
    const stream = net.connect({ path: pipePath() });
    current = stream;
    let body = '';
    let acked = false;
    let ended = false;

    const retry = () => {
      if (ended) return;
      ended = true;
      stream.destroy();
      // Stopped, or replaced by a resubscribe that already connected.
      if (stopped || current !== stream) return;
      current = null;
      if (!fs.existsSync(socketFile())) {
        onGone();
        return;
      }
      attempts += 1;
      retryTimer = setTimeout(connect, Math.min(RETRY_CAP_MS, RETRY_BASE_MS * 2 ** Math.min(attempts, 6)));
    };

    stream.on('connect', () => {
      stream.write(
        `${JSON.stringify({
          id: 'daemon-sub',
          method: 'events.subscribe',
          params: { subscriptions: subscriptions(paneIds) },
        })}\n`,
      );
    });
    stream.on('data', (chunk) => {
      body += chunk;
      let sawEvent = false;
      let newline;
      while ((newline = body.indexOf('\n')) >= 0) {
        body = body.slice(newline + 1);
        if (!acked) {
          // The ack (or an error line, which the close handler will follow).
          acked = true;
          attempts = 0;
          sawEvent = true; // resync after every (re)connect
          continue;
        }
        sawEvent = true;
      }
      if (sawEvent && !stopped) onWake();
    });
    stream.on('error', retry);
    stream.on('close', retry);
  };

  connect();
  return {
    stop() {
      stopped = true;
      clearTimeout(retryTimer);
      current?.destroy();
    },
    // The agent panes to hear status changes from. A changed set reconnects:
    // a subscription's list is fixed once it starts.
    panes(ids) {
      const next = [...ids].sort();
      if (stopped || next.join('\n') === paneIds.join('\n')) return;
      paneIds = next;
      const old = current;
      attempts = 0;
      connect();
      old?.destroy();
    },
  };
}

module.exports = { start, KINDS, subscriptions };
