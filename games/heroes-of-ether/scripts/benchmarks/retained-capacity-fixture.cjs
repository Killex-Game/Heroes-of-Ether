"use strict";
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const receipts = require("../../src/server/profiles/operation-receipts");
const sha = value => createHash("sha256").update(value).digest("hex");
function extend(fixture, { active = 95, activeReceipts = 15000, dormantReceipts = 2000,
  oversizedProfiles = 0, oversizedReceipts = 180000 } = {}) {
  const profiles = Object.values(fixture.data.profiles);
  assert(profiles.length === 1280 && profiles.every(p => p.testFixture === "database-capacity-20261110"));
  assert(Array.isArray(fixture.tokens) && fixture.tokens.length === 1280);
  assert([active, activeReceipts, dormantReceipts].every(Number.isSafeInteger));
  assert(active >= 1 && active <= 365 && activeReceipts >= 0 && activeReceipts <= 30000 && dormantReceipts >= 0 && dormantReceipts <= 10000);
  assert(Number.isSafeInteger(oversizedProfiles) && oversizedProfiles >= 0 && oversizedProfiles <= Math.min(active, 2));
  assert(Number.isSafeInteger(oversizedReceipts) && oversizedReceipts >= activeReceipts && oversizedReceipts <= 200000);
  fixture.data.version = Math.max(14, fixture.data.version);
  let total = 0;
  for (const [i, token] of fixture.tokens.entries()) {
    const profile = fixture.data.profiles[sha(token)]; assert(profile);
    const buckets = { ...profile.arenaReceipts };
    const count = i < oversizedProfiles ? oversizedReceipts : i < active ? activeReceipts : dormantReceipts;
    for (let n = 0; n < count; n++) {
      const id = "retained-fixture-" + String(n).padStart(8, "0"), key = receipts.bucketFor(id);
      if (!Object.hasOwn(buckets, key)) buckets[key] = {};
      assert(!Object.hasOwn(buckets[key], id));
      buckets[key][id] = "synthetic-completed-cast";
    }
    profile.arenaReceipts = buckets; receipts.validate(profile, fixture.data.version); total += count;
  }
  fixture.summary.retainedHistory = { active, activeReceipts, dormantReceipts, total };
  if (oversizedProfiles) fixture.summary.retainedHistory.oversized = { profiles: oversizedProfiles, receipts: oversizedReceipts,
    minimumProfileBytes: Math.min(...fixture.tokens.slice(0, oversizedProfiles).map(token => Buffer.byteLength(JSON.stringify(fixture.data.profiles[sha(token)])))) };
  return fixture;
}
function verify(before, after) {
  assert(before.summary?.retainedHistory, "Retained fixture proof missing");
  let total = 0, profiles = 0;
  for (const [key, source] of Object.entries(before.data.profiles)) {
    const target = after.profiles[key]; assert(target, "Historical profile missing");
    for (const entries of Object.values(source.arenaReceipts || {})) for (const [id, signature] of Object.entries(entries)) {
      assert.equal(receipts.read(target, id), signature, "Retained historical receipt changed or missing");
      if (id.startsWith("retained-fixture-")) total++;
    }
    profiles++;
  }
  assert.equal(total, before.summary.retainedHistory.total);
  return { matched: true, profiles, historicalReceipts: total };
}
if (require.main === module) {
  const [source, destination] = process.argv.slice(2);
  assert(source && destination && path.resolve(source) !== path.resolve(destination));
  assert(!fs.existsSync(destination), "Refusing to overwrite fixture");
  const fixture = extend(JSON.parse(fs.readFileSync(source)));
  fs.writeFileSync(destination, JSON.stringify(fixture), { flag: "wx", mode: 0o600 });
  console.log(JSON.stringify({ bytes: fs.statSync(destination).size, history: fixture.summary.retainedHistory,
    sha256: sha(fs.readFileSync(destination)) }));
}
module.exports = { extend, verify };
