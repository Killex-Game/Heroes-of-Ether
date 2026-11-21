/* Timers exist only while their UI is relevant. Deadlines remain wall-clock based. */
(() => {
  "use strict";
  const tasks = new Set();
  let scheduled = false, closed = false;
  const visible = () => !closed && !document.hidden;
  function sync() {
    scheduled = false;
    for (const task of tasks) {
      const active = visible() && task.when();
      if (!active && task.timer !== null) { clearTimeout(task.timer); task.timer = null; }
      if (active && task.timer === null) task.timer = setTimeout(task.run, Math.max(16,typeof task.delay==='function'?task.delay():task.delay));
    }
  }
  function schedule() { if (!scheduled) { scheduled = true; queueMicrotask(sync); } }
  function every(callback, delay, when = () => true) {
    const task = { when, delay, timer: null, run() {
      task.timer = null;
      try { if (visible() && when()) callback(); }
      finally { if (tasks.has(task)) schedule(); }
    } };
    tasks.add(task); schedule();
    return () => { clearTimeout(task.timer); tasks.delete(task); };
  }
  document.addEventListener("visibilitychange", schedule);
  document.addEventListener("killex:profile", schedule);
  document.addEventListener("killex:boot-ready", schedule);
  addEventListener("pagehide", () => { closed = true; sync(); });
  addEventListener("pageshow", () => { closed = false; schedule(); });
  new MutationObserver(schedule).observe(document.documentElement, { subtree: true,
    attributes: true, attributeFilter: ["open", "hidden", "data-screen", "data-view", "aria-selected", "aria-pressed"] });
  window.KillexActivity = { every, sync: schedule,
    visible: element => !!element && element.isConnected && !element.closest('[hidden]') &&
      (!element.closest('dialog') || element.closest('dialog').open) && element.getClientRects().length > 0,
    get running() { return [...tasks].filter(t => t.timer !== null).length; } };
})();
