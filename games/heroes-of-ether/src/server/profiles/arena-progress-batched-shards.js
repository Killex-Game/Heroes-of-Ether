"use strict";
const { ArenaProgressShards, laneFor } = require("./arena-progress-shards");
const { profileKeys } = require("./profile-index");
const { copyRecord } = require("./copy-record");
const tableDeltas = require("./immutable-table-delta");
const optionKeys = ["petEvents", "baseRouletteConfig", "promotionConfig", "unlockLeagueBackgrounds",
  "unlockLeagueFrames", "unlockClanCrests"];
function sameInput(current, before) {
  if (current === before) return true;
  if (!current || !before) return false;
  // The daily ranking projection is maintained by central settlement, never
  // read or changed by arenaProgressDraft. Everything else must match exactly.
  const a = Object.keys(current).filter(k => k !== "daily"), b = Object.keys(before).filter(k => k !== "daily");
  return a.length === b.length && a.every(k => Object.hasOwn(before, k) && current[k] === before[k]);
}
class BatchedArenaProgressShards extends ArenaProgressShards {
  async prepare(store, batches) {
    if (this.failed || this.closed) return undefined;
    if (store.data.clanQuests || store.clanDailyQuests) return undefined;
    if (this.pending) throw Error("Concurrent batched progress preparation");
    this.pending = true;
    const started = performance.now(), base = store.data;
    const ctx = { options: Object.fromEntries(optionKeys.map(k => [k, store[k]])),
      events: store.events?.data, rankingReady: store.eventRankingReady?.() !== false };
    try {
      const keys = profileKeys(base.profiles), selected = [];
      const groups = Array.from({ length: this.count }, () => ({ input: { profiles: {}, clans: {} }, batches: [], active: false }));
      for (const batch of batches) {
        if (selected.length && (selected.length === 32 || store.competitionDue(base, batch.at))) break;
        selected.push(batch);
        const split = Array.from({ length: this.count }, () => []);
        for (const event of batch.progress) {
          const key = keys.get(event.profileId);
          if (!key) continue;
          const p = base.profiles[key], lane = laneFor(p.id, this.count), group = groups[lane];
          group.active = true; group.input.profiles[key] = p; split[lane].push(event);
          if (p.clanId && base.clans[p.clanId]) group.input.clans[p.clanId] = { xp: base.clans[p.clanId].xp };
        }
        // Include empty steps so every worker prediction has the same original
        // FIFO position. Never combine times or skip a calendar settlement.
        for (let lane = 0; lane < groups.length; lane++)
          groups[lane].batches.push({ id: batch.id, at: batch.at, progress: split[lane] });
      }
      const dispatched = performance.now();
      const replies = await Promise.all(groups.map((group, lane) => group.active
        ? this.submit(lane, group.input, group.batches, ctx) : null));
      this.stats.jobs++; this.stats.roundTripMs += performance.now() - started;
      this.stats.transferMs += dispatched - started;
      if (store.data !== base || store.events?.data !== ctx.events || (store.eventRankingReady?.() !== false) !== ctx.rankingReady ||
          optionKeys.some(k => store[k] !== ctx.options[k])) {
        this.stats.conflicts++; return null;
      }
      for (const reply of replies) if (reply) this.stats.computeMs += reply.computeMs;
      const mergeAt = performance.now(), changes = [];
      let snapshot = store.data;
      for (let index = 0; index < selected.length; index++) {
        const batch = selected[index];
        if (snapshot.progressReceipt === batch.id) { changes.push([]); continue; }
        const steps = replies.flatMap((reply, lane) => reply ? [{ result: reply.steps[index], lane }] : []);
        // Settling an earlier batch can award a title or clan prize to an
        // otherwise independent player. Recalculate the WHOLE affected tick
        // on its new authoritative input rather than merging stale rewards.
        const conflicted = steps.some(({ result, lane }) =>
          groups[lane].batches[index].progress.some(e => {
            const key = keys.get(e.profileId);
            return !sameInput(snapshot.profiles[key], result.before.profiles[key]);
          }) || result.clanXp.some(([id]) => !snapshot.clans[id]));
        let next = snapshot, ids;
        if (conflicted) {
          this.stats.recomputed = (this.stats.recomputed || 0) + 1;
          const draft = store.arenaProgressDraft(snapshot, batch.id, batch.progress, batch.at);
          next = draft?.next || snapshot; ids = draft?.ids || [];
        } else {
          const changed = new Set(), assigned = new Set(), xp = new Map();
          let profiles = snapshot.profiles;
          for (const { result, lane } of steps) {
            const patch = result.patch, allowed = groups[lane].input.profiles;
            if (Object.keys(patch.set).length || patch.remove.length ||
                Object.keys(patch.tables || {}).some(k => !["profiles", "profileEdits"].includes(k)) ||
                (patch.tables.profiles?.remove || []).length) throw Error("Invalid batched progress scope");
            const modified = [...Object.keys(patch.tables.profiles?.set || {}), ...Object.keys(patch.tables.profileEdits || {})];
            for (const key of modified) {
              if (assigned.has(key) || !Object.hasOwn(allowed, key)) throw Error("Overlapping batched progress profiles");
              assigned.add(key);
              const predicted = result.predicted.profiles[key], before = result.before.profiles[key], current = snapshot.profiles[key];
              if (predicted.daily !== before.daily) throw Error("Arena modified central ranking projection");
              if (profiles === snapshot.profiles) profiles = copyRecord(profiles);
              profiles[key] = predicted;
              if (current.daily !== before.daily) {
                profiles[key] = { ...predicted };
                if (Object.hasOwn(current, "daily")) profiles[key].daily = current.daily;
                else delete profiles[key].daily;
              }
            }
            for (const id of result.ids) changed.add(id);
            for (const [id, gain] of result.clanXp) {
              if (!groups[lane].input.clans[id] || !Number.isSafeInteger(gain) || gain < 0) throw Error("Invalid batched clan XP");
              xp.set(id, (xp.get(id) || 0) + gain);
            }
          }
          if (profiles !== snapshot.profiles) {
            tableDeltas.remember(profiles, snapshot.profiles, assigned, true);
            next = { ...snapshot, profiles, progressReceipt: batch.id };
          }
          if (xp.size) {
            next = { ...next, clans: { ...snapshot.clans } };
            for (const [id, gain] of xp) {
              const clan = snapshot.clans[id], total = clan.xp + gain;
              if (!Number.isSafeInteger(total)) throw Error("Clan XP overflow");
              next.clans[id] = { ...clan, xp: total };
            }
            tableDeltas.remember(next.clans, snapshot.clans, xp.keys(), true);
          }
          ids = [...new Set(batch.progress.map(e => e.profileId))].filter(id => changed.has(id));
        }
        if (next !== snapshot) snapshot = store.prepareSnapshot(next, batch.at, undefined, snapshot);
        changes.push(ids);
      }
      this.stats.transferMs += performance.now() - mergeAt;
      return { snapshot, changes };
    } catch {
      this.fail("batched-calculation"); return undefined;
    } finally { this.pending = false; }
  }
}
module.exports = { BatchedArenaProgressShards };
