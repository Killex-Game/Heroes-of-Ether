/* Runs loopback arenas with synthetic profiles. No listener uses a game port.
 * node scripts/benchmarks/room-capacity.cjs [shared|isolated] [3|5|7|10]
 * "isolated" is an experiment: each server has its own temporary profile store.
 */
"use strict";
const { fork } = require("node:child_process");
const os = require("node:os");
const path = require("node:path");
const layout = process.argv[2] || "shared";
const stages = [3, 5, 7, 10];
const limit = Number(process.argv[3] || 3);
// Diagnostic opt-in: measure an already known failing stage without claiming
// that lower stages passed. The same memory reserve and stop rules apply.
const onlyStage = process.env.LOAD_ONLY_STAGE === "1";
if (!["shared", "isolated"].includes(layout) || !stages.includes(limit))
  throw Error("Expected shared|isolated and 3|5|7|10");
const duration = Number(process.env.LOAD_PHASE_MS || 10000);
if (!Number.isFinite(duration) || duration < 6000 || duration > 300000)
  throw Error("LOAD_PHASE_MS must be between 6000 and 300000");
const phases = ["move", "split", "combined", "combined"];
const reserveMiB = 768;
const freeMiB = () => Math.floor(os.freemem() / 2 ** 20);
const runner = path.join(__dirname, "room-input-load.cjs");
const perRoom = Number(process.env.LOAD_PLAYERS || require('../../config/arena-rooms.json').arenaCapacity);
if (![30, 35].includes(perRoom)) throw Error('Supported room sizes are 30 and legacy 35');

async function stage(count) {
  const workerCount = Math.max(0, Math.min(8, Number(process.env.LOAD_STATE_WORKERS || 0)));
  const requiredMiB = reserveMiB + count * (layout === "shared" ? 160 : 300) +
    Math.min(workerCount, count) * 160;
  if (freeMiB() < requiredMiB) throw Error("Insufficient free memory for " + count + " rooms; need " + requiredMiB + " MiB");
  const hosts = [], waiting = new Set(), results = [], phaseCounts = new Map();
  let phase = 0, minimumFreeMiB = freeMiB(), watchdog, timeout;
  try {
    await new Promise((resolve, reject) => {
      const hostCount = layout === "shared" ? 1 : count;
      let exited = 0;
      for (let index = 0; index < hostCount; index++) {
        const child = fork(runner, [], {
          env: { ...process.env, LOAD_CLIENT: "0", LOAD_CAPACITY: "1", LOAD_COMBAT: "1",
            LOAD_ROOMS: String(count / hostCount), LOAD_PLAYERS: String(perRoom), LOAD_REJOIN: "1",
            LOAD_PHASES: phases.join(","), LOAD_PHASE_MS: String(duration),
            LOAD_JOURNAL: "1", LOAD_CONNECT_INTERVAL: "100" },
          stdio: ["ignore", "ignore", "inherit", "ipc"],
        });
        hosts.push(child);
        child.once("error", reject);
        child.once("exit", (code) => {
          if (code !== 0) return reject(Error("Benchmark server stopped: " + code));
          if (++exited === hostCount) resolve();
        });
        child.on("message", (m) => {
          if (m.type === "ready") {
            if (m.phase !== phases[phase] || waiting.has(child))
              return reject(Error("Phase barrier out of order"));
            waiting.add(child);
            if (waiting.size === hostCount) {
              phase++;
              waiting.clear();
              hosts.forEach((host) => host.send("start"));
            }
          }
          if (m.type !== "sample") return;
          const step = phaseCounts.get(child) || 0;
          const row = m.row;
          phaseCounts.set(child, step + 1);
          const sample = { layout, count, host: index + 1, step, phase: row.phase,
            serverMiB: Math.round(row.rssMB), cpuPercent: Math.round(row.cpuPercent),
            tickP95: row.tickGaps.p95, tickP99: row.tickGaps.p99, tickSamples: row.tickGaps.n,
            networkMbps: row.networkMbps, boosters: row.boosters, mass: row.mass, food: row.food, rooms: row.rooms };
          if (process.env.LOAD_ALL_BOOSTERS === "1") sample.usedByType = row.usedByType;
          sample.stateWorkers = row.stateWorkers;
          sample.persistence = row.persistence;
          if (row.lobby) sample.lobby = row.lobby;
          if (row.stats.confirmation) sample.confirmation = row.stats.confirmation;
          if (row.stats.tickWork?.n) {
            const ticks = row.stats.tickWork.n;
            sample.msPerTick = Object.fromEntries(["tickWork", "step", "snapshot", "encodeAndSend", "applyArenaProgress"]
              .map(key => [key, Math.round((row.stats[key]?.ms || 0) * 10 / ticks) / 10]));
            if (process.env.LOAD_COLLISION_TIMING === "1")
              sample.collisionMsPerTick = Object.fromEntries(["moveFeed", "moveParts", "separateParts", "collectEther",
                "resolveAbsorptions", "combatUpdate", "collectHazards", "hit", "vortex", "planKnuckles",
                "rememberKnuckleContacts", "updateSwords"]
                .map(key => [key, Math.round((row.stats[key]?.ms || 0) * 10 / ticks) / 10]));
          }
          results.push(sample);
          console.log(JSON.stringify(sample));
        });
      }
      watchdog = setInterval(() => {
        minimumFreeMiB = Math.min(minimumFreeMiB, freeMiB());
        if (minimumFreeMiB < reserveMiB) reject(Error("Stopped at memory reserve " + reserveMiB + " MiB"));
      }, 300);
      timeout = setTimeout(() => reject(Error("Benchmark timed out")), 90000 + count * 6000 + duration * phases.length * 2);
    });
    const missingBoosters = process.env.LOAD_ALL_BOOSTERS === "1"
      ? [...require("../../src/server/boosters/booster-catalog").BOOSTERS.values()]
          .filter(b => b.ready && !results.some(s => s.usedByType?.[b.id] > 0)).map(b => b.id)
      : [];
    const passed = !missingBoosters.length && results.length === hosts.length * phases.length && results.every((s) =>
      s.phase === phases[s.step] && s.rooms.length === count / hosts.length &&
      s.tickSamples > 0 && s.tickP95 <= 65 && s.tickP99 <= 100 &&
      (s.phase !== "combined" || s.boosters > 0) &&
      s.rooms.every((r) => r.connections === 35 && r.alive === 35 &&
        (s.phase === "move" || r.parts > 35) && r.updatesPerClient >= 18 &&
        r.gaps.p95 <= 100 && r.gaps.p99 <= 150));
    console.log(JSON.stringify({ layout, count, passed, minimumFreeMiB, missingBoosters }));
    return passed;
  } finally {
    clearInterval(watchdog);
    clearTimeout(timeout);
    for (const child of hosts) if (child.exitCode === null && child.signalCode === null) child.kill();
  }
}

(async () => {
  for (const count of onlyStage ? [limit] : stages) {
    if (count > limit) break;
    if (!(await stage(count))) {
      process.exitCode = 2; // Completed, but latency or occupancy missed the gate.
      break;
    }
  }
})().catch((error) => { console.error(error.message); process.exitCode = 1; });
