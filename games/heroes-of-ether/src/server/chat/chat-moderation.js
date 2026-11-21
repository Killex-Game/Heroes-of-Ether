"use strict";
const { randomUUID } = require("node:crypto");
const { BoosterError } = require("../boosters/booster-catalog");
const { requirePlayable } = require("../admin/moderation");
const { banId, newBanId } = require("../admin/ban-identifiers");
const { profileKeys, remember } = require("../profiles/profile-index");
const deltas = require("../profiles/immutable-table-delta");
const { copyRecord } = require("../profiles/copy-record");
const { replaceBatchProfile } = require("../profiles/profile-batch");
const receipts = require("../profiles/operation-receipts");
const { countProfanity, fingerprint } = require("./profanity");
const { REASONS, activeMute, decision } = require("./chat-rules");
const RECEIPT = "chat-moderation-v1";

function rejection(result, at) {
  const minutes = result.until ? Math.max(1, Math.ceil((result.until - at) / 60000)) : 0;
  const suffix = result.account ? " Доступ к игре ограничен на 1 час." : minutes
    ? ` Отправка сообщений во всех чатах недоступна ещё ${minutes} мин.` : " Сообщение не отправлено.";
  return Object.assign(new BoosterError(result.reason + "." + suffix, result.account ? 403 : 429), {
    code: result.account ? "ACCOUNT_BANNED" : result.until > at ? "CHAT_MUTED" : "CHAT_REJECTED",
    chatModeration: { reason: result.reason, until: result.until || null, serverNow: at },
  });
}
class ChatModeration {
  constructor({ profiles = null, now = () => Date.now(), onBan = () => {}, actionQueue = null } = {}) {
    this.profiles = profiles;
    this.now = now;
    this.onBan = onBan;
    this.actionQueue = actionQueue;
    // Bounded hot state, shared by every channel. No timer or arena-tick hook.
    this.recent = new Map();
    this.scans = 0;
  }
  current(profile) { return this.profiles?.byId(profile.id) || profile; }
  status(profile) {
    const at = this.now(), mute = activeMute(this.current(profile), at);
    return { reason: mute?.reason || null, until: mute?.until || null, serverNow: at };
  }
  assertCanSend(profile) {
    const current = this.current(profile), at = this.now();
    requirePlayable(current, at);
    const mute = activeMute(current, at);
    if (mute) throw rejection(mute, at);
  }
  check(profile, requestId, signature, text, channel) {
    const current = this.current(profile), at = this.now();
    this.assertCanSend(current);
    const receipt = current.receipts ? receipts.read(current, requestId) : receipts.MISSING;
    if (receipt !== receipts.MISSING) {
      let saved;
      try { saved = JSON.parse(receipt); } catch (_) { /* An unrelated operation. */ }
      if (saved?.[0] !== RECEIPT || saved[1] !== signature)
        throw new BoosterError("Номер сообщения уже использован.", 409);
      throw rejection(saved[2], at);
    }
    const rows = (this.recent.get(current.id) || []).filter(row => at - row.at < 30000);
    const recent = rows.find(row => row.id === requestId);
    if (recent) {
      if (recent.signature !== signature) throw new BoosterError("Номер сообщения уже использован.", 409);
      return;
    }
    this.scans++;
    const key = fingerprint(text), nextRows = [...rows, { at, key, id: requestId, signature }].slice(-12);
    const flood = nextRows.filter(row => at - row.at < 10000).length >= 8 ||
      (key.length > 0 && nextRows.filter(row => row.key === key).length >= 4);
    const profanity = countProfanity(text);
    if (!flood && !profanity) {
      this.remember(current.id, nextRows);
      return;
    }
    if (this.actionQueue && this.profiles?.journal) {
      // Ordinary messages never enter the profile queue. Violations use its
      // asynchronous durable commit, just like other profile changes. A failed
      // stage must publish neither strikes nor a ban/disconnection.
      return new Promise((resolve, reject) => this.actionQueue.use({
        owner: current.id,
        prepare: batch => {
          const world = batch.next, key = profileKeys(world.profiles).get(current.id);
          const fresh = world.profiles[key];
          if (!fresh) throw new BoosterError("Игрок не найден.", 401);
          this.assertCanSend(fresh);
          const previous = receipts.read(fresh, requestId);
          if (previous !== receipts.MISSING) {
            let saved;
            try { saved = JSON.parse(previous); } catch (_) {}
            if (saved?.[0] !== RECEIPT || saved[1] !== signature)
              throw new BoosterError("Номер сообщения уже использован.", 409);
            throw rejection(saved[2], this.now());
          }
          const finish = this.prepareViolation(fresh, requestId, signature, text, channel,
            { flood, profanity }, nextRows, this.now(), batch);
          return { finish: () => { try { finish(); } catch (error) { reject(error); } } };
        },
        fail: reject,
      }));
    }
    this.prepareViolation(current, requestId, signature, text, channel,
      { flood, profanity }, nextRows, at)();
  }
  prepareViolation(current, requestId, signature, text, channel, violation, nextRows, at, batch) {
    const { flood, profanity } = violation;
    const { next, punishment } = decision(current.chatModeration, violation, at);
    const result = punishment || { reason: REASONS.profanity, until: null, account: false };
    const saved = JSON.stringify([RECEIPT, signature, result]);
    const draft = {
      ...current,
      chatModeration: next,
      receipts: { ...current.receipts, [requestId]: saved },
      revision: (current.revision || 0) + 1,
    };
    const eventId = randomUUID();
    const banWorld = result.account ? batch?.next || this.profiles?.data || { profiles: { [current.id]: current } } : null;
    if (result.account) draft.moderation = {
      ...current.moderation,
      version: (current.moderation?.version || 0) + 1,
      ban: { at, until: result.until, reason: result.reason, by: "system:chat", id: newBanId(banWorld), byName: "Системная блокировка" },
    };
    if (this.profiles) {
      const world = batch?.next || this.profiles.data, index = profileKeys(world.profiles), key = index.get(current.id);
      if (!key) throw new BoosterError("Игрок не найден.", 401);
      const changed = batch && replaceBatchProfile(batch, world, key, draft);
      const table = changed?.profiles || Object.assign(copyRecord(world.profiles), { [key]: draft });
      if (!changed) deltas.remember(table, world.profiles, [key], true);
      remember(table, index);
      const administration = world.administration || { version: 1, audit: [], receipts: {} };
      const event = {
        id: eventId, at, actorId: "system:chat", targetId: current.id, targetName: current.name,
        action: result.account ? "ban" : result.until ? "chat-mute" : "chat-strike",
        label: result.account ? "Автоматическая блокировка аккаунта" : result.until ? "Ограничение чата" : "Страйк чата",
        reason: result.reason, requestId,
        ...(result.account ? { banId: draft.moderation.ban.id, previousBan: current.moderation?.ban
          ? { ...current.moderation.ban, id: banId(current, banWorld) } : null } : {}),
        before: current.chatModeration || null, after: next,
        evidence: { channel, text, flood, profanity, accountUntil: result.account ? result.until : null },
      };
      const updated = { ...(changed || world), profiles: table,
        administration: { ...administration, audit: [...administration.audit, event] } };
      if (batch) batch.next = updated;
      else this.profiles.save(updated, at);
    } else {
      // Standalone ChatService fixtures/embedders have no game store. Production
      // always injects ProfileStore and uses the same WAL commit as account bans.
      Object.assign(current, draft);
    }
    return () => {
      this.remember(current.id, punishment ? [] : nextRows);
      if (result.account) this.onBan(current.id);
      throw rejection(result, at);
    };
  }
  remember(id, rows) {
    this.recent.delete(id);
    this.recent.set(id, rows);
    if (this.recent.size > 8192) this.recent.delete(this.recent.keys().next().value);
  }
}
module.exports = { ChatModeration };
