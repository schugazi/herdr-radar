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
