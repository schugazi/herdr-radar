'use strict';

// Where a CLI keeps its session records is the CLI's choice, not the home
// directory's: Claude Code moves its whole data directory with
// CLAUDE_CONFIG_DIR and Codex with CODEX_HOME (#58). A pane that predates the
// daemon gets its shade from that record, so a lookup fixed on the home
// directory left every such pane a plain idle on a machine that had moved them.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const activity = require('../lib/activity');

const STAMP = '2026-10-14T13:43:48.000Z';

// One record line, the shape both CLIs write: a JSON object per line with an
// ISO timestamp.
function record(file) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify({ type: 'message', timestamp: STAMP })}\n`);
}

function withEnv(name, value, run) {
  const previous = process.env[name];
  process.env[name] = value;
  try {
    return run();
  } finally {
    if (previous === undefined) delete process.env[name];
    else process.env[name] = previous;
  }
}

test('a claude record is found under CLAUDE_CONFIG_DIR', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'radar-claude-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  record(path.join(dir, 'projects', 'C--work-app', 'ses-moved-claude.jsonl'));
  withEnv('CLAUDE_CONFIG_DIR', dir, () => {
    assert.equal(activity.recover('claude', 'ses-moved-claude'), Date.parse(STAMP));
  });
});

test('a codex record is found under CODEX_HOME', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'radar-codex-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  record(path.join(dir, 'sessions', '2026', '10', '14', 'rollout-2026-10-14T13-43-48-ses-moved-codex.jsonl'));
  withEnv('CODEX_HOME', dir, () => {
    assert.equal(activity.recover('codex', 'ses-moved-codex'), Date.parse(STAMP));
  });
});
