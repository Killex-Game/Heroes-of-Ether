"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs"), os = require("node:os"), path = require("node:path");
const { once } = require("node:events"), { randomUUID } = require("node:crypto");
const WebSocket = require("ws");
const { createGameServer } = require("../../src/server/game-server");
const { Arena } = require("../../src/server/arena/arena-simulation");
const { ProfileStore } = require("../../src/server/profiles/profile-store");
const { recover } = require("../../src/server/profiles/profile-journal");
async function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "heroes-lobby-writes-"));
  const filePath = path.join(dir, "profiles.json"), store = new ProfileStore({ filePath, journal: true });
  const app = createGameServer({ profiles: store, arena: new Arena({ etherCount: 0 }), autoTick: false });
  t.after(async () => { await app.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  app.httpServer.listen(0, "127.0.0.1");
  await once(app.httpServer, "listening");
  const user = store.open(), base = `http://127.0.0.1:${app.httpServer.address().port}`;
  const current = () => store.find(user.token);
  const saved = () => Object.values(recover(filePath).data.profiles).find(p => p.id === user.profile.id);
  const post = async (route, body) => {
    const response = await fetch(base + route, { method: "POST", headers: {
      Cookie: `sferorumiya_session=${user.token}`, Origin: base, "Content-Type": "application/json",
    }, body: JSON.stringify(body), signal: AbortSignal.timeout(10000) });
    return { status: response.status, body: await response.json() };
  };
  return { app, store, user, base, current, saved, post };
}
function hold(t, store) {
  let ready, release;
  const entered = new Promise(resolve => { ready = resolve; });
  const gate = new Promise(resolve => { release = resolve; });
  const original = store.journal.stage.bind(store.journal);
  const mock = t.mock.method(store.journal, "stage", async next => {
    const staged = await original(next); ready(); await gate; return staged;
  });
  return { entered, release, restore: () => mock.mock.restore() };
}
test("HTTP purchase waits for durable staging, rebases and replays without a second debit", async t => {
  const f = await fixture(t), initial = structuredClone(f.current()), gate = hold(t, f.store);
  const body = { boosterId: "candy", requestId: randomUUID() };
  try {
    let responded = false;
    const request = f.post("/api/shop/buy", body).then(r => { responded = true; return r; });
    await gate.entered;
    assert.equal(responded, false);
    assert.deepEqual(f.current().wallet, initial.wallet);
    assert.deepEqual(f.current().inventory, initial.inventory);
    f.store.transact(f.user.token, randomUUID(), "competing-save", p => { p.wallet.coins += 17; });
    const write = f.store.writeSnapshot.bind(f.store);
    const mock = t.mock.method(f.store, "writeSnapshot", (next, staged) => {
      assert.ok(staged, "the HTTP purchase must not use synchronous WAL fallback");
      return write(next, staged);
    });
    gate.release();
    const result = await request;
    mock.mock.restore();
    assert.equal(result.status, 200);
    assert.equal(f.current().inventory.candy, (initial.inventory.candy || 0) + 10);
    assert.equal(f.current().wallet.coins, initial.wallet.coins + 17 - 10);
    assert.deepEqual(f.saved().wallet, f.current().wallet);
    const after = structuredClone(f.current().wallet);
    const replay = await f.post("/api/shop/buy", body);
    assert.equal(replay.status, 200);
    assert.equal(replay.body.replay, true);
    assert.deepEqual(f.current().wallet, after);
  } finally { gate.release(); gate.restore(); }
});
for (const [route, fields] of [
  ["/api/shop/buy", { boosterId: "candy" }],
  ["/api/profile/loadout", { skinId: "forest-spirit", quickSlots: [] }],
]) test(`${route} cannot publish if the player joins the arena during the disk write`, async t => {
  const f = await fixture(t), before = structuredClone(f.current()), gate = hold(t, f.store);
  const requestId = randomUUID();
  try {
    const request = f.post(route, { ...fields, requestId });
    await gate.entered;
    const ws = new WebSocket(f.base.replace("http:", "ws:"), {
      headers: { Cookie: `sferorumiya_session=${f.user.token}` },
    });
    t.after(() => ws.terminate());
    const welcome = await new Promise((resolve, reject) => {
      ws.on("message", raw => { const m = JSON.parse(raw); if (m.type === "welcome") resolve(m); });
      ws.on("error", reject);
    });
    assert.ok(welcome.id);
    gate.release();
    const response = await request;
    assert.equal(response.status, 409);
    assert.equal(response.body.code, "ARENA_ACTIVE");
    assert.equal(f.current().receipts[requestId], undefined);
    assert.deepEqual(f.current().wallet, before.wallet);
    assert.deepEqual(f.current().inventory, before.inventory);
    assert.equal(f.current().skinId, before.skinId);
    assert.equal(f.saved().receipts[requestId], undefined);
  } finally { gate.release(); gate.restore(); }
});
test("account daily bonus is durable and cannot be collected twice by queued requests", async t => {
  const f = await fixture(t);
  f.store.activateAccount(f.user.token, { kind: "vip", requestId: randomUUID() });
  const coins = f.current().wallet.coins, gate = hold(t, f.store);
  const body = { kind: "vip", currency: "coins", requestId: randomUUID() };
  try {
    const first = f.post("/api/profile/account-bonus", body);
    await gate.entered;
    const second = f.post("/api/profile/account-bonus", { ...body, requestId: randomUUID() });
    assert.equal(f.current().wallet.coins, coins);
    gate.release();
    assert.equal((await first).status, 200);
    assert.equal((await second).status, 409);
    assert.equal(f.current().wallet.coins, coins + 50);
    assert.equal(f.saved().wallet.coins, coins + 50);
    assert.equal((await f.post("/api/profile/account-bonus", body)).body.replay, true);
  } finally { gate.release(); gate.restore(); }
});
test("a failed lobby write leaves wallet, inventory and receipt untouched and allows retry", async t => {
  const f = await fixture(t), before = structuredClone(f.current());
  const body = { boosterId: "candy", requestId: randomUUID() };
  const mock = t.mock.method(f.store.journal, "stage", async () => { throw Error("test disk failure"); });
  assert.equal((await f.post("/api/shop/buy", body)).status, 500);
  assert.deepEqual(f.current().wallet, before.wallet);
  assert.deepEqual(f.current().inventory, before.inventory);
  assert.equal(f.current().receipts[body.requestId], undefined);
  mock.mock.restore();
  assert.equal((await f.post("/api/shop/buy", body)).status, 200);
  assert.equal(f.current().inventory.candy, (before.inventory.candy || 0) + 10);
});
