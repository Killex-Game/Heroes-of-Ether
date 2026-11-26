/* Deterministic offline replay. Run in a dedicated Node process from the game root. */
"use strict";
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
let serial = 0, seed = 0;
const random = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296;
crypto.randomUUID = () => "00000000-0000-4000-8000-" + (++serial).toString(16).padStart(12, "0");
Math.random = random;
const { Arena, radiusForMass } = require("../../src/server/arena/arena-simulation");
const { ArenaHazards } = require("../../src/server/arena/arena-hazards");
const { BOOSTERS, BoosterError } = require("../../src/server/boosters/booster-catalog");
const pets = require("../../src/server/pets/arena-pets");
const petRules = require("../../public/shared/pet-rules");
const catalog = [...BOOSTERS.values()].filter(b => b.ready).map(b => b.id);
const specials = ["pet_fire", "pet_claw", "pet_glove", "pet_carrot"];

function equipPet(p, kind, now) {
  const id = kind === "pet_carrot" ? "zaya" : kind === "pet_glove" ? "drakosha" : "manya";
  const stats = petRules.stats(id, 5000);
  p.pet = { id, stats, vitalityMs: stats.capacityMs, lastAt: now, activeMs: 0, premiumMs: 0,
    accessoryPetMs: 0, nextGiftMs: stats.intervalMs, nextPremiumMs: 30000,
    stock: { ...stats.start, carrot: id === "zaya" ? 1 : 0 }, readyAt: {}, receipts: new Map(), sequence: 0 };
}

function replay(id, count, partCount, opponent, kindOffset = 0) {
  serial = 0; seed = 439;
  const arena = new Arena({ random, backgroundRandom: random, etherCount: 200 });
  arena.hazards = new ArenaHazards(arena);
  const now = 20000, players = [], kinds = [...catalog, ...specials];
  const mixed = id === "mixed";
  const kindOf = i => mixed ? kinds[(i + kindOffset) % kinds.length] : (i === 1 && opponent) || id;
  const populate = (p, i, time) => {
    const x = 420 + i % 7 * (opponent ? 230 : 340), y = 500 + Math.floor(i / 7) * 330;
    Object.assign(p, { level: 600, protectedUntil: 0, nextMassDecayAt: Infinity,
      x, y, targetX: x + 10, targetY: y, mass: 4000, radius: radiusForMass(4000) });
    if (partCount > 1 || kindOf(i) === "sponge") {
      const n = Math.max(2, partCount);
      p.parts = Array.from({length:n}, (_, j) => {
        const mass = 350 + (i % 4) * 40 + j;
        return { id: p.id + "-" + j, mass, radius: radiusForMass(mass),
          x: x + (j % 4) * 42, y: y + Math.floor(j / 4) * 42,
          vx: 0, vy: 0, mergeAt: time + 30000 };
      });
      p.mainPartId = p.parts[0].id;
      arena.syncParts(p);
    }
    if (specials.includes(kindOf(i))) equipPet(p, kindOf(i), time);
  };
  for (let i = 0; i < count; i++) {
    const p = arena.addPlayer(now, "player-" + i);
    populate(p, i, now);
    players.push(p);
  }
  const samples = [], ok = {}, rejected = {}, hash = crypto.createHash("sha256");
  let contacts = 0;
  const attempts = new Uint16Array(count);
  const ticks = mixed ? 160 : 60;
  for (let tick = 0; tick < ticks; tick++) {
    const time = now + tick * 50;
    const start = performance.now();
    for (let i = 0; i < count; i++) {
      const p = players[i], target = players[(i + 1) % count];
      if (p.dead) {
        arena.resetPlayer(p, time);
        populate(p, i, time);
      }
      const kind = kindOf(i);
      const input = { spawnSerial:p.spawnSerial, sequence:tick + 1, x:target.x, y:target.y };
      arena.handleInput(p.id, { ...input, type:"move" }, time);
      if (partCount > 1 && tick % 8 === 1) arena.handleInput(p.id, { ...input, type:"feed" }, time);
      if (mixed && tick % 5 === 2) arena.handleInput(p.id, { ...input, type:"split" }, time);
      const heldFood = BOOSTERS.get(kind)?.kind === "mass";
      if (tick % (heldFood ? 2 : 24) !== 0) continue;
      attempts[i]++;
      const action = { ...input, aimX:target.x, aimY:target.y, boosterId:kind,
        targetId:target.id, targetSpawnSerial:target.spawnSerial, requestId:"request-" + i + "-" + tick };
      try {
        if (specials.includes(kind)) {
          action.ability = kind === "pet_fire" ? "fire" : kind === "pet_carrot" ? "sixth" : "secondary";
          const result = pets.use(arena, p, action, time);
          assert.equal("pet_" + result.kind, kind);
        } else arena.prepareBooster(p.id, action, time)();
        ok[kind] = (ok[kind] || 0) + 1;
      } catch (error) {
        if (!(error instanceof BoosterError)) throw error;
        rejected[error.message] = (rejected[error.message] || 0) + 1;
      }
    }
    const events = arena.step(time);
    samples.push(performance.now() - start);
    contacts += arena.combat.contacts.length;
    hash.update(JSON.stringify(events));
    if (tick % 10 === 0 || tick === ticks - 1) hash.update(JSON.stringify(arena.snapshot(time, events)));
  }
  if (opponent) {
    // A shield or a lock applied first may legitimately deny the second action.
    assert.ok(attempts.every(n => n > 0));
    for (const p of players) {
      if (p.dead) continue;
      const parts = arena.bodies(p);
      assert.ok(parts.length > 0 && parts.length <= 16);
      assert.ok(parts.every(b => Number.isFinite(b.x) && Number.isFinite(b.y) && Number.isFinite(b.mass) && b.mass > 0));
    }
  } else {
    const expected = mixed ? players.map((_, i) => kindOf(i)) : [id];
    assert.deepEqual(expected.filter(kind => !ok[kind]), [], JSON.stringify({ id, rejected }));
  }
  samples.sort((a,b) => a-b);
  console.log(JSON.stringify({id,opponent,players:count,initialParts:id === "sponge" ? Math.max(2,partCount) : partCount,
    ticks,ok,rejected,contacts,p50:samples[ticks >> 1],p95:samples[Math.floor(ticks * .95)],max:samples.at(-1),hash:hash.digest("hex")}));
}
const selected = process.argv[2];
if (selected && ![...catalog, ...specials, "mixed", "pairs"].includes(selected))
  throw Error("Unknown booster replay: " + selected);
for (const [players, parts] of [[2,1],[35,1],[35,16]]) {
  for (const id of [...catalog, ...specials]) if (!selected || selected === id) replay(id, players, parts);
}
if (!selected || selected === "mixed") {
  for (let offset = 0; offset < catalog.length + specials.length; offset += 30)
    replay("mixed", 30, 16, undefined, offset);
}
if (selected === "pairs") {
  const actions = [...catalog, ...specials];
  for (const first of actions) for (const second of actions) replay(first, 2, 2, second);
}

