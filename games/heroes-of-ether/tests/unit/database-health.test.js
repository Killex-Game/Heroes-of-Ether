"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { syncHealth } = require("../../src/server/persistence/database-health");
const now = 1000000;
const status = { connected: true, checkedAt: now - 1000, syncedAt: now - 1000, revision: 10 };
test("database status checks last successful sync, not just connected flag", () => {
  assert.equal(syncHealth(status, now).state, "ok");
  assert.equal(syncHealth({ ...status, syncedAt: now - 90001 }, now).state, "stale");
  assert.equal(syncHealth({ ...status, checkedAt: now - 90001 }, now).state, "stale");
  assert.equal(syncHealth({ ...status, syncedAt: now + 1 }, now).state, "stale");
  assert.equal(syncHealth({ ...status, syncedAt: undefined }, now).state, "stale");
  assert.equal(syncHealth(null, now).state, "missing");
  assert.equal(syncHealth({ ...status, stopped: true }, now).state, "stopped");
});
test("database health does not leak secrets or driver errors", () => {
  const health = syncHealth(
    { ...status, lastError: "postgresql://secret", password: "hidden", writer: "private" },
    now,
  );
  assert.equal(health.state, "error");
  assert.equal(health.lastError, "DATABASE_OPERATION_FAILED");
  assert.doesNotMatch(JSON.stringify(health), /secret|hidden|private/);
});
