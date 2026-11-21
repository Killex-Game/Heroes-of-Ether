"use strict";
const test = require("node:test"),
  assert = require("node:assert/strict");
const { ProfileStore } = require("../../src/server/profiles/profile-store");
const { grantHall, GRANT_ID, OWNER_ID } = require("../../scripts/development/grant-hall-heroes");
const hall = require("../../src/server/rankings/hall-of-fame");
const path = require("node:path");
const { temporary } = require("../temp");
function setup(options) {
  const s = new ProfileStore(options);
  for (let i = 0; i < 5; i++) {
    const auth = s.open(),
      p = s.find(auth.token);
    if (i === 0) p.id = OWNER_ID;
    else p.testBot = "test";
  }
  return s;
}
test("Owner grant publishes four earned Hero titles once without granting chest contents", () => {
  const s = setup(),
    wallets = Object.values(s.data.profiles).map((p) => structuredClone(p.wallet));
  const result = grantHall(s, () => 0, 10000);
  assert.equal(result.replay, false);
  assert.equal(hall.view(s).total, 4);
  assert.equal(hall.view(s).top[0].greatness, 2500190);
  assert.deepEqual(
    Object.values(s.data.profiles).map((p) => p.wallet),
    wallets,
  );
  const saved = structuredClone(s.data);
  assert.equal(
    grantHall(s, () => {
      throw Error("reselected");
    }).replay,
    true,
  );
  assert.deepEqual(s.data, saved);
});

test("Grant and receipt survive reloading the saved world without a second award", (t) => {
  const filePath = path.join(temporary(t, "hall-owner-grant"), "profiles.json");
  const s = setup({ filePath });
  const receipt = grantHall(s, () => 0);
  const restored = new ProfileStore({ filePath });
  assert.deepEqual(restored.data.testGrants[GRANT_ID].recipients, receipt.recipients);
  assert.equal(hall.view(restored).total, 4);
  assert.equal(
    grantHall(restored, () => {
      throw Error("must not select again");
    }).replay,
    true,
  );
  for (const p of Object.values(s.data.profiles)) {
    const after = restored.byId(p.id);
    assert.deepEqual(after.wallet, p.wallet);
    assert.deepEqual(after.honors, p.honors);
  }
});
test("Rejected save leaves all profiles and the grant receipt untouched", () => {
  const s = setup(),
    saved = structuredClone(s.data);
  s.save = () => {
    throw Error("disk rejected");
  };
  assert.throws(() => grantHall(s, () => 0, 10000), /disk/);
  assert.deepEqual(s.data, saved);
  assert.equal(s.data.testGrants?.[GRANT_ID], undefined);
});
