'use strict';

// Herdr keeps the view override in the server's memory only. When it is lost,
// the panel falls back to Herdr's own order while the group headers are still
// placed for the plugin's, and a header lands mid-group (#49). The daemon puts
// the chosen order back on a timer; these pin down what that re-apply does,
// and that it never runs across a view switch.

const test = require('node:test');
const assert = require('node:assert/strict');

const view = require('../lib/view');

// A server call the test answers by hand, so the interleaving is explicit.
function pending() {
  let resolve;
  const promise = new Promise((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

const settle = () => new Promise((resolve) => setImmediate(resolve));

test('the chosen order is set again', async (t) => {
  t.mock.method(view, 'mode', () => 'grouped');
  const apply = t.mock.method(view, 'apply', async () => ({ result: { active: true } }));
  await view.reassert();
  assert.equal(apply.mock.callCount(), 1);
  assert.deepEqual(apply.mock.calls[0].arguments, ['grouped']);
});

test("Herdr's own order, once chosen, is left alone", async (t) => {
  t.mock.method(view, 'mode', () => null);
  const apply = t.mock.method(view, 'apply', async () => null);
  const clear = t.mock.method(view, 'clear', async () => null);
  assert.equal(await view.reassert(), null);
  assert.equal(apply.mock.callCount(), 0, 'nothing is set');
  assert.equal(clear.mock.callCount(), 0, "and another source's view is not cleared");
});

// The order the review found: a switch to `off` is waiting on the server's
// clear, the timer fires, and `grouped` is still what is persisted.
test('a tick during a switch to off stands down, and off stays off', async (t) => {
  let persisted = 'grouped';
  const calls = [];
  t.mock.method(view, 'mode', () => persisted);
  t.mock.method(view, 'apply', async (mode) => calls.push(`set:${mode}`));
  const clearing = pending();
  const keeper = view.keeper();

  const switched = keeper.during(async () => {
    calls.push('clear');
    await clearing.promise;
    persisted = null;
  });
  await settle();
  assert.equal(keeper.tick(), null, 'the timer stands down while the switch runs');
  clearing.resolve();
  await switched;

  await keeper.tick();
  assert.deepEqual(calls, ['clear'], 'nothing set the old order back');
});

test('a switch waits out a re-apply already sent', async (t) => {
  const calls = [];
  const setting = pending();
  t.mock.method(view, 'mode', () => 'grouped');
  t.mock.method(view, 'apply', async (mode) => {
    calls.push(`set:${mode}`);
    await setting.promise;
    calls.push(`set:${mode} landed`);
  });
  const keeper = view.keeper();

  const ticked = keeper.tick();
  const switched = keeper.during(async () => calls.push('switch'));
  await settle();
  assert.deepEqual(calls, ['set:grouped'], 'the switch has not gone out yet');
  setting.resolve();
  await Promise.all([ticked, switched]);
  assert.deepEqual(calls, ['set:grouped', 'set:grouped landed', 'switch']);
});

test('a failed re-apply does not wedge the keeper', async (t) => {
  t.mock.method(view, 'mode', () => 'grouped');
  const apply = t.mock.method(view, 'apply', async () => {
    throw new Error('socket gone');
  });
  const keeper = view.keeper();
  await assert.rejects(keeper.tick(), /socket gone/);
  await settle();
  assert.equal(await keeper.during(async () => 'switched'), 'switched');
  await keeper.tick()?.catch(() => {});
  assert.equal(apply.mock.callCount(), 2, 'the next tick runs again');
});
