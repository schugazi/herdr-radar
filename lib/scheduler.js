'use strict';

// The daemon's frame scheduler: one timer, aimed at the earliest thing that
// needs doing. Wakes (events, file changes, the heartbeat) pull it closer; a
// finished frame pushes it out to the next real deadline; a floor keeps our
// own token writes, which echo back as events, from scheduling frames forever.
//
// Every interval here is measured on a monotonic clock, never the wall clock.
// The floor used to compare `Date.now()` against the time of the last frame,
// and a wall clock stepped BACKWARDS — NTP correcting a fast RTC at boot, which
// is when this daemon starts — makes that difference negative: every wake then
// looks too soon after the last frame, is pushed out to a "last frame + 150ms"
// that now lies minutes in the future, and the panel stops drawing for as long
// as the step was, while the process answers pings and looks healthy. Reported
// in #18.
//
// Callers hand this DELAYS, not moments. The frame's own deadlines are wall
// clock times — they are compared with persisted activity stamps, which must
// stay wall clock — so they are turned into a delay at the call site, in the
// same instant the wall clock was read, and no step can fall in between.

function createScheduler({
  run,
  floorMs,
  pollMs,
  debounceMs,
  clock = () => performance.now(),
  setTimer = setTimeout,
  clearTimer = clearTimeout,
}) {
  let timer = null;
  let nextAt = Infinity;
  // schu fork: whether the armed timer is a wake, which the floor holds back,
  // rather than a deadline the last frame asked for, which it does not. The
  // floor is there for wakes only: our echoes arrive as wakes, and a deadline
  // fires once. Holding a deadline back too cost a spinner step whenever a
  // wake (heartbeat, agent event) drew a frame just before it: that frame had
  // nothing new to show, and the step it was waiting for was pushed a full
  // poll later, a 300ms beat where every other one is 150.
  let timerIsWake = false;
  let running = false;
  let rerun = false;
  let lastFrameAt = -Infinity;
  const bornAt = clock();
  let lastFireAt = bornAt;

  const arm = (ms, isWake) => {
    const at = clock() + Math.max(0, ms);
    if (timer && at >= nextAt) return;
    if (timer) clearTimer(timer);
    nextAt = at;
    timerIsWake = isWake;
    timer = setTimer(fire, Math.max(0, at - clock()));
  };

  const scheduleIn = (ms) => arm(ms, false);

  const wake = () => arm(debounceMs, true);

  async function fire() {
    const isWake = timerIsWake;
    timer = null;
    nextAt = Infinity;
    lastFireAt = clock();
    if (running) {
      rerun = true;
      return;
    }
    const since = clock() - lastFrameAt;
    if (isWake && since < floorMs) {
      arm(pollMs - since, true);
      return;
    }
    running = true;
    lastFrameAt = clock();
    try {
      await run();
    } finally {
      running = false;
      if (rerun) {
        rerun = false;
        wake();
      }
    }
  }

  return {
    wake,
    scheduleIn,
    isRunning: () => running,
    // Two different ways of not drawing, reported separately on `ping` so the
    // watchdog can judge each on its own clock (lib/state.js daemonStatus).
    //
    // `fireAgeMs`: how long since the timer last fired at all. The heartbeat
    // fires it every two seconds whatever else is going on — even while a
    // frame is in flight, where it only notes a rerun — so a gap here means
    // the timers themselves have stopped.
    //
    // `runningForMs`: how long the frame in flight has been running, zero
    // when none is. A frame waits on IPC calls that each time out in seconds,
    // so a long one is a slow Herdr, not a stall, until it is very long.
    fireAgeMs: () => clock() - lastFireAt,
    runningForMs: () => (running ? clock() - lastFrameAt : 0),
  };
}

module.exports = { createScheduler };
