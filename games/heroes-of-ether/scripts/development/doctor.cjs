"use strict";
// Read-only local diagnostics. Does not open ProfileStore, acquire a writer or connect to Atlas.
const fs = require("node:fs"), path = require("node:path"), os = require("node:os");
const { loadServerSettings } = require("../../src/server/runtime/server-settings");
const { loadConfig } = require("../../src/server/persistence/mongodb-config");
const { syncHealth } = require("../../src/server/persistence/mongodb-health");
function readOptional(file) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); }
  catch (error) { if (error.code === "ENOENT") return null; throw error; }
}
function inspect(root, { configOnly = false, env = process.env, now = Date.now() } = {}) {
  const s = loadServerSettings(root, env);
  const report = { configuration: "ok", node: process.versions.node, availableCpus: os.availableParallelism(),
    address: { host: s.host, port: s.port },
    limits: { arenaPlayers: s.arena.maximumArenaPlayers, arenaRooms: s.arena.maximumArenas,
      playersPerRoom: s.arena.arenaCapacity, stateWorkers: s.stateWorkerCount,
      stateWorkerRooms: s.stateWorkers.maxRooms, simulationProcesses: 1 },
    ownerConfigured: !!s.owner.ownerId,
    notes: ["Лимиты конфигурации не подтверждают производительность при таком онлайне."] };
  if (s.stateWorkers.enabled && s.stateWorkers.maxRooms < s.arena.maximumArenas)
    report.notes.push("Подготовка снимков комнат сверх stateWorkerRooms выполняется в основном потоке.");
  if (configOnly) return report;
  let pid = null, processPresent = false;
  const lock = path.join(s.dataDir, "server.lock");
  if (fs.existsSync(lock)) {
    pid = Number(fs.readFileSync(lock, "utf8"));
    if (!Number.isSafeInteger(pid) || pid < 1) throw Object.assign(Error("Некорректный data/server.lock"), { code: "DOCTOR_DATA" });
    try { process.kill(pid, 0); processPresent = true; }
    catch (e) { if (e.code !== "ESRCH") throw Object.assign(Error("Не удалось проверить процесс сервера"), { code: "DOCTOR_DATA" }); }
  }
  report.server = { pid, processPresent, maintenance: fs.existsSync(path.join(s.dataDir, "maintenance.enabled")) };
  const files = fs.existsSync(s.dataDir) ? fs.readdirSync(s.dataDir).filter(n => /^profiles\.json(?:\.wal(?:-\d+)?)?$/.test(n)) : [];
  report.localStorage = { files: files.flatMap(name => {
    try { return [{ name, bytes: fs.statSync(path.join(s.dataDir, name)).size }]; }
    catch (error) { if (error.code === "ENOENT") return []; throw error; } // A completed checkpoint can remove a sealed segment.
  }) };
  const disk = fs.statfsSync(root);
  report.resources = { freeMemoryMiB: Math.floor(os.freemem() / 1048576), freeDiskMiB: Math.floor(disk.bavail * disk.bsize / 1048576) };
  const mongo = loadConfig(root);
  report.mongo = mongo ? { enabled: true, ...syncHealth(readOptional(path.join(s.dataDir, "mongodb-status.json")), now, mongo.intervalMs) } : { enabled: false };
  return report;
}
if (require.main === module) {
  try {
    if (process.argv.slice(2).some(a => a !== "--config-only")) throw Error("Используй doctor.cjs [--config-only]");
    const report = inspect(path.resolve(__dirname, "../.."), { configOnly: process.argv.includes("--config-only") });
    console.log(JSON.stringify(report, null, 2));
    if (report.server?.processPresent && report.mongo?.enabled && report.mongo.state !== "ok") process.exitCode = 2;
  } catch (error) {
    console.error(["SERVER_CONFIG", "DOCTOR_DATA"].includes(error.code) ? error.message : "Не удалось прочитать настройки или локальное состояние.");
    process.exitCode = 1;
  }
}
module.exports = { inspect };
