"use strict";
// Trusted local baseline sources only. No game server, profile data or DB needed.
const fs = require("node:fs"), path = require("node:path"), Module = require("node:module");
const assert = require("node:assert/strict");
const source = path.resolve(__dirname, "../../src/server/events");
const baseline = process.env.EVENT_BASELINE_DIR;
if (!baseline) throw Error("Set EVENT_BASELINE_DIR to the five saved event source files");
const names = ["event-manager", "event-activities", "black-friday", "easter-hunt", "lucky-week"];
const cache = new Map();
function previous(name) {
  if (cache.has(name)) return cache.get(name).exports;
  const filename = path.join(source, name + ".js"), m = new Module(filename, module);
  m.filename = filename; m.paths = Module._nodeModulePaths(source); cache.set(name, m);
  const original = m.require.bind(m);
  m.require = id => id.startsWith("./") && names.includes(id.slice(2)) ? previous(id.slice(2)) : original(id);
  m._compile(fs.readFileSync(path.join(baseline, name + ".js"), "utf8"), filename);
  return m.exports;
}
const modules = [
  { Manager: previous("event-manager").EventManager, readers: [previous("black-friday"), previous("easter-hunt"), previous("lucky-week")] },
  { Manager: require(path.join(source, "event-manager")).EventManager,
    readers: ["black-friday", "easter-hunt", "lucky-week"].map(n => require(path.join(source, n))) },
];
const start = Date.UTC(2026, 10, 12), results = [];
function fixture(variant, length, active) {
  const m = new modules[variant].Manager();
  m.data.runs = Array.from({ length }, (_, i) => ({ id: "run-" + i,
    manifest: modules[variant].readers[i % 3].manifest,
    startsAt: start + i * 120000, endsAt: start + i * 120000 + 60000, stoppedAt: null }));
  return { m, at: start + (length - 1) * 120000 + (active ? 1000 : 61000) };
}
function read(variant, f, at) {
  let value = f.m.active(at) ? 1 : 0;
  value += f.m.scheduled(at) ? 1 : 0;
  value += f.m.rouletteConfig({}, at).events.length;
  value += f.m.stamp(at).length;
  for (const reader of modules[variant].readers) value += reader.runAt(f.m, at) ? 1 : 0;
  return value;
}
for (const length of [1, 100, 2000]) for (const active of [false, true]) {
  const fixtures = [0, 1].map(v => fixture(v, length, active));
  for (const offset of [-120001, -60001, -1001, -1, 0, 1, 59999, 60000, 120000, -240000]) {
    const at = fixtures[0].at + offset;
    assert.equal(read(0, fixtures[0], at), read(1, fixtures[1], at));
    assert.deepEqual(fixtures[1].m.publicView(at), fixtures[0].m.publicView(at));
    for (let r = 0; r < 3; r++) assert.deepEqual(modules[1].readers[r].runAt(fixtures[1].m, at),
      modules[0].readers[r].runAt(fixtures[0].m, at));
  }
  const measurements = [];
  for (const variant of [0, 1, 1, 0]) {
    const f = fixtures[variant];
    for (let i = 0; i < 300; i++) read(variant, f, f.at);
    const t = performance.now(); let sum = 0;
    for (let i = 0; i < 20000; i++) sum += read(variant, f, f.at + i % 500);
    measurements.push({ variant: variant ? "candidate" : "baseline", ms: performance.now() - t, sum });
  }
  assert.ok(measurements.every(m => m.sum === measurements[0].sum));
  results.push({ history: length, active, iterations: 20000, measurements });
}
console.log(JSON.stringify({ exact: true, scope: "Event availability/history lookup only; not room capacity or client FPS", results }, null, 2));
