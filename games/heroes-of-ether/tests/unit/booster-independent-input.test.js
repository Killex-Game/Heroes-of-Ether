"use strict";
const test = require("node:test"),
  assert = require("node:assert/strict"),
  vm = require("node:vm"),
  fs = require("node:fs"),
  path = require("node:path"),
  crypto = require("node:crypto");
function fixture() {
  let time = 0,
    id = 0;
  const timers = new Map(),
    sent = [],
    window = { KillexRequestIds: { create: () => crypto.randomUUID() } },
    document = { hidden: false, activeElement: null };
  const context = {
    window,
    document,
    crypto,
    performance: { now: () => time },
    setTimeout: (fn, ms) => {
      timers.set(++id, { fn, ms });
      return id;
    },
    clearTimeout: (id) => timers.delete(id),
    setInterval: (fn, ms) => {
      timers.set(++id, { fn, ms });
      return id;
    },
    clearInterval: (id) => timers.delete(id),
    cancelAnimationFrame: () => {},
  };
  vm.runInNewContext(
    fs.readFileSync(
      path.join(__dirname, "../../public/ui/boosters/shop-and-inventory-dialog.js"),
      "utf8",
    ),
    context,
  );
  const ui = Object.create(window.KillexBoosterUI.prototype),
    me = {
      spawnSerial: 1,
      level: 50,
      mass: 100,
      massLimit: 50000,
      boosterLimit: 10,
      boosterUses: {},
    };
  const items = {
    clan_shield: { id: "clan_shield", kind: "shield", target: "self", name: "Клановый щит" },
    easter_egg: {
      id: "easter_egg",
      kind: "easter_growth",
      target: "self",
      name: "Пасхальное яйцо",
    },
    meat: { id: "meat", kind: "mass", target: "self", name: "Мясо" },
  };
  Object.assign(ui, {
    activations: new Map(),
    slots: ["clan_shield", "easter_egg", "meat"],
    profile: { inventory: { clan_shield: 10, easter_egg: 10, meat: 10 } },
    game: {
      getMe: () => me,
      isArena: () => true,
      inputBlocked: () => false,
      send: (m) => {
        sent.push(m);
        return true;
      },
    },
    dialog: { open: false },
    catalog: { rules: { massRepeatMs: 100 } },
    item: (id) => items[id],
    slotAvailable: () => true,
    slotBlocked: () => false,
    showArenaMessage: () => {},
    updateQuick: () => {},
    updateProfile: () => {},
    cancelTarget: () => {},
    load: () => {},
  });
  window.KillexLoadout = { keyIndex: (code) => ["KeyA", "KeyS", "KeyD"].indexOf(code) };
  return {
    ui,
    me,
    items,
    sent,
    timers,
    advance: (n) => {
      time += n;
    },
    interval: () => [...timers.values()].find((t) => t.ms === 25)?.fn(),
  };
}
test("Разные бустеры отправляются без ожидания ACK, повтор одного не дублирует списание", () => {
  const f = fixture();
  f.ui.useSlot(0);
  f.ui.useSlot(1);
  f.ui.useSlot(0);
  assert.deepEqual(
    f.sent.map((m) => m.boosterId),
    ["clan_shield", "easter_egg"],
  );
  assert.equal(f.ui.activations.size, 2);
  const second = f.sent[1];
  f.ui.receive({ type: "boosterResult", requestId: second.requestId, ok: true });
  assert.equal(f.ui.activations.size, 1);
  assert.ok(f.ui.activations.has("clan_shield"));
  f.ui.receive({ type: "boosterResult", requestId: second.requestId, ok: true });
  assert.equal(f.ui.activations.size, 1);
  const retry = [...f.timers.values()].find((t) => t.ms === 3000);
  retry.fn();
  assert.equal(f.sent.at(-1).requestId, f.sent[0].requestId);
});
test("Удержание Мяса повторяет только после ACK, не копит очередь и останавливается при отпускании/исчерпании", () => {
  const f = fixture();
  f.ui.handleKey({ code: "KeyD", repeat: false });
  assert.equal(f.sent.length, 1);
  f.advance(200);
  f.interval();
  assert.equal(f.sent.length, 1);
  f.ui.receive({ type: "boosterResult", requestId: f.sent[0].requestId, ok: true });
  f.interval();
  assert.equal(f.sent.length, 2);
  f.ui.handleKeyUp({ code: "KeyD" });
  f.advance(500);
  f.interval();
  assert.equal(f.sent.length, 2);
  assert.equal(f.ui.massRepeatTimer, null);
  f.ui.receive({ type: "boosterResult", requestId: f.sent[1].requestId, ok: true });
  f.ui.handleKey({ code: "KeyD", repeat: false });
  f.ui.profile.inventory.meat = 0;
  f.advance(200);
  f.interval();
  assert.equal(f.ui.massRepeatTimer, null);
});

test("After a slow save the held Meat key waits for the actual remaining server cooldown", () => {
  const f = fixture();
  f.ui.handleKey({ code: "KeyD", repeat: false });
  f.advance(250);
  f.ui.receive({
    type: "boosterResult",
    requestId: f.sent[0].requestId,
    ok: true,
    repeatAfterMs: 80,
  });
  f.advance(79);
  f.interval();
  assert.equal(f.sent.length, 1);
  f.advance(1);
  f.interval();
  assert.equal(f.sent.length, 2);
});
