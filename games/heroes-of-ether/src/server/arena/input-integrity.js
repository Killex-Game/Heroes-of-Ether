"use strict";
const { randomUUID } = require("node:crypto");
const { activeBan, validate } = require("../admin/moderation");
const { newBanId } = require("../admin/ban-identifiers");
const { profileKeys, remember } = require("../profiles/profile-index");
const { replaceBatchProfile } = require("../profiles/profile-batch");
const deltas = require("../profiles/immutable-table-delta");
const { copyRecord } = require("../profiles/copy-record");
const REASON = "Нарушение правил игры по пункту 3.2";
const DURATION_MS = 180 * 86400000;
const commands = new Set(["move", "stop", "split", "feed", "setTurbo", "useBooster", "usePetBooster", "useAccessoryBooster"]);
// These are exclusively server-owned fields, never sent by any supported
// client command. Timing, repeated clicks and cooldown rejections are NOT proof.
const serverFields = new Set(["mass", "radius", "speed", "vx", "vy", "velocity", "position",
  "parts", "effects", "effectStrengths", "protectedUntil", "shieldReadyAt", "shieldCooldowns",
  "boosterReadyAt", "boosterItemReadyAt", "boosterCooldownMs", "boosterCooldowns"]);
function inspect(message) {
  if (!message || typeof message !== "object" || Array.isArray(message) || !commands.has(message.type)) return null;
  let fields;
  for (const key in message) if (Object.hasOwn(message, key) && serverFields.has(key)) (fields ||= []).push(key);
  // Store bounded field names only; raw packets may contain personal data.
  return fields ? { kind: "server-state-in-command", command: message.type, fields: fields.sort() } : null;
}
class InputIntegrity {
  constructor({ profiles, actionQueue, now = Date.now, onBan = () => {} }) {
    Object.assign(this, { profiles, actionQueue, now, onBan });
    this.pending = new Map();
  }
  report(id, message) {
    const evidence = inspect(message);
    if (!evidence) return Promise.resolve(false);
    if (this.pending.has(id)) return this.pending.get(id);
    const eventId = randomUUID();
    const prepare = batch => {
      const world = batch?.next || this.profiles.data, index = profileKeys(world.profiles), key = index.get(id);
      const current = world.profiles[key];
      if (!current) throw Error("Игрок для проверки не найден.");
      const at = this.now();
      if (activeBan(current, at)) return { finish: () => { this.onBan(id); return true; } };
      const ban = { at, until: at + DURATION_MS, reason: REASON, by: "system:integrity",
        id: newBanId(world), byName: "Системная блокировка" };
      const draft = { ...current, revision: current.revision + 1,
        moderation: { ...current.moderation, version: (current.moderation?.version || 0) + 1, ban } };
      const changed = batch && replaceBatchProfile(batch, world, key, draft);
      const table = changed?.profiles || Object.assign(copyRecord(world.profiles), { [key]: draft });
      if (!changed) deltas.remember(table, world.profiles, [key], true);
      remember(table, index);
      const administration = world.administration || { version: 1, audit: [], receipts: {} };
      const event = { id: eventId, at, actorId: "system:integrity", actorName: "Системная блокировка",
        targetId: id, targetName: current.name, action: "ban", label: "Автоматическая блокировка аккаунта",
        reason: REASON, banId: ban.id, before: current.moderation?.ban || null, after: ban, evidence };
      const next = { ...(changed || world), profiles: table,
        administration: { ...administration, audit: [...administration.audit, event] } };
      validate(next, [key]);
      if (batch) batch.next = next;
      else this.profiles.save(next, at);
      return { finish: () => { this.onBan(id); return true; } };
    };
    // Publish the ban and disconnect only after the normal durable commit.
    const promise = Promise.resolve().then(() => {
      if (!this.profiles.journal || !this.actionQueue) return prepare().finish();
      return new Promise((resolve, reject) => this.actionQueue.use({ owner: id,
        prepare: batch => { const result = prepare(batch); return { finish: () => { result.finish(); resolve(true); } }; },
        fail: reject,
      }));
    }).finally(() => this.pending.delete(id));
    this.pending.set(id, promise);
    return promise;
  }
}
module.exports = { InputIntegrity, inspect, REASON, DURATION_MS };
