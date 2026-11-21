/* Restore reviewed static art only; default is a read-only preview. */
"use strict";
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
const assert = require("node:assert/strict");
const args = process.argv.slice(2);
function option(name) {
  const i = args.indexOf(name);
  if (i < 0 || !args[i + 1] || args[i + 1].startsWith("--")) throw Error("Required: " + name);
  return args[i + 1];
}
function group(file) {
  if (file === "public/shared/player-identity.js" || file.startsWith("public/assets/skins/") ||
      /^public\/assets\/interface-packs\/[^/]+\/avatars\//.test(file)) return "portraits";
  if (file === "public/shared/league-appearance.js" ||
      /^public\/assets\/(league-frames|title-frames)\//.test(file) ||
      /^public\/assets\/interface-packs\/[^/]+\/frame\.webp$/.test(file)) return "frames";
  return null;
}
function inside(root, file) {
  assert(file.startsWith("public/") && !file.includes("..") && !file.includes("\\"), "Invalid static path");
  const result = path.resolve(root, file);
  assert(result.startsWith(root + path.sep), "Path outside root");
  assert(fs.realpathSync(result).startsWith(root + path.sep), "Symlink outside root");
  assert(fs.lstatSync(result).isFile(), "Expected a regular file");
  return result;
}
const sha = file => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
try {
  const root = fs.realpathSync(option("--game-root")), backup = fs.realpathSync(option("--backup"));
  assert.notEqual(root, backup, "Backup must be separate from the game");
  const manifest = JSON.parse(fs.readFileSync(option("--manifest"), "utf8")), select = option("--select");
  assert(Array.isArray(manifest) && manifest.length > 0);
  for (const row of manifest) assert(/^[a-f0-9]{64}$/.test(row.before) && /^[a-f0-9]{64}$/.test(row.after));
  const matched = manifest.filter(r => select === "all" || r.path === select || (select.endsWith("/") && r.path.startsWith(select)));
  assert(matched.length, "No matching files");
  // A portrait/frame must be restored together with its coupled placement values.
  const groups = new Set(matched.map(r => group(r.path)).filter(Boolean)), selected = new Set(matched.map(r => r.path));
  const rows = manifest.filter(r => selected.has(r.path) || (group(r.path) && groups.has(group(r.path))));
  const pending = [];
  for (const row of rows) {
    const src = inside(backup, row.path), dest = inside(root, row.path);
    assert.equal(sha(src), row.before, "Damaged backup: " + row.path);
    const current = sha(dest);
    assert(current === row.after || current === row.before, "File changed since this release: " + row.path);
    if (current !== row.before) pending.push({ ...row, src, dest });
  }
  const apply = args.includes("--apply");
  if (apply) for (const row of pending) {
    assert.equal(sha(row.dest), row.after, "Concurrent change: " + row.path);
    const temp = row.dest + ".restore-" + process.pid;
    fs.copyFileSync(row.src, temp, fs.constants.COPYFILE_EXCL);
    fs.chmodSync(temp, 0o644);
    const fd = fs.openSync(temp, "r+");
    try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    assert.equal(sha(temp), row.before);
    fs.renameSync(temp, row.dest);
    assert.equal(sha(row.dest), row.before);
  }
  console.log(JSON.stringify({ mode: apply ? "restored" : "preview", selected: rows.length,
    changed: pending.length, coupledGroups: [...groups], unchanged: rows.length - pending.length }));
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
