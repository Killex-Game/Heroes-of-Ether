"use strict";
const fs = require("node:fs");
const path = require("node:path");
const { performance } = require("node:perf_hooks");
const { MongoSync } = require("../../src/server/persistence/mongodb-sync");
const { MongoState, readLocal } = require("../../src/server/persistence/mongodb-state");
const { safeError } = require("../../src/server/persistence/mongodb-config");

async function attachTestMongo(root, profiles, chat) {
  const config = JSON.parse(fs.readFileSync(path.join(root, "config/mongodb.local.json"), "utf8"));
  if (!/^hero_ether_test_[a-f0-9]{20}$/.test(config.database)) throw Error("Synthetic database required");
  await profiles.journal.requestCheckpoint();
  await chat?.writer?.checkpoint();
  const offline = new MongoState(config);
  try { await offline.initialize(readLocal(path.join(root, "data")).snapshot); }
  finally { await offline.close(); }
  const sync = await MongoSync.open(root);
  const samples = [];
  const flush = sync.flush.bind(sync);
  sync.flush = function (final) {
    if (this.running) return this.running;
    const started = performance.now();
    return flush(final).then(result => {
      samples.push({ ...result, durationMs: performance.now() - started, final: !!final });
      return result;
    }, error => {
      samples.push({ error: safeError(error), durationMs: performance.now() - started });
      throw error;
    });
  };
  sync.attach(profiles, chat);
  return { sync, samples, async verify() {
    const reader = new MongoState(config);
    try {
      const remote = await reader.read(), local = readLocal(path.join(root, "data"));
      const result = { matched: remote.snapshot.digest === local.snapshot.digest,
        localRevision: local.snapshot.revision, mongoRevision: remote.snapshot.revision,
        profiles: Object.keys(remote.world.profiles).length, clans: Object.keys(remote.world.clans).length,
        samples };
      fs.writeFileSync(path.join(root, "mongodb-verification.json"), JSON.stringify(result, null, 2));
      if (!result.matched) throw Object.assign(Error("MONGO_CHECKSUM_FAILED"), {code:"MONGO_CHECKSUM_FAILED"});
      return result;
    } finally { await reader.close(); }
  } };
}
module.exports = { attachTestMongo };
