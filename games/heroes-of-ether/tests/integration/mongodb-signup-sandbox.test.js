"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { randomUUID, createHmac } = require("node:crypto");
const { MongoClient } = require("mongodb");
const { credentials, safeError } = require("../../src/server/persistence/mongodb-config");
const {
  MongoSignupSandbox,
} = require("../../deployment/vk-production/auth/mongodb-signup-sandbox");
const { verifyVkMiniAppLaunch } = require("../../deployment/vk-production/auth/vk-mini-app-launch");
function identity(userId = "456", appId = "123") {
  const now = Date.now();
  const q = `vk_app_id=${appId}&vk_ts=${Math.floor(now / 1000)}&vk_user_id=${userId}`;
  const sign = createHmac("sha256", "test-secret").update(q).digest("base64url");
  return verifyVkMiniAppLaunch(q + "&sign=" + sign, { appId, now, secret: "test-secret" });
}
// Contract fixture, NOT a replacement for the game's full profile factory.
const makeProfile = (id) => ({
  id,
  wallet: { coins: 100, crystals: 10, bucks: 0 },
  inventory: {},
  level: 1,
});
test("auth experiment cannot point at live or arbitrary databases", () => {
  for (const database of ["hero_ether", "sample_mflix", "admin", "hero_ether_test_manual"])
    assert.throws(
      () => new MongoSignupSandbox(null, database, makeProfile),
      /SANDBOX_DATABASE_REQUIRED/,
    );
});
test(
  "Atlas signup: concurrent first launches, repeat, rollback and isolation",
  {
    skip: !process.env.HERO_ETHER_ATLAS_TEST_CREDENTIALS,
    timeout: 90000,
  },
  async (t) => {
    const database = "hero_ether_test_" + randomUUID().replaceAll("-", "").slice(0, 20);
    const client = new MongoClient(credentials(process.env.HERO_ETHER_ATLAS_TEST_CREDENTIALS), {
      maxPoolSize: 3,
      serverSelectionTimeoutMS: 15000,
      connectTimeoutMS: 10000,
      socketTimeoutMS: 15000,
      appName: "HeroEther-auth-test",
    });
    const store = new MongoSignupSandbox(client, database, makeProfile);
    let owned = false;
    t.after(async () => {
      try {
        if (
          owned &&
          /^hero_ether_test_[a-f0-9]{20}$/.test(database) &&
          store.db.databaseName === database
        )
          await store.db.dropDatabase();
      } finally {
        await client.close();
      }
    });
    try {
      await client.connect();
      await store.initialize();
      owned = true;
      await assert.rejects(
        store.getOrCreate({ provider: "vk-mini-apps", appId: "123", userId: "456" }),
        /UNVERIFIED/,
      );
      assert.equal(await store.profiles.countDocuments(), 0);
      const launches = await Promise.all(
        Array.from({ length: 5 }, () => store.getOrCreate(identity())),
      );
      assert.equal(new Set(launches.map((entry) => entry.profile.id)).size, 1);
      assert.equal(launches.filter((entry) => entry.created).length, 1);
      assert.equal(await store.profiles.countDocuments(), 1);
      assert.equal(await store.identities.countDocuments(), 1);
      assert.deepEqual(launches[0].profile.wallet, { coins: 100, crystals: 10, bucks: 0 });
      assert.deepEqual(launches[0].profile.inventory, {});
      const id = launches[0].profile.id;
      await store.profiles.updateOne({ _id: id }, { $set: { "profile.wallet.coins": 93 } });
      // Retry after a lost reply / other device: never reset an existing account.
      const again = await store.getOrCreate(identity());
      assert.equal(again.created, false);
      assert.equal(again.profile.id, id);
      assert.equal(again.profile.wallet.coins, 93);
      const realInsert = store.identities.insertOne.bind(store.identities);
      store.identities.insertOne = async () => {
        throw Error("injected identity failure");
      };
      await assert.rejects(store.getOrCreate(identity("999")), /injected identity failure/);
      store.identities.insertOne = realInsert;
      assert.equal(
        await store.profiles.countDocuments(),
        1,
        "failed binding leaves no orphan profile",
      );
      const other = await store.getOrCreate(identity("456", "124"));
      assert.notEqual(other.profile.id, id, "different apps must not merge by numeric user ID");
      const indexes = await store.identities.indexes();
      assert.equal(indexes.find((index) => index.name === "identity_unique").unique, true);
      await assert.rejects(store.initialize(), /NOT_EMPTY/);
    } catch (error) {
      if (error.name === "AssertionError" || /^AUTH_/.test(error.code || "")) throw error;
      throw Error(safeError(error));
    }
  },
);
