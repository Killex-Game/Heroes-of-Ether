/* Расчёт клиентских таймеров перезарядки по серверному состоянию. */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.KillexBoosterTiming = api;
})(typeof globalThis !== "undefined" ? globalThis : this, () => {
  "use strict";
  function cooldown(item, me, elapsed = 0, rules = {}) {
    if (!item || !me || item.kind === "mass") return { ms: 0, duration: 1 };
    const remaining = (value) => Math.max(0, (Number(value) || 0) - Math.max(0, elapsed));
    if (item.kind === "shield")
      return {
        // The server permits immediate replacement after a shield was broken
        // or replaced. Do not leave the normal UI locked behind a stale timer.
        ms: (me.effects || []).some(e => e.id === item.id && remaining(e.remainingMs) > 0)
          ? remaining(me.shieldCooldowns?.[item.id]) : 0,
        duration: rules.shieldCooldownMs || 15000,
      };
    const effect = item.target === "self" ? (me.effects || []).find((e) => e.id === item.id) : null;
    const own = remaining(effect?.remainingMs),
      shared = item.sharedCooldownMs === 0 ? 0 : remaining(me.boosterCooldownMs),
      itemCooldown = remaining(me.boosterCooldowns?.[item.id]);
    if (itemCooldown > Math.max(own, shared))
      return { ms: itemCooldown, duration: item.cooldownMs || itemCooldown };
    return own > shared
      ? { ms: own, duration: item.durationMs || own }
      : { ms: shared, duration: rules.cooldownMs || 1000 };
  }
  const label = (ms) =>
    ms >= 1000 ? String(Math.ceil(ms / 1000)) : (Math.ceil(ms / 100) / 10).toFixed(1);
  const turbo = (state, elapsed = 0) =>
    Math.max(0, (state?.remainingMs || 0) - (state?.active ? Math.max(0, elapsed) : 0));
  return { cooldown, label, turbo };
});
