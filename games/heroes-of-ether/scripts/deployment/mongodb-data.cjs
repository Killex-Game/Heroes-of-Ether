"use strict";
// init/verify are offline; export always writes a NEW directory, never live data.
const fs = require("node:fs");
const path = require("node:path");
const { MongoState, readLocal, hash, sameContents } = require("../../src/server/persistence/mongodb-state");
const { loadConfig, safeError } = require("../../src/server/persistence/mongodb-config");
const { acquireServerLock } = require("../../src/server/runtime/process-lock");
const { atomicSnapshot } = require("../../src/server/profiles/profile-journal");
const root = path.resolve(__dirname, "../..");
(async () => {
  const command = process.argv[2];
  if (!["init", "verify", "export", "status"].includes(command))
    throw Object.assign(Error("Usage: mongodb-data.cjs init|verify|export NEW_DIRECTORY|status"), {
      code: "MONGO_COMMAND",
    });
  const config = loadConfig(root);
  if (!config) throw Object.assign(Error("Missing config"), { code: "MONGO_CONFIG" });
  const release = ["init", "verify"].includes(command)
    ? acquireServerLock(path.join(root, "data/server.lock"))
    : () => {};
  const state = new MongoState(config);
  try {
    await state.client.connect();
    if (command === "init")
      await state.initialize(readLocal(path.join(root, "data"), true).snapshot);
    const remote = await state.read({ snapshot: command === 'export' });
    let exportDigest;
    if (command === "verify") {
      const local = readLocal(path.join(root, "data"), true);
      if (!sameContents(remote, local))
        throw Object.assign(Error("Mismatch"), { code: "MONGO_CHECKSUM_FAILED" });
    }
    if (command === "export") {
      if (!process.argv[3])
        throw Object.assign(Error("New directory required"), { code: "MONGO_EXPORT_PATH" });
      const destination = path.resolve(process.argv[3]);
      // mkdir without recursive cannot overwrite an existing destination.
      fs.mkdirSync(destination);
      atomicSnapshot(path.join(destination, "profiles.json"), remote.world);
      for (const [file, value] of Object.entries(remote.auxiliary))
        atomicSnapshot(path.join(destination, file), value);
      const restored = readLocal(destination);
      if (!sameContents(restored, remote))
        throw Object.assign(Error("Restore mismatch"), { code: "MONGO_CHECKSUM_FAILED" });
      exportDigest = restored.snapshot.digest;
    }
    console.log(
      JSON.stringify({
        ok: true,
        command,
        database: config.database,
        profiles: Object.keys(remote.world.profiles).length,
        clans: Object.keys(remote.world.clans).length,
        revision: remote.manifest.revision,
        generation: remote.manifest.generation,
        // Export consumers verify the reconstructed files using the current
        // reader. Preserve the database's physical digest separately.
        digest: exportDigest || remote.snapshot.digest,
        storageDigest: remote.snapshot.digest,
        updatedAt: remote.manifest.updatedAt,
        writerActive: !!remote.manifest.writer,
        snapshotHash: hash(remote.world),
      }),
    );
  } finally {
    await state.close();
    release();
  }
})().catch((error) => {
  console.error(safeError(error));
  process.exitCode = 1;
});
