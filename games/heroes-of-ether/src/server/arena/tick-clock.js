"use strict";

// Keep the 50 ms cadence even when the OS wakes a timer a few ms late.
// A stalled room resumes with one real step, never a burst of historical steps.
function startTickClock(
  tick,
  period,
  { now = () => performance.now(), schedule = setTimeout, cancel = clearTimeout } = {},
) {
  let deadline = now() + period,
    stopped = false,
    blocked = false,
    resumeScheduled = false;
  let timer = schedule(run, period);
  function run() {
    if (stopped) return;
    const started = now();
    if (started >= deadline) {
      deadline = started - deadline >= period ? started + period : deadline + period;
      // Optional admission barrier: the caller has NOT advanced simulation.
      // Its durable acknowledgement can resume this one owed step without
      // waiting for another full period. Ordinary clocks return undefined.
      if (tick() === false) { blocked = true; timer = schedule(resumeRun, period); return; }
    }
    if (!stopped) timer = schedule(run, Math.max(1, Math.ceil(deadline - now())));
  }
  const stop = () => {
    stopped = true;
    cancel(timer);
  };
  function resumeRun() {
    timer = null;
    resumeScheduled = false;
    if (stopped || !blocked) return;
    const started = now();
    if (tick() === false) {
      // Continue retry/timeout housekeeping if an acknowledgement is delayed.
      timer = schedule(resumeRun, period);
      return;
    }
    blocked = false;
    // Resume one real step. No catch-up burst, even after a long write stall.
    deadline = started + period;
    timer = schedule(run, Math.max(1, Math.ceil(deadline - now())));
  }
  stop.resume = () => {
    if (stopped || !blocked || resumeScheduled) return;
    cancel(timer);
    resumeScheduled = true;
    timer = schedule(resumeRun, 1);
  };
  return stop;
}
module.exports = { startTickClock };
