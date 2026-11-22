"use strict";
const tables = require("../profiles/immutable-table-delta");
const { MARKER } = require("./bot-identity");
const sameMembers = (a, b) => a === b || !!a && !!b && a.length === b.length &&
  a.every((id, index) => id === b[index]);
const sameEligibility = (a, b) => a === b || !!a && !!b &&
  a.id === b.id && a.testBot === b.testBot && a.clanId === b.clanId && a.level === b.level;

// Eligibility depends only on membership, bot identity and level. Arena progress
// replaces immutable rows often, without changing these fields. Ban, occupancy
// and spawn checks remain live in TestBots.update and never use this cache.
class BotRosterEligibility {
  read(store, independent, levelEligible, cacheable) {
    const profiles = store.data.profiles, clans = store.data.clans, previous = this.previous;
    let reuse = !!(cacheable && store.journal && previous &&
      previous.levelEligible === levelEligible && previous.independent === independent);
    if (reuse && profiles !== previous.profiles) {
      const changed = tables.changedKeys(previous.profiles, profiles);
      reuse = changed !== null && changed.every(key => sameEligibility(previous.profiles[key], profiles[key]));
    }
    if (reuse && clans !== previous.clans) {
      const ids = Object.keys(clans);
      reuse = ids.length === Object.keys(previous.clans).length && ids.every(id =>
        clans[id].id === previous.clans[id]?.id && clans[id].independent === previous.clans[id]?.independent &&
        sameMembers(clans[id].members, previous.clans[id].members));
    }
    let eligible = previous?.eligible;
    if (!reuse) {
      eligible = new Set();
      for (const clan of [...Object.values(clans), ...independent])
        if (clan.members.some(id => {
          const p = store.byId(id);
          return p?.testBot === MARKER && (!clan.independent || !p.clanId) && levelEligible(p);
        })) eligible.add(clan.id);
    }
    this.previous = cacheable && store.journal ? { profiles, clans, independent, levelEligible, eligible } : null;
    return eligible;
  }
}
module.exports = { BotRosterEligibility };
