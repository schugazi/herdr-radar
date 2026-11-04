'use strict';

// schu fork: Claude compacting an idle session draws the same spinner as a
// turn, so Herdr reports `working` for it. ~/.claude/hooks/herdr-idle-compact.sh
// sets the pane token `idle_compact` for the length of it, and the frame shows
// whatever the pane showed before it went working: no spinner, no done badge
// afterwards, no fresher idle shade.

const test = require('node:test');
const assert = require('node:assert/strict');

const activity = require('../lib/activity');
const config = require('../lib/config');
const herdr = require('../lib/herdr');
const state = require('../lib/state');
const { Frame } = require('../lib/frame');

function paneFrame(t) {
  t.mock.method(activity, 'load', () => new Map());
  t.mock.method(activity, 'save', () => {});
  t.mock.method(activity, 'recover', () => null);
  const grace = config.idleGraceMs;
  const hold = config.doneHoldUntilSeen;
  config.idleGraceMs = 0;
  config.doneHoldUntilSeen = true;
  t.after(() => {
    config.idleGraceMs = grace;
    config.doneHoldUntilSeen = hold;
  });
  return new Frame('test');
}

const PANE = 'w:p1';
const entry = (overrides = {}) => ({
  pane: PANE,
  workspace: 'w',
  tab: 'w:t1',
  name: 'claude',
  title: 'Fix the parser',
  status: 'idle',
  ...overrides,
});

// Frames at one-second steps: idle, the compaction, idle again.
function compact(frame, idleCompact, start = 1000) {
  const shown = [];
  shown.push(frame.displayFor(entry(), start, []));
  shown.push(frame.displayFor(entry({ status: 'working', idleCompact }), start + 1000, []));
  shown.push(frame.displayFor(entry({ status: 'working', idleCompact }), start + 2000, []));
  // The token outlives the spinner: the hook clears it once Herdr reads idle.
  shown.push(frame.displayFor(entry({ idleCompact }), start + 3000, []));
  shown.push(frame.displayFor(entry(), start + 4000, []));
  return shown;
}

test('without the token a compaction reads as a turn and leaves a done badge', (t) => {
  const shown = compact(paneFrame(t), false);
  assert.equal(shown[1], 'working');
  assert.equal(shown[4], 'done');
});

test('an idle compaction changes nothing on an idle pane', (t) => {
  const frame = paneFrame(t);
  const shown = compact(frame, true);
  assert.deepEqual(shown, ['idle', 'idle', 'idle', 'idle', 'idle']);
  assert.equal(frame.doneUntil.has(PANE), false, 'a done badge was set');
  assert.equal(frame.lastWorkingAt.has(PANE), false, 'the compaction counted as activity');
});

test('an unseen done badge survives an idle compaction', (t) => {
  const frame = paneFrame(t);
  frame.displayFor(entry({ status: 'working' }), 500, []);
  assert.equal(frame.displayFor(entry(), 900, []), 'done');
  const shown = compact(frame, true);
  assert.deepEqual(shown, ['done', 'done', 'done', 'done', 'done']);
});

test('the idle shade keeps the age of the last real turn', (t) => {
  const frame = paneFrame(t);
  frame.displayFor(entry({ status: 'working' }), 0, []);
  frame.displayFor(entry({ focused: true }), 10, []); // seen: no badge
  const before = frame.lastWorkingAt.get(PANE);
  compact(frame, true, config.activityStaleMs + 1000);
  assert.equal(frame.lastWorkingAt.get(PANE), before, 'the compaction refreshed the activity stamp');
});

// Claude draws its "Running PreCompact hooks…" spinner before the hook sets the
// token, so the first working frames can arrive bare.
test('working frames before the token are taken back once it shows', (t) => {
  const frame = paneFrame(t);
  frame.displayFor(entry({ status: 'working' }), 0, []);
  frame.displayFor(entry({ focused: true }), 10, []); // seen: no badge
  const stamp = frame.lastWorkingAt.get(PANE);
  const start = config.activityStaleMs + 1000;
  const shown = [
    frame.displayFor(entry(), start, []),
    frame.displayFor(entry({ status: 'working' }), start + 100, []),
    frame.displayFor(entry({ status: 'working', idleCompact: true }), start + 1000, []),
    frame.displayFor(entry({ idleCompact: true }), start + 2000, []),
    frame.displayFor(entry(), start + 3000, []),
  ];
  assert.equal(shown[1], 'working', 'the bare frame cannot know yet');
  assert.deepEqual(shown.slice(2), [shown[0], shown[0], shown[0]]);
  assert.equal(frame.lastWorkingAt.get(PANE), stamp, 'the early frame left a refreshed activity stamp');
  assert.equal(frame.doneUntil.has(PANE), false, 'a done badge was set');
});

test('an unseen done badge survives working frames before the token', (t) => {
  const frame = paneFrame(t);
  frame.displayFor(entry({ status: 'working' }), 500, []);
  assert.equal(frame.displayFor(entry(), 900, []), 'done');
  frame.displayFor(entry({ status: 'working' }), 1000, []);
  assert.equal(frame.displayFor(entry({ status: 'working', idleCompact: true }), 1500, []), 'done');
  assert.equal(frame.displayFor(entry(), 3000, []), 'done');
});

// What Herdr really reports: its own unseen `done` once the spinner stops,
// lasting until the pane is looked at. The hook's release turns the token
// into `after`, which the next real turn's prompt or Stop clears.
test("Herdr's own done after an idle compaction is the compaction's too", (t) => {
  const frame = paneFrame(t);
  const shown = [
    frame.displayFor(entry(), 1000, []),
    frame.displayFor(entry({ status: 'working', idleCompact: true }), 2000, []),
    frame.displayFor(entry({ status: 'done', idleCompact: true }), 3000, []),
    frame.displayFor(entry({ status: 'done', compactAfter: true }), 4000, []),
    frame.displayFor(entry({ status: 'done', compactAfter: true }), 60_000, []),
  ];
  assert.deepEqual(shown, ['idle', 'idle', 'idle', 'idle', 'idle']);
  assert.equal(frame.doneUntil.has(PANE), false, 'a done badge was set');
});

test("Herdr's done straight after the hold, with no frame in between, is masked", (t) => {
  const frame = paneFrame(t);
  frame.displayFor(entry(), 1000, []);
  frame.displayFor(entry({ status: 'working', idleCompact: true }), 2000, []);
  assert.equal(frame.displayFor(entry({ status: 'done', compactAfter: true }), 3000, []), 'idle');
});

// The prompt or Stop clears the token; Radar may never sample the `working`.
test("a real turn's done shows even when its working fell between snapshots", (t) => {
  const frame = paneFrame(t);
  frame.displayFor(entry(), 1000, []);
  frame.displayFor(entry({ status: 'working', idleCompact: true }), 2000, []);
  assert.equal(frame.displayFor(entry({ status: 'done', compactAfter: true }), 3000, []), 'idle');
  assert.equal(frame.displayFor(entry({ status: 'done' }), 9000, []), 'done');
  assert.equal(frame.compactDone.has(PANE), false);
});

test('the mask ends when Herdr leaves done, and a real turn still leaves a badge', (t) => {
  const frame = paneFrame(t);
  frame.displayFor(entry(), 1000, []);
  frame.displayFor(entry({ status: 'working', idleCompact: true }), 2000, []);
  frame.displayFor(entry({ status: 'done', compactAfter: true }), 3000, []);
  assert.equal(frame.displayFor(entry({ status: 'working' }), 4000, []), 'working');
  assert.equal(frame.displayFor(entry({ status: 'done' }), 5000, []), 'done');
  // Looked at, then a later unrelated done: also not masked.
  frame.displayFor(entry({ focused: true }), 6000, []);
  frame.displayFor(entry({ status: 'working' }), 7000, []);
  assert.equal(frame.displayFor(entry({ status: 'done' }), 8000, []), 'done');
});

test('a pane this instance never saw has nothing to hold', (t) => {
  const frame = paneFrame(t);
  assert.equal(frame.displayFor(entry({ status: 'working', idleCompact: true }), 1000, []), 'working');
});

test('the snapshot reads idle_compact on Claude panes only', async (t) => {
  t.mock.method(herdr, 'agentsAsync', async () => [
    { pane_id: 'w:p1', agent: 'claude', agent_status: 'working', tokens: { idle_compact: '1' } },
    { pane_id: 'w:p2', agent: 'claude', agent_status: 'working', tokens: { idle_compact: '' } },
    { pane_id: 'w:p3', agent: 'codex', agent_status: 'working', tokens: { idle_compact: '1' } },
    { pane_id: 'w:p4', agent: 'claude', agent_status: 'working', tokens: {} },
    { pane_id: 'w:p5', agent: 'claude', agent_status: 'done', tokens: { idle_compact: 'after' } },
    { pane_id: 'w:p6', agent: 'codex', agent_status: 'done', tokens: { idle_compact: 'after' } },
  ]);
  const entries = await state.snapshot();
  assert.deepEqual(
    entries.map((e) => [e.idleCompact, e.compactAfter]),
    [
      [true, false],
      [false, false],
      [false, false],
      [false, false],
      [false, true],
      [false, false],
    ],
  );
});
