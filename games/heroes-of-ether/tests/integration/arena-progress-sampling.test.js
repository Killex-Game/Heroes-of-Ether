"use strict";
const test = require("node:test"),
  assert = require("node:assert/strict");
const { createGameServer } = require("../../src/server/game-server");
const { Arena, radiusForMass } = require("../../src/server/arena/arena-simulation");
const { ProfileStore } = require("../../src/server/profiles/profile-store");

test("Progress sampling keeps changed mass immediate, lifetime exact and failed commits retryable", async (t) => {
  let time = 0;
  const epoch = Date.now();
  const profiles = new ProfileStore({ now: () => epoch + time });
  const arena = new Arena({ etherCount: 0 });
  const app = createGameServer({
    profiles,
    arena,
    autoTick: false,
    now: () => time,
    wallNow: () => epoch + time,
    testBots: { enabled: false },
  });
  t.after(() => app.close());
  const auth = profiles.open(),
    player = arena.addPlayer(time);
  player.profileId = auth.profile.id;
  profiles.startLife(player.profileId, player.lifeId);
  const events = [];
  const apply = profiles.applyArenaProgress;
  profiles.applyArenaProgress = function (id, batch, at) {
    events.push(...batch);
    return apply.call(this, id, batch, at);
  };
  for (let i = 0; i < 40; i++) {
    time += 50;
    app.tick();
  }
  assert.equal(events.filter((e) => e.type === "massPeak").length, 2);
  assert.equal(events.filter((e) => e.type === "lifeTime").length, 3);
  assert.equal(profiles.find(auth.token).activity.arenaSeconds, 2);
  assert.equal(profiles.find(auth.token).progress.maxMass, player.mass);

  const before = structuredClone(profiles.data),
    save = profiles.save;
  player.mass += 100;
  player.radius = radiusForMass(player.mass);
  profiles.save = () => {
    throw Error("simulated disk failure");
  };
  time += 50;
  app.tick();
  assert.deepEqual(profiles.data, before);
  profiles.save = save;
  app.tick();
  assert.equal(profiles.find(auth.token).progress.maxMass, player.mass);
  assert.equal(profiles.find(auth.token).activity.arenaSeconds, 2);
  const committed = structuredClone(profiles.data);
  app.tick();
  assert.deepEqual(profiles.data, committed, "a retried mass sample cannot issue a second reward");

  profiles.applyArenaProgress(
    "finish-sampling-test",
    [
      {
        type: "lifeEnded",
        profileId: player.profileId,
        lifeId: player.lifeId,
        durationSeconds: 2,
        durationMs: time,
        reason: "left",
      },
    ],
    epoch + time,
  );
  arena.resetPlayer(player, time);
  profiles.startLife(player.profileId, player.lifeId);
  events.length = 0;
  time += 50;
  app.tick();
  assert.equal(events.filter((e) => e.type === "lifeTime").length, 1);
  assert.equal(events.filter((e) => e.type === "massPeak").length, 1);
});
