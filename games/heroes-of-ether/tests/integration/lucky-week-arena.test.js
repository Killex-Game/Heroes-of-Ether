"use strict";
const test = require("node:test"),
  assert = require("node:assert/strict"),
  { randomUUID } = require("node:crypto");
const { ProfileStore } = require("../../src/server/profiles/profile-store"),
  { EventManager } = require("../../src/server/events/event-manager"),
  { createGameServer } = require("../../src/server/game-server"),
  { Arena, radiusForMass } = require("../../src/server/arena/arena-simulation");
test("server tick verifies spouse presence on this arena before recording the earned level", async (t) => {
  let tickAt = 0,
    wallAt = Date.UTC(2026, 9, 23, 10);
  const profiles = new ProfileStore({ now: () => wallAt }),
    events = new EventManager({ now: () => wallAt }),
    arena = new Arena({ etherCount: 0, world: { width: 10000, height: 10000 } });
  const a = profiles.open(),
    b = profiles.open();
  profiles.find(a.token).progress.xp = 480;
  profiles.find(a.token).social = {
    marriage: { partnerId: b.profile.id, at: wallAt },
    invitations: [],
    gifts: [],
    inviteReadyAt: 0,
  };
  profiles.find(b.token).social = {
    marriage: { partnerId: a.profile.id, at: wallAt },
    invitations: [],
    gifts: [],
    inviteReadyAt: 0,
  };
  events.apply("owner", "start", { requestId: randomUUID(), revision: 0, eventId: "lucky-week" });
  const app = createGameServer({
    profiles,
    events,
    arena,
    now: () => tickAt,
    wallNow: () => wallAt,
    autoTick: false,
    testBots: { enabled: false },
  });
  t.after(() => app.close());
  const actor = arena.addPlayer(0, "actor"),
    mate = arena.addPlayer(0, "mate");
  Object.assign(actor, {
    profileId: a.profile.id,
    mass: 1000000,
    radius: radiusForMass(1000000),
    x: 2000,
    y: 2000,
    targetX: 2000,
    targetY: 2000,
  });
  Object.assign(mate, { profileId: b.profile.id, x: 8000, y: 8000, targetX: 8000, targetY: 8000 });
  profiles.applyArenaProgress(
    randomUUID(),
    [
      { type: "lifeStarted", lifeId: actor.lifeId, profileId: a.profile.id },
      { type: "lifeStarted", lifeId: mate.lifeId, profileId: b.profile.id },
    ],
    wallAt,
  );
  actor.nextMassDecayAt = Infinity;
  app.tick();
  for (tickAt = 50; tickAt <= 60000; tickAt += 50) {
    wallAt += 50;
    app.tick();
  }
  assert.ok(profiles.find(a.token).progress.session.luckyLevel);
  assert.equal(profiles.find(b.token).progress.session.luckyLevel, undefined);
  profiles.applyArenaProgress(
    randomUUID(),
    [
      {
        type: "lifeEnded",
        lifeId: actor.lifeId,
        profileId: a.profile.id,
        durationSeconds: 60,
        reason: "exit",
      },
    ],
    wallAt,
  );
  assert.equal(
    profiles.find(a.token).eventAchievements[events.active().id].values.lucky_marriage_games,
    1,
  );
  arena.players.delete(mate.id);
  const newLife = randomUUID();
  actor.lifeId = newLife;
  actor.lifeStartedAt = tickAt;
  actor.survivalMinutes = 0;
  require("../../src/server/arena/mass-accrual").reset(actor, tickAt);
  profiles.applyArenaProgress(
    randomUUID(),
    [{ type: "lifeStarted", lifeId: newLife, profileId: a.profile.id }],
    wallAt,
  );
  for (let i = 0; i < 1200; i++) {
    tickAt += 50;
    wallAt += 50;
    app.tick();
  }
  assert.equal(profiles.find(a.token).progress.session.luckyLevel, undefined);
});
