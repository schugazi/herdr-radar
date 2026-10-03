'use strict';

// The schu fork's own additions: the title split and the detail pairs.

const test = require('node:test');
const assert = require('node:assert/strict');

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
  const fresh = state.stateTokens('idle', line, 'T', 'T2', { model: 'Opus 5.5', topic: 'radar' });
  assert.equal(fresh.d_model, 'Opus 5.5');
  assert.equal(fresh.d_model_stale, null);
  assert.equal(fresh.d_topic, 'radar');
  assert.equal(fresh.d_topic2, null);
  assert.equal(fresh.d_effort, null);
  assert.equal(fresh.title2_idle, 'T2');
  assert.equal(fresh.title2_working, null);

  const stale = state.stateTokens('idle_stale', line, 'T', 'T2', { model: 'Opus 5.5', plan: '' });
  assert.equal(stale.d_model, null);
  assert.equal(stale.d_model_stale, 'Opus 5.5');
  assert.equal(stale.d_plan_stale, null);
  assert.equal(stale.title2_idle_stale, 'T2');
});

test('detail fields come from the detected agent only, so a dead Claude cannot outrank a Codex', () => {
  const both = { model: 'Opus 5.5', effort: 'high', codex_model: 'gpt-6.1-sol', codex_effort: 'medium' };
  assert.deepEqual(state.detailSources('codex', both), { model: 'gpt-6.1-sol', effort: 'medium', plan: null });
  assert.equal(state.detailSources('claude', both).model, 'Opus 5.5');
  assert.deepEqual(state.detailSources('gemini', both), {});
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
