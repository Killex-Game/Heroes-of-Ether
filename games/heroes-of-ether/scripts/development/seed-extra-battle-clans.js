"use strict";
const fs = require("node:fs"),
  path = require("node:path"),
  assert = require("node:assert/strict");
const { ProfileStore } = require("../../src/server/profiles/profile-store");
const { isDeepStrictEqual } = require("node:util");
const { prepareExtraBattleClans } = require("../../src/server/testing/extra-battle-clans");
const args = process.argv.slice(2),
  apply = args.includes("--apply");
const option = args.indexOf("--profiles");
const filePath = path.resolve(
  option >= 0 ? args[option + 1] : path.join(__dirname, "../../data/profiles.json"),
);
const lockPath = path.join(path.dirname(filePath), "server.lock");
if (apply && fs.existsSync(lockPath))
  throw Error("Остановите игровой сервер штатно перед изменением профилей.");
const original = fs.readFileSync(filePath),
  at = Date.now();
const store = new ProfileStore({ filePath, now: () => at });
const prepared = prepareExtraBattleClans(store.data, at);
const originalData = JSON.parse(original);
for (const table of ["profiles", "clans"])
  for (const [key, entry] of Object.entries(originalData[table]))
    if (!isDeepStrictEqual(prepared.data[table][key], entry))
      throw Error(
        "Существующие данные требуют отдельного обновления; тестовые кланы не добавлены.",
      );
if (apply && (prepared.summary.addedClans || prepared.summary.addedGroups)) {
  const backupDir = path.join(path.dirname(filePath), "backups", "extra-battle-clans-" + at);
  fs.mkdirSync(backupDir, { recursive: true });
  const backup = path.join(backupDir, "profiles.json");
  fs.writeFileSync(backup, original, { flag: "wx", mode: 0o600 });
  assert.ok(fs.readFileSync(backup).equals(original), "Backup mismatch");
  const pending = filePath + ".extra-clans.tmp";
  fs.writeFileSync(pending, JSON.stringify(prepared.data) + "\n", { flag: "wx", mode: 0o600 });
  try {
    new ProfileStore({ filePath: pending, now: () => at });
    assert.ok(fs.readFileSync(filePath).equals(original), "Profiles changed concurrently");
    if (fs.existsSync(lockPath)) throw Error("Сервер был запущен во время подготовки.");
    fs.renameSync(pending, filePath);
  } finally {
    if (fs.existsSync(pending)) fs.unlinkSync(pending);
  }
}
console.log(JSON.stringify({ applied: apply, ...prepared.summary }, null, 2));
