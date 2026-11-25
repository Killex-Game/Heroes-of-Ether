"use strict";
// The same step is used by the local server and the isolated process benchmark.
const easterHunt = require("../events/easter-hunt");
const giftEffects = require("../profiles/gift-effects");
const { ArenaHazards } = require("./arena-hazards");
function stepRoom(room, at, wallAt, profiles, capacity) {
  const prepared = prepareRoomStep(room, at, wallAt, profiles, capacity);
  return finishRoomStep(room, at, profiles, prepared, room.arena.step(at));
}
function prepareRoomStep(room, at, wallAt, profiles, capacity) {
  const { arena, bots } = room;
  const botProgress = bots.update(at, wallAt, capacity);
  // Сроки аккаунтов проверяются даже без действий игрока.
  for (const p of arena.players.values())
    if (p.profileId) {
      const profile = profiles.byId(p.profileId);
      if (profile) {
        const identity = profiles.arenaAppearance(profile);
        p.giftModifiers = giftEffects.modifiers(profile, wallAt);
        p.account = identity.account;
        p.skinId = identity.skinId;
        p.appearance = identity.appearance;
      }
    }
  arena.hazards ||= new ArenaHazards(arena);
  arena.hazards.setRun(easterHunt.runAt(profiles.events, wallAt));
  arena.alchemyField.setRun(require("../events/ether-alchemy").runAt(profiles.events, wallAt), at);
  return { botProgress, botEvents: [...bots.events] };
}
function finishRoomStep(room, at, profiles, prepared, arenaEvents) {
  const { arena, bots } = room;
  const { botProgress, botEvents } = prepared;
  const events = [...botEvents, ...arenaEvents];
  const activeProfiles = new Set(
    [...arena.players.values()].filter((p) => !p.dead && !p.isRemnant).map((p) => p.profileId),
  );
  const spouses = new Map();
  const spouseOnArena = id => {
    if (!spouses.has(id)) {
      const mate = profiles.byId(id)?.social?.marriage?.partnerId;
      spouses.set(id, mate && activeProfiles.has(mate) ? mate : null);
    }
    return spouses.get(id);
  };
  const inputActions = require("./quest-actions").takePending(arena);
  // Actions emitted inside this tick also occur in progressEvents. Preserve
  // their order and include between-tick inputs exactly once in the same WAL batch.
  const current = inputActions.length ? new Set(arena.progressEvents) : null;
  const beforeTick = current ? inputActions.filter(event => !current.has(event)) : inputActions;
  const progress = [
    ...botProgress,
    ...[...beforeTick, ...arena.progressEvents, ...events].map((event) => ({
      ...event,
      profileId: arena.players.get(event.playerId || event.eaterId)?.profileId,
      victimProfileId:
        arena.players.get(event.victimId)?.profileId ||
        arena.players.get(event.victimId)?.departedProfileId,
      spouseOnArena: spouseOnArena(arena.players.get(event.playerId || event.eaterId)?.profileId),
    })),
  ];
  // Sample passive timers together, rather than rewriting the entire save
  // separately at every player's staggered one-second anniversary.
  // Pickups, combat, rewards and life endings still commit immediately.
  const progressSecond = Math.floor(at / 1000),
    samplePassiveProgress = room.progressSecond !== progressSecond;
  room.progressSecond = progressSecond;
  const questRanks =
    samplePassiveProgress &&
    new Map(
      [...arena.players.values()]
        .filter((p) => !p.dead && !p.isRemnant)
        .sort((a, b) => b.mass - a.mass || a.id.localeCompare(b.id))
        .map((p, i) => [p.id, i + 1]),
    );
  for (const p of arena.players.values()) {
    if (!samplePassiveProgress || p.dead || !p.profileId || p.isRemnant) continue;
    p.questSampleAt = at;
    progress.push({
      type: "questSample",
      profileId: p.profileId,
      lifeId: p.lifeId,
      food: p.questFoodCount,
      clanFood: p.clanFoodCount,
      rank: questRanks.get(p.id),
    });
  }
  for (const p of arena.players.values())
    if (
      (samplePassiveProgress || p.lifeTimeSample?.lifeId !== p.lifeId) &&
      !p.dead &&
      p.profileId
    ) {
      const durationSeconds = Math.max(0, Math.floor((at - p.lifeStartedAt) / 1000));
      if (p.lifeTimeSample?.lifeId === p.lifeId && p.lifeTimeSample.seconds === durationSeconds)
        continue;
      progress.push({
        type: "lifeTime",
        profileId: p.profileId,
        lifeId: p.lifeId,
        durationSeconds,
        spouseOnArena: spouseOnArena(p.profileId),
      });
      p.lifeTimeSample = { lifeId: p.lifeId, seconds: durationSeconds };
    }
  for (const event of events)
    if (
      ((event.type === "absorbed" && event.victimDefeated !== false) ||
        event.type === "burned") &&
      !arena.players.get(event.victimId)?.isRemnant
    )
      progress.push({
        type: "lifeEnded",
        profileId: arena.players.get(event.victimId)?.profileId,
        lifeId: event.lifeId,
        durationSeconds: event.durationSeconds,
        durationMs: Math.max(0, Math.floor(at - arena.players.get(event.victimId).lifeStartedAt)),
        food: arena.players.get(event.victimId).questFoodCount,
        clanFood: arena.players.get(event.victimId).clanFoodCount,
        reason: event.type,
        killer: event.killer,
      });
  progress.push(...bots.clearIfIdle(at));
  return {
    progress,
    events: events.map((event) => ({ ...event, arenaId: room.id })),
  };
}

module.exports = { stepRoom, prepareRoomStep, finishRoomStep };
