"use strict";
// Explicit diagnostic: fresh synthetic databases only, never hero_ether.
const fs = require("node:fs"), path = require("node:path"), os = require("node:os");
const { fork } = require("node:child_process");
const { randomBytes, randomUUID } = require("node:crypto");
const { MongoState } = require("../../src/server/persistence/mongodb-state");
const { loadConfig, safeError } = require("../../src/server/persistence/mongodb-config");
const { createFixture, simulateSeason } = require("./mongodb-room-fixture.cjs");
const { assessCapacity } = require("./capacity-assessment.cjs");
const root = path.resolve(__dirname, "../..");
const output = path.resolve(process.env.LOAD_OUTPUT || path.join(root, "../../artifacts/mongodb-capacity-20261110"));
const fixtureFile = path.join(output, "synthetic-world.json");
const rooms = Number(process.argv[2] || 1), mode = process.argv[3] || "local";
const minutes = Number(process.env.LOAD_MINUTES || 0);
const seconds = Number(process.env.LOAD_SECONDS || (minutes ? 60 : 20));
if (!Number.isInteger(minutes) || minutes < 0 || minutes > 120 || (minutes && seconds !== 60))
  throw Error("LOAD_MINUTES must be 1..120 with 60-second windows");
if (![1, 3, 5, 7, 10, 20].includes(rooms) || !["mongo", "local", "prepare"].includes(mode) ||
    !Number.isInteger(seconds) || seconds < 10 || seconds > 120) throw Error("Invalid load arguments");
const phases = minutes ? Array(minutes).fill("combined") : ["move", "split", "feed", "boosters", "combined"];
const reserveMiB = 1400;
const freeMiB = () => Math.floor(require("./available-memory.cjs").availableMemory() / 1048576);

async function run() {
  fs.mkdirSync(output, { recursive: true });
  if (!fs.existsSync(fixtureFile)) {
    // A real clan must exist before the 04:00 roster freeze. Creating it now
    // silently excludes every synthetic member from today's quest workload.
    const fixture = createFixture(Date.now() - 24 * 60 * 60 * 1000);
    fs.writeFileSync(fixtureFile, JSON.stringify(fixture));
    fs.writeFileSync(path.join(output, "season.json"), JSON.stringify(simulateSeason(fixture), null, 2));
    console.log(JSON.stringify({ fixture: fixture.summary, output }));
  }
  if (mode === "prepare") return;
  const workers = Number(process.env.LOAD_STATE_WORKERS || 0);
  const workerRoomLimit = Number(process.env.LOAD_STATE_WORKER_ROOMS ?? 3);
  const required = reserveMiB + rooms * 160 + Math.min(rooms, workers) * 160;
  if (freeMiB() < required) throw Object.assign(Error("Memory reserve"), {code:"LOAD_MEMORY_RESERVE"});
  const label = `${mode}-${rooms * 35}-${Date.now()}`;
  const runDir = path.join(output, label);
  fs.mkdirSync(runDir);
  const rows = [], log = fs.createWriteStream(path.join(runDir, "process.log"));
  let config, child, watchdog, timeout, evidence, minFreeMiB = freeMiB(), result, failure;
  if (mode === "mongo") {
    const liveConfig = loadConfig(root);
    if (!liveConfig) throw Error("Mongo configuration missing");
    config = { enabled: true, credentialsFile: liveConfig.credentialsFile,
      database: "hero_ether_test_" + randomBytes(10).toString("hex"), sourceId: randomUUID() };
    fs.writeFileSync(path.join(runDir, "mongodb.local.json"), JSON.stringify(config));
  }
  try {
    const code = await new Promise((resolve, reject) => {
      child = fork(path.join(__dirname, "room-input-load.cjs"), [], {
        env: { ...process.env, LOAD_CLIENT: "0", LOAD_CAPACITY: "1", LOAD_COMBAT: "1",
          LOAD_ROOMS: String(rooms), LOAD_PLAYERS: "35", LOAD_REJOIN: "1", LOAD_LOBBY: "30",
          LOAD_PHASES: phases.join(","), LOAD_PHASE_MS: String(seconds * 1000),
          LOAD_JOURNAL: "1", LOAD_CONNECT_INTERVAL: "150", LOAD_ALL_BOOSTERS: "1",
          LOAD_WORLD_FIXTURE: fixtureFile, LOAD_MONGO_CONFIG: config ? path.join(runDir, "mongodb.local.json") : "",
          LOAD_ACK_DIR: process.env.LOAD_ACK_DIR || path.join(output, "acks"),
          LOAD_TICK_BREAKDOWN: "1", LOAD_STATE_WORKERS: String(workers) },
        stdio: ["ignore", "pipe", "pipe", "ipc"], execArgv: process.env.LOAD_CPU_PROFILE === "1"
          ? ["--cpu-prof", "--cpu-prof-dir=" + runDir] : [],
      });
      child.stdout.pipe(log, { end: false }); child.stderr.pipe(log, { end: false });
      child.on("error", reject);
      child.on("exit", code => resolve(code));
      child.on("message", m => {
        if (m.type === "evidence") evidence = m.dir;
        if (m.type === "ready") child.send("start");
        if (m.type !== "sample") return;
        rows.push(m.row);
        console.log(JSON.stringify({ mode, players: rooms * 35, phase: m.row.phase,
          hz: +m.row.updatesPerClient.toFixed(2),
          tickP95: Math.round(m.row.tickGaps.p95), cpu: Math.round(m.row.cpuPercent),
          rssMiB: Math.round(m.row.rssMB), mongoWrites: m.row.mongo?.length || 0,
          connected: m.row.connections, lobbyErrors: m.row.lobby?.errors }));
      });
      watchdog = setInterval(() => {
        minFreeMiB = Math.min(minFreeMiB, freeMiB());
        if (minFreeMiB < reserveMiB) reject(Object.assign(Error("Memory reserve"), {code:"LOAD_MEMORY_RESERVE"}));
      }, 500);
      timeout = setTimeout(() => reject(Object.assign(Error("Load timed out"), {code:"LOAD_TIMEOUT"})),
        180000 + rooms * 6000 + seconds * phases.length * 2000);
    });
    result = { mode, players: rooms * 35, lobby: 30, code, minFreeMiB, evidence,
      successfulPhases: rows.length, stateWorkers: workers, workerRoomLimit,
      phaseSeconds: seconds, mixedMinutes: minutes, cpuProfile: process.env.LOAD_CPU_PROFILE === "1",
      compression: process.env.LOAD_COMPRESSION === "1",
      profileWorker: process.env.LOAD_PROFILE_WORKER === "1" || !!process.env.LOAD_PROFILE_PIPELINE || !!process.env.LOAD_PROFILE_SHARDS,
    boosterBatchSize: Number(process.env.LOAD_BOOSTER_BATCH_SIZE || 32),
      profilePipeline: Number(process.env.LOAD_PROFILE_PIPELINE || 0),
      pipelineComputeBudgetMs: Number(process.env.LOAD_PROGRESS_BUDGET_MS || 50),
      arenaProgressGroupSize: Number(process.env.LOAD_PROGRESS_GROUP_SIZE || 4),
      incrementalSettlement: process.env.LOAD_INCREMENTAL_SETTLEMENT === "1",
      packedFood: process.env.LOAD_PACKED_FOOD === "1",
      packedParts: process.env.LOAD_PACKED_PARTS !== "0",
      progressBudgetMs: process.env.LOAD_PROGRESS_BUDGET ? Number(process.env.LOAD_PROGRESS_BUDGET) : 8,
      progressGroupLimit: process.env.LOAD_PROGRESS_GROUP || null,
      mixedSocial: process.env.LOAD_MIXED_SOCIAL === "1",
      chatLoad: process.env.LOAD_CHAT === "1",
      event: process.env.LOAD_EVENT || null,
      stock: Number(process.env.LOAD_STOCK || 100),
      lightMetrics: process.env.LOAD_METRICS_LIGHT === "1" };
    if (evidence && fs.existsSync(path.join(evidence, "mongodb-verification.json"))) {
      result.mongoVerification = JSON.parse(fs.readFileSync(path.join(evidence, "mongodb-verification.json"), "utf8"));
    }
  } catch (error) {
    failure = error;
    result = { mode, players: rooms * 35, lobby: 30, code: null, minFreeMiB, evidence,
      successfulPhases: rows.length, stateWorkers: workers, workerRoomLimit,
      phaseSeconds: seconds, failure: safeError(error) };
  } finally {
    clearInterval(watchdog); clearTimeout(timeout);
    if (child && child.exitCode === null && child.signalCode === null) {
      child.kill(); await new Promise(resolve => child.once("exit", resolve));
    }
    log.end();
    if (config) {
      // This exact random name was allocated by this run. No arbitrary drop target.
      const db = new MongoState(config);
      try {
        const manifest = await db.meta.findOne({ _id: "state" });
        const empty = !(await db.db.listCollections({}, { nameOnly: true }).toArray()).length;
        if (!empty && manifest?.sourceId !== config.sourceId)
          throw Object.assign(Error("Test database ownership mismatch"), { code: "LOAD_DB_OWNER_MISMATCH" });
        await db.db.dropDatabase(); if (result) result.testDatabaseRemoved = true;
      }
      catch (error) {
        failure ||= error;
        result.cleanupFailure = safeError(error);
      }
      finally { await db.close(); }
    }
  }
  result.assessment = assessCapacity(rows, result);
  // Phase-scoped inspector profiles are written beside the evidence, rather
  // than Node's process-wide --cpu-prof output directory. Preserve them too.
  if (evidence) for (const row of rows) {
    const name = row.cpuProfile;
    if (typeof name === "string" && /^phase-[a-z]+\.cpuprofile$/.test(name)) {
      const source = path.join(evidence, name);
      if (fs.existsSync(source)) fs.copyFileSync(source, path.join(runDir, name));
    }
  }
  fs.writeFileSync(path.join(runDir, "results.json"), JSON.stringify(rows, null, 2));
  fs.writeFileSync(path.join(runDir, "summary.json"), JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ ...result, mongoVerification: result.mongoVerification ?
    {matched:result.mongoVerification.matched, samples:result.mongoVerification.samples.length} : null, runDir }));
  if (failure || result.code !== 0) process.exitCode = 1;
  else if (!result.assessment.shortRunMeetsTargets) process.exitCode = 2;
}
run().catch(error => { console.error(safeError(error)); process.exitCode = 1; });
