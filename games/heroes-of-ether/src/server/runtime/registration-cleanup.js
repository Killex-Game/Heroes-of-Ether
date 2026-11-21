"use strict";
const { randomUUID } = require("node:crypto");
const { isEmptyRegistration } = require("../profiles/empty-registration");
const { copyRecord } = require("../profiles/copy-record");
const tables = require("../profiles/immutable-table-delta");
const IDLE_MS = 5 * 60000;
class RegistrationCleanup {
  constructor({ profiles, now = Date.now, protectedPlayer = () => false, paused = () => false, busy = () => false }) {
    Object.assign(this, { profiles, now, protectedPlayer, paused, busy });
    this.startedAt = now(); this.seen = new Map(); this.checked = new WeakMap(); this.cursor = 0;
  }
  touch(id) {
    const p = this.profiles.byId(id);
    if (p?.personal?.nameSet === false) this.seen.set(id, this.now());
    else this.seen.delete(id);
  }
  empty(p) {
    if (!this.checked.has(p)) this.checked.set(p, isEmptyRegistration(p));
    return this.checked.get(p);
  }
  run() {
    const at = this.now();
    // Restart and maintenance never turn uncertainty about activity into deletion.
    if (this.paused()) { this.startedAt = at; return []; }
    if (this.busy()) return [];
    if (at - this.startedAt < IDLE_MS) return [];
    const world = this.profiles.data;
    if (!this.scan || this.cursor >= this.scan.length) {
      this.scan = Object.keys(world.profiles); this.cursor = 0;
      const ids = new Set(Object.values(world.profiles).map(p => p.id));
      for (const id of this.seen.keys()) if (!ids.has(id)) this.seen.delete(id);
    }
    const removed = [], deletedKeys = [];
    // Bound both examination and writes; this does not run in the physics tick.
    for (let count = 0; count < 256 && this.cursor < this.scan.length && removed.length < 8; count++) {
      const key = this.scan[this.cursor++], p = world.profiles[key];
      if (!p || p.personal?.nameSet !== false || this.protectedPlayer(p.id) || this.profiles.isOnline?.(p.id) ||
          at - Math.max(this.startedAt, this.seen.get(p.id) || 0, p.activity?.registeredAt || at) < IDLE_MS || !this.empty(p)) continue;
      // Protect references even in legacy data with an inconsistent clanId.
      if (Object.values(world.clans).some(c => c.ownerId === p.id || c.members?.includes(p.id) || c.applications?.includes(p.id))) continue;
      if (world.gameGrants?.campaigns.some(c => c.targets.includes(p.id))) continue;
      deletedKeys.push(key); removed.push(p);
    }
    if (!removed.length) return [];
    const profiles = copyRecord(world.profiles);
    for (const key of deletedKeys) delete profiles[key];
    tables.remember(profiles, world.profiles, deletedKeys);
    const administration = world.administration || { version: 1, audit: [], receipts: {} };
    const audit = administration.audit.concat(removed.map(p => ({ id: randomUUID(), at,
      actorId: "system:registration-cleanup", targetId: p.id, targetName: p.name,
      action: "registration-expired", label: "Удалён пустой незавершённый профиль",
      reason: "Ник не подтверждён, 5 минут без активности; игровой прогресс отсутствует." })));
    // This is a membership-only change: no rewards/calendar captures or copied
    // profile bodies. WAL/fsync succeeds before the new table becomes visible.
    this.profiles.writeSnapshot({ ...world, profiles, administration: { ...administration, audit } });
    for (const p of removed) this.seen.delete(p.id);
    return removed.map(p => p.id);
  }
}
module.exports = { RegistrationCleanup, IDLE_MS };
