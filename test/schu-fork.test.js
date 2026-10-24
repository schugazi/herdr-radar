'use strict';

// The schu fork's own additions: the title split and the detail pairs.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const state = require('../lib/state');

test('splitTitle wraps at a space, cuts an overlong word, ellipsises row two', () => {
  assert.deepEqual(state.splitTitle('herdr radar plugin compatibility', 18, 22), ['herdr radar plugin', 'compatibility']);
  assert.deepEqual(state.splitTitle('short', 18, 22), ['short', '']);
  assert.deepEqual(state.splitTitle('abcdefghij klm', 4, 22), ['abcd', 'efghij klm']);
  assert.deepEqual(state.splitTitle('one two three four five', 3, 8), ['one', 'two thr…']);
  assert.deepEqual(state.splitTitle('', 18, 22), ['', '']);
});

const line = { mark: 'x', split: '', logo: 'L', titlePrefix: '' };

test('detail fields publish under the normal name unless the entry is stale', () => {
  const fresh = state.stateTokens('idle', line, 'T', 'T2', { model: 'Opus 5.5', topic: 'radar', divider: '────' });
  assert.equal(fresh.d_model, 'Opus 5.5');
  assert.equal(fresh.d_model_stale, null);
  assert.equal(fresh.d_topic, 'radar');
  assert.equal(fresh.d_topic2, null);
  assert.equal(fresh.d_effort, null);
  assert.equal(fresh.d_divider, '────');
  assert.equal(fresh.title2_idle, 'T2');
  assert.equal(fresh.title2_working, null);

  const stale = state.stateTokens('idle_stale', line, 'T', 'T2', { model: 'Opus 5.5', plan: '', divider: '────' });
  assert.equal(stale.d_model, null);
  assert.equal(stale.d_model_stale, 'Opus 5.5');
  assert.equal(stale.d_plan_stale, null);
  assert.equal(stale.d_divider_stale, '────');
  assert.equal(stale.title2_idle_stale, 'T2');
});

test('a nested entry indents the first cell of every row under the title, not the divider', () => {
  const nest = '​  ';
  const detail = { model: 'Opus 5.5', effort: 'high', topic: 'radar', plan: 'plan', divider: '────' };
  const tokens = state.stateTokens('idle', line, 'T', 'T2', detail, nest);
  assert.equal(tokens.title2_idle, `${nest}T2`);
  assert.equal(tokens.d_topic, `${nest}radar`);
  assert.equal(tokens.d_model, `${nest}Opus 5.5`);
  assert.equal(tokens.d_effort, 'high', 'a cell after the first in its row');
  assert.equal(tokens.d_plan, `${nest}plan`);
  assert.equal(tokens.d_divider, '────');
  assert.equal(detail.model, 'Opus 5.5', 'the caller\'s detail is left alone');
  // Effort's colour rules match the exact value, so it is never prefixed.
  assert.equal(state.stateTokens('idle', line, 'T', '', { effort: 'low' }, nest).d_effort, 'low');
  assert.equal(state.stateTokens('idle', line, 'T', '', { model: 'm' }).d_model, 'm');
});

test('divider follows the narrowest local client and refreshes after a resize', (t) => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'radar-divider-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  t.mock.method(os, 'homedir', () => home);
  const dir = path.join(home, '.local/state/herdr/client-shell');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'local-one.json'), '{"sidebar_width":31}');
  fs.writeFileSync(path.join(dir, 'local-two.json'), '{"sidebar_width":29}');
  const now = Date.now() + 10000;
  assert.equal(state.sidebarDivider(now).length, 24);
  fs.writeFileSync(path.join(dir, 'local-two.json'), '{"sidebar_width":33}');
  assert.equal(state.sidebarDivider(now + 5001).length, 26);
});

test('detail fields come from the detected agent only, so a dead Claude cannot outrank a Codex', () => {
  const both = { model: 'Opus 5.5', effort: 'high', codex_model: 'gpt-6.1-sol', codex_effort: 'medium' };
  assert.deepEqual(state.detailSources('codex', both), { model: 'gpt-6.1-sol', effort: 'medium', plan: null });
  assert.equal(state.detailSources('claude', both).model, 'Opus 5.5');
  assert.deepEqual(state.detailSources('gemini', both), {});
});

test('the subagent row shortens the agents cell to its count beside background shells', () => {
  const two = '2 agents: review, explore';
  assert.deepEqual(state.claudeTasks(two), { agents: two, shells: null });
  assert.deepEqual(state.claudeTasks(two, { shells: 1, monitors: 0 }), { agents: '2 agents', shells: '1 shell' });
  assert.deepEqual(state.claudeTasks(null, { shells: 2, monitors: 1 }), { agents: null, shells: '2 shells · 1 monitor' });
  assert.deepEqual(state.claudeTasks('', { shells: 0, monitors: 0 }), { agents: null, shells: null });
});

test('background tasks are counted per session even once a task has exec-ed away its shell', { skip: process.platform !== 'linux' }, async (t) => {
  const { spawn } = require('node:child_process');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'radar-tasks-'));
  fs.mkdirSync(path.join(dir, 'tasks'));
  fs.mkdirSync(path.join(dir, 'projects/-x'), { recursive: true });
  // b1 went to the background; b2 is a foreground command, the same in /proc.
  fs.writeFileSync(
    path.join(dir, 'projects/-x/radar-test.jsonl'),
    '{"toolUseResult":{"stdout":"","backgroundTaskId":"b1"}}\n{"toolUseResult":{"stdout":"b2"}}\n',
  );
  const configDir = process.env.CLAUDE_CONFIG_DIR;
  process.env.CLAUDE_CONFIG_DIR = dir;
  const background = fs.openSync(path.join(dir, 'tasks/b1.output'), 'w');
  const foreground = fs.openSync(path.join(dir, 'tasks/b2.output'), 'w');
  const env = { ...process.env, CLAUDE_PID: String(process.pid), CLAUDE_CODE_SESSION_ID: 'radar-test' };
  // `sleep` itself, no shell: what a task running `exec sleep …` leaves behind.
  const children = [
    spawn('sleep', ['5'], { env, stdio: ['ignore', background, background] }),
    spawn('sleep', ['5'], { env, stdio: ['ignore', 'pipe', 'pipe'] }), // monitor: libuv pipes are sockets
    spawn('sleep', ['5'], { env, stdio: ['ignore', foreground, foreground] }),
    spawn('sleep', ['5'], { env, stdio: ['pipe', 'pipe', 'pipe'] }), // a hook: its stdin is the JSON it was handed
    spawn('sleep', ['5'], { env: { ...env, CLAUDE_PID: '1' }, stdio: ['ignore', background, background] }), // not Claude's child
  ];
  t.after(() => {
    for (const child of children) child.kill();
    fs.closeSync(background);
    fs.closeSync(foreground);
    fs.rmSync(dir, { recursive: true, force: true });
    if (configDir === undefined) delete process.env.CLAUDE_CONFIG_DIR;
    else process.env.CLAUDE_CONFIG_DIR = configDir;
  });
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.deepEqual(state.backgroundTasks(Date.now() + 10000).get('radar-test'), { shells: 1, monitors: 1 });

  // b2 moves to the background, its line landing in two writes: the half
  // line is left for the next read, which finds the id whole.
  const transcript = path.join(dir, 'projects/-x/radar-test.jsonl');
  fs.appendFileSync(transcript, '{"toolUseResult":{"backgroundTaskId":"b');
  assert.deepEqual(state.backgroundTasks(Date.now() + 20000).get('radar-test'), { shells: 1, monitors: 1 });
  fs.appendFileSync(transcript, '2"}}\n');
  assert.deepEqual(state.backgroundTasks(Date.now() + 30000).get('radar-test'), { shells: 2, monitors: 1 });

  // A transcript replaced under its name is read again from the top, and an
  // id straddling the 4 MiB chunk of a line too long for one is still found.
  const chunk = 4 << 20;
  const head = '{"stdout":"' + 'x'.repeat(chunk - 11 - 10) + '","backgroundTaskId":"b1"}\n';
  fs.writeFileSync(`${transcript}.new`, head);
  fs.renameSync(`${transcript}.new`, transcript);
  assert.deepEqual(state.backgroundTasks(Date.now() + 40000).get('radar-test'), { shells: 1, monitors: 1 });
});

test('a nested entry indents the agents cell, not the shells beside it', () => {
  const tokens = state.stateTokens('idle', line, 'T', '', { agents: '1 agent', shells: '1 shell' }, '​  ');
  assert.equal(tokens.d_agents, '​  1 agent');
  assert.equal(tokens.d_shells, '1 shell');
  const shellsOnly = state.stateTokens('idle', line, 'T', '', { shells: '1 shell' }, '​  ');
  assert.equal(shellsOnly.d_shells, '​  1 shell');
});

test('the logo follows the title\'s last row', () => {
  assert.equal(state.stateTokens('idle', line, 'T', '').logo, 'L');
  const wrapped = state.stateTokens('working', line, 'T', 'T2');
  assert.equal(wrapped.logo_working, null);
  assert.equal(wrapped.logo2_working, 'L');
});

test('the retired d_tab pair is still owned, so purge clears an older daemon\'s value', () => {
  assert.ok(state.OWNED_TOKENS.includes('d_tab'));
  assert.ok(state.OWNED_TOKENS.includes('d_tab_stale'));
});

test('every published name is owned, so purge and the orphan sweep clear it', () => {
  const tokens = state.stateTokens('working', line, 'T', 'T2', { model: 'm', topic: 't', topic2: 't2' });
  for (const name of Object.keys(tokens)) {
    if (name.startsWith('name_')) continue; // legacy, nulled on every write
    assert.ok(state.OWNED_TOKENS.includes(name), name);
  }
});

test('agent status is subscribed per pane, since a bare entry rejects the whole subscription', () => {
  const subs = require('../lib/subscribe').subscriptions(['w1:p1', 'w2:p3']);
  const status = subs.filter((s) => s.type === 'pane.agent_status_changed');
  assert.deepEqual(status.map((s) => s.pane_id), ['w1:p1', 'w2:p3']);
  assert.ok(subs.every((s) => s.type !== 'pane.agent_status_changed' || s.pane_id));
});

// A pane moved to another workspace: Herdr lists it under a new id and keeps
// the old id as an alias of it, so a clear sent to the old id wiped the moved
// pane's row (it kept its title and lost model, effort and topic for good).
test('a moved pane\'s old id is forgotten without a clear, while its new id is live', async (t) => {
  const ipc = require('../lib/ipc');
  const { Frame } = require('../lib/frame');
  const reports = [];
  t.mock.method(ipc, 'call', async (method, params) => {
    if (method === 'pane.get') return { result: { pane: { pane_id: 'w2:p1' } } };
    reports.push(params.pane_id);
    return { result: {} };
  });
  const frame = new Frame('test');
  frame.lastLine.set('w1:p2', 'painted');
  frame.lastTokens.set('w1:p2', { d_model: 'Opus 5.5' });

  let jobs = [];
  frame.clearGone(new Set(['w2:p1']), 0, jobs);
  await Promise.all(jobs);
  assert.deepEqual(reports, [], 'the clear reached the moved pane through its old id');
  assert.equal(frame.lastLine.has('w1:p2'), false, 'the old id is still tracked');
  assert.equal(frame.lastTokens.has('w1:p2'), false);

  // The other direction: the agent is gone from the moved pane too, so the
  // tokens it carried over are ours to clear.
  frame.lastLine.set('w1:p2', 'painted');
  jobs = [];
  frame.clearGone(new Set(), 0, jobs);
  await Promise.all(jobs);
  assert.deepEqual([...new Set(reports)], ['w1:p2'], 'a moved pane with no agent kept our tokens');
});

test('a resubscribe cancels the pending retry, so one subscription stays open', async () => {
  const net = require('node:net');
  const os = require('node:os');
  const path = require('node:path');
  const sock = path.join(os.tmpdir(), `radar-sub-${process.pid}.sock`);
  const open = new Set();
  let first = true;
  const server = net.createServer((conn) => {
    open.add(conn);
    conn.on('close', () => open.delete(conn));
    conn.once('data', () => {
      // The first subscription names a pane that just closed: error, then close.
      if (first) {
        first = false;
        conn.end('{"id":"daemon-sub","error":{"code":"pane_not_found"}}\n');
      } else conn.write('{"id":"daemon-sub","result":{"type":"subscription_started"}}\n');
    });
  });
  await new Promise((resolve) => server.listen(sock, resolve));
  process.env.HERDR_SOCKET_PATH = sock;
  const sub = require('../lib/subscribe').start({ onWake() {}, onGone() {} });
  try {
    sub.panes(['w1:p1']);
    await new Promise((resolve) => setTimeout(resolve, 100)); // first one failed, retry pending
    sub.panes([]);
    await new Promise((resolve) => setTimeout(resolve, 1300)); // past the first retry's backoff
    assert.equal(open.size, 1);
    sub.stop();
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.equal(open.size, 0);
  } finally {
    sub.stop();
    for (const conn of open) conn.destroy();
    delete process.env.HERDR_SOCKET_PATH;
    server.close();
  }
});

// A named session's daemon keeps its own activity stamps and view flag: pane
// ids are per Herdr server, and so is the view override. The default session
// keeps both in the state directory, where they always were.
test('activity stamps and the view flag are per session', () => {
  const { execFileSync } = require('node:child_process');
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'radar-session-'));
  const write = (socket, at) =>
    execFileSync(
      process.execPath,
      [
        '-e',
        `require('./lib/activity').save(new Map([['w0:p1', ${at}]]), 0, { force: true });` +
          `require('./lib/view').setMode('recent');`,
      ],
      { cwd: path.join(__dirname, '..'), env: { ...process.env, HERDR_PLUGIN_STATE_DIR: dir, HERDR_SOCKET_PATH: socket } },
    );
  try {
    write('/x/herdr/herdr.sock', 1);
    write('/x/herdr/sessions/scratch/herdr.sock', 2);
    const read = (...parts) => JSON.parse(fs.readFileSync(path.join(dir, ...parts), 'utf8'));
    assert.deepEqual(read('activity.json'), { 'w0:p1': 1 });
    assert.deepEqual(read('runtime-scratch', 'activity.json'), { 'w0:p1': 2 });
    assert.ok(fs.existsSync(path.join(dir, 'agent-view.on')));
    assert.ok(fs.existsSync(path.join(dir, 'runtime-scratch', 'agent-view.on')));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
