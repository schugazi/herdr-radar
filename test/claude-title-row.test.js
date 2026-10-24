'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const herdr = require('../lib/herdr');
const { Frame } = require('../lib/frame');

test('Claude titles stay on one coloured row, with fallback and state transitions', async (t) => {
  const sent = {};
  t.mock.method(herdr, 'reportMetadataAsync', async (_pane, _source, tokens) => {
    Object.assign(sent, tokens);
    return true;
  });
  t.mock.method(herdr, 'reportMetadata', () => true);
  const frame = new Frame('test');
  const entry = {
    pane: 'w:p1', workspace: 'w', tab: 't', name: 'claude', claudePane: true,
    sessionTitled: true, title: 'A longer Claude session title about the sidebar',
    detail: { model: 'Opus 5.5', effort: 'high', plan: 'plan mode' },
  };
  const layout = {
    tabs: new Map([['t', 'short-tab']]), indent: '', spinStep: 0,
    keys: {
      minuteKey: () => '000000000001',
      wsKeys: new Map([['w', 'ws']]),
      tabKeys: new Map([['w:p1', 'tab']]),
    },
  };
  async function publish(display, now) {
    const jobs = [];
    frame.paneJobs(entry, display, layout, now, [], jobs);
    await Promise.all(jobs);
  }
  await publish('working', 0);
  assert.ok(sent.title_working.endsWith(entry.title), 'Herdr needs the whole title to fill a wider sidebar');
  assert.equal(sent.title2_working, null);
  assert.ok(sent.logo_working);
  assert.equal(sent.logo2_working, null);
  assert.equal(sent.d_plan, 'plan mode');

  await publish('idle_stale', 10000);
  assert.equal(sent.title_working, null);
  assert.ok(sent.title_idle_stale.endsWith(entry.title));
  assert.equal(sent.title2_idle_stale, null);
  assert.ok(sent.logo_stale);
  assert.equal(sent.logo_working, null);

  entry.sessionTitled = false;
  await publish('idle', 20000);
  assert.ok(sent.title_idle.endsWith('short-tab'));
  assert.equal(sent.title2_idle, null);
  entry.sessionTitled = true;
  entry.title = 'Long title '.repeat(20);
  await publish('working', 30000);
  assert.equal(Array.from(sent.title_working).length, 80, 'keep the entire token within Herdr’s metadata limit');
  assert.equal(sent.title2_working, null);
});
