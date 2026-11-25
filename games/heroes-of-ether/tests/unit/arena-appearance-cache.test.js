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
  assert.equal(joinedClan, beforeClan);
  store.data.clans = { ...store.data.clans, [p.clanId]: { ...store.data.clans[p.clanId] } };
  assert.equal(select(), joinedClan);
  const replacement = structuredClone(p);
  assert.notEqual(store.arenaAppearance(replacement), select());
});

test('clan economy, membership and frame edits do not recreate personal arena appearance',()=>{
  const at=Date.parse('2026-11-24T09:00:00.000Z'),store=new ProfileStore({now:()=>at});
  const auth=store.open();let p=store.find(auth.token);
  p.account=require('../../src/server/accounts/account-benefits').fresh();
  p.account.vipUntil=at+10000;p.appearance.avatarFrame=p.appearance.arenaFrame='vip';
  p.clanId='clan';store.data.clans.clan={id:'clan',name:'First',prefix:'CL',competition:{frame:'bronze'}};
  const first=store.arenaAppearance(p);
  for(let i=0;i<100;i++){
    p={...p,revision:p.revision+1,wallet:{...p.wallet,coins:p.wallet.coins+1}};
    store.data.clans.clan={...store.data.clans.clan,xp:i,treasury:i*100,competition:{frame:i%2?'gold':'silver'}};
    const actual=store.arenaAppearance(p),identity=store.identity(p);
    assert.equal(actual,first);
    assert.deepEqual(actual,{account:identity.account,skinId:identity.skinId,appearance:identity.appearance});
    assert.equal(identity.clanFrame,store.data.clans.clan.competition.frame);
  }
  p={...p,revision:p.revision+1,appearance:{...p.appearance,arenaFrame:'default'}};
  assert.notEqual(store.arenaAppearance(p),first);
  assert.equal(store.arenaAppearance(p).appearance.arenaFrame,'default');
});
