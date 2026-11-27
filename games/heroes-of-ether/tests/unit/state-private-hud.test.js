"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const wire = require("../../public/shared/arena-wire");
const { ArenaStateStream } = require("../../src/server/arena/state-stream");
const { Arena } = require("../../src/server/arena/arena-simulation");
const pets = require("../../src/server/pets/arena-pets");

function peer(id, protocol = wire.PROTOCOL) {
  const ws = { playerId: id, protocol, readyState: 1, bufferedAmount: 0 };
  const packets = [], raw = [], decoder = new wire.Decoder();
  const stream = new ArenaStateStream(ws, (_, bytes) => {
    raw.push(JSON.parse(bytes)); packets.push(decoder.decode(raw.at(-1)));
  }, () => 0);
  return { ws, stream, packets, raw };
}
function player(i, tick) {
  return { id: "p" + i, x: 100 + i, y: 100, mass: 1000, radius: 30,
    name: "Игрок " + i, mainPartId: "c" + i, spawnSerial: 1,
    account: { vip: tick < 3, premium: tick % 2 === 1, vipUntil: 3000,
      premiumUntil: 4000, multiplier: 3, currencyBonusResetAt: 86400000,
      currencyBonuses: { coins: { vip: tick, premium: tick + 1 } } },
    parts: [{ id: "c" + i, x: 100 + i + tick, y: 100, mass: 1000, radius: 30 }],
    lifeSeconds: tick, lifeElapsedMs: tick * 1000, canFeed: true, canSplit: true,
    boosterUses: { meat: i + tick }, boosterLimit: 20, boosterCooldownMs: 40,
    boosterCooldowns: { fire: 1000 - tick }, shieldCooldowns: { golden_shield: 500 },
    massLimit: 30000, forcedMovement: tick % 2 === 0, mergeMs: 1000,
    accessoryAbilities: [{ source: "hat", id: "easter_egg", count: 3 - tick % 3 }],
    pet: { id: "manya", level: 5, active: true, vitality: 99 - tick,
      stock: { fire: i + 10 }, cooldowns: { fire: tick * 10 }, sequence: tick },
    turbo: { active: true, remainingMs: 9000 - tick, sequence: i, totalMs: 180000 },
    shieldMs: 5000 - tick,
    effects: [{ id: "sphere", remainingMs: 5000 - tick }],
    instantEffects: [{ id: "meat", remainingMs: 1000 - tick }],
  };
}
const snapshot = (tick, players) => ({ type: "state", tick, world: { width: 5000, height: 4000 },
  players, ether: [], projectiles: [], hazards: [], events: [], audioEvents: [], visualEvents: [] });

test("building private HUDs only for connected owners preserves decoded snapshots and deltas", () => {
  const arena = new Arena({ etherCount: 0 });
  const players = ["first", "second", "bot"].map(id => arena.addPlayer(0, id));
  const owners = new Set(["first", "second"]);
  for (const p of players) {
    p.x = p.y = 500;
    p.level = 16;
    p.giftModifiers = { visual: "curse" };
    pets.start(p, { level: 16, pets: { equipped: "manya", owned: {
      manya: { games: 120, vitalityMs: 30000, refillAt: 3600000 },
    } } }, 0, 0);
  }
  const protocols = [wire.HUD_PROTOCOL, wire.PRIVATE_STATE_PROTOCOL, wire.PROTOCOL,
    wire.SCHEMA_PROTOCOL, wire.PLAYER_SCHEMA_PROTOCOL];
  const peers = protocols.flatMap(protocol => [...owners].map(id => [peer(id, protocol), peer(id, protocol)]));
  for (let tick = 1; tick <= 3; tick++) {
    arena.tick = tick;
    for (const p of players) {
      p.boosterUses.meat = tick;
      p.pet.stock.fire += tick;
      p.shieldReadyAt.golden_shield = 10000;
      p.x += tick;
    }
    const full = arena.snapshot(tick * 100);
    const limited = arena.snapshot(tick * 100, [], true, owners);
    const bot = limited.players.find(p => p.id === "bot");
    assert.equal(bot.boosterUses, undefined);
    assert.deepEqual(bot.pet, { id: "manya", level: 1, active: true });
    assert.equal(full.players.find(p => p.id === "bot").boosterUses.meat, tick);
    for (const [reference, current] of peers) {
      reference.stream.acknowledge(reference.stream.sequence);
      current.stream.acknowledge(current.stream.sequence);
      reference.stream.publish(full);
      current.stream.publish(limited);
      assert.deepEqual(current.packets.at(-1), reference.packets.at(-1));
    }
  }
});

test("35 recipients retain their exact HUD while sharing only opponents' rendering fields", () => {
  const clients = Array.from({ length: 35 }, (_, i) => peer("p" + i));
  const legacy = peer("p0", wire.MOTION_PROTOCOL);
  let preserved, original;
  for (let tick = 1; tick <= 5; tick++) {
    const state = snapshot(tick, clients.map((_, i) => player(i, tick)));
    for (const c of [...clients, legacy]) {
      c.stream.viewport = { x: 200, y: 100, width: 800, height: 600 };
      c.stream.acknowledge(c.stream.sequence);
      c.stream.publish(state);
    }
    const full = legacy.packets.at(-1).players;
    for (const [i, c] of clients.entries()) {
      const decoded = c.packets.at(-1).players;
      assert.deepEqual(decoded[i], full[i]);
      assert.equal(c.raw.at(-1).selfDelta.id, "p" + i);
      for (const [j, p] of decoded.entries()) if (i !== j) {
        assert.equal(p.boosterUses, undefined);
        assert.equal(p.lifeElapsedMs, undefined);
        assert.equal(p.accessoryAbilities, undefined);
        assert.deepEqual(p.account, { vip: full[j].account.vip, premium: full[j].account.premium });
        assert.equal(p.pet.stock, undefined);
        assert.deepEqual(p.pet, { id: "manya", level: 5, active: true });
        for (const key of ["parts", "mass", "radius", "effects", "instantEffects", "shieldMs"])
          assert.deepEqual(p[key], full[j][key]);
        assert.equal(p.turbo.active, full[j].turbo.active);
        assert.equal(p.turbo.remainingMs, full[j].turbo.remainingMs);
      }
    }
    if (tick === 1) { original = clients[0].packets[0]; preserved = structuredClone(original); }
  }
  assert.deepEqual(original, preserved);
});

test("HUD survives skipped frames, clears removals and starts fresh after a player ID changes", () => {
  const c = peer("p0"), legacy = peer("p0", wire.MOTION_PROTOCOL);
  const publish = (tick, players) => {
    const frame = snapshot(tick, players);
    for (const p of [c, legacy]) { p.stream.acknowledge(p.stream.sequence); p.stream.publish(frame); }
  };
  publish(1, [player(0, 1), player(1, 1)]);
  c.ws.bufferedAmount = 100000;
  publish(2, [player(0, 2), player(1, 2)]);
  const updated = player(0, 3);
  updated.pet = null; updated.boosterUses = {}; delete updated.accessoryAbilities;
  updated.account = null;
  publish(3, [updated, player(1, 3)]);
  c.ws.bufferedAmount = 0; c.stream.flush();
  assert.deepEqual(c.packets.at(-1).players[0], legacy.packets.at(-1).players[0]);
  publish(4, [player(1, 4)]);
  assert.equal(c.raw.at(-1).selfDelta, null);
  c.ws.playerId = "p1";
  publish(5, [player(1, 5)]);
  assert.deepEqual(c.packets.at(-1).players[0], legacy.packets.at(-1).players[0]);
});
