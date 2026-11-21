"use strict";
const fs = require("node:fs"),
  path = require("node:path"),
  { randomInt } = require("node:crypto");
const { ProfileStore } = require("../../src/server/profiles/profile-store");
const { awardTitles } = require("../../src/server/progression/title-chest-rewards");
const { acquireServerLock } = require("../../src/server/runtime/process-lock");
const { portBusy } = require("./grant-coins");
const GRANT_ID = "owner-hall-heroes-20261107",
  OWNER_ID = "c39fe041-62a0-4047-87d1-2be4e8ee6562";
function grantHall(store, choose = randomInt, at = Date.now()) {
  const previous = store.data.testGrants?.[GRANT_ID];
  if (previous) return { replay: true, ...previous };
  const next = structuredClone(store.data),
    all = Object.values(next.profiles),
    owner = all.find((p) => p.id === OWNER_ID);
  if (!owner) throw Error("Owner profile missing");
  const candidates = all.filter((p) => p.id !== OWNER_ID && p.testBot && p.greatness < 2000000);
  if (candidates.length < 3) throw Error("Three existing test profiles required");
  const selected = [owner];
  for (let i = 0; i < 3; i++) selected.push(candidates.splice(choose(candidates.length), 1)[0]);
  const recipients = selected.map((p) => {
    const before = p.greatness;
    p.greatness = p.id === OWNER_ID ? 2500000 : 2000000;
    awardTitles(p, at);
    p.revision++;
    return { id: p.id, name: p.name, before, after: p.greatness };
  });
  const receipt = { issuedAt: at, count: 4, recipients };
  next.testGrants = { ...next.testGrants, [GRANT_ID]: receipt };
  store.save(next, at);
  return { replay: false, ...receipt };
}
async function main() {
  if (process.argv.length !== 3 || process.argv[2] !== "--apply")
    throw Error("Use --apply only after graceful shutdown");
  if (await portBusy(Number(process.env.PORT || 3000)))
    throw Error("Stop local game gracefully first");
  const root = path.resolve(__dirname, "../.."),
    release = acquireServerLock(path.join(root, "data/server.lock"));
  let store;
  try {
    store = new ProfileStore({
      filePath: path.join(root, "data/profiles.json"),
      promotionConfig: require("../../config/promotions.json"),
    });
    const backup = path.join(root, "data/backups/" + GRANT_ID + ".json");
    fs.mkdirSync(path.dirname(backup), { recursive: true });
    if (!fs.existsSync(backup)) fs.copyFileSync(store.filePath, backup, fs.constants.COPYFILE_EXCL);
    const result = grantHall(store);
    console.log(JSON.stringify(result, null, 2));
  } finally {
    await store?.close();
    release();
  }
}
if (require.main === module)
  main().catch((e) => {
    console.error(e.message);
    process.exitCode = 1;
  });
module.exports = { grantHall, GRANT_ID, OWNER_ID };
