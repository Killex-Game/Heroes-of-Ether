"use strict";
const test = require("node:test"),
  assert = require("node:assert/strict");
const fs = require("node:fs"),
  path = require("node:path"),
  os = require("node:os"),
  { randomUUID } = require("node:crypto");
const { spawnSync } = require("node:child_process");
const { ProfileStore } = require("../../src/server/profiles/profile-store");
const { recover } = require("../../src/server/profiles/profile-journal");
const { ArenaBoosterQueue } = require("../../src/server/profiles/arena-booster-queue");
const operations = require("../../src/server/profiles/operation-receipts");
function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sferorumia-profile-wal-")),
    filePath = path.join(dir, "profiles.json");
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return filePath;
}
test("Arena rewards publish after flush, retry a failed disk and survive a racing wallet commit", async t => {
  const filePath = fixture(t);
  const store = new ProfileStore({ filePath, journal: true });
  try {
    const auth = store.open(), id = auth.profile.id, lifeId = randomUUID(), at = Date.now();
    store.startLife(id, lifeId);
    const events = [{ type: "absorbed", profileId: id, victimProfileId: randomUUID(), gain: 35, lifeId }];
    const submit = () => store.applyArenaProgress("arena-batch", events, at, true);
    const original = store.find(auth.token);
    let finish;
    const flush = fs.fsync;
    const mock = t.mock.method(fs, "fsync", (fd, callback) => {
      finish = error => error ? callback(error) : flush(fd, callback);
    });
    let writing = submit();
    assert.strictEqual(store.find(auth.token), original);
    finish(Error("disk unavailable"));
    await assert.rejects(writing, /disk unavailable/);
    assert.strictEqual(store.find(auth.token), original);
    assert.notEqual(recover(filePath).data.progressReceipt, "arena-batch");

    writing = submit();
    store.transact(auth.token, randomUUID(), "wallet", p => { p.wallet.coins += 17; });
    finish();
    assert.equal(await writing, null);
    assert.equal(store.find(auth.token).wallet.coins, original.wallet.coins + 17);
    assert.deepEqual(store.find(auth.token).progress, original.progress);

    writing = submit();
    const checkpoint = store.journal.requestCheckpoint();
    assert.deepEqual(store.find(auth.token).progress, original.progress);
    finish();
    assert.deepEqual(await writing, [id]);
    await checkpoint;
    mock.mock.restore();
    const saved = store.find(auth.token);
    assert.equal(saved.progress.absorbedMass, original.progress.absorbedMass + 35);
    assert.equal(saved.wallet.coins, original.wallet.coins + 17);
    assert.deepEqual(await submit(), []);
    assert.deepEqual(Object.values(recover(filePath).data.profiles).find(p => p.id === id), saved);
  } finally {
    await store.close();
  }
});
test("A confirmed arena batch survives abrupt process exit and replay", async (t) => {
  const filePath = fixture(t);
  const child = spawnSync(process.execPath, ["-e", `
    const { ProfileStore } = require(process.argv[1]);
    const store = new ProfileStore({ filePath: process.argv[2], journal: true });
    const id = store.open().profile.id;
    store.startLife(id, "life");
    const event = { type: "absorbed", profileId: id, victimProfileId: "other", gain: 35, lifeId: "life" };
    store.applyArenaProgress("confirmed", [event], Date.now(), true)
      .then(() => process.exit(0), () => process.exit(1));
  `, require.resolve("../../src/server/profiles/profile-store"), filePath], { encoding: "utf8" });
  assert.equal(child.status, 0, child.stderr);
  const store = new ProfileStore({ filePath, journal: true });
  try {
    const [profile] = Object.values(store.data.profiles);
    const event = { type: "absorbed", profileId: profile.id, victimProfileId: "other", gain: 35, lifeId: "life" };
    assert.equal(profile.progress.absorbedMass, 35);
    assert.deepEqual(await store.applyArenaProgress("confirmed", [event], Date.now(), true), []);
    assert.equal(store.byId(profile.id).progress.absorbedMass, 35);
  } finally {
    await store.close();
  }
});
test("Backlogged ticks share a flush, keep individual rewards and stop before daily rollover", async (t) => {
  const at = Date.parse("2026-11-03T20:59:59.000Z");
  const store = new ProfileStore({ filePath: fixture(t), journal: true, now: () => at });
  const serial = new ProfileStore({ filePath: fixture(t), journal: true, now: () => at });
  try {
    const { profile } = store.open();
    const lifeId = randomUUID();
    store.startLife(profile.id, lifeId);
    serial.save(structuredClone(store.data), at);
    const batches = [50, 900, 1050].map((dt, i) => ({
      at: at + dt, id: "step-" + i, progress: [{
        type: "absorbed", profileId: profile.id, victimProfileId: "opponent-" + i, gain: 30 + i, lifeId,
      }],
    }));
    const revision = store.journal.revision;
    assert.deepEqual(await store.applyArenaGroup(batches, Infinity), [[profile.id], [profile.id]]);
    assert.equal(store.journal.revision, revision + 1);
    assert.deepEqual(await store.applyArenaGroup(batches.slice(2)), [[profile.id]]);
    for (const batch of batches) serial.applyArenaProgress(batch.id, batch.progress, batch.at);
    const actual = store.byId(profile.id), expected = serial.byId(profile.id);
    assert.equal(actual.progress.absorbedMass, 93);
    assert.deepEqual(actual.progress, expected.progress);
    assert.deepEqual(actual.daily, expected.daily);
    assert.deepEqual(actual.wallet, expected.wallet);
    assert.equal(actual.revision, expected.revision);
    assert.equal(recover(store.filePath).data.progressReceipt, batches[2].id);
  } finally {
    await Promise.all([store.close(), serial.close()]);
  }
});
test("A booster in three full rooms journals only its owner, and daily rollover still persists", async (t) => {
  const filePath = fixture(t);
  let at = Date.parse("2026-11-01T20:50:00Z");
  const store = new ProfileStore({ filePath, journal: true, now: () => at });
  try {
    const users = Array.from({ length: 105 }, () => store.open());
    store.transact(users[0].token, randomUUID(), "fixture", (p) => {
      p.inventory.meat = 10;
    });
    await store.journal.requestCheckpoint();
    const before = Object.values(store.data.profiles),
      offset = store.journal.activeBytes,
      requestId = randomUUID();
    store.consume(users[0].token, "meat", requestId, "consume-test", () => ({ mass: 5000 }));
    const after = Object.values(store.data.profiles);
    assert.equal(after.filter((p, i) => p !== before[i]).length, 1);
    const wal = fs
      .readFileSync(filePath + ".wal")
      .subarray(offset)
      .toString("utf8")
      .trim();
    const entry = JSON.parse(wal.slice(65));
    const updated = [
      ...Object.keys(entry.change.tables.profiles?.set || {}),
      ...Object.keys(entry.change.tables.profileEdits || {}),
    ];
    assert.deepEqual(updated, [
      Object.keys(store.data.profiles).find(
        (key) => store.data.profiles[key].id === users[0].profile.id,
      ),
    ]);
    assert.ok(Buffer.byteLength(wal) < 16000, "one booster must not copy 105 profiles");
    assert.equal(
      Object.values(recover(filePath).data.profiles).find((p) => p.id === users[0].profile.id)
        .inventory.meat,
      9,
    );
    store.consume(users[0].token, "meat", requestId, "consume-test", () => {
      throw Error("replayed effect");
    });
    assert.equal(store.find(users[0].token).inventory.meat, 9);
    at = Date.parse("2026-11-01T21:00:01Z");
    store.refreshCompetition();
    const day = require("../../src/server/rankings/daily-leaderboards").dayAt(at);
    const saved = recover(filePath).data;
    assert.ok(Object.values(saved.profiles).every((p) => p.daily.day === day));
  } finally {
    await store.close();
  }
});
test("Abrupt process exit preserves committed wallet, inventory and receipt; retry does not spend twice", async (t) => {
  const filePath = fixture(t),
    modulePath = require.resolve("../../src/server/profiles/profile-store");
  const requestId = randomUUID();
  const script = `const {ProfileStore}=require(process.argv[1]);
    const store=new ProfileStore({filePath:process.argv[2],journal:true});
    const auth=store.open();
    const p=structuredClone(store.find(auth.token)); p.wallet.coins=10000;
    store.save({...store.data,profiles:{...store.data.profiles,[require('crypto').createHash('sha256').update(auth.token).digest('hex')]:p}});
    const result=store.buy(auth.token,'freeze',process.argv[3]);
    console.log(JSON.stringify({token:auth.token,result,wallet:store.find(auth.token).wallet,inventory:store.find(auth.token).inventory}));
    process.exit(0);`;
  const child = spawnSync(process.execPath, ["-e", script, modulePath, filePath, requestId], {
    encoding: "utf8",
  });
  assert.equal(child.status, 0, child.stderr);
  const saved = JSON.parse(child.stdout);
  const store = new ProfileStore({ filePath, journal: true });
  try {
    assert.deepEqual(store.find(saved.token).wallet, saved.wallet);
    assert.deepEqual(store.find(saved.token).inventory, saved.inventory);
    store.buy(saved.token, "freeze", requestId);
    assert.deepEqual(store.find(saved.token).wallet, saved.wallet);
    assert.deepEqual(store.find(saved.token).inventory, saved.inventory);
  } finally {
    await store.close();
  }
});
test("Journal failure leaves profile unchanged; retry and graceful restart preserve progress once", async (t) => {
  const filePath = fixture(t),
    store = new ProfileStore({ filePath, journal: true });
  try {
    const auth = store.open(),
      id = auth.profile.id,
      life = randomUUID();
    store.startLife(id, life);
    const before = structuredClone(store.find(auth.token));
    const write = fs.writeSync;
    let failed = false;
    const mock = t.mock.method(fs, "writeSync", (fd, ...args) => {
      if (fd === store.journal.fd && !failed) {
        failed = true;
        throw Error("synthetic write failure");
      }
      return write(fd, ...args);
    });
    const events = [{ type: "lifeTime", profileId: id, lifeId: life, durationSeconds: 60 }];
    assert.throws(
      () => store.applyArenaProgress("tick-retry", events, Date.now()),
      /synthetic write failure/,
    );
    assert.deepEqual(store.find(auth.token), before);
    mock.mock.restore();
    const appearance = store.find(auth.token).appearance;
    store.applyArenaProgress("tick-retry", events, Date.now());
    assert.strictEqual(store.find(auth.token).appearance, appearance);
    const after = structuredClone(store.find(auth.token));
    store.applyArenaProgress("tick-retry", events, Date.now());
    assert.deepEqual(store.find(auth.token), after);
    const restored = recover(filePath).data;
    assert.equal(restored.progressReceipt, "tick-retry");
    assert.deepEqual(Object.values(restored.profiles).find((p) => p.id === id), after);
    await store.close();
    assert.equal(JSON.parse(fs.readFileSync(filePath)).progressReceipt, "tick-retry");
  } finally {
    if (!store.journal.closed) await store.close();
  }
});
test("An empty journal from an interrupted first startup does not invalidate a fresh store", async (t) => {
  const filePath = fixture(t);
  fs.writeFileSync(filePath + ".wal", "");
  const store = new ProfileStore({ filePath, journal: true });
  try {
    assert.ok(store.open().profile.id);
  } finally {
    await store.close();
  }
});

test("Crash before and after booster publication recovers precisely the confirmed inventory", async (t) => {
  for (const point of ["prepared", "published"]) {
    const file = fixture(t),
      id = randomUUID();
    const child = spawnSync(
      process.execPath,
      [
        "-e",
        `
      const {ProfileStore} = require(process.argv[1]);
      const {ArenaBoosterQueue} = require(process.argv[2]);
      const store = new ProfileStore({filePath: process.argv[3], journal: true});
      const user = store.open();
      store.transact(user.token, "seed-boosters-0001", "seed", p => { p.inventory.candy = 4; });
      const stage = store.journal.stage.bind(store.journal);
      store.journal.stage = async next => {
        const entry = await stage(next);
        if (process.argv[5] === "prepared") process.exit(0);
        return entry;
      };
      new ArenaBoosterQueue(store).use({
        owner: user.profile.id,
        prepare(batch) {
          store.consume(user.token, "candy", process.argv[4], "cast", () => ({mass: 400}), true, batch);
          return {finish: () => process.exit(0)};
        },
        fail: () => process.exit(2),
      });
    `,
        require.resolve("../../src/server/profiles/profile-store"),
        require.resolve("../../src/server/profiles/arena-booster-queue"),
        file,
        id,
        point,
      ],
      { encoding: "utf8", timeout: 20000 },
    );
    assert.equal(child.status, 0, child.stderr);
    const restored = new ProfileStore({ filePath: file, journal: true });
    try {
      const [profile] = Object.values(restored.data.profiles);
      assert.equal(profile.inventory.candy, point === "published" ? 3 : 4);
      assert.equal(operations.read(profile, id), point === "published" ? "cast" : operations.MISSING);
    } finally {
      await restored.close();
    }
  }
});

test("Live booster batches survive replay and a competing save; a failed or obsolete cast costs nothing", async (t) => {
  const filePath = fixture(t);
  const store = new ProfileStore({ filePath, journal: true });
  const queue = new ArenaBoosterQueue(store);
  try {
    const users = [store.open(), store.open()];
    for (const user of users)
      store.transact(user.token, randomUUID(), "seed", (p) => {
        p.inventory.meat = 4;
      });
    let effects = 0,
      living = true;
    const use = (user, id) =>
      new Promise((resolve, reject) =>
        queue.use({
          owner: user.profile.id,
          prepare(batch) {
            const result = store.consume(
              user.token,
              "meat",
              id,
              "arena-test",
              () => {
                if (!living) throw Error("life ended");
                return { mass: 750 };
              },
              true,
              batch,
            );
            return {
              valid: () => living,
              finish() {
                if (!result.replay) effects++;
                resolve(result.replay);
              },
            };
          },
          fail: reject,
        }),
      );
    const first = randomUUID();
    const stage = store.journal.stage.bind(store.journal);
    let release, ready;
    const gate = new Promise((done) => {
      release = done;
    });
    const staged = new Promise((done) => {
      ready = done;
    });
    let groups = 0;
    store.journal.stage = async (next) => {
      groups++;
      const record = await stage(next);
      ready();
      await gate;
      return record;
    };
    const casts = [use(users[0], first), use(users[1], randomUUID())];
    await staged;
    assert.equal(effects, 0);
    assert.equal(store.find(users[0].token).inventory.meat, 4);
    assert.ok(Object.values(recover(filePath).data.profiles).every((p) => p.inventory.meat === 4));
    release();
    assert.deepEqual(await Promise.all(casts), [false, false]);
    assert.equal(groups, 1);
    assert.ok(Object.values(recover(filePath).data.profiles).every((p) => p.inventory.meat === 3));
    assert.equal(await use(users[0], first), true);
    assert.equal(effects, 2);
    const competingId = randomUUID();
    store.journal.stage = async (next) => {
      const staged = await stage(next);
      store.transact(users[0].token, competingId, "gift", (p) => {
        p.inventory.meat += 2;
      });
      return staged;
    };
    await use(users[0], randomUUID());
    assert.equal(store.find(users[0].token).inventory.meat, 4);
    store.journal.stage = async (next) => {
      const record = await stage(next);
      living = false;
      return record;
    };
    await assert.rejects(use(users[0], randomUUID()), /life ended/);
    living = true;
    store.journal.stage = async () => {
      throw Error("disk full");
    };
    await assert.rejects(use(users[0], randomUUID()), /disk full/);
    assert.equal(effects, 3);
    const saved = Object.values(recover(filePath).data.profiles).find(
      (p) => p.id === users[0].profile.id,
    );
    assert.equal(saved.inventory.meat, 4);
    assert.equal(saved.receipts[competingId], "gift");
    assert.equal(operations.read(saved, first), "arena-test");
  } finally {
    await queue.running;
    await store.close();
  }
});
