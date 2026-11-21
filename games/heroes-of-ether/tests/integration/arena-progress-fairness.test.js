"use strict";
const test = require("node:test"),
  assert = require("node:assert/strict");
const fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path");
const { once } = require("node:events"),
  { randomUUID } = require("node:crypto");
const { createGameServer } = require("../../src/server/game-server");
const { Arena, radiusForMass } = require("../../src/server/arena/arena-simulation");
const { ProfileStore } = require("../../src/server/profiles/profile-store");
const { ArenaBoosterQueue } = require("../../src/server/profiles/arena-booster-queue");
const { recover } = require("../../src/server/profiles/profile-journal");
function deferred() {
  let resolve;
  const promise = new Promise((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
async function fixture(t, arenaProgressWorker = false, fairRetries = false) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "heroes-progress-fairness-"));
  const file = path.join(dir, "profiles.json");
  let time = 0,
    queue;
  const epoch = Date.now(),
    store = new ProfileStore({ filePath: file, journal: true, arenaProgressWorker, now: () => epoch + time });
  const arena = new Arena({ etherCount: 0 });
  const app = createGameServer({
    profiles: store,
    arena,
    autoTick: false,
    arenaBoosterFairRetries: fairRetries,
    now: () => time,
    wallNow: () => epoch + time,
    testBots: { enabled: false },
  });
  // This fixture asserts persistence of a monotonically growing mass. Random
  // thorns and natural decay can change it independently of the journal queue.
  t.mock.method(require("../../src/server/arena/arena-hazards").ArenaHazards.prototype,
    "replenish", () => {});
  t.mock.method(arena, "decayMass", () => {});
  t.after(async () => {
    await app.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });
  app.httpServer.listen(0, "127.0.0.1");
  await once(app.httpServer, "listening");
  const buyer = store.open(),
    runner = store.open(),
    p = arena.addPlayer(time);
  p.profileId = runner.profile.id;
  store.startLife(p.profileId, p.lifeId);
  const commit = ArenaBoosterQueue.prototype.commit;
  t.mock.method(ArenaBoosterQueue.prototype, "commit", function (commands) {
    queue = this;
    return commit.call(this, commands);
  });
  const stage = store.journal.stage.bind(store.journal),
    ready = deferred(),
    gate = deferred();
  const held = t.mock.method(store.journal, "stage", async (next) => {
    const result = await stage(next);
    ready.resolve();
    await gate.promise;
    return result;
  });
  const base = `http://127.0.0.1:${app.httpServer.address().port}`;
  const request = fetch(base + "/api/shop/buy", {
    method: "POST",
    headers: {
      Cookie: `sferorumiya_session=${buyer.token}`,
      Origin: base,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ boosterId: "candy", requestId: randomUUID() }),
    signal: AbortSignal.timeout(5000),
  });
  await ready.promise;
  function tick() {
    time += 50;
    p.mass += 100;
    p.radius = radiusForMass(p.mass);
    app.tick();
  }
  for (let n = 0; n < 12; n++) tick();
  assert.equal(app.persistenceStatus().arenaBatches, 12);
  t.after(() => gate.resolve());
  return {
    app,
    store,
    runner,
    p,
    file,
    queue,
    tick,
    request,
    release() {
      held.mock.restore();
      gate.resolve();
    },
  };
}

for (const worker of [false, true]) for (const fairRetries of [false, true]) test(
  `waiting arena ticks commit before the next cast; later ticks cannot starve it (worker=${worker}, fair=${fairRetries})`,
  { timeout: 10000 },
  async (t) => {
    const f = await fixture(t, worker, fairRetries),
      expected = f.p.mass,
      finished = deferred();
    let flushes = 0,
      flushesAtCast;
    const flush = f.store.flushArenaSnapshot.bind(f.store);
    // A generous test budget isolates FIFO scheduling from calculation time.
    const apply = f.store.applyArenaGroup.bind(f.store);
    t.mock.method(f.store, "applyArenaGroup", batches => apply(batches, Infinity));
    t.mock.method(f.store, "flushArenaSnapshot", async (...args) => {
      const result = await flush(...args);
      if (++flushes <= 8) f.tick(); // ongoing players keep producing progress
      return result;
    });
    f.queue.use({
      owner: "barrier-observer",
      prepare() {
        assert.ok(f.store.byId(f.runner.profile.id).progress.maxMass >= expected);
        flushesAtCast = flushes;
        return { finish: () => finished.resolve() };
      },
      fail: (error) => {
        finished.resolve();
        throw error;
      },
    });
    f.release();
    assert.equal((await f.request).status, 200);
    await finished.promise;
    await f.queue.running;
    assert.ok(
      flushesAtCast === 3,
      `bounded prefix, got ${flushesAtCast} flushes`,
    );
    await f.app.close();
    const saved = Object.values(recover(f.file).data.profiles).find(
      (p) => p.id === f.runner.profile.id,
    );
    assert.ok(saved.progress.maxMass >= expected);
  },
);

test(
  "shutdown during the progress barrier completes and retains queued progress",
  { timeout: 10000 },
  async (t) => {
    const f = await fixture(t),
      expected = f.p.mass,
      ready = deferred(),
      gate = deferred();
    const flush = f.store.flushArenaSnapshot.bind(f.store);
    const held = t.mock.method(f.store, "flushArenaSnapshot", async (...args) => {
      const result = await flush(...args);
      ready.resolve();
      await gate.promise;
      return result;
    });
    f.release();
    await f.request;
    await ready.promise;
    const closing = f.app.close();
    held.mock.restore();
    gate.resolve();
    await closing;
    const saved = Object.values(recover(f.file).data.profiles).find(
      (p) => p.id === f.runner.profile.id,
    );
    assert.equal(saved.progress.maxMass, expected);
  },
);

test(
  "failed progress write releases the barrier, keeps progress queued and permits retry",
  { timeout: 10000 },
  async (t) => {
    const f = await fixture(t),
      expected = f.p.mass;
    const failed = t.mock.method(f.store.journal, "commitArena", () => {
      throw Error("test disk failure");
    });
    f.release();
    await f.request;
    await f.queue.running;
    assert.equal(f.app.persistenceStatus().paused, true);
    assert.equal(f.app.persistenceStatus().arenaBatches, 12);
    assert.ok(f.store.byId(f.runner.profile.id).progress.maxMass < expected);
    failed.mock.restore();
    f.app.tick();
    await f.app.close();
    const saved = Object.values(recover(f.file).data.profiles).find(
      (p) => p.id === f.runner.profile.id,
    );
    assert.equal(saved.progress.maxMass, expected);
  },
);

test(
  "a slow checkpoint does not freeze progress behind an unpublished booster",
  { timeout: 10000 },
  async (t) => {
    const f = await fixture(t),
      checkpoint = deferred();
    f.store.journal.running = checkpoint.promise;
    try {
      f.release(); // publication must wait for the checkpoint, then rebuild
      const deadline = Date.now() + 2000;
      while (f.queue.staging !== false && Date.now() < deadline)
        await new Promise((resolve) => setTimeout(resolve, 1));
      assert.equal(f.queue.staging, false);
      assert.equal(f.store.journal.running, checkpoint.promise);
      for (let n = 0; n < 72; n++) {
        f.tick();
        assert.equal(f.app.persistenceStatus().paused, false);
        await f.store.journal.arenaFlush;
        await new Promise((resolve) => setImmediate(resolve));
      }
      assert.ok(f.store.byId(f.runner.profile.id).progress.maxMass >= f.p.mass - 100);
      f.store.journal.running = null;
      checkpoint.resolve();
      assert.equal((await f.request).status, 200);
      await f.queue.running;
      await f.app.close();
      const saved = Object.values(recover(f.file).data.profiles).find(
        (p) => p.id === f.runner.profile.id,
      );
      assert.equal(saved.progress.maxMass, f.p.mass);
    } finally {
      f.store.journal.running = null;
      checkpoint.resolve();
    }
  },
);
