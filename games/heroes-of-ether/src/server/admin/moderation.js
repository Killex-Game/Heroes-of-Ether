"use strict";
const { BoosterError } = require("../boosters/booster-catalog");
const identifiers = require("./ban-identifiers");
function activeBan(profile, at = Date.now()) {
  const ban = profile?.moderation?.ban;
  return ban && (ban.until === null || ban.until > at) ? ban : null;
}
function requirePlayable(profile, at) {
  const ban = activeBan(profile, at);
  if (ban)
    throw Object.assign(new BoosterError("Аккаунт заблокирован: " + ban.reason, 403), {
      code: "ACCOUNT_BANNED",
    });
}
// Called only by the blocked player's access request, never by the arena tick.
// Legacy short IDs are deterministic without rewriting old saves or depending
// on an available admin credential store.
function publicBan(profile, data, ownerId, at = Date.now()) {
  const ban = activeBan(profile, at);
  if (!ban) return null;
  const event = (!ban.id || !ban.byName)
    ? identifiers.banEvent(profile, data, ban)
    : null;
  const banId = identifiers.banId(profile, data, ban);
  const moderatorName = ban.by.startsWith("system:") ? "Системная блокировка"
    : ban.by === ownerId || ban.by === "owner" ? "Killex"
    : ban.byName || event?.actorName || "Не указан";
  return { reason: ban.reason, until: ban.until, banId, moderatorName };
}
function validate(data, keys) {
  for (const key of keys || Object.keys(data.profiles)) {
    const p = data.profiles[key];
    require('../arena/kill-detector').validate(p.kill);
    require("../chat/chat-rules").validate(p);
    if (p.moderation === undefined) continue;
    const ban = p.moderation?.ban;
    if (
      !p.moderation ||
      Array.isArray(p.moderation) ||
      (p.moderation.version !== undefined &&
        (!Number.isSafeInteger(p.moderation.version) || p.moderation.version < 0)) ||
      (ban !== null &&
        (!ban ||
          typeof ban.reason !== "string" ||
          !ban.reason.trim() ||
          ban.reason.length > 500 ||
          typeof ban.by !== "string" ||
          (ban.id !== undefined && (typeof ban.id !== "string" || !/^[a-zA-Z0-9_-]{6,80}$/.test(ban.id))) ||
          (ban.byName !== undefined && (typeof ban.byName !== "string" || !ban.byName.trim() || ban.byName.length > 100)) ||
          !Number.isSafeInteger(ban.at) ||
          ban.at < 0 ||
          (ban.until !== null && (!Number.isSafeInteger(ban.until) || ban.until <= ban.at))))
    )
      throw Error("Повреждены данные блокировок. Сохранение не перезаписано.");
  }
  if (data.administration !== undefined) {
    const a = data.administration;
    if (
      !a ||
      a.version !== 1 ||
      !Array.isArray(a.audit) ||
      !a.receipts ||
      Array.isArray(a.receipts) ||
      typeof a.receipts !== "object" ||
      a.audit.some(
        (e) =>
          !e ||
          typeof e.id !== "string" ||
          typeof e.actorId !== "string" ||
          typeof e.targetId !== "string" ||
          typeof e.reason !== "string" ||
          !Number.isSafeInteger(e.at),
      ) ||
      Object.entries(a.receipts).some(
        ([id, r]) =>
          !/^[a-zA-Z0-9_-]{16,80}$/.test(id) ||
          !r ||
          !/^[a-f0-9]{64}$/.test(r.signature) ||
          typeof r.eventId !== "string",
      )
    )
      throw Error("Повреждён журнал владельца. Сохранение не перезаписано.");
  }
}
module.exports = { activeBan, requirePlayable, publicBan, validate };
