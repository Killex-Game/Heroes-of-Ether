"use strict";
const test = require("node:test"),
  assert = require("node:assert/strict");
const fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path");
const { once } = require("node:events"),
  { randomUUID } = require("node:crypto");
const WebSocket = require("ws");
const { createGameServer } = require("../../src/server/game-server");
const { Arena, radiusForMass } = require("../../src/server/arena/arena-simulation");
const { ProfileStore } = require("../../src/server/profiles/profile-store");
const { recover } = require("../../src/server/profiles/profile-journal");
function deferred() {
  let resolve;
  return {
    promise: new Promise((r) => {
      resolve = r;
    }),
    resolve,
  };
}
async function fixture(t, boosterId) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "heroes-moving-cast-"));
  const file = path.join(dir, "profiles.json");
  const store = new ProfileStore({ filePath: file, journal: true });
  const arena = new Arena({ etherCount: 0 });
  const app = createGameServer({
    profiles: store,
    arena,
    autoTick: false,
    now: () => 5000,
    testBots: { enabled: false },
  });
  t.after(async () => {
    await app.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });
  app.httpServer.listen(0, "127.0.0.1");
  await once(app.httpServer, "listening");
  const user = store.open();
  store.transact(user.token, randomUUID(), "synthetic-test-inventory", (p) => {
    p.level = 25;
    p.progress = require("../../src/server/progression/experience-progression").freshProgress(25);
    p.inventory[boosterId] = 3;
    p.quickSlots = [boosterId];
  });
  const ws = new WebSocket(`ws://127.0.0.1:${app.httpServer.address().port}`, {
    headers: { Cookie: `sferorumiya_session=${user.token}` },
  });
  const messages = [];
  ws.on("message", (raw) => messages.push(JSON.parse(raw)));
  const wait = async (type, from = 0) => {
    const signal = AbortSignal.timeout(5000);
    for (;;) {
      const found = messages.slice(from).find((x) => x.type === type);
      if (found) return found;
      await once(ws, "message", { signal });
    }
  };
  const welcome = await wait("welcome"),
    p = arena.players.get(welcome.id);
  function mass(value) {
    p.mass = value;
    p.radius = radiusForMass(value);
  }
  mass(1000);
  p.protectedUntil = 0;
  const gate = deferred(),
    entered = deferred();
  let attempts = 0;
  const stage = store.journal.stage.bind(store.journal);
  t.mock.method(store.journal, "stage", async (next) => {
    const entry = await stage(next);
    if (++attempts === 1) {
      entered.resolve();
      await gate.promise;
    }
    return entry;
  });
  t.after(() => gate.resolve());
  const command = {
    type: "useBooster",
    requestId: randomUUID(),
    boosterId,
    spawnSerial: p.spawnSerial,
    aimX: p.x + 100,
    aimY: p.y,
  };
  ws.send(JSON.stringify(command));
  await entered.promise;
  return {
    app,
    store,
    p,
    user,
    ws,
    wait,
    messages,
    command,
    file,
    mass,
    attempts: () => attempts,
    release: gate.resolve,
  };
}

for (const value of [900, 1100])
  test(`projectile remains valid when observed mass changes to ${value} during fsync`, async (t) => {
    const f = await fixture(t, "rocket");
    assert.equal(f.p.boostersUsed, 0);
    assert.equal(f.store.byId(f.user.profile.id).inventory.rocket, 3);
    f.mass(value);
    f.release();
    assert.equal((await f.wait("boosterResult")).ok, true);
    assert.equal(f.attempts(), 1, "ordinary mass movement must not restage the whole batch");
    assert.equal(f.p.boosterUses.rocket, 1);
    assert.equal(f.app.arena.combat.shots.length, 1);
    assert.equal(
      f.store.byId(f.user.profile.id).progress.maxMass,
      1000,
      "the transaction records a real, already observed mass",
    );
    const from = f.messages.length;
    f.ws.send(JSON.stringify(f.command));
    assert.equal((await f.wait("boosterResult", from)).replay, true);
    assert.equal(f.p.boosterUses.rocket, 1);
    await f.app.close();
    const saved = Object.values(recover(f.file).data.profiles).find(
      (p) => p.id === f.user.profile.id,
    );
    assert.equal(saved.inventory.rocket, 2);
    assert.ok(saved.progress.maxMass >= Math.max(1000, value));
  });

test("instant mass still restages when feeding changes the predicted gain", async (t) => {
  const f = await fixture(t, "meat");
  f.mass(900);
  f.release();
  assert.equal((await f.wait("boosterResult")).ok, true);
  assert.equal(f.attempts(), 2);
  assert.equal(f.p.mass, 1600);
  assert.equal(f.store.byId(f.user.profile.id).progress.maxMass, 1600);
  assert.equal(f.store.byId(f.user.profile.id).inventory.meat, 2);
  assert.equal(f.p.boosterUses.meat, 1);
});

test("expired life still cancels a projectile before spending its stock", async (t) => {
  const f = await fixture(t, "rocket");
  f.p.dead = true;
  f.release();
  assert.equal((await f.wait("boosterResult")).ok, false);
  assert.equal(f.p.boostersUsed, 0);
  assert.equal(f.store.byId(f.user.profile.id).inventory.rocket, 3);
  assert.equal(f.app.arena.combat.shots.length, 0);
});
