"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const rules = require("../../public/shared/arena-emotes");
const { ArenaEmotes } = require("../../src/server/arena/emotes");
const { Renderer, placement } = require("../../public/arena/emote-renderer");
const accessories = require("../../public/arena/accessory-renderer");

test("emotion keys are bounded and ignore repeats, shortcuts and IME", () => {
  for (let n = 1; n <= 9; n++) {
    assert.equal(rules.key({ code: "Digit" + n, key: String(n) }), n);
    assert.equal(rules.key({ code: "Numpad" + n, key: String(n) }), n);
  }
  for (const code of ["Digit0", "Numpad0", "KeyA", "F1", "Digit10"])
    assert.equal(rules.key({ code }), null);
  for (const flag of ["repeat", "isComposing", "ctrlKey", "altKey", "metaKey", "shiftKey", "defaultPrevented"])
    assert.equal(rules.key({ code: "Digit1", [flag]: true }), null);
  assert.equal(rules.key({ code: "Numpad1", key: "End" }), null);
});

test("emotions are room-local, bounded, replaceable and never queue slow sockets", () => {
  const service = new ArenaEmotes(), room = {}, other = {}, sent = [];
  const peer = () => ({ readyState: 1, bufferedAmount: 0 });
  const a = peer(), b = peer(), c = peer(), slow = { ...peer(), bufferedAmount: 16385 };
  service.join(room, a); service.join(room, b); service.join(other, c); service.join(room, slow);
  const p = { id: "actor", profileId: "account", spawnSerial: 1, parts: [{}] };
  const source = structuredClone(p), send = (ws, packet) => sent.push([ws, JSON.parse(packet)]);
  assert(service.send(room, p, { index: 8, spawnSerial: 1, playerId: "victim" }, 0, send));
  assert.deepEqual(sent.map(r => r[0]), [a, b]);
  assert(sent.every(r => r[1].playerId === "actor" && r[1].index === 8));
  assert(!service.send(room, p, { index: 9, spawnSerial: 1 }, 1499, send));
  service.leave(room, b);
  assert(service.send(room, p, { index: 9, spawnSerial: 1 }, 1500, send));
  assert.equal(sent.length, 3); assert.equal(sent[2][0], a);
  assert.deepEqual(p, source);
});

test("dead, departed, stale and malformed requests cannot broadcast an emotion", () => {
  for (const patch of [{ dead: true }, { isRemnant: true }, { profileId: null }, { parts: [] }]) {
    const s = new ArenaEmotes();
    assert(!s.send({}, { id: "p", profileId: "a", spawnSerial: 1, parts: [{}], ...patch },
      { index: 1, spawnSerial: 1 }, 0, () => assert.fail("unexpected send")));
  }
  for (const input of [{ index: 0 }, { index: 10 }, { index: "1" }, { index: 1.2 },
    { index: 1, spawnSerial: 2 }, { index: 1, spawnSerial: "1" }]) {
    const s = new ArenaEmotes();
    assert(!s.send({}, { id: "p", profileId: "a", spawnSerial: 1, parts: [{}] },
      { spawnSerial: 1, ...input }, 0, () => assert.fail("unexpected send")));
  }
});

test("emote overlaps every hat, stays centered and scales with each body", () => {
  const hats = [null, "novice_hat", "rabbit_ears", "title_emperor_hat", "magician_hat", "sombrero_hat"];
  for (const hat of hats) for (const scale of [0.1, 0.5, 1, 2]) for (const radius of [8, 30, 150, 600]) {
    const body = { x: 140, y: 200, radius }, outfit = { hat };
    const rect = placement(outfit, body, scale);
    assert(Math.abs(rect.x + rect.width / 2 - body.x) < 1e-9);
    assert(rect.y + rect.height <= body.y - radius);
    for (const accessory of accessories.placements(outfit, { ...body, scale }))
      { assert(rect.y < accessory.y); assert(rect.y + rect.height > accessory.y); }
    assert(rect.width * scale >= 24 - 1e-9 && rect.width * scale <= 64 + 1e-9);
  }
});

test("renderer replaces one emotion per player, expires without timers and bounds texture memory", () => {
  let loaded = 0;
  const r = new Renderer(() => { loaded++; return { complete: true, naturalWidth: 128 }; });
  const ctx = { drawImage(...args) { this.calls.push(args); }, calls: [] };
  const p = { id: "p", spawnSerial: 1 }, body = { x: 50, y: 80, radius: 20 };
  r.receive({ playerId: "p", spawnSerial: 1, index: 1 }, 0);
  for (let i = 0; i < 4; i++) r.draw(ctx, p, { ...body, x: 50 + i * 60 }, 1, 20);
  assert.equal(ctx.calls.length, 4); assert.equal(loaded, 1);
  r.receive({ playerId: "p", spawnSerial: 1, index: 2 }, 100);
  assert.equal(r.active.size, 1); assert.equal(loaded, 2);
  r.draw(ctx, { ...p, spawnSerial: 2 }, body, 1, 150);
  r.draw(ctx, { ...p, departure: {} }, body, 1, 150);
  assert.equal(ctx.calls.length, 4);
  r.prune(3100); assert.equal(r.active.size, 0);
  for (let i = 0; i < 2000; i++) r.receive({ playerId: "p" + i, spawnSerial: 1, index: i % 9 + 1 }, i);
  assert.equal(r.active.size, 512); assert.equal(loaded, 9);
  r.clear(); assert.equal(r.active.size, 0);
});
