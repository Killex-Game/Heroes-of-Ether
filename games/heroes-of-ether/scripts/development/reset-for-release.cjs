"use strict";
// Explicit, offline owner operation. Never imported by the game server.
const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");
const { ProfileStore } = require("../../src/server/profiles/profile-store");
const journal = require("../../src/server/profiles/profile-journal");
const nicknames = require("../../src/server/profiles/nickname-rules");
const OWNER_ID = "c39fe041-62a0-4047-87d1-2be4e8ee6562";

function preservedOwner(profile) {
  const copy = structuredClone(profile);
  copy.clanId = null;
  // Both parties must agree on marriage; the other profile is now fresh.
  if (copy.social) {
    copy.social.marriage = null;
    copy.social.invitations = [];
  }
  copy.revision++;
  return copy;
}

function resetWorld(source, at) {
  const entries = Object.entries(source.profiles);
  const owners = entries.filter(([, p]) => p.id === OWNER_ID);
  assert.equal(owners.length, 1, "Exactly one Killex profile is required");
  assert.ok(!owners[0][1].progress.session, "Finish Killex's life before reset");
  const [ownerKey, originalOwner] = owners[0];
  const profiles = { [ownerKey]: preservedOwner(originalOwner) };
  const templateStore = new ProfileStore({ now: () => at });
  const auth = templateStore.open();
  const template = templateStore.find(auth.token);
  assert.deepEqual(template.wallet, { coins: 100, crystals: 10, bucks: 0 });
  let reset = 0,
    removedBots = 0;
  for (const [key, previous] of entries) {
    if (key === ownerKey) continue;
    if (previous.testBot) {
      removedBots++;
      continue;
    }
    const fresh = structuredClone(template);
    fresh.id = previous.id;
    fresh.name = nicknames.available(Object.values(profiles));
    fresh.revision = previous.revision + 1;
    // Account IDs and authentication hashes stay usable. Security restrictions
    // are not game progress and must not be bypassed by this reset.
    if (previous.moderation) fresh.moderation = structuredClone(previous.moderation);
    profiles[key] = fresh;
    reset++;
  }
  const next = {
    version: source.version,
    profiles,
    clans: {},
    _journalRevision: (source._journalRevision || 0) + 1,
  };
  // Retain settlement watermarks and only the owner's historical prizes to
  // prevent paying old event results again after reset.
  for (const key of [
    "dailyPrizes",
    "eventRankingStartedAt",
    "eventDailyRankingStartedAt",
    "luckyRankingStartedAt",
    "luckyDailyRankingStartedAt",
    "testGrants",
  ])
    if (source[key] !== undefined) next[key] = structuredClone(source[key]);
  for (const key of ["eventRankingResults", "eventDailyRankingResults"]) {
    if (!source[key]) continue;
    next[key] = Object.fromEntries(
      Object.entries(source[key]).map(([id, result]) => [
        id,
        { ...structuredClone(result), entries: result.entries.filter((p) => p.id === OWNER_ID) },
      ]),
    );
  }
  assert.deepEqual(next.profiles[ownerKey], preservedOwner(originalOwner));
  return {
    data: next,
    report: {
      resetProfiles: reset,
      removedBots,
      dissolvedClans: Object.keys(source.clans).length,
      retainedProfiles: Object.keys(profiles).length,
      startingWallet: template.wallet,
      killexPersonalProgressPreserved: true,
    },
  };
}

function offline(gameRoot) {
  const lock = path.join(gameRoot, "data/server.lock");
  if (!fs.existsSync(lock)) return;
  const pid = Number(fs.readFileSync(lock, "utf8"));
  assert.ok(Number.isInteger(pid) && pid > 0, "Invalid server lock");
  try {
    process.kill(pid, 0);
  } catch (error) {
    if (error.code === "ESRCH") return;
    throw error;
  }
  throw Error("Server is still running; offline reset refused");
}

function run({ gameRoot, backupRoot, apply = false, at = Date.now() }) {
  if (apply) offline(gameRoot);
  const sourceFile = path.join(gameRoot, "data/profiles.json");
  const recovered = journal.recover(sourceFile);
  const result = resetWorld(recovered.data, at);
  if (!apply) return result.report;
  assert.ok(backupRoot && fs.existsSync(backupRoot), "A verified backup directory is required");
  const backup = journal.recover(path.join(backupRoot, "data/profiles.json"));
  assert.deepEqual(backup.data, recovered.data, "Backup must match the complete recovered save");
  const marker = path.join(backupRoot, "reset-applied.json");
  assert.ok(!fs.existsSync(marker), "This reset was already applied");
  const stageFile = path.join(backupRoot, "candidate-profiles.json");
  journal.atomicSnapshot(stageFile, result.data);
  const verified = new ProfileStore({ filePath: stageFile, now: () => at });
  assert.equal(Object.keys(verified.data.clans).length, 0);
  for (const p of Object.values(verified.data.profiles)) {
    if (p.id === OWNER_ID) continue;
    assert.equal(p.level, 1);
    assert.equal(p.greatness, 0);
    assert.deepEqual(p.wallet, { coins: 100, crystals: 10, bucks: 0 });
    assert.deepEqual(p.inventory, {});
    assert.equal(p.personal.nameSet, false);
  }
  const checkedOwner = Object.values(verified.data.profiles).find((p) => p.id === OWNER_ID);
  const owner = Object.values(result.data.profiles).find((p) => p.id === OWNER_ID);
  // Loading is allowed to normalize eligibility, but must not change property
  // ownership, reward history, levels, wallet, experience or subscriptions.
  for (const key of [
    "wallet",
    "inventory",
    "name",
    "level",
    "greatness",
    "progress",
    "honors",
    "pets",
    "account",
    "roulette",
    "regalia",
    "seasonTrophies",
    "blackFriday",
    "purchasedAccessories",
  ])
    assert.deepEqual(checkedOwner[key], owner[key], "Owner changed on recovery: " + key);
  offline(gameRoot);
  assert.deepEqual(
    journal.recover(sourceFile).data,
    recovered.data,
    "Save changed during preparation",
  );
  // Disable automatic test seeding before publishing the clean save.
  for (const [name, patch] of [
    ["test-bots.json", { enabled: false, maxActive: 0, boostersEnabled: false }],
    ["promotions.json", { preview: false }],
  ]) {
    const file = path.join(gameRoot, "config", name);
    journal.atomicSnapshot(file, { ...JSON.parse(fs.readFileSync(file, "utf8")), ...patch });
  }
  journal.atomicSnapshot(sourceFile, result.data);
  // Old WAL records have lower revisions, so recovery cannot resurrect them.
  assert.deepEqual(journal.recover(sourceFile).data, result.data);
  fs.writeFileSync(sourceFile + ".wal", "", { mode: 0o600 });
  const chat = { version: 1, clans: {}, achievementCounts: {}, messageReceipts: {} };
  journal.atomicSnapshot(path.join(gameRoot, "data/clan-chat.json"), chat);
  fs.writeFileSync(marker, JSON.stringify({ at, ...result.report }, null, 2));
  return result.report;
}
if (require.main === module) {
  const gameRoot = path.resolve(__dirname, "../..");
  console.log(
    JSON.stringify(
      run({
        gameRoot,
        apply: process.argv.includes("--apply"),
        backupRoot: process.argv[process.argv.indexOf("--backup") + 1],
      }),
      null,
      2,
    ),
  );
}
module.exports = { resetWorld, preservedOwner, run, OWNER_ID };
