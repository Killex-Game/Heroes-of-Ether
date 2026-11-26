"use strict";
const test = require("node:test"),
  assert = require("node:assert/strict");
const { ProfileStore } = require("../../src/server/profiles/profile-store");

test("public mini-profile exposes only an active ban deadline", () => {
  let now = Date.UTC(2026, 10, 26, 10);
  const store = new ProfileStore({ now: () => now }),
    user = store.open();
  const p = store.find(user.token);
  assert.equal(store.publicPlayer(p.id).ban, null);
  const until = now + 1000;
  p.moderation = {
    ban: {
      at: now,
      until,
      by: "private-moderator",
      reason: "private reason",
      id: "private-ban-id",
    },
  };
  assert.deepEqual(store.publicPlayer(p.id).ban, { until });
  assert.equal(store.publicPlayer(p.id).moderation, undefined);
  assert(!JSON.stringify(store.publicPlayer(p.id)).includes("private-"));
  assert.equal(store.identity(p).ban, undefined, "Do not add moderation to every arena identity");
  now = until;
  assert.equal(store.publicPlayer(p.id).ban, null);
  assert.equal(p.moderation.ban.until, until, "Reading the profile never rewrites the ban");
  p.moderation.ban.until = null;
  assert.deepEqual(store.publicPlayer(p.id).ban, { until: null });
  p.moderation.ban = null;
  assert.equal(store.publicPlayer(p.id).ban, null);
});
