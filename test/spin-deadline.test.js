'use strict';

// schu fork: a frame that runs past the next spinner step must still ask for
// that step. It used to keep only deadlines still ahead when the frame ended,
// so one slow Herdr reply dropped the step and the daemon slept to the 2s
// heartbeat with every working spinner frozen. The IPC calls are replaced
// here; nothing reaches a real Herdr.

const test = require('node:test');
const assert = require('node:assert/strict');

const activity = require('../lib/activity');
const herdr = require('../lib/herdr');
const view = require('../lib/view');
const { Frame, SPIN_MS } = require('../lib/frame');

function slowFrame(t, writeMs) {
  t.mock.method(activity, 'load', () => new Map());
  t.mock.method(activity, 'save', () => {});
  t.mock.method(activity, 'recover', () => null);
  t.mock.method(view, 'mode', () => null);
  t.mock.method(herdr, 'panelGrouped', () => false);
  t.mock.method(herdr, 'reportMetadataAsync', () => new Promise((resolve) => setTimeout(resolve, writeMs, true)));
  t.mock.method(herdr, 'agentsAsync', async () => [
    {
      pane_id: 'w1:p1',
      tab_id: 'w1:t1',
      workspace_id: 'w1',
      agent: 'codex',
      agent_status: 'working',
      terminal_title_stripped: 'Migrate invoices table',
      tokens: {},
    },
  ]);
  t.mock.method(herdr, 'tabsAsync', async () => [{ tab_id: 'w1:t1', label: '1' }]);
  t.mock.method(herdr, 'workspacesAsync', async () => [{ workspace_id: 'w1', label: 'billing' }]);
  const frame = new Frame('test');
  t.mock.method(frame.workspaceOrder, 'sync', async () => {});
  t.mock.method(frame, 'spaceJobs', () => {});
  t.mock.method(frame, 'groupJobs', async () => {});
  return frame;
}

test('a frame that outlasts a spinner step asks for the next frame at once', async (t) => {
  const frame = slowFrame(t, SPIN_MS + 50);
  const sleepUntil = await frame.render(Date.now());
  assert.ok(sleepUntil <= Date.now(), `slept ${sleepUntil - Date.now()}ms with a spinner step already due`);
});

test('a quick frame sleeps to the next spinner step', async (t) => {
  const frame = slowFrame(t, 0);
  const now = Date.now();
  const sleepUntil = await frame.render(now);
  assert.equal(sleepUntil, (Math.floor(now / SPIN_MS) + 1) * SPIN_MS);
});
