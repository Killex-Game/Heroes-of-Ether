"use strict";
// Recover only the synthetic benchmark's private WAL and verify observed ACKs.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const {createHash} = require("node:crypto");
const { recover } = require("../../src/server/profiles/profile-journal");
const receipts = require("../../src/server/profiles/operation-receipts");
const history = require("../../src/server/profiles/transaction-history");
function audit(directory) {
  const output = path.resolve(directory);
  const runs = fs.readdirSync(output).filter(n => /^(local|mongo)-\d+-\d+$/.test(n));
  let summary, resident;
  if (!runs.length && fs.existsSync(path.join(output, "report.json"))) {
    resident = JSON.parse(fs.readFileSync(path.join(output, "report.json")));
    assert(resident.scope.startsWith("isolated resident simulation"), "Unknown report");
    assert.equal(resident.aborted, false); assert.equal(resident.pending, 0);
    assert.equal(resident.writer.errors, 0); assert.equal(resident.casts.failures, 0);
    summary = { code: 0, evidence: output, mixedSocial: resident.scenario.mixedSocial };
  } else {
    assert.equal(runs.length, 1, "Select an output containing exactly one load run");
    summary = JSON.parse(fs.readFileSync(path.join(output, runs[0], "summary.json")));
    assert.equal(summary.code, 0, "The load process did not close normally");
  }
  const world = recover(path.join(summary.evidence, "data/profiles.json")).data;
  const chat = recover(path.join(summary.evidence, "data/clan-chat.json")).data;
  const profiles = Object.values(world.profiles);
  assert(profiles.length > 0 && profiles.every(p => p.testFixture === "mongo-capacity-20261110"), "Synthetic world marker missing");
  const byId = new Map(profiles.map(p => [p.id, p]));
  const seen = new Set(), types = {}, giftCounts = new Map();
  let acknowledged = 0, gifts = 0, notices = 0;
  for (const file of fs.readdirSync(path.join(output, "acks"))) {
    if (!file.endsWith(".ndjson")) continue;
    for (const line of fs.readFileSync(path.join(output, "acks", file), "utf8").split("\n").filter(Boolean)) {
      const ack = JSON.parse(line), p = world.profiles[ack.key];
      assert(p, "ACK owner missing"); assert(!seen.has(ack.id), "Duplicate successful ACK"); seen.add(ack.id);
      if (ack.type === "lobby:chat") {
        const key = createHash("sha256").update(JSON.stringify([p.id,ack.id])).digest("hex");
        assert(chat.messageReceipts?.[key], "Chat ACK absent from recovered chat WAL");
      } else assert.notEqual(receipts.read(p, ack.id), receipts.MISSING, "ACK absent from recovered WAL");
      types[ack.type] = (types[ack.type] || 0) + 1;
      if (ack.type === "lobby:gift") {
        assert.equal(ack.giftId, "chocolates", "Unexpected test gift");
        const target = byId.get(ack.targetId), gift = target?.social?.gifts.find(g => g.id === ack.giftId);
        assert(gift, "Acknowledged gift missing from recipient");
        const entries = p.transactions.entries.filter(e => e.requestId === ack.id);
        assert.equal(entries.length, 1, "Gift must debit exactly once");
        assert.equal(entries[0].after.coins - entries[0].before.coins, -250, "Incorrect gift charge");
        const key = ack.targetId + ":" + p.id;
        const count = (giftCounts.get(key) || 0) + 1; giftCounts.set(key, count);
        assert(gift.history.filter(h => h.fromId === p.id).length >= count, "Acknowledged gift history lost");
        gifts++;
      } else if (ack.type === "lobby:gift-read") {
        const notice = p.social.gifts.flatMap(g => g.history).find(h => h.id === ack.noticeId);
        assert(notice?.readAt > 0, "Acknowledged read status lost"); notices++;
      }
      acknowledged++;
    }
  }
  for (const p of profiles) {
    receipts.validate(p, world.version); history.validate(p);
    assert(Object.values(p.inventory).every(n => Number.isSafeInteger(n) && n >= 0), "Invalid inventory");
  }
  assert(acknowledged > 100, "Insufficient successful action coverage");
  if (summary.mixedSocial) assert(gifts > 0 && notices > 0, "Mixed social acknowledgments missing");
  let applied;
  if (resident) {
    const appliedIds = new Set();
    for (const name of fs.readdirSync(path.join(output, "applied"))) {
      for (const line of fs.readFileSync(path.join(output, "applied", name), "utf8").split("\n").filter(Boolean)) {
        const row = JSON.parse(line), p = byId.get(row.profileId);
        assert(p && seen.has(row.requestId), "Effect without observed durable ACK");
        assert(!appliedIds.has(row.requestId), "Effect applied twice");
        assert.notEqual(receipts.read(p, row.requestId), receipts.MISSING, "Applied effect absent from WAL");
        appliedIds.add(row.requestId);
      }
    }
    applied = appliedIds.size;
    assert.equal(applied, resident.casts.completed, "Committed cast missing its effect");
    assert.equal(applied, Object.entries(types).reduce((n,[type,count])=>n+(type.startsWith("booster:")?count:0),0));
  }
  const report = { acknowledged, recovered: acknowledged, duplicates: 0, profiles: profiles.length,
    types, gifts, notices, ...(resident ? { appliedEffects: applied } : {}), validInventoriesAndTransactions: true };
  fs.writeFileSync(path.join(output, "ack-audit.json"), JSON.stringify(report, null, 2) + "\n");
  return report;
}
if (require.main === module) {
  if (!process.argv[2]) throw Error("Usage: node scripts/benchmarks/audit-capacity.cjs OUTPUT_DIRECTORY");
  console.log(JSON.stringify(audit(process.argv[2])));
}
module.exports = { audit };
