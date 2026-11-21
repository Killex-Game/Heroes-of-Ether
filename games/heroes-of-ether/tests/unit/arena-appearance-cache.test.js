"use strict";
const test = require("node:test"),
  assert = require("node:assert/strict");
const { ProfileStore } = require("../../src/server/profiles/profile-store");
test("arena appearance cache expires at exact account/grant/day boundaries and invalidates on commits", () => {
  let at = Date.parse("2026-11-01T20:59:55Z");
  const store = new ProfileStore({ filePath: null, now: () => at });
  const auth = store.open(),
    p = store.find(auth.token);
  p.account = require("../../src/server/accounts/account-benefits").fresh();
  p.account.vipUntil = at + 1000;
  p.account.premiumUntil = at + 2000;
  p.appearance.avatarFrame = p.appearance.arenaFrame = "premium";
  p.appearance.lobbyBackground = "silver";
  p.appearance.grants.silver = at + 3000;
  const select = () => {
    const value = store.arenaAppearance(p),
      identity = store.identity(p);
    assert.deepEqual(value, {
      account: identity.account,
      skinId: identity.skinId,
      appearance: identity.appearance,
    });
    return value;
  };
  const initial = select();
  at += 999;
  assert.equal(select(), initial);
  at++;
  assert.equal(select().account.vip, false);
  at += 1000;
  assert.equal(select().appearance.arenaFrame, "default");
  at += 1000;
  assert.equal(select().appearance.lobbyBackground, "default");
  const beforeDay = select();
  at += 2000;
  assert.notEqual(select().account.currencyBonusResetAt, beforeDay.account.currencyBonusResetAt);
  at -= 5000;
  assert.equal(select().account.premium, true);
  const beforeRevision = select();
  p.revision++;
  p.appearance.arenaFrame = "default";
  assert.notEqual(select(), beforeRevision);
  assert.equal(select().appearance.arenaFrame, "default");
  const beforeClan = select();
  store.data.clans = { ...store.data.clans };
  assert.equal(select(), beforeClan);
  p.clanId = "my-clan";
  store.data.clans[p.clanId] = { id: p.clanId };
  const joinedClan = select();
  assert.notEqual(joinedClan, beforeClan);
  store.data.clans = { ...store.data.clans, [p.clanId]: { ...store.data.clans[p.clanId] } };
  assert.notEqual(select(), joinedClan);
  const replacement = structuredClone(p);
  assert.notEqual(store.arenaAppearance(replacement), select());
});
