"use strict";
const test = require("node:test"), assert = require("node:assert/strict"), path = require("node:path");
const { ProfileStore } = require("../../src/server/profiles/profile-store");
const { isEmptyRegistration } = require("../../src/server/profiles/empty-registration");
const { RegistrationCleanup, IDLE_MS } = require("../../src/server/runtime/registration-cleanup");
const { recover } = require("../../src/server/profiles/profile-journal");
const { temporary } = require("../temp");
function fixture(options = {}) {
  let at = Date.UTC(2026, 10, 17, 8);
  const profiles = new ProfileStore({ now: () => at, ...options });
  const a = profiles.open(), b = profiles.open();
  const cleanup = new RegistrationCleanup({ profiles, now: () => at, protectedPlayer: id => id === b.profile.id });
  return { profiles, a, b, cleanup, advance: ms => at += ms };
}
test("Empty registration expires after five idle minutes, touches and online sessions protect it", async () => {
  const f = fixture(), original = f.profiles.data;
  try {
    assert(isEmptyRegistration(f.profiles.find(f.a.token)));
    f.advance(IDLE_MS - 1); assert.deepEqual(f.cleanup.run(), []);
    f.cleanup.touch(f.a.profile.id); f.advance(1); assert.deepEqual(f.cleanup.run(), []);
    f.advance(IDLE_MS); f.profiles.isOnline = () => true; assert.deepEqual(f.cleanup.run(), []);
    f.profiles.isOnline = () => false;
    assert.deepEqual(f.cleanup.run(), [f.a.profile.id]);
    assert.equal(f.profiles.byId(f.a.profile.id), undefined);
    assert(f.profiles.byId(f.b.profile.id));
    assert.equal(Object.keys(original.profiles).length, 2);
    assert.equal(f.profiles.data.administration.audit.length, 1);
    assert.deepEqual(f.cleanup.run(), []);
  } finally { await f.profiles.close(); }
});
test("Every nonempty or unknown branch protects an unconfirmed nickname", async () => {
  const f = fixture();
  try {
    const base = f.profiles.find(f.a.token);
    const changes = [
      p => p.personal.nameSet = true, p => p.personal.firstNameSetAt = 1,
      p => p.clanQuestAchievements.lastDay = '2026-11-17',
      p => p.clanQuestAchievements.types.push('food'), p => p.clanQuestAchievements.unknown = true,
      p => p.personal.introPending = false, p => p.level = 2, p => p.greatness = 1,
      p => p.progress.xp = 1, p => p.progress.lastLife = {}, p => p.progress.session = {},
      p => p.inventory.freeze = 1, p => p.receipts.oldPurchase = {},
      p => p.wallet.coins = 101, p => p.transactions.entries.push({ kind: "payment" }),
      p => p.social = { gifts: [{ count: 1 }] }, p => p.gameGiftNotices = [],
      p => p.account = { vipUntil: 1 }, p => p.clanId = "clan",
      p => p.quests.items[0].progress = 1, p => p.quests.items[0].claimedAt = 1,
      p => p.quests.rulesVersion = 2, p => p.quests.rulesVersion = null,
      p => p.activity.values.sociable = 1, p => p.activity.values.fan = 1,
      p => p.activity.claimed.regular = 1, p => p.pets.food = 1,
      p => p.roulette.spent = 1, p => p.moderation = { ban: null },
      p => p.chatModeration = {}, p => p.testBot = true,
      p => p.futureFeature = { earned: 1 }, p => p.activity.futureCounter = 0,
    ];
    for (const change of changes) { const p = structuredClone(base); change(p); assert.equal(isEmptyRegistration(p), false, change.toString()); }
    f.profiles.data.gameGrants = { campaigns: [{ targets: [f.a.profile.id] }] };
    f.advance(IDLE_MS); assert.deepEqual(f.cleanup.run(), []);
    delete f.profiles.data.gameGrants;
    f.profiles.data.clans.protected = { members: [], applications: [f.a.profile.id] };
    assert.deepEqual(f.cleanup.run(), []);
  } finally { await f.profiles.close(); }
});
test("Cleanup is bounded, waits for maintenance and retries failed durable publication", async t => {
  const filePath = path.join(temporary(t, "guest-expiry"), "profiles.json"), f = fixture({ filePath, journal: true });
  try {
    f.advance(IDLE_MS); f.cleanup.paused = () => true; assert.deepEqual(f.cleanup.run(), []);
    f.cleanup.paused = () => false; assert.deepEqual(f.cleanup.run(), []);
    f.advance(IDLE_MS); f.cleanup.busy = () => true; assert.deepEqual(f.cleanup.run(), []);
    f.cleanup.busy = () => false;
    const original = f.profiles.data, commit = t.mock.method(f.profiles.journal, "commit", () => { throw Error("disk failure"); });
    assert.throws(() => f.cleanup.run(), /disk failure/);
    assert.strictEqual(f.profiles.data, original); assert(f.profiles.byId(f.a.profile.id));
    commit.mock.restore();
    assert.deepEqual(f.cleanup.run(), [f.a.profile.id]);
    const recovered = recover(filePath).data;
    assert.deepEqual(recovered, { ...f.profiles.data, _journalRevision: f.profiles.journal.revision });
    assert.equal(Object.keys(recovered.profiles).length, 1);
    const restarted = new RegistrationCleanup({ profiles: f.profiles, now: f.profiles.now });
    assert.deepEqual(restarted.run(), []);
  } finally { await f.profiles.close(); }
});
test("A batch removes at most eight and preserves a nickname saved just before the scan", async () => {
  const f = fixture();
  try {
    for (let i = 0; i < 18; i++) f.profiles.open();
    f.profiles.transact(f.a.token, "confirm-before-cleanup", "confirm", p => { p.personal.nameSet = true; p.personal.introPending = false; });
    f.advance(IDLE_MS);
    assert.equal(f.cleanup.run().length, 8); assert.equal(f.cleanup.run().length, 8); assert.equal(f.cleanup.run().length, 2);
    assert(f.profiles.byId(f.a.profile.id)); assert(f.profiles.byId(f.b.profile.id));
  } finally { await f.profiles.close(); }
});
test("A missing cookie retry cannot create more guest profiles; a valid cookie still authenticates", async () => {
  const { createGameServer } = require("../../src/server/game-server");
  const { Arena } = require("../../src/server/arena/arena-simulation");
  const app = createGameServer({ autoTick: false, arena: new Arena({ etherCount: 0 }), testBots: { enabled: false } });
  await new Promise(resolve => app.httpServer.listen(0, "127.0.0.1", resolve));
  try {
    const url = "http://127.0.0.1:" + app.httpServer.address().port + "/api/profile";
    const first = await fetch(url), data = await first.json(), cookie = first.headers.get("set-cookie").split(";")[0];
    for (let i = 0; i < 3; i++) {
      const response = await fetch(url, { headers: { "X-Killex-Profile": data.profile.id } });
      assert.equal(response.status, 401); assert.match((await response.json()).error, /cookie/);
    }
    const valid = await fetch(url, { headers: { cookie, "X-Killex-Profile": data.profile.id } });
    assert.equal(valid.status, 200); assert.equal((await valid.json()).profile.id, data.profile.id);
    assert.equal(Object.keys(app.profiles.data.profiles).length, 1);
  } finally { await app.close(); }
});
