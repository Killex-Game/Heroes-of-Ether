/* Запас и переключение способности Турбо за вход на арену. */
"use strict";
const NOTICE_MS = 180000;
const budget = (p) => p.account?.turboMs ?? 0;
function reset(p, now) {
  p.turbo = { active: false, usedMs: 0, at: now, sequence: 0, lastNoticeAt: -Infinity };
}
function update(p, now) {
  const t = p.turbo;
  if (!t) return;
  if (t.active)
    t.usedMs = Math.max(t.usedMs, Math.min(budget(p), t.usedMs + Math.max(0, now - t.at)));
  t.at = Math.max(t.at, now);
  if (p.dead || t.usedMs >= budget(p)) t.active = false;
}
function view(p, now) {
  const t = p.turbo,
    totalMs = budget(p);
  const used = (t?.usedMs || 0) + (t?.active ? Math.max(0, now - t.at) : 0);
  const remainingMs = Math.max(0, totalMs - used);
  return {
    active: !!t?.active && !p.dead && remainingMs > 0,
    remainingMs,
    totalMs,
    sequence: t?.sequence || 0,
  };
}
function set(p, message, now) {
  if (
    p.dead ||
    message.spawnSerial !== p.spawnSerial ||
    typeof message.active !== "boolean" ||
    !Number.isSafeInteger(message.sequence) ||
    message.sequence <= 0
  )
    return null;
  update(p, now);
  const t = p.turbo;
  if (message.sequence <= t.sequence) return { ok: true, turbo: view(p, now), notice: false };
  t.sequence = message.sequence;
  if (budget(p) <= 0) return { ok: false, turbo: view(p, now), notice: false };
  let notice = false;
  if (message.active && t.usedMs >= budget(p)) {
    if (now - t.lastNoticeAt >= NOTICE_MS) {
      notice = true;
      t.lastNoticeAt = now;
    }
  } else t.active = message.active;
  return { ok: true, turbo: view(p, now), notice };
}
module.exports = { reset, update, view, set, NOTICE_MS };
