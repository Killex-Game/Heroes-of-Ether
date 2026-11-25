"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const { inventory } = require("../../scripts/testing/audit-world-copies.cjs");
test("production world commands always declare their affected profiles", () => {
  const audit = inventory();
  assert.deepEqual(audit.errors, []);
  const calls = audit.rows.filter(row => row.file.startsWith("src/server/") &&
    !row.file.includes("/testing/") && row.name === "transactWorld");
  assert(calls.length >= 3);
  // An omitted write set invokes the isolated whole-world fallback. New game
  // commands must explicitly name their writes and prove rollback/replay.
  assert.deepEqual(calls.filter(row => row.arguments < 5), []);
});
