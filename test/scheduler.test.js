'use strict';

// The daemon's frame scheduler (lib/scheduler.js).
//
// Driven for real, on its own default clock — that default is part of what is
// under test — with every timer it arms collected, so none outlives a test
// whatever clock it ends up running on.

const test = require('node:test');
const assert = require('node:assert/strict');

const { createScheduler } = require('../lib/scheduler');

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function scheduler(t, run) {
  const pending = new Set();
  t.after(() => {
    for (const handle of pending) clearTimeout(handle);
  });
  return createScheduler({
    floorMs: 120,
    pollMs: 150,
    debounceMs: 50,
    run,
    setTimer: (fn, ms) => {
      const handle = setTimeout(() => {
        pending.delete(handle);
        fn();
      }, ms);
      pending.add(handle);
      return handle;
    },
    clearTimer: (handle) => {
      pending.delete(handle);
      clearTimeout(handle);
    },
  });
}

// #18. The floor used to compare Date.now() with the last frame, and a clock
// stepped backwards made that negative: every wake looked too soon, was pushed
// minutes into the future, and the panel froze for the length of the step
// while the process answered pings.
test('a wall clock stepped back six minutes does not stop the frames', async (t) => {
  let frames = 0;
  const s = scheduler(t, async () => {
    frames += 1;
  });
  s.wake();
  await pause(300);
  const before = frames;
  assert.ok(before >= 1, 'no frame before the step — the test itself is broken');

  // NTP correcting a fast RTC by six minutes, the way #18's machine booted.
  const real = Date.now;
  t.mock.method(Date, 'now', () => real.call(Date) - 6 * 60 * 1000);
  for (let i = 0; i < 4; i += 1) {
    s.wake();
    await pause(220);
  }
  assert.ok(
    frames - before >= 3,
    `${frames - before} frame(s) in four wakes after the step; the floor reads the wall clock`,
  );
});

// The watchdog judges a silent timer at thirty seconds, so the heartbeat must
// keep reaching the scheduler while a frame is in flight — there it only notes
// a rerun. If a slow frame aged the timer, a slow Herdr would get the daemon
// killed, and its replacement after it.
test('a frame in flight keeps the timer counted as firing', async (t) => {
  let release;
  const s = scheduler(t, () => new Promise((resolve) => (release = resolve)));
  t.after(() => release?.());
  s.wake();
  await pause(300);
  s.wake();
  await pause(150);
  assert.ok(s.runningForMs() >= 250, `a ~400ms frame reports ${Math.round(s.runningForMs())}ms running`);
  assert.ok(s.fireAgeMs() <= 150, `the timer reads ${Math.round(s.fireAgeMs())}ms silent during a frame`);
});

// schu fork: the floor's cases below run on a fake clock and timer queue, so a
// descheduled test process cannot move a frame. `early` makes every timer fire
// that many ms before it is due, the way libuv's cached loop time can.
function fakeScheduler(run, { early = 0 } = {}) {
  let now = 0;
  const queue = [];
  const s = createScheduler({
    floorMs: 120,
    pollMs: 150,
    debounceMs: 50,
    run: () => run(now),
    clock: () => now,
    setTimer: (fn, ms) => {
      const timer = { at: now + (ms > early ? ms - early : ms), fn };
      queue.push(timer);
      return timer;
    },
    clearTimer: (timer) => queue.splice(queue.indexOf(timer), 1),
  });
  // Fire every timer due by `until`, in order, letting each frame settle.
  s.advance = async (until) => {
    for (;;) {
      queue.sort((a, b) => a.at - b.at);
      if (!queue.length || queue[0].at > until) break;
      const timer = queue.shift();
      now = Math.max(now, timer.at);
      timer.fn();
      await new Promise(setImmediate);
    }
    now = until;
  };
  return s;
}

// A wake that drew a frame just before a spinner step must not push the step a
// poll later. The floor holds back wakes, our own echoes among them; a deadline
// the last frame asked for fires once and runs on time.
test('a deadline right after a frame is not held back by the floor', async () => {
  const times = [];
  const s = fakeScheduler(async (now) => {
    times.push(now);
    if (times.length === 1) s.scheduleIn(20);
  });
  s.wake();
  await s.advance(1000);
  assert.deepEqual(times, [50, 70]);
});

test('a wake right after a frame still waits out the floor', async () => {
  const times = [];
  const s = fakeScheduler(async (now) => {
    times.push(now);
    if (times.length === 1) s.wake();
  });
  s.wake();
  await s.advance(1000);
  assert.deepEqual(times, [50, 200]);
});

// An early timer must not run the deadline's frame before its moment: that
// frame draws the step already shown and asks for the same moment again.
test('a deadline whose timer fires early still runs once, on time', async () => {
  const times = [];
  const s = fakeScheduler(
    async (now) => {
      times.push(now);
      if (times.length === 1) s.scheduleIn(150);
    },
    { early: 1 },
  );
  s.wake();
  await s.advance(1000);
  assert.deepEqual(times, [49, 199]);
});

test('no frame is running when none has started', (t) => {
  const s = scheduler(t, async () => {});
  assert.equal(s.runningForMs(), 0);
});
