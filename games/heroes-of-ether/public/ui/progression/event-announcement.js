/* Keep existing acknowledgement keys; show events as newspaper articles. */
"use strict";
(() => {
  let profile, scheduled = false;
  const seen = new Set(), displayed = new Set();
  const key = (p, runId) => `event-announcement.v1:${p.id}:${runId}`;
  function acknowledged(k) {
    try { return seen.has(k) || localStorage.getItem(k) === "1"; }
    catch (_) { return seen.has(k); }
  }
  function schedule() {
    if (scheduled) return;
    scheduled = true;
    queueMicrotask(() => {
      scheduled = false;
      const event = profile?.event;
      if (!event || !profile.id || acknowledged(key(profile, event.runId)) || document.hidden ||
        document.body.dataset.screen !== "lobby" || window.KillexBoot?.active || window.KillexMaintenance?.blocked ||
        document.querySelector('dialog[open], dialog[data-required="true"]')) return;
      window.KillexNews?.openEvent(event.runId);
    });
  }
  document.addEventListener("killex:news-event-visible", event => {
    if (profile?.id && event.detail.runId) displayed.add(key(profile, event.detail.runId));
  });
  document.addEventListener("close", event => {
    if (event.target.id === "releaseNotesDialog" && !event.target.open) {
      for (const k of displayed) {
        seen.add(k);
        try { localStorage.setItem(k, "1"); } catch (_) {}
      }
      displayed.clear();
    }
    schedule();
  }, true);
  document.addEventListener("killex:boot-ready", schedule);
  document.addEventListener("killex:news-ready", schedule);
  document.addEventListener("visibilitychange", schedule);
  new MutationObserver(schedule).observe(document.body, { attributes: true, attributeFilter: ["data-screen"] });
  window.KillexEventAnnouncement = { update(value) { profile = value; schedule(); } };
})();
