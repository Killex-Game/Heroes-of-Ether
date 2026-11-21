"use strict";
const test = require("node:test"),
  assert = require("node:assert/strict");
const {
  Player,
  LobbyMusic,
  ArenaEvents,
  followRoulette,
} = require("../../public/arena/game-audio");
const { Arena, radiusForMass } = require("../../src/server/arena/arena-simulation");
const { BOOSTERS } = require("../../src/server/boosters/booster-catalog");
const part = (id, mergeVersion = 0) => ({ id, mergeVersion, x: 500, y: 500, radius: 30 });
function state(parts, audioEvents = [], spawnSerial = 1) {
  return { players: [{ id: "me", spawnSerial, parts }], audioEvents };
}
test("Own merge sounds once; loss, spawn, repeated snapshot and other players stay silent", () => {
  const heard = [],
    events = new ArenaEvents((id) => heard.push(id));
  events.state(state([part("a"), part("b")]), "me");
  events.state(state([part("a")]), "me"); // eaten part
  events.state(state([part("a", 1)]), "me");
  events.state(state([part("a", 1)]), "me");
  events.state(state([part("a", 4)], [], 2), "me");
  events.state({ players: [{ id: "other", parts: [part("a", 5)] }] }, "me");
  assert.deepEqual(heard, ["merge"]);
});
test("Defeat deduplicates life results and ignores voluntary departure", () => {
  const heard = [],
    events = new ArenaEvents((id) => heard.push(id));
  for (const result of [
    { id: "a", reason: "left" },
    { id: "b", reason: "absorbed" },
    { id: "b", reason: "absorbed" },
    { id: "c", reason: "burned" },
  ])
    events.lifeEnded(result);
  assert.deepEqual(heard, ["defeat", "defeat"]);
});
test("Mine sounds require a new confirmed nearby impact, first-state explosions are ignored", () => {
  const heard = [],
    events = new ArenaEvents((...args) => heard.push(args));
  const mine = { id: "1", type: "mine", x: 500, y: 500, targetId: "me" };
  events.state(state([part("a")], [mine]), "me");
  events.state(state([part("a")], [mine]), "me");
  events.state(state([part("a")], [{ ...mine, id: "2" }]), "me");
  events.state(state([part("a")], [{ ...mine, id: "2" }]), "me");
  events.state(state([part("a")], [{ ...mine, id: "3", x: 3000, targetId: "other" }]), "me");
  events.state(state([part("a")], [{ ...mine, id: "4", x: 900, targetId: "other" }]), "me");
  assert.equal(heard.length, 2);
  assert.equal(heard[0][1], 1);
  assert.ok(heard[1][1] < 1);
  for (let i = 5; i < 600; i++)
    events.state(
      state([part("a")], [{ ...mine, id: String(i), x: 3000, targetId: "other" }]),
      "me",
    );
  assert.equal(events.seen.size, 256);
});
test("Sound preferences, hidden tabs, burst limits and blocked playback are safe", async () => {
  const document = { hidden: false, addEventListener() {}, removeEventListener() {} };
  const instances = [];
  let time = 100;
  class Audio {
    constructor(src) {
      this.src = src;
      this.paused = true;
      instances.push(this);
    }
    addEventListener() {}
    play() {
      this.paused = false;
      return Promise.resolve();
    }
    pause() {
      this.paused = true;
    }
    removeAttribute() {}
    load() {}
  }
  const player = new Player({ document, Audio, now: () => time });
  assert.equal(player.play("merge"), false);
  player.unlock();
  await Promise.resolve();
  assert.equal(player.play("merge"), true);
  assert.equal(player.play("merge"), false);
  player.setEnabled(false);
  assert.ok(instances.every((a) => a.paused));
  time += 1000;
  assert.equal(player.play("mine"), false);
  player.setEnabled(true);
  document.hidden = true;
  assert.equal(player.play("mine"), false);
  document.hidden = false;
  assert.equal(player.play("mine"), true);
  player.stop();
  await Promise.resolve();
  assert.ok(instances.every((a) => a.paused));
  time += 1000;
  for (const a of instances) a.play = () => Promise.reject(Error("NotAllowedError"));
  player.play("defeat");
  await Promise.resolve();
  await Promise.resolve();
  player.destroy();
});
test("Lobby music: gesture, late playback, pause settings and WebKit loop recovery", async () => {
  const document = { hidden: false, addEventListener() {}, removeEventListener() {} };
  let resolvePlay;
  class Audio {
    constructor() {
      this.paused = true;
      this.currentTime = 0;
    }
    addEventListener() {}
    removeEventListener() {}
    play() {
      this.paused = false;
      return new Promise((resolve) => {
        resolvePlay = resolve;
      });
    }
    pause() {
      this.paused = true;
    }
    removeAttribute() {}
    load() {}
  }
  const music = new LobbyMusic({ document, Audio });
  music.setActive(true);
  assert.equal(music.audio.paused, true);
  music.onGesture({ isTrusted: true });
  assert.equal(music.audio.paused, false);
  music.setActive(false);
  resolvePlay();
  await Promise.resolve();
  assert.equal(music.audio.paused, true, "поздний play не возобновляет музыку на арене");
  music.setActive(true);
  resolvePlay();
  await Promise.resolve();
  music.audio.pause();
  music.onLoopSeek();
  assert.equal(music.audio.paused, false, "внутренняя перемотка возобновляет повтор");
  resolvePlay();
  await Promise.resolve();
  music.setEnabled(false);
  music.onLoopSeek();
  assert.equal(music.audio.paused, true);
  document.hidden = true;
  music.setEnabled(true);
  assert.equal(music.audio.paused, true);
  music.destroy();
});

test("Volume scales the existing mix, changes active audio and zero stops all playback", async () => {
  const document = { hidden: false, addEventListener() {}, removeEventListener() {} };
  class Audio {
    constructor() { this.paused = true; }
    addEventListener() {} removeEventListener() {} removeAttribute() {} load() {}
    play() { this.paused = false; return Promise.resolve(); }
    pause() { this.paused = true; }
  }
  let now = 1000;
  const player = new Player({ document, Audio, volume: .5, now: () => now });
  player.unlock(); await Promise.resolve();
  assert.equal(player.play("mine", .5), true);
  const voice = player.voices.get("mine")[0];
  assert.equal(voice.audio.volume, .15);
  player.setVolume(.25);
  assert.equal(voice.audio.volume, .075, "currently playing effect updates immediately");
  player.setVolume(0);
  assert.ok([...player.voices.values()].flat().every(v => v.audio.paused));
  now += 1000;
  assert.equal(player.play("merge"), false);
  player.setVolume(3);
  assert.equal(player.play("merge"), true);
  assert.equal(player.voices.get("merge")[0].audio.volume, .48);
  const music = new LobbyMusic({ document, Audio, volume: .25 });
  music.setActive(true); music.onGesture({ isTrusted: true });
  assert.equal(music.audio.volume, .08);
  music.setVolume(0); await Promise.resolve();
  assert.equal(music.audio.paused, true, "late play cannot escape zero volume");
  music.setVolume(.5);
  assert.equal(music.audio.paused, false);
  assert.equal(music.audio.volume, .16);
  music.setActive(false); music.setVolume(1);
  assert.equal(music.audio.paused, true, "volume does not start lobby music in arena");
  player.destroy(); music.destroy();
});

test("Impacts emit mine explosions or shield blocks at the boundary, never on expiry", () => {
  for (const grounded of [false, true])
    for (const shield of [null, "spawn", "colorful_shield", "clan_shield"]) {
      const arena = new Arena({ etherCount: 0 });
      const owner = arena.addPlayer(0, "owner"),
        target = arena.addPlayer(0, "target");
      Object.assign(owner, {
        x: 360,
        y: 500,
        targetX: 360,
        targetY: 500,
        protectedUntil: 0,
        stopped: true,
      });
      Object.assign(target, {
        x: 500,
        y: 500,
        targetX: 500,
        targetY: 500,
        mass: 80,
        radius: radiusForMass(80),
        protectedUntil: shield === "spawn" ? 9000 : 0,
        stopped: true,
      });
      if (shield && shield !== "spawn") target.effects[shield] = 9000;
      // Stationary throw is opposite aim: the confirmed mine still travels toward the target.
      arena.combat.prepare(owner, BOOSTERS.get("mine"), { aimX: 220, aimY: 500 }, 3000)();
      const shot = arena.combat.shots[0];
      if (grounded)
        Object.assign(shot, {
          landed: true,
          landsAt: 3000,
          x: target.x - target.radius - 5,
          y: 500,
          speed: 0,
        });
      arena.step(4000);
      assert.equal(arena.audioEvents.length, 1, `${grounded}/${shield}`);
      assert.equal(arena.audioEvents[0].type, shield ? "shield" : "mine");
      if (!shield) {
        const event = arena.snapshot(4000).audioEvents[0];
        assert.equal(event.id, shot.id);
        assert.equal(event.targetId, target.id);
        assert.ok(event.x < 500);
        assert.equal(arena.snapshot(4000).events.length, 0);
      }
      arena.combat.shots = [];
      arena.step(4050);
      assert.deepEqual(arena.snapshot(4050).audioEvents, []);
    }
});

test("Shield audio uses confirmed events, ignores replay and the initial snapshot", () => {
  const heard = [],
    events = new ArenaEvents((...a) => heard.push(a));
  const hit = { id: "shield:one", type: "shield", x: 500, y: 500, targetId: "me" };
  events.state(state([part("a")], [hit]), "me");
  events.state(state([part("a")], [hit]), "me");
  events.state(state([part("a")], [{ ...hit, id: "shield:two" }]), "me");
  events.state(state([part("a")], [{ ...hit, id: "shield:two" }]), "me");
  events.state(
    state([part("a")], [{ ...hit, id: "shield:far", x: 4000, targetId: "other" }]),
    "me",
  );
  assert.deepEqual(heard, [["shield", 1]]);
});

test("Shield audio is private even when another shield is touching the listener", () => {
  const heard = [], events = new ArenaEvents((...args) => heard.push(args));
  events.state(state([part("a")]), "me");
  for (const targetId of ["other", undefined, null, ""]) {
    events.state(state([part("a")], [{id: "hit:" + targetId, type: "shield", x: 500, y: 500, targetId}]), "me");
  }
  assert.deepEqual(heard, []);
  const own = {id: "own", type: "shield", x: 500, y: 500, targetId: "me"};
  events.state(state([part("a")], [own]), "me");
  events.state(state([part("a")], [own]), "me");
  assert.deepEqual(heard, [["shield", 1]]);
});

test("Shield sound does not change special Fire, Awl or Cake behaviour", () => {
  for (const id of ["fire", "awl", "cake", "rocket"]) {
    const a = new Arena({ etherCount: 0 }),
      owner = a.addPlayer(0, "owner"),
      target = a.addPlayer(0, "target");
    Object.assign(target, {
      mass: 200,
      radius: radiusForMass(200),
      protectedUntil: 0,
      effects: { colorful_shield: 9000 },
    });
    a.combat.impact(
      {
        id: "shot",
        boosterId: id,
        ownerId: owner.id,
        ownerLife: owner.lifeId,
        x: target.x,
        y: target.y,
      },
      target,
      3000,
    );
    assert.equal(
      a.audioEvents.filter((e) => e.type === "shield").length,
      id === "rocket" ? 1 : 0,
      id,
    );
    if (id === "fire") assert.equal(target.mass, 100);
    if (id === "awl") assert.equal(a.hasEffect(target, "shield", 3000), false);
    if (id === "rocket") assert.equal(target.mass, 200);
  }
});

test("Roulette sound follows eased sectors; hidden tabs, completed animation and cancellation stay silent", () => {
  let next,
    progress = 0,
    cancelled,
    played = 0;
  const document = { hidden: false };
  const animation = { playState: "running", effect: { getComputedTiming: () => ({ progress }) } };
  const stop = followRoulette(animation, 1800, 12, () => played++, {
    document,
    request: (cb) => ((next = cb), 42),
    cancel: (id) => (cancelled = id),
  });
  next();
  assert.equal(played, 0);
  progress = 0.005;
  next();
  assert.equal(played, 0);
  progress = 0.03;
  next();
  assert.equal(played, 1);
  progress = 0.2;
  next();
  assert.equal(played, 2, "one click instead of a backlog");
  document.hidden = true;
  progress = 0.5;
  next();
  assert.equal(played, 2);
  document.hidden = false;
  next();
  assert.equal(played, 2, "no old ticks on tab return");
  animation.playState = "finished";
  progress = 1;
  next();
  assert.equal(played, 2);
  stop();
  assert.equal(cancelled, 42);
  next();
  assert.equal(played, 2);
});

test('Fast roulette accelerates existing audio voices and stopTrack cancels late playback', async () => {
  const document={hidden:false,addEventListener(){},removeEventListener(){}};
  const voices=[];let resolve;
  class Audio {constructor(src){this.src=src;this.paused=true;voices.push(this);}addEventListener(){}pause(){this.paused=true;}play(){this.paused=false;return new Promise(done=>resolve=done);}removeAttribute(){}load(){}}
  const player=new Player({document,Audio,now:()=>1000});player.unlock();player.stop();
  assert.equal(player.play('roulette',.75,2.8),true);
  const voice=voices.find(a=>!a.paused);assert.equal(voice.playbackRate,2.8);assert.equal(voice.preservesPitch,false);
  player.stopTrack('roulette');resolve();await Promise.resolve();assert.ok(voices.every(a=>a.paused));
  player.setEnabled(false);assert.equal(player.play('roulette',1,2.8),false);player.destroy();
});
