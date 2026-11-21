"use strict";
const fs = require("node:fs");
const path = require("node:path");
const { performance } = require("node:perf_hooks");
const { MongoClient } = require("mongodb");
const {
  loadConfig,
  credentials,
  safeError,
} = require("../../src/server/persistence/mongodb-config");
const { syncHealth } = require("../../src/server/persistence/mongodb-health");
async function main() {
  if (process.argv.slice(2).some((arg) => arg !== "--atlas")) throw Error("Invalid arguments");
  const root = path.resolve(__dirname, "../..");
  const config = loadConfig(root);
  if (!config) {
    console.log(JSON.stringify({ enabled: false }));
    return;
  }
  const file = path.join(root, "data/mongodb-status.json");
  const status = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : null;
  const report = { enabled: true, local: syncHealth(status, Date.now(), config.intervalMs) };
  if (process.argv.includes("--atlas")) {
    const client = new MongoClient(credentials(config.credentialsFile), {
      maxPoolSize: 1,
      minPoolSize: 0,
      serverSelectionTimeoutMS: 15000,
      connectTimeoutMS: 10000,
      socketTimeoutMS: 15000,
      appName: "HeroEther-health",
    });
    try {
      await client.connect();
      const start = performance.now();
      await client.db(config.database).command({ ping: 1 });
      const pingMs = Math.round((performance.now() - start) * 10) / 10;
      const meta = await client
        .db(config.database)
        .collection("metadata")
        .findOne(
          { _id: "state" },
          {
            projection: { _id: 0, revision: 1, updatedAt: 1 },
          },
        );
      const listed = await client
        .db("admin")
        .admin()
        .listDatabases({ nameOnly: true, authorizedDatabases: true });
      let dataAndIndexBytes = 0;
      let databaseCount = 0;
      let complete = true;
      for (const db of listed.databases) {
        if (["admin", "config", "local"].includes(db.name)) continue;
        try {
          const stats = await client.db(db.name).command({ dbStats: 1, scale: 1 });
          dataAndIndexBytes += Number(stats.dataSize || 0) + Number(stats.indexSize || 0);
          databaseCount++;
        } catch (_) {
          complete = false;
        }
      }
      report.atlas = {
        reachable: true,
        pingMs,
        revision: meta?.revision ?? null,
        updatedAt: meta?.updatedAt ?? null,
        visibleDatabaseCount: databaseCount,
        visibleDataAndIndexBytes: dataAndIndexBytes,
        visibleStatsComplete: complete,
        // Lower-bound usage only: restricted database users may see a subset.
        freeStorageLimitBytes: 512 * 1024 * 1024,
        visibleStorageWarning: dataAndIndexBytes >= 0.8 * 512 * 1024 * 1024,
      };
    } catch (error) {
      report.atlas = { reachable: false, error: safeError(error) };
    } finally {
      await client.close();
    }
  }
  console.log(JSON.stringify(report, null, 2));
  if (
    report.local.state !== "ok" ||
    report.atlas?.reachable === false ||
    report.atlas?.visibleStorageWarning
  )
    process.exitCode = 2;
}
main().catch((error) => {
  console.error(safeError(error));
  process.exitCode = 1;
});
