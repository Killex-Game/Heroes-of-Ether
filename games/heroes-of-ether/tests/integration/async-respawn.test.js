"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs"), os = require("node:os"), path = require("node:path");
const { once } = require("node:events"), { randomUUID } = require("node:crypto");
const WebSocket = require("ws");
const { createGameServer } = require("../../src/server/game-server");
const { Arena } = require("../../src/server/arena/arena-simulation");
const { ProfileStore } = require("../../src/server/profiles/profile-store");
const { recover } = require("../../src/server/profiles/profile-journal");
const immediate = () => new Promise(resolve => setImmediate(resolve));
async function setup(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "heroes-respawn-"));
  const filePath = path.join(dir, "profiles.json");
  const store = new ProfileStore({ filePath, journal: true });
  const app = createGameServer({ profiles: store, arena: new Arena({ etherCount: 0 }), autoTick: false });
  t.after(async () => { await app.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  app.httpServer.listen(0, "127.0.0.1");
  await once(app.httpServer, "listening");
  const user = store.open();
  const ws = new WebSocket(`ws://127.0.0.1:${app.httpServer.address().port}`, {
    headers: { Cookie: `sferorumiya_session=${user.token}` },
  });
  const messages = [];
  ws.on("message", raw => messages.push(JSON.parse(raw)));
  async function wait(type, from = 0) {
    const signal = AbortSignal.timeout(5000);
    for (;;) {
      const found = messages.slice(from).find(x => x.type === type);
      if (found) return found;
      await once(ws, "message", { signal });
    }
  }
  const welcome = await wait("welcome"), p = app.arena.players.get(welcome.id);
  ws.send(JSON.stringify({ type: "leaveLife", spawnSerial: p.spawnSerial }));
  await wait("lifeEnded");
  assert.equal(p.dead, true);
  assert.equal(store.byId(user.profile.id).progress.session, null);
  return { store, app, ws, messages, wait, p, user, filePath,
    resume() { ws.send(JSON.stringify({ type: "continueLife", lifeId: p.lifeId })); } };
}
function holdStage(t, store) {
  let release, ready;
  const gate = new Promise(resolve => { release = resolve; });
  const entered = new Promise(resolve => { ready = resolve; });
  const stage = store.journal.stage.bind(store.journal);
  const mock = t.mock.method(store.journal, "stage", async value => {
    const staged = await stage(value);
    ready();
    await gate;
    return staged;
  });
  return { entered, release, restore: () => mock.mock.restore() };
}

test("respawn waits for durability, rebases a competing save and coalesces retransmission", async t => {
  const f = await setup(t), oldLife = f.p.lifeId, gate = holdStage(t, f.store);
  try {
    f.resume();
    await gate.entered;
    f.resume();
    await immediate();
    assert.equal(f.p.dead, true);
    assert.equal(f.p.lifeId, oldLife);
    assert.equal(f.store.byId(f.user.profile.id).progress.session, null);
    assert.equal(f.messages.some(x => x.type === "continueResult"), false);
    f.store.transact(f.user.token, randomUUID(), "concurrent-wallet", p => { p.wallet.coins += 17; });
    const coins = f.store.byId(f.user.profile.id).wallet.coins;
    const write = f.store.writeSnapshot.bind(f.store);
    const mock = t.mock.method(f.store, "writeSnapshot", (next, staged) => {
      assert.ok(staged, "respawn must not fall back to synchronous journal writes");
      return write(next, staged);
    });
    gate.release();
    assert.equal((await f.wait("continueResult")).ok, true);
    mock.mock.restore();
    assert.equal(f.p.dead, false);
    assert.notEqual(f.p.lifeId, oldLife);
    assert.equal(f.store.byId(f.user.profile.id).progress.session.id, f.p.lifeId);
    assert.equal(f.store.byId(f.user.profile.id).wallet.coins, coins);
    const saved = Object.values(recover(f.filePath).data.profiles).find(p => p.id === f.user.profile.id);
    assert.equal(saved.progress.session.id, f.p.lifeId);
    const spawn = f.p.spawnSerial, from = f.messages.length;
    f.ws.send(JSON.stringify({ type: "continueLife", lifeId: oldLife }));
    assert.equal((await f.wait("continueResult", from)).ok, true);
    assert.equal(f.p.spawnSerial, spawn);
  } finally { gate.release(); gate.restore(); }
});

test("disconnect during durable respawn discards the unpublished session", async t => {
  const f = await setup(t), gate = holdStage(t, f.store);
  try {
    f.resume();
    await gate.entered;
    const serverSocket = [...f.app.wss.clients].find(ws => ws.playerId === f.p.id);
    const closed = once(serverSocket, "close");
    f.ws.close();
    await closed;
    gate.release();
    // Wait for the queue to reject the invalidated draft, not just socket close.
    for (let n = 0; n < 15; n++) await immediate();
    assert.equal(f.app.arena.players.has(f.p.id), false);
    assert.equal(f.store.byId(f.user.profile.id).progress.session, null);
    const saved = Object.values(recover(f.filePath).data.profiles).find(p => p.id === f.user.profile.id);
    assert.equal(saved.progress.session, null);
  } finally { gate.release(); gate.restore(); }
});

test("failed respawn storage leaves the old life ended and a retry creates exactly one new life", async t => {
  const f = await setup(t), oldLife = f.p.lifeId;
  const mock = t.mock.method(f.store.journal, "stage", async () => { throw Error("disk unavailable"); });
  f.resume();
  assert.equal((await f.wait("continueResult")).ok, false);
  assert.equal(f.p.dead, true);
  assert.equal(f.p.lifeId, oldLife);
  assert.equal(f.store.byId(f.user.profile.id).progress.session, null);
  mock.mock.restore();
  const from = f.messages.length;
  f.resume();
  assert.equal((await f.wait("continueResult", from)).ok, true);
  assert.equal(f.store.byId(f.user.profile.id).progress.session.id, f.p.lifeId);
});
