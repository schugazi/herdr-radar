'use strict';

// `state-restart` (bin/agent-state.js restartAnimator).
//
// `herdr plugin action invoke` returns once the action's command has started,
// so the README's `state-stop` then `state-start` ran side by side: the start
// asked while the old daemon was still answering after its `stop` reply,
// called it healthy, and left. The old one then exited with nothing in its
// place (#65). The restart has to launch only once the endpoint is quiet.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// Keep the error log and the rest of the state off the live daemon's files,
// and any call that slips past the mocks off the live server.
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'radar-restart-'));
// HERDR_RADAR_STATE outranks the plugin state dir (lib/paths.js), so both.
process.env.HERDR_RADAR_STATE = scratch;
process.env.HERDR_PLUGIN_STATE_DIR = scratch;
process.env.HERDR_SOCKET_PATH = path.join(scratch, 'no-server.sock');

const control = require('../lib/control');
const spawn = require('../lib/spawn');
const state = require('../lib/state');
const { restartAnimator } = require('../bin/agent-state');

// A daemon that accepts `stop`, keeps answering pings for `lingerMs` (it
// leaves on a timer after the reply), then is gone.
function daemonThatLingers(t, lingerMs) {
  let stoppedAt = null;
  t.mock.method(control, 'request', async (message) => {
    if (message.cmd === 'stop') {
      stoppedAt ??= Date.now();
      return { ok: true };
    }
    if (stoppedAt !== null && Date.now() - stoppedAt >= lingerMs) return null;
    return { ok: true, pid: 4242, fire_age_ms: 100, frame_running_ms: 0 };
  });
  return () => stoppedAt;
}

test('restart launches a new daemon only after the old one has gone', async (t) => {
  const stoppedAt = daemonThatLingers(t, 400);
  const launches = [];
  t.mock.method(spawn, 'detachedNode', (...args) => launches.push({ at: Date.now(), args }));

  await restartAnimator();

  assert.equal(launches.length, 1, 'exactly one daemon launched');
  assert.deepEqual(launches[0].args[1], ['--animate']);
  assert.ok(launches[0].at - stoppedAt() >= 400, 'launched after the old daemon stopped answering');
});

test('restart with no daemon running still starts one', async (t) => {
  t.mock.method(control, 'request', async () => null);
  t.mock.method(state, 'clearAll', async () => {});
  const launches = [];
  t.mock.method(spawn, 'detachedNode', (...args) => launches.push(args));

  await restartAnimator();

  assert.equal(launches.length, 1);
});
