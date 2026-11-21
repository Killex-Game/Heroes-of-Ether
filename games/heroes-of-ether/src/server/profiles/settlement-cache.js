"use strict";
const rankings = require("../rankings/daily-leaderboards");
const tables = require("./immutable-table-delta");
function windowAt(at, from = 0, until = Infinity) {
  return { from, until, include(value) {
    if (!Number.isFinite(value)) return;
    if (value > at) this.until = Math.min(this.until, value);
    else this.from = Math.max(this.from, value);
  }};
}

// Published profiles are immutable. A prepared profile needs another personal
// capture only after a write, a clock reversal, or an actual expiry boundary.
// This is a cache of completed work, never a timer delaying rewards or writes.
class SettlementCache {
  constructor() {
    this.prepared = new WeakMap(); this.worlds = new WeakMap();
    this.treasuries = new WeakMap();
    this.treasuryInputs = new WeakMap();
    this.clanRules = new WeakMap(); this.clanAppearances = new WeakMap();
    this.clanAppearanceInputs = new WeakMap();
    this.clanDeadlines = new WeakMap();
    this.matches = new Map();
  }
  matchingProfiles(name, profiles, inspect, context) {
    const saved = this.matches.get(name);
    const changed = saved?.context === context && saved
      ? tables.changedKeys(saved.profiles, profiles) : null;
    if (changed?.length === 0) {
      // Advance provenance even for equivalent tables; otherwise a long chain
      // of unrelated writes eventually forces an avoidable full rescan.
      this.matches.set(name, {profiles, keys:saved.keys, context});
      return saved.keys;
    }
    const keys = new Set(changed ? saved.keys : []);
    for (const key of changed || Object.keys(profiles)) {
      const p = profiles[key];
      if (p && inspect(p)) keys.add(key); else keys.delete(key);
    }
    this.matches.set(name, { profiles, keys, context });
    return keys;
  }
  currentClanRules(clan, unlocked, inspect) {
    if (this.clanRules.get(clan) === unlocked) return clan;
    const updated = inspect(clan, unlocked);
    this.clanRules.set(updated, unlocked);
    return updated;
  }
  clanExpiryDue(clans, at) {
    // Published clan tables are immutable. Arena scores replace competition
    // totals, but not memberships/recruit deadlines. Reinspect a replaced table
    // and never cache a positive result that still requires settlement.
    const known = this.clanDeadlines.get(clans);
    if (known !== undefined) return known <= at;
    let until = Infinity;
    for (const clan of Object.values(clans)) {
      if (!clan.competition?.seasonPeak || !clan.competition?.trophies) return true;
      for (const end of Object.values(clan.competition.recruits || {})) {
        if (end <= at) return true;
        if (Number.isFinite(end)) until = Math.min(until, end);
      }
    }
    this.clanDeadlines.set(clans, until);
    return false;
  }
  clanAppearance(clan, at, unlocked, inspect) {
    const saved = this.clanAppearances.get(clan);
    if (saved && saved.unlocked === unlocked && at >= saved.from && at < saved.until) return clan;
    // XP/scores replace a clan row without changing its immutable appearance.
    // Capture reads that appearance and the already resolved access flag only.
    // Reuse a completed check, but never cross a grant deadline or bypass a
    // missing appearance that still requires migration.
    const shared = clan.appearance && this.clanAppearanceInputs.get(clan.appearance);
    if (shared && shared.unlocked === unlocked && at >= shared.from && at < shared.until) {
      this.clanAppearances.set(clan, shared);
      return clan;
    }
    const updated = inspect(clan, at, false, unlocked);
    const range = windowAt(at);
    for (const value of Object.values(updated.appearance?.grants || {}))
      range.include(value);
    const result = { from:range.from, until:range.until, unlocked };
    this.clanAppearances.set(updated, result);
    if (updated.appearance) this.clanAppearanceInputs.set(updated.appearance, result);
    return updated;
  }
  chestExpiryDue(profile, at, inspect) {
    const saved = this.treasuries.get(profile);
    if (saved && at >= saved.from && at < saved.until) return false;
    // Arena progress replaces the profile but usually retains every treasury
    // input. Reuse only a completed check with identical immutable inputs and
    // account deadlines, never a result saying that settlement is required.
    const anchor = profile.clanChests || profile;
    const shared = this.treasuryInputs.get(anchor);
    if (shared && at >= shared.from && at < shared.until &&
        shared.vipUntil === profile.account?.vipUntil &&
        shared.premiumUntil === profile.account?.premiumUntil &&
        shared.pending === profile.quests?.pending &&
        shared.easter === profile.easter?.chests &&
        shared.friday === profile.blackFriday?.chests) {
      this.treasuries.set(profile, shared);
      return false;
    }
    if (inspect(profile, at)) return true;
    // Only immutable, published profile rows use this cache. Any replacement
    // is inspected again. Recheck exactly at account, queue and notice expiry;
    // Out-of-order room samples in the same validity interval reuse the result.
    // Crossing an earlier account/expiry boundary still rechecks the row.
    const range = windowAt(at);
    const include = value => range.include(value);
    include(profile.account?.vipUntil);
    include(profile.account?.premiumUntil);
    for (const rows of [profile.clanChests?.items, profile.quests?.pending,
      profile.easter?.chests, profile.blackFriday?.chests])
      for (const chest of rows || []) include(chest.expiresAt);
    for (const notice of profile.clanChests?.notices || []) include(notice.at + 86400000);
    const result = {from:range.from, until:range.until,
      vipUntil:profile.account?.vipUntil, premiumUntil:profile.account?.premiumUntil,
      pending:profile.quests?.pending, easter:profile.easter?.chests, friday:profile.blackFriday?.chests};
    this.treasuries.set(profile, result);
    this.treasuryInputs.set(anchor, result);
    return false;
  }
  worldChestExpiryDue(profiles, at, inspect) {
    const prior = this.lastTreasuryWorld;
    const reusable = prior && at >= prior.from && at < prior.until;
    const changed = reusable ? tables.changedKeys(prior.profiles, profiles) : null;
    let until = changed ? prior.until : Infinity;
    let from = changed ? prior.from : 0;
    for (const key of changed || Object.keys(profiles)) {
      const profile = profiles[key];
      if (!profile) continue;
      if (this.chestExpiryDue(profile, at, inspect)) return true;
      until = Math.min(until, this.treasuries.get(profile).until);
      from = Math.max(from, this.treasuries.get(profile).from);
    }
    // An expired/remapped earliest deadline can cause a conservative full scan,
    // never postpone expiry. Unknown ancestry and backwards time also scan.
    this.lastTreasuryWorld = { profiles, from, until };
    return false;
  }
  easterRefreshDue(profiles, at, inspect) {
    const prior = this.lastEasterWorld;
    const reusable = prior && at >= 0 && at < prior.until;
    const changed = reusable ? tables.changedKeys(prior.profiles, profiles) : null;
    let until = changed ? prior.until : Infinity;
    for (const key of changed || Object.keys(profiles)) {
      const profile = profiles[key];
      if (!profile) continue;
      if (inspect(profile, at)) return true;
      for (const batch of profile.easter?.batches || [])
        if (Number.isFinite(batch.expiresAt) && batch.expiresAt > at)
          until = Math.min(until, batch.expiresAt);
    }
    this.lastEasterWorld = { profiles, at, until };
    return false;
  }
  known(world) {
    const saved = this.worlds.get(world.profiles);
    return !!saved && saved.clans === world.clans && saved.competition === world.competition;
  }
  selectKeys(world, previous, at) {
    const saved=this.worlds.get(previous.profiles);
    if (!this.known(previous) || !saved || at < saved.from || at >= saved.until)
      return Object.keys(world.profiles).filter(key => this.needs(world.profiles[key],previous.profiles[key],at));
    const changed=tables.changedKeys(previous.profiles,world.profiles) ??
      Object.keys(world.profiles).filter(key => world.profiles[key]!==previous.profiles[key]);
    return [...new Set([...changed,...saved.pending])].filter(key => Object.hasOwn(world.profiles,key));
  }
  rememberWorld(world, at, previous, keys) {
    // WAL fencing adds a cursor to the envelope, without changing the captured
    // tables. Key by those immutable tables rather than the envelope identity.
    const old=previous && this.known(previous) && this.worlds.get(previous.profiles);
    const reusable=old && at >= old.from && at < old.until;
    const pending=new Set(reusable ? old.pending : []);
    let until=reusable ? old.until : Infinity;
    let from=reusable ? old.from : 0;
    for (const key of reusable ? keys : Object.keys(world.profiles)) {
      const p=world.profiles[key], captured=p && this.prepared.get(p);
      if (!p) { pending.delete(key); continue; }
      if (!captured || at < captured.from || at >= captured.until) pending.add(key);
      else { pending.delete(key); until=Math.min(until,captured.until); from=Math.max(from,captured.from); }
    }
    this.worlds.set(world.profiles, {clans:world.clans, competition:world.competition,from,until,pending});
  }
  needs(profile, previous, at) {
    if (profile !== previous) return true;
    const saved = this.prepared.get(profile);
    return !saved || at < saved.from || at >= saved.until;
  }
  remember(profile, at) {
    const saved = this.prepared.get(profile);
    if (saved && at >= saved.from && at < saved.until) return;
    const until = rankings.nextReset(at), range = windowAt(at, until-86400000, until);
    const include = value => range.include(value);
    include(profile.account?.vipUntil);
    include(profile.account?.premiumUntil);
    for (const value of Object.values(profile.appearance?.grants || {})) include(value);
    for (const batch of profile.easter?.batches || []) include(batch.expiresAt);
    this.prepared.set(profile, {from:range.from, until:range.until});
  }
}
module.exports = { SettlementCache };
