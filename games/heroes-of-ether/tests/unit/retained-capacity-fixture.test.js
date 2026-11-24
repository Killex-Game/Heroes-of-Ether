"use strict";
const test = require("node:test"), assert = require("node:assert/strict"), { createHash } = require("node:crypto");
const { extend, verify } = require("../../scripts/benchmarks/retained-capacity-fixture.cjs");
test("retained-history fixture preserves source balances and audit rejects one missing historical operation", () => {
  const f = { data: { version: 14, profiles: {} }, tokens: [], summary: {} };
  for (let i = 0; i < 1280; i++) {
    const token = "token" + i, key = createHash("sha256").update(token).digest("hex"); f.tokens.push(token);
    f.data.profiles[key] = { testFixture: "database-capacity-20261110", receipts: {}, wallet: { coins: i } };
  }
  extend(f, { active: 95, activeReceipts: 3, dormantReceipts: 1 });
  const copy = structuredClone(f.data), proof = verify(f, copy);
  assert.equal(proof.historicalReceipts, 1470);
  assert(Object.values(copy.profiles).every((p, i) => p.wallet.coins === i));
  const p = Object.values(copy.profiles)[0], bucket = Object.values(p.arenaReceipts)[0];
  delete bucket[Object.keys(bucket)[0]];
  assert.throws(() => verify(f, copy), /changed or missing/);
});
