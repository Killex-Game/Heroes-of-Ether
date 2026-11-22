"use strict";
// Maintenance only: verify retained snapshots + WAL before calling the guarded remover.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict"),
  crypto = require("node:crypto"), { spawnSync } = require("node:child_process");
const root = path.resolve(__dirname, "../.."), storage = path.join(root, "backups");
const policy = JSON.parse(fs.readFileSync(path.join(root, "operations/backup-retention.json"), "utf8"));
assert.equal(policy.version, 1);
assert.ok(Number.isSafeInteger(policy.keepLatest) && policy.keepLatest >= 3);
assert.ok(policy.pinned && !Array.isArray(policy.pinned));
assert.ok(process.argv.slice(2).every(a => a === "--apply"), "Only --apply is supported");
const guarded = file => {
  const relative = path.relative(root, file);
  assert.ok(relative && !relative.startsWith("..") && !path.isAbsolute(relative), "Outside workspace");
  for (let current = file; current !== root; current = path.dirname(current))
    assert.ok(!fs.lstatSync(current).isSymbolicLink(), "Link rejected: " + current);
  return file;
};
guarded(storage);
const entries = fs.readdirSync(storage).map(name => {
  const file = guarded(path.join(storage, name)), stat = fs.statSync(file);
  assert.ok(stat.isDirectory(), "Unexpected file in backup storage: " + name);
  assert.ok(fs.existsSync(path.join(file, "data/profiles.json")) || policy.legacyBundles.includes(name), "Unknown backup layout: " + name);
  return { name, file, mtime: stat.mtimeMs };
}).sort((a, b) => b.mtime - a.mtime || a.name.localeCompare(b.name));
for (const [name, reason] of Object.entries(policy.pinned)) {
  assert.ok(entries.some(e => e.name === name), "Missing pinned backup: " + name);
  assert.ok(typeof reason === "string" && reason.trim().length >= 10, "Pinned backup needs a reason");
}
const latest = new Set(entries.filter(e => !Object.hasOwn(policy.pinned, e.name)).slice(0, policy.keepLatest).map(e => e.name));
assert.equal(latest.size, policy.keepLatest, "Fewer than three unpinned backups; no deletion");
const game = path.join(root, "games/heroes-of-ether"), { readLocal } = require(path.join(game, "src/server/persistence/state-snapshot")),
  { ProfileStore } = require(path.join(game, "src/server/profiles/profile-store"));
function manifest(directory, output = []) {
  for (const name of fs.readdirSync(directory)) {
    const file = guarded(path.join(directory, name)), stat = fs.statSync(file);
    if (stat.isDirectory()) manifest(file, output);
    else { assert.ok(stat.isFile()); output.push({ path: path.relative(root, file).replaceAll("\\", "/"), bytes: stat.size,
      sha256: crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex") }); }
  }
  return output;
}
const verification = [];
const decisions = entries.map(entry => {
  const keep = latest.has(entry.name) || Object.hasOwn(policy.pinned, entry.name);
  if (keep) {
    const files = manifest(entry.file), data = path.join(entry.file, "data"), recovered = readLocal(data, true);
    const loaded = new ProfileStore({ filePath: path.join(data, "profiles.json"), now: () => Math.floor(entry.mtime) });
    assert.deepEqual(Object.keys(loaded.data.profiles).sort(), Object.keys(recovered.world.profiles).sort());
    assert.deepEqual(Object.keys(loaded.data.clans).sort(), Object.keys(recovered.world.clans).sort());
    assert.deepEqual(manifest(entry.file), files, "Backup changed during validation");
    verification.push({ path: "backups/" + entry.name, profiles: Object.keys(recovered.world.profiles).length,
      clans: Object.keys(recovered.world.clans).length, revision: recovered.snapshot.revision, digest: recovered.snapshot.digest, files });
  }
  return { root: "backups", path: "backups/" + entry.name, action: keep ? "keep" : "delete",
    reason: policy.pinned[entry.name] || (keep ? "Три свежих комплекта" : "Старше трёх свежих, не закреплён"), absolutePath: entry.file };
});
const reportDir = path.join(root, "artifacts", "backup-retention-" + new Date().toISOString().replace(/[:.]/g, "-"));
fs.mkdirSync(reportDir, { recursive: true });
fs.writeFileSync(path.join(reportDir, "verification.json"), JSON.stringify(verification, null, 2));
const plan = path.join(reportDir, "plan.json");
fs.writeFileSync(plan, JSON.stringify({ createdAt: new Date().toISOString(), policy, decisions }, null, 2));
console.log(JSON.stringify({ keep: decisions.filter(e => e.action === "keep").map(e => e.path), delete: decisions.filter(e => e.action === "delete").map(e => e.path), reportDir }, null, 2));
const args = ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", path.join(__dirname, "apply-storage-retention.ps1"), "-Plan", plan];
if (process.argv.includes("--apply")) args.push("-Apply");
const result = spawnSync("powershell.exe", args, { cwd: root, stdio: "inherit", windowsHide: true });
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
if (result.status === 0 && process.argv.includes("--apply")) {
  assert.deepEqual(fs.readdirSync(storage).sort(), decisions.filter(e => e.action === "keep").map(e => path.basename(e.path)).sort());
  fs.writeFileSync(path.join(reportDir, "post-check.json"), JSON.stringify({ matched: true, retained: fs.readdirSync(storage) }, null, 2));
}
