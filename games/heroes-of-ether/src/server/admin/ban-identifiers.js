"use strict";
const { randomBytes, createHash } = require("node:crypto");
const ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
const isShort = value => typeof value === "string" && /^[2-9A-HJ-NP-Z]{6}$/.test(value);
const encode = bytes => Array.from(bytes.subarray(0, 6), byte => ALPHABET[byte & 31]).join("");
const legacyKey = (profile, ban) => JSON.stringify([profile.id, ban.at, ban.by, ban.until, ban.reason]);
function banEvent(profile, data, ban) {
  return data.administration?.audit?.findLast(e => e.action === "ban" &&
    e.targetId === profile.id && e.actorId === ban.by && e.at === ban.at && e.reason === ban.reason &&
    (e.after?.until ?? e.evidence?.accountUntil ?? null) === ban.until);
}
// Only used when issuing a ban or displaying a legacy ban. No chat scan/tick work.
// Audit rows are append-only. Reserve their explicit codes first, then allocate
// deterministic legacy codes in journal order, resolving collisions consistently.
function identifiers(data, extraProfile) {
  const used = new Set(), legacy = new Map(), aliases = new Map(), audit = data.administration?.audit || [];
  const profiles = Object.values(data.profiles || {}).filter(p => p.moderation?.ban);
  if (extraProfile?.moderation?.ban && !profiles.some(p => p.id === extraProfile.id)) profiles.push(extraProfile);
  for (const e of audit) {
    for (const id of [e.banId, e.operationId, e.previousBan?.id, e.before?.id, e.after?.id]) if (isShort(id)) used.add(id);
    for (const ban of [e.before, e.previousBan]) if (isShort(ban?.id) && typeof ban.by === "string")
      aliases.set(legacyKey({ id: e.targetId }, ban), ban.id);
  }
  for (const p of profiles) if (isShort(p.moderation.ban.id)) used.add(p.moderation.ban.id);
  function reserve(key) {
    if (legacy.has(key)) return legacy.get(key);
    for (let attempt = 0; attempt < 10000; attempt++) {
      const id = encode(createHash("sha256").update(key + ":" + attempt).digest());
      if (!used.has(id)) { used.add(id); legacy.set(key, id); return id; }
    }
    throw Error("Не удалось подобрать ID блокировки.");
  }
  for (const e of audit) if (e.action === "ban") {
    const previous = aliases.get(legacyKey({ id: e.targetId }, {
      at: e.at, by: e.actorId, reason: e.reason, until: e.after?.until ?? e.evidence?.accountUntil ?? null,
    }));
    const explicit = isShort(e.banId) ? e.banId : isShort(e.after?.id) ? e.after.id : previous;
    if (explicit) legacy.set("event:" + e.id, explicit); else reserve("event:" + e.id);
  }
  for (const p of profiles.sort((a, b) => a.id.localeCompare(b.id))) if (!isShort(p.moderation.ban.id)) {
    const event = banEvent(p, data, p.moderation.ban);
    const key = "profile:" + legacyKey(p, p.moderation.ban);
    if (event) legacy.set(key, legacy.get("event:" + event.id));
    else if (aliases.has(legacyKey(p, p.moderation.ban))) legacy.set(key, aliases.get(legacyKey(p, p.moderation.ban)));
    else reserve(key);
  }
  return { used, legacy };
}
function banId(profile, data, ban = profile.moderation?.ban) {
  if (!ban) return null;
  if (isShort(ban.id)) return ban.id;
  return identifiers(data, profile).legacy.get("profile:" + legacyKey(profile, ban));
}
function newBanId(data, random = randomBytes) {
  const { used } = identifiers(data);
  for (let attempt = 0; attempt < 128; attempt++) {
    const id = encode(random(6));
    if (!used.has(id)) return id;
  }
  throw Error("Не удалось подобрать свободный ID блокировки. Повтори действие.");
}
module.exports = { banId, newBanId, banEvent, isShort };
