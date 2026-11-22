/* Расчёт клиентских таймеров перезарядки по серверному состоянию. */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.KillexBoosterTiming = api;
})(typeof globalThis !== "undefined" ? globalThis : this, () => {
  "use strict";
  function cooldown(item, me, elapsed = 0, rules = {}) {
    if (!item || !me) return { ms: 0, duration: 1 };
    const remaining = (value) => Math.max(0, (Number(value) || 0) - Math.max(0, elapsed));
    return {
      ms: remaining(me.boosterCooldowns?.[item.id]),
      duration: item.cooldownMs || rules.cooldownMs || 500,
    };
  }
  const label = (ms) =>
    ms >= 1000 ? String(Math.ceil(ms / 1000)) : (Math.ceil(ms / 100) / 10).toFixed(1);
  const turbo = (state, elapsed = 0) =>
    Math.max(0, (state?.remainingMs || 0) - (state?.active ? Math.max(0, elapsed) : 0));
  return { cooldown, label, turbo };
});
