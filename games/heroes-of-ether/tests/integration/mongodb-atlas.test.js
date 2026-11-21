"use strict";
// Opt-in network test. Only its uniquely created empty database is removed.
const test = require("node:test");
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const { MongoState, pack, hash } = require("../../src/server/persistence/mongodb-state");
const fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path");
const { MongoSync } = require("../../src/server/persistence/mongodb-sync");
const { ProfileJournal } = require("../../src/server/profiles/profile-journal");
test(
  "Atlas transaction, retry, rollback, writer exclusion and restore",
  { skip: !process.env.HERO_ETHER_ATLAS_TEST_CREDENTIALS, timeout: 120000 },
  async (t) => {
    const database = "hero_ether_test_" + randomUUID().replaceAll("-", "").slice(0, 20);
    const config = {
      credentialsFile: process.env.HERO_ETHER_ATLAS_TEST_CREDENTIALS,
      database,
      sourceId: randomUUID(),
    };
    const state = new MongoState(config),
      other = new MongoState(config);
    let created = false;
    t.after(async () => {
      await other.close();
      try {
        if (
          created &&
          /^hero_ether_test_[a-f0-9]{20}$/.test(database) &&
          state.db.databaseName === database
        )
          await state.db.dropDatabase();
      } finally {
        await state.close();
      }
    });
    await state.client.connect();
    const world = {
      version: 13,
      _journalRevision: 1,
      profiles: {
        p: {
          wallet: { coins: 100 },
          receipts: {},
          quests: { session: { seenBuckets: { 0: { v: true } } } },
        },
      },
      clans: { c: { members: ["p"] } },
    };
    const initial = pack(world, { "game-events.json": { events: [] } });
    await state.initialize(initial);
    created = true;
    await assert.rejects(state.initialize(initial), /NOT_EMPTY/);
    await state.acquire(initial);
    await assert.rejects(other.acquire(initial), /WRITER_BUSY/);
    const next = structuredClone(world);
    next._journalRevision = 2;
    next.profiles.p.wallet.coins = 90;
    next.profiles.p.receipts.purchase = { granted: 1, cost: 10 };
    const second = pack(next, { "game-events.json": { events: [] } });
    // Failure after actual state writes, before commit: nothing may escape.
    const realUpdate = state.meta.updateOne.bind(state.meta);
    state.meta.updateOne = async () => {
      throw Error("injected write failure");
    };
    await assert.rejects(state.sync(second), /injected/);
    state.meta.updateOne = realUpdate;
    assert.equal((await state.read()).snapshot.digest, initial.digest);
    await state.sync(second);
    assert.deepEqual((await state.read()).world, next);
    const repeated = await state.sync(second);
    assert.equal(repeated.changedDocuments, 0);
    // Committed remotely, acknowledgement lost locally; next sync also has new data.
    next._journalRevision = 3;
    next.profiles.p.wallet.coins = 80;
    const third = pack(next);
    const realTransaction = state.transaction.bind(state);
    state.transaction = async (fn) => {
      await realTransaction(fn);
      throw Error("lost ack");
    };
    await assert.rejects(state.sync(third), /lost ack/);
    state.transaction = realTransaction;
    next._journalRevision = 4;
    next.profiles.p.wallet.coins = 70;
    await state.sync(pack(next));
    assert.deepEqual((await state.read()).world, next);
    assert.equal(hash((await state.read()).world), hash(next));
    // Stale server cannot overwrite an external version, even with same source ID.
    await state.meta.updateOne({ _id: "state" }, { $inc: { generation: 1 } });
    next._journalRevision++;
    await assert.rejects(state.sync(pack(next)), /CONCURRENT/);
  },
);
test(
  "Persistence worker uploads WAL checkpoint and final shutdown state, then reconnects",
  { skip: !process.env.HERO_ETHER_ATLAS_TEST_CREDENTIALS, timeout: 120000 },
  async (t) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "hero-ether-mongo-worker-"));
    const database = "hero_ether_test_" + randomUUID().replaceAll("-", "").slice(0, 20);
    const config = {
      enabled: true,
      credentialsFile: process.env.HERO_ETHER_ATLAS_TEST_CREDENTIALS,
      database,
      sourceId: randomUUID(),
    };
    fs.mkdirSync(path.join(root, "config"));
    fs.mkdirSync(path.join(root, "data"));
    fs.writeFileSync(path.join(root, "config/mongodb.local.json"), JSON.stringify(config));
    const file = path.join(root, "data/profiles.json");
    const initial = {
      version: 13,
      _journalRevision: 1,
      profiles: { p: { coins: 100, receipts: {} } },
      clans: {},
    };
    fs.writeFileSync(file, JSON.stringify(initial));
    const state = new MongoState(config);
    let journal,
      sync,
      created = false;
    t.after(async () => {
      if (journal && !journal.closed) await journal.close();
      if (sync) await sync.close(false);
      try {
        if (created && /^hero_ether_test_[a-f0-9]{20}$/.test(database))
          await state.db.dropDatabase();
      } finally {
        await state.close();
        fs.rmSync(root, { recursive: true, force: true });
      }
    });
    await state.initialize(pack(initial));
    created = true;
    sync = await MongoSync.open(root);
    const metricsReply = () => new Promise(resolve => {
      const receive = message => {
        if (message.type !== "metrics") return;
        sync.worker.off("message", receive); resolve(message);
      };
      sync.worker.on("message", receive);
    });
    let metrics = metricsReply();sync.setMetrics(false);await metrics;
    assert.ok(!sync.waiting);
    metrics = metricsReply();sync.setMetrics(true);await metrics;
    assert.ok(sync.monitoring().metrics);
    journal = new ProfileJournal(file, { intervalMs: 60000 });
    const next = structuredClone(initial);
    next.profiles.p = { coins: 90, receipts: { spent: 10 } };
    journal.commit(next);
    sync.attach({ journal });
    await sync.flush();
    assert.deepEqual((await state.read()).world.profiles, next.profiles);
    assert.ok(sync.monitoring().metrics.read > 0, "Enabled metrics must observe actual reads on an existing connection");
    assert.ok(sync.monitoring().metrics.write > 0, "Enabled metrics must observe actual writes on an existing connection");
    metrics = metricsReply();sync.setMetrics(false);await metrics;
    assert.equal(sync.monitoring().metrics, null);
    assert.equal(sync.failed, false);
    await sync.worker.terminate();
    await sync.flush();
    assert.deepEqual((await state.read()).world.profiles, next.profiles);
    const final = { ...next, profiles: { p: { coins: 80, receipts: { spent: 10, spent2: 10 } } } };
    journal.commit(final);
    sync.pause();
    await journal.close();
    await sync.close();
    sync = null;
    const remote = await state.read();
    assert.deepEqual(remote.world.profiles, final.profiles);
    assert.equal(remote.manifest.writer, undefined);
    sync = await MongoSync.open(root);
    await sync.close(false);
    sync = null;
    const status = JSON.parse(fs.readFileSync(path.join(root, "data/mongodb-status.json")));
    assert.equal(status.stopped, true);
    assert.ok(!JSON.stringify(status).includes("mongodb+srv"));
  },
);
