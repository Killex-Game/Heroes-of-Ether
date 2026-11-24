"use strict";
const test = require("node:test"),
  assert = require("node:assert/strict"),
  { randomUUID } = require("node:crypto"),
  fs = require("node:fs"),
  path = require("node:path");
const { ProfileStore } = require("../../src/server/profiles/profile-store"),
  { BOOSTERS } = require("../../src/server/boosters/booster-catalog"),
  { Arena } = require("../../src/server/arena/arena-simulation"),
  { freshProgress } = require("../../src/server/progression/experience-progression"),
  slots = require("../../public/shared/quick-slot-rules"),
  { temporary } = require("../temp");
test("Покупка: обычные с 1, улучшенные с 12, редкие с 25; отказ не меняет кошелёк", () => {
  for (const level of [1, 11, 12, 24, 25])
    for (const item of BOOSTERS.values()) {
      if (["clan", "event", "potion"].includes(item.tier)) continue;
      const store = new ProfileStore(),
        { token } = store.open(),
        p = store.find(token);
      p.level = level;
      p.progress = freshProgress(level);
      p.wallet = { coins: 100000, crystals: 100000, bucks: 100000 };
      const before = structuredClone(p);
      const required = item.tier === "rare" ? 25 : item.tier === "advanced" ? 12 : 1;
      if (level < required) {
        assert.throws(
          () => store.buy(token, item.id, randomUUID()),
          new RegExp(`${required} уровня`),
        );
        assert.deepEqual(store.find(token), before);
      } else assert.ok(store.buy(token, item.id, randomUUID()).profile.inventory[item.id] > 0);
    }
});
test("Четвёртая ячейка закрыта до 12, бонусные VIP/Premium остаются открыты", () => {
  for (const account of [{}, { vip: true }, { premium: true }, { vip: true, premium: true }])
    for (const level of [11, 12]) {
      const expected = Array.from(
        { length: 6 },
        (_, i) =>
          i < 3 ||
          (i === 3 && level >= 12) ||
          i === 4 ||
          (i === 5 && account.vip),
      ).map(Boolean);
      assert.deepEqual(
        Array.from({ length: 6 }, (_, i) => slots.unlocked(i, account, level)),
        expected,
      );
      const store = new ProfileStore({ now: () => 5000 }),
        { token } = store.open(),
        p = store.find(token);
      p.level = level;
      p.progress = freshProgress(level);
      p.inventory.candy = 10;
      p.account = require("../../src/server/accounts/account-benefits").fresh();
      if (account.vip) p.account.vipUntil = 9000;
      if (account.premium) p.account.premiumUntil = 9000;
      for (let i = 0; i < 6; i++) {
        const selection = Array(6).fill(null);
        selection[i] = "candy";
        const save = () =>
          store.setLoadout(token, {
            skinId: "moon-dragon",
            quickSlots: selection,
            requestId: randomUUID(),
          });
        if (expected[i]) save();
        else assert.throws(save, /слот/);
      }
    }
});
test("Клановые бустеры нельзя применять до 12 уровня", () => {
  for (const item of BOOSTERS.values())
    if (item.tier === "clan") {
      const arena = new Arena({ etherCount: 0 }),
        p = arena.addPlayer(0, "p");
      p.level = 11;
      assert.throws(
        () =>
          arena.prepareBooster(
            p.id,
            { boosterId: item.id, spawnSerial: 0, aimX: 100, aimY: 100 },
            5000,
          ),
        /12 уровня/,
      );
      assert.equal(p.boostersUsed, 0);
      p.level = 12;
      assert.doesNotThrow(() =>
        arena.prepareBooster(
          p.id,
          { boosterId: item.id, spawnSerial: 0, aimX: 100, aimY: 100 },
          5000,
        ),
      );
    }
});
test("Старый седьмой слот снимается без потери предмета, остальные назначения сохраняются", (t) => {
  const filePath = path.join(temporary(t, "slot-migrate"), "profiles.json"),
    store = new ProfileStore(),
    { token } = store.open(),
    p = store.find(token);
  p.quickSlots = ["candy", null, null, null, null, null, "meat"];
  p.inventory.candy = 10;
  p.inventory.meat = 5;
  fs.writeFileSync(filePath, JSON.stringify(store.data));
  const disk = new ProfileStore({ filePath }),
    restored = disk.find(token);
  assert.deepEqual(restored.quickSlots, ["candy", null, null, null, null, null]);
  assert.equal(restored.inventory.meat, 5);
  assert.equal(disk.loadoutMigrationPending, true);
  assert.equal(disk.refreshCompetition(), true);
  const restarted = new ProfileStore({ filePath });
  assert.equal(restarted.find(token).quickSlots.length, 6);
  assert.equal(restarted.find(token).revision, restored.revision);
  assert.equal(restarted.loadoutMigrationPending, undefined);
});


test('Недоступные клановые предметы нельзя назначить в слот даже при наличии Premium', () => {
 for(const level of [1,11,12]) for(const item of BOOSTERS.values()) if(item.tier==='clan'){
  const store=new ProfileStore({now:()=>5000}),{token}=store.open(),p=store.find(token);
  p.level=level;p.progress=freshProgress(level);p.inventory[item.id]=10;p.account=require("../../src/server/accounts/account-benefits").fresh();p.account.premiumUntil=10000;
  const before=structuredClone(p),input={skinId:'moon-dragon',quickSlots:[item.id],requestId:randomUUID()};
  if(level<12){assert.throws(()=>store.setLoadout(token,input),/12 уровня/);assert.deepEqual(store.find(token),before);}
  else{const r=store.setLoadout(token,input);assert.equal(r.profile.quickSlots[0],item.id);assert.deepEqual(store.setLoadout(token,input).profile.quickSlots,r.profile.quickSlots);}
 }
});
test('Загрузка снимает закрытые по уровню назначения, сохраняя предметы и сохраняет миграцию один раз', t=>{
 const filePath=path.join(temporary(t,'level-slot-migrate'),'profiles.json'),store=new ProfileStore(),{token}=store.open(),p=store.find(token);
 p.inventory.fire=9;p.inventory.candy=3;p.quickSlots=['fire','candy',null,null,null,null];
 fs.writeFileSync(filePath,JSON.stringify(store.data));const disk=new ProfileStore({filePath});
 assert.deepEqual(disk.find(token).quickSlots,[null,'candy',null,null,null,null]);assert.deepEqual(disk.find(token).inventory,p.inventory);
 assert.equal(disk.loadoutMigrationPending,true);disk.refreshCompetition();const next=new ProfileStore({filePath});assert.equal(next.find(token).revision,disk.find(token).revision);assert.equal(next.loadoutMigrationPending,undefined);
});
