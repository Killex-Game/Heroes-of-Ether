"use strict";
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict"), Module = require("node:module");
const { performance } = require("node:perf_hooks");
const currentFile = path.resolve(__dirname, "../../src/server/testing/arena-bot-brain.js");
const { BotBrain: Candidate } = require(currentFile);
const baselineFile = process.argv[2];
assert(baselineFile, "Pass the unchanged baseline module file");
const baseModule = new Module(currentFile, module);
baseModule.filename = currentFile; baseModule.paths = Module._nodeModulePaths(path.dirname(currentFile));
baseModule._compile(fs.readFileSync(baselineFile, "utf8"), currentFile);
const Baseline = baseModule.exports.BotBrain;
let seed = 271828;
const random = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32;
function make(kind) {
  const ether = Array.from({ length: kind === "empty" ? 0 : 3000 }, (_, id) => ({ id,
    x: kind === "clustered" ? 3800 + random() * 400 : random() * 8000,
    y: kind === "clustered" ? 3800 + random() * 400 : random() * 8000,
    value: 1 + Math.floor(random() * 100), sourceId: "world", sourcePickupAt: 0,
  }));
  const arena = { ether, world: { width: 8000, height: 8000 }, hasEffect: () => false };
  const clients = Array.from({ length: 30 }, (_, id) => ({
    p: { id: String(id) }, ctx: { body: { x: kind === "clustered" ? 4000 : random() * 8000,
      y: kind === "clustered" ? 4000 : random() * 8000, radius: 20 }, threats: [], prey: null, ally: null },
    state: { wander: { x: -1000, y: -1000, id: -1 }, nextWanderAt: Infinity },
  }));
  return { arena, clients };
}
const results = [];
for (const kind of ["sparse", "clustered", "empty"]) {
  const { arena, clients } = make(kind), base = new Baseline(arena), next = new Candidate(arena);
  for (const c of clients) assert.strictEqual(base.destination(c.p, c.ctx, c.state, 1000), next.destination(c.p, c.ctx, c.state, 1000));
  function run(brain, rounds) {
    let checksum = 0;
    const cpu = process.cpuUsage(), start = performance.now();
    for (let n = 0; n < rounds; n++) for (const c of clients) checksum += brain.destination(c.p, c.ctx, c.state, 1000).id;
    const ms = performance.now() - start, usage = process.cpuUsage(cpu);
    return { ms, cpuMs: (usage.user + usage.system) / 1000, checksum, decisions: rounds * clients.length };
  }
  run(base, 10); run(next, 10);
  const rows = [];
  for (const name of ["baseline", "candidate", "candidate", "baseline"]) rows.push({ name, ...run(name === "baseline" ? base : next, 100) });
  assert(rows.every(r => r.checksum === rows[0].checksum));
  results.push({ kind, food: arena.ether.length, rows });
}
console.log(JSON.stringify({ platform: process.platform, node: process.version,
  scope: "Bot food-target component only; no world-copy, whole-game CPU, latency or CCU claim", results }, null, 2));
