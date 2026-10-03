'use strict';

// schu fork: a finished turn keeps its done badge while this host's client is
// showing another machine, even though Herdr still calls the pane focused.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

// Everything this test touches lives under one temp dir: Herdr's state dir (the
// selection file), the plugin's own state (activity stamps) and an empty plugin
// config, so the user's settings (idle grace, done hold) cannot change the result.
const stateHome = fs.mkdtempSync(path.join(os.tmpdir(), 'radar-away-'));
process.env.XDG_STATE_HOME = stateHome;
process.env.HERDR_RADAR_STATE = path.join(stateHome, 'plugin-state');
process.env.HERDR_PLUGIN_CONFIG_DIR = path.join(stateHome, 'plugin-config');
delete process.env.HERDR_PLUGIN_STATE_DIR;
const selection = path.join(stateHome, 'herdr', 'client', 'endpoint-selection.json');
test.after(() => fs.rmSync(stateHome, { recursive: true, force: true }));

const { Frame } = require('../lib/frame');
const herdr = require('../lib/herdr');

function select(profile) {
  fs.mkdirSync(path.dirname(selection), { recursive: true });
  fs.writeFileSync(selection, JSON.stringify({ version: 1, selected_profile: profile }));
}

// A focused pane works, then goes idle; what does it show after the grace?
function finishFocusedTurn() {
  const frame = new Frame({});
  const entry = (status) => ({ pane: 'w6:pA', status, name: 'claude', session: '', focused: true });
  frame.away = herdr.clientAway();
  let now = Date.now();
  frame.displayFor(entry('idle'), now, []);
  frame.displayFor(entry('working'), (now += 1000), []);
  frame.displayFor(entry('idle'), (now += 5000), []);
  return frame.displayFor(entry('idle'), (now += 1000), []);
}

test('no selection file reads as here, so a watched turn clears at once', () => {
  fs.rmSync(path.dirname(selection), { recursive: true, force: true });
  assert.equal(herdr.clientAway(), false);
  assert.equal(finishFocusedTurn(), 'idle_fresh');
});

test('Local selected: a watched turn clears at once', () => {
  select(null);
  assert.equal(herdr.clientAway(), false);
  assert.equal(finishFocusedTurn(), 'idle_fresh');
});

test('another machine selected: the focused pane keeps its done badge', () => {
  select('07e0beeb5b24ac601fb998bd13dedb1c');
  assert.equal(herdr.clientAway(), true);
  assert.equal(finishFocusedTurn(), 'done');
});

test('an unreadable selection file reads as here', () => {
  fs.writeFileSync(selection, '{not json');
  assert.equal(herdr.clientAway(), false);
});
