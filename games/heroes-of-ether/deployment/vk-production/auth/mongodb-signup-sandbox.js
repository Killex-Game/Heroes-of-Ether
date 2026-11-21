"use strict";
// Isolated migration experiment, deliberately barred from the live hero_ether
// database. It does not create sessions or expose HTTP endpoints.
const { randomUUID } = require("node:crypto");
const { requireVerifiedIdentity } = require("./vk-mini-app-launch");
const fail = (code) => {
  throw Object.assign(Error(code), { code });
};
class MongoSignupSandbox {
  constructor(client, database, makeProfile) {
    if (!/^hero_ether_test_[a-f0-9]{20}$/.test(database)) fail("AUTH_SANDBOX_DATABASE_REQUIRED");
    if (typeof makeProfile !== "function") fail("AUTH_PROFILE_FACTORY_REQUIRED");
    this.client = client;
    this.db = client.db(database);
    this.identities = this.db.collection("signup_identities");
    this.profiles = this.db.collection("signup_profiles");
    this.makeProfile = makeProfile;
  }
  async initialize() {
    if ((await this.db.listCollections({}, { nameOnly: true }).toArray()).length)
      fail("AUTH_SANDBOX_NOT_EMPTY");
    await this.db.createCollection("signup_profiles");
    await this.db.createCollection("signup_identities");
    await this.identities.createIndex(
      { provider: 1, appId: 1, userId: 1 },
      { unique: true, name: "identity_unique" },
    );
    await this.identities.createIndex({ profileId: 1 }, { unique: true, name: "profile_unique" });
    this.ready = true;
  }
  async getOrCreate(identity) {
    requireVerifiedIdentity(identity);
    if (!this.ready) fail("AUTH_SANDBOX_NOT_READY");
    const key = { provider: identity.provider, appId: identity.appId, userId: identity.userId };
    // Duplicate-key races may abort a transaction without a retry label.
    // Retry the complete transaction; never publish a half-created profile.
    for (let attempt = 0; attempt < 5; attempt++) {
      const session = this.client.startSession();
      try {
        return await session.withTransaction(
          async () => {
            const existing = await this.identities.findOne(key, { session });
            if (existing) {
              const record = await this.profiles.findOne({ _id: existing.profileId }, { session });
              if (!record) fail("AUTH_PROFILE_MISSING");
              return { profile: record.profile, created: false };
            }
            const id = randomUUID();
            // Pure, server-owned factory only. Never use req.body as a profile.
            // It may run more than once if MongoDB retries this transaction.
            const profile = this.makeProfile(id);
            if (!profile || profile.id !== id || typeof profile.then === "function")
              fail("AUTH_INVALID_PROFILE");
            await this.profiles.insertOne({ _id: id, profile }, { session });
            await this.identities.insertOne({ ...key, profileId: id }, { session });
            return { profile, created: true };
          },
          {
            readConcern: { level: "snapshot" },
            writeConcern: { w: "majority" },
            readPreference: "primary",
            timeoutMS: 15000,
          },
        );
      } catch (error) {
        if (error.code !== 11000 || attempt === 4) throw error;
      } finally {
        await session.endSession();
      }
    }
  }
}
module.exports = { MongoSignupSandbox };
