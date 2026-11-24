"use strict";
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const { atomicSnapshot, difference, recover } = require("../../src/server/profiles/profile-journal");
const { pin } = require("../../src/server/profiles/profile-read-snapshot");
const { PinnedWorldReader } = require("../../src/server/persistence/pinned-world-reader");
const { SnapshotBuilder } = require("../../src/server/persistence/snapshot-builder");
const [mode, directory, output] = process.argv.slice(2);
assert(["prepare", "baseline", "cached"].includes(mode) && directory);
const dir = path.resolve(directory), base = path.join(dir, "profiles.json");
if (mode === "prepare") {
  assert(!fs.existsSync(dir), "Refusing to overwrite benchmark input"); fs.mkdirSync(dir, { recursive: true });
  let world = { version: 14, _journalRevision: 1, profiles: {}, clans: {}, residentRooms: {} };
  for (let i = 0; i < 1280; i++) world.profiles["p" + i] = { id: "p" + i,
    wallet: { coins: 100000, ether: 5000 }, progress: { session: { xp: 0 } },
    transactions: { entries: Array.from({ length: 500 }, (_, j) => ({
      id: "historical-" + i + "-" + j, at: 1700000000000 + j, kind: "fixture", label: "Синтетическая покупка",
      changes: { coins: -1, crystals: 0, ether: 0 }, source: "pinned-world-benchmark",
    })) } };
  for (let i = 0; i < 128; i++) world.clans["c" + i] = { id: "c" + i, treasury: 0 };
  atomicSnapshot(base, world, true); const files = [], revisions = [], hashes = [];
  for (let step = 1; step <= 10; step++) {
    let text = "";
    for (let action = 0; action < 30; action++) {
      const id = "p" + (step * 17 + action) % 60, p = world.profiles[id];
      const next = { ...world, _journalRevision: world._journalRevision + 1, profiles: { ...world.profiles,
        [id]: { ...p, wallet: { ...p.wallet, coins: p.wallet.coins - 1 },
          progress: { session: { xp: p.progress.session.xp + 5 } } } } };
      const body = JSON.stringify({ revision: next._journalRevision, change: difference(next, world) });
      text += createHash("sha256").update(body).digest("hex") + " " + body + "\n"; world = next;
    }
    const name = "profiles.json.wal-" + world._journalRevision;
    fs.writeFileSync(path.join(dir, name), text, { flag: "wx", mode: 0o600 });
    files.push(name); revisions.push(world._journalRevision);
    hashes.push(new SnapshotBuilder().pack(world).worldHash);
  }
  fs.writeFileSync(path.join(dir, "fixture.json"), JSON.stringify({ files, revisions, hashes,
    sourceBytes: fs.statSync(base).size, profiles: 1280, histories: 640000 }));
  console.log(JSON.stringify({ prepared: true, sourceBytes: fs.statSync(base).size }));
} else {
  assert(global.gc && output && !fs.existsSync(output), "Use --expose-gc and a new output path");
  const fixture = JSON.parse(fs.readFileSync(path.join(dir, "fixture.json"))), reader = new PinnedWorldReader();
  const builder = new SnapshotBuilder(), results = []; let saved = null, snapshot = null;
  for (let step = 0; step < fixture.files.length; step++) {
    saved = snapshot = null; global.gc();
    const p = pin(base, fixture.files.slice(0, step + 1).map(name => path.join(dir, name)), fixture.revisions[step]);
    try {
      const before = process.memoryUsage(), cpu = process.cpuUsage(), start = performance.now();
      saved = mode === "cached" ? reader.read(p) : recover(p.file, false);
      const readMs = performance.now() - start, packing = performance.now(); snapshot = builder.pack(saved.data);
      const packMs = performance.now() - packing, used = process.cpuUsage(cpu);
      assert.equal(snapshot.worldHash, fixture.hashes[step]);
      results.push({ step, readMs, packMs, totalMs: readMs + packMs, cpuMs: (used.user + used.system) / 1000,
        before, after: process.memoryUsage(), maxRSSKiB: process.resourceUsage().maxRSS,
        reader: mode === "cached" ? reader.stats : null, builder: builder.stats, revision: snapshot.revision,
        worldHash: snapshot.worldHash, digest: snapshot.digest });
      console.log(JSON.stringify({ mode, step, readMs, packMs, cpuMs: results.at(-1).cpuMs, maxRSSKiB: results.at(-1).maxRSSKiB }));
    } finally { p.release(); }
  }
  fs.writeFileSync(output, JSON.stringify({ mode, fixture: { sourceBytes: fixture.sourceBytes, histories: fixture.histories },
    scope: "Offline immutable checkpoint and WAL preparation; no network, physics or whole-game capacity", results }, null, 2), { flag: "wx" });
}
