"use strict";
const { randomUUID } = require("node:crypto");
const accounts = require("../accounts/account-benefits");
const HOUR = 3600000;
const integer = (n) => Number.isSafeInteger(n) && n >= 0;
function capacity(p, at) {
  const a = accounts.benefits(p, at);
  return a.premium ? 12 : a.vip ? 10 : 7;
}
function waitingHours(p, at) {
  const a = accounts.benefits(p, at);
  return a.vip && a.premium ? 48 : a.vip || a.premium ? 24 : 3;
}
function entries(p) {
  return [
    ...(p.clanChests?.items || []).map((chest) => ({ chest, kind: "clan" })),
    ...(p.quests?.pending || []).map((chest) => ({ chest, kind: "quest" })),
    ...(p.easter?.chests || []).map((chest) => ({ chest, kind: "easter" })),
    ...(p.blackFriday?.chests || []).map((chest) => ({ chest, kind: "friday" })),
  ];
}
function isStored({ chest, kind }) {
  return kind === "quest" ? chest.stored !== false : chest.stored === true;
}
function earnedAt(c) {
  return c.earnedAt ?? c.at ?? c.createdAt ?? 0;
}
function stored(p) {
  return entries(p).filter(isStored).length;
}
// Receiving/reloading cannot reset this origin. A later exit from storage can.
function queue(p, chest, at) {
  chest.stored = false;
  chest.waitingSince = at;
  chest.waitingHours = waitingHours(p, at);
  chest.expiresAt = at + chest.waitingHours * HOUR;
}
function validStorage(c) {
  if (c.storedAt !== undefined && !integer(c.storedAt)) return false;
  if (c.storageOrder !== undefined && (!integer(c.storageOrder) || c.storageOrder < 1))
    return false;
  if (c.expiresAt !== undefined && c.expiresAt !== null && !integer(c.expiresAt)) return false;
  if (c.waitingSince === undefined && c.waitingHours === undefined) return true; // legacy
  return (
    integer(c.waitingSince) &&
    [3, 24, 48].includes(c.waitingHours) &&
    (c.expiresAt === null || c.expiresAt === c.waitingSince + c.waitingHours * HOUR)
  );
}
function expired(c, at) {
  return c.stored === false && Number.isFinite(c.expiresAt) && c.expiresAt <= at;
}
function fill(p, at) {
  // Most arena updates do not change storage. Inspect the existing rows before
  // allocating/sorting migration and queue lists; deadlines are still checked
  // on every call, including account expiry and newly completed quests.
  if (!needsFill(p, at)) return false;
  let changed = false;
  let all = entries(p);
  const hours = waitingHours(p, at);
  let sequence = all.reduce((n, { chest }) => Math.max(n, chest.storageOrder || 0), 0);
  // Reconstruct legacy arrival order across all sources once. Future arrivals
  // use a shared sequence even when their timestamps are identical.
  for (const entry of [...all].sort((a, b) => earnedAt(a.chest) - earnedAt(b.chest))) {
    const c = entry.chest;
    if (isStored(entry)) {
      if (!c.storageOrder) {
        c.storageOrder = ++sequence;
        c.storedAt = earnedAt(c);
        changed = true;
      }
      if (c.expiresAt !== null) {
        c.expiresAt = null;
        changed = true;
      }
    } else {
      if (c.waitingSince === undefined) {
        // Finite legacy clan queues retain their original start; formerly
        // endless quest/event queues get a full window at migration.
        c.waitingSince = Number.isFinite(c.expiresAt) ? earnedAt(c) : at;
        changed = true;
      }
      const deadline = c.waitingSince + hours * HOUR;
      if (c.waitingHours !== hours || c.expiresAt !== deadline) {
        c.waitingHours = hours;
        c.expiresAt = deadline;
        changed = true;
      }
    }
  }
  const burned = all.filter(({ chest }) => expired(chest, at));
  if (burned.length) {
    const ids = new Set(burned.map(({ chest }) => chest.id));
    if (p.clanChests) p.clanChests.items = p.clanChests.items.filter((c) => !ids.has(c.id));
    if (p.quests) {
      for (const row of p.quests.items) {
        const lost = burned.find(({ chest, kind }) => kind === "quest" && chest.id === row.id);
        if (lost) row.expiredAt = lost.chest.expiresAt;
      }
      p.quests.pending = p.quests.pending.filter((c) => !ids.has(c.id));
    }
    if (p.easter) p.easter.chests = p.easter.chests.filter((c) => !ids.has(c.id));
    if (p.blackFriday?.chests) p.blackFriday.chests = p.blackFriday.chests.filter(c => !ids.has(c.id));
    const clan = (p.clanChests ||= { items: [], notices: [] });
    if (ids.has(clan.battleReward?.chestId)) {
      clan.battleReward.status = "expired";
      clan.battleReward.expiresAt = burned.find(
        ({ chest }) => chest.id === clan.battleReward.chestId,
      ).chest.expiresAt;
    }
    clan.notices.push({
      id: randomUUID(),
      at,
      kind: "expired",
      text: "Истёк срок ожидания вне Сокровищницы. Сгорело сундуков: " + burned.length + ".",
    });
    clan.notices = clan.notices.slice(-40);
    all = all.filter(({ chest }) => !ids.has(chest.id));
    changed = true;
  }
  const inside = all.filter(isStored).sort((a, b) => b.chest.storageOrder - a.chest.storageOrder);
  let available = capacity(p, at) - inside.length;
  // Capacity loss evicts newest arrivals, without requiring another claim.
  for (let i = 0; available < 0; i++, available++) {
    const c = inside[i].chest;
    queue(p, c, at);
    c.receivedAt ??= at;
    changed = true;
  }
  const waiting = all
    .filter(
      (entry) => !isStored(entry) && entry.chest.receivedAt !== null && entry.chest.expiresAt > at,
    )
    .sort(
      (a, b) =>
        a.chest.waitingSince - b.chest.waitingSince ||
        earnedAt(a.chest) - earnedAt(b.chest) ||
        (a.chest.storageOrder || 0) - (b.chest.storageOrder || 0),
    );
  for (const { chest } of waiting) {
    if (available <= 0) break;
    chest.stored = true;
    chest.storedAt = at;
    chest.storageOrder = ++sequence;
    chest.expiresAt = null;
    available--;
    changed = true;
  }
  const battle = p.clanChests?.battleReward;
  const chest = battle && p.clanChests.items.find((c) => c.id === battle.chestId);
  if (chest) {
    const status = chest.stored ? "stored" : "available";
    if (battle.status !== status || battle.expiresAt !== chest.expiresAt) {
      battle.status = status;
      battle.expiresAt = chest.expiresAt;
      changed = true;
    }
  }
  return changed;
}
function needsFill(p, at) {
  const sources = [p.clanChests?.items, p.quests?.pending, p.easter?.chests, p.blackFriday?.chests];
  if (!sources.some(rows => rows?.length)) return false;
  const a = accounts.benefits(p, at),
    limit = a.premium ? 12 : a.vip ? 10 : 7,
    hours = a.vip && a.premium ? 48 : a.vip || a.premium ? 24 : 3;
  let count = 0, receivedWaiting = false;
  for (let source = 0; source < sources.length; source++) {
    for (const c of sources[source] || []) {
      const inside = source === 1 ? c.stored !== false : c.stored === true;
      if (inside) {
        if (!c.storageOrder || c.expiresAt !== null || ++count > limit) return true;
      } else {
        if (c.waitingSince === undefined || c.waitingHours !== hours ||
            c.expiresAt !== c.waitingSince + hours * HOUR || expired(c, at)) return true;
        if (c.receivedAt !== null && c.expiresAt > at) receivedWaiting = true;
      }
    }
  }
  if (count < limit && receivedWaiting) return true;
  const battle = p.clanChests?.battleReward;
  const chest = battle && p.clanChests.items.find((c) => c.id === battle.chestId);
  return (
    !!chest &&
    (battle.status !== (chest.stored ? "stored" : "available") ||
      battle.expiresAt !== chest.expiresAt)
  );
}
module.exports = { capacity, stored, fill, needsFill, waitingHours, queue, expired, validStorage };
