"use strict";
const test = require("node:test"), assert = require("node:assert/strict"), path = require("node:path"), fs = require("node:fs"), { randomUUID } = require("node:crypto");
const { temporary } = require("../temp"), { ProfileStore } = require("../../src/server/profiles/profile-store"),
  { OwnerAccess } = require("../../src/server/admin/owner-access"), actions = require("../../src/server/admin/content-actions"),
  promo = require("../../src/server/profiles/promo-codes"), news = require("../../src/server/profiles/game-news");
function fixture(t, journal = false) {
  let at = Date.UTC(2026, 10, 13, 12);
  const filePath = path.join(temporary(t, "promo-codes"), "profiles.json"), store = new ProfileStore({ filePath, journal, now: () => at });
  const owner = store.open(), player = store.open(), other = store.open();
  const access = new OwnerAccess({ ownerId: owner.profile.id, now: () => at });
  const command = extra => ({ requestId: randomUUID(), revision: store.data.promoCodes?.revision || 0,
    reason: "Проверка промокода", code: "WELCOME", title: "Приветствие", enabled: true, startsAt: 0, endsAt: 0,
    maxRedemptions: 0, rewards: [{ kind: "currency", id: "coins", amount: 123 }], ...extra });
  const apply = input => actions.apply(store, access, store.find(owner.token), "promoCodes", input, promo.normalize);
  const redeem = (extra = {}, token = player.token) => promo.redeem(store, token, { code: "welcome", requestId: randomUUID(), ...extra });
  return { store, access, owner, player, other, command, apply, redeem, filePath, now: () => at, advance: ms => { at += ms; } };
}
test("promo grant, counter and receipt are durable together; exact retry and a new request cannot grant twice", t => {
  const f = fixture(t, true), creation = f.command(); f.apply(creation);
  assert.equal(f.apply(creation).replay, true);
  const before = f.store.find(f.player.token).wallet.coins, input = { requestId: randomUUID(), code: "  welcome  " };
  const originalSync = fs.fsyncSync; let synced = 0;
  fs.fsyncSync = (...args) => { synced++; return originalSync(...args); };
  try { assert.equal(f.redeem(input).replay, false); assert.ok(synced > 0, "durable sync happens before success"); }
  finally { fs.fsyncSync = originalSync; }
  assert.equal(f.redeem(input).replay, true);
  assert.throws(() => f.redeem(), /уже активировал/);
  const restored = new ProfileStore({ filePath: f.filePath, journal: true, now: f.now });
  assert.equal(restored.find(f.player.token).wallet.coins, before + 123);
  assert.equal(restored.data.promoCodes.items[0].redeemed, 1);
  assert.equal(promo.redeem(restored, f.player.token, input).replay, true);
  assert.match(restored.find(f.player.token).transactions.entries.at(-1).label, /WELCOME/);
  const current = f.store.data.promoCodes.items[0]; f.apply(f.command({ ...current, enabled: false }));
  assert.equal(f.redeem(input).replay, true, "lost ACK remains valid after the owner disables the code");
});

test("every redeemable reward has its canonical art or an existing account frame renderer", t => {
  const f = fixture(t);
  for (let i = 0; i < promo.catalog.length; i += 50) {
    const code = "ART-" + i;
    f.apply(f.command({ code, rewards: promo.catalog.slice(i, i + 50).map(({kind,id}) => ({kind,id,amount:1})) }));
    const result = f.redeem({code});
    for (const r of result.rewards) {
      if (!r.icon) { assert.equal(r.kind, "frame"); assert.ok(["vip","premium"].includes(r.id)); continue; }
      assert.ok(r.icon.startsWith("assets/"), r.id);
      assert.ok(fs.existsSync(path.resolve(__dirname,"../../public",r.icon.split("?")[0])), r.kind + ":" + r.id + " " + r.icon);
    }
  }
});

test("promo deletion is confirmed, durable and idempotent; claims, retries and retired codes stay protected", t => {
  const f = fixture(t,true); f.apply(f.command());
  const redeem = {code:"WELCOME",requestId:randomUUID()}; f.redeem(redeem);
  const player = structuredClone(f.store.find(f.player.token)), code = f.store.data.promoCodes.items[0];
  const deletion = {action:"delete",id:code.id,confirmed:true,requestId:randomUUID(),revision:f.store.data.promoCodes.revision,reason:"Акция завершена"};
  assert.throws(()=>f.apply({...deletion,confirmed:false}),/Подтверди/);
  assert.throws(()=>f.apply({...deletion,revision:0}),/изменился/);
  assert.throws(()=>actions.apply(f.store,f.access,f.store.find(f.other.token),"promoCodes",deletion,promo.normalize),/Только владелец/);
  const before=structuredClone(f.store.data),save=f.store.save;
  f.store.save=()=>{throw Error("disk full");};assert.throws(()=>f.apply(deletion),/disk full/);assert.deepEqual(f.store.data,before);f.store.save=save;
  const untouched=f.store.find(f.other.token);f.apply(deletion);assert.equal(f.apply(deletion).replay,true);
  assert.equal(f.store.data.promoCodes.items.length,0);assert.equal(f.store.find(f.other.token),untouched);
  assert.deepEqual(f.store.find(f.player.token),player);
  assert.throws(()=>f.redeem({},f.other.token),/не найден/);
  assert.throws(()=>f.apply(f.command()),/удалён/);
  f.apply(f.command({code:"NEW-PROMO"}));
  assert.throws(()=>f.apply(f.command()),/удалён/,"later edits retain retired codes");
  const restored=new ProfileStore({filePath:f.filePath,journal:true,now:f.now});
  assert.equal(promo.redeem(restored,f.player.token,redeem).replay,true,"lost redemption ACK can still be retried after deletion");
  assert.deepEqual(restored.find(f.player.token),player);
  assert.equal(actions.apply(restored,f.access,restored.find(f.owner.token),"promoCodes",deletion,promo.normalize).replay,true);
  const audit=restored.data.administration.audit.find(e=>e.requestId===deletion.requestId);
  assert.equal(audit.after,null);assert.equal(audit.before.code,"WELCOME");
  promo.validate(restored.data);
});
test("all reward families become usable and survive restart without granting titles or account benefits", t => {
  const f = fixture(t), rewards = [
    { kind: "currency", id: "coins", amount: 3 }, { kind: "currency", id: "crystals", amount: 4 }, { kind: "currency", id: "bucks", amount: 5 },
    { kind: "booster", id: "candy", amount: 7 }, { kind: "booster", id: "easter_egg", amount: 3 },
    { kind: "accessory", id: "title_king_hat", amount: 1 }, { kind: "accessory", id: "gold_bow", amount: 1 },
    { kind: "skin", id: "premium-1", amount: 1 },
    ...["theme", "frame"].map(kind => ({ kind, id: promo.catalog.find(c => c.kind === kind).id, amount: 1 })),
    { kind: "chest", id: "low", amount: 1 },
  ];
  const honors = structuredClone(f.store.find(f.player.token).honors);
  f.apply(f.command({ rewards })); f.redeem();
  const store = new ProfileStore({ filePath: f.filePath, now: f.now }), p = store.find(f.player.token);
  assert.equal(p.inventory.candy, 7); assert.equal(p.inventory.easter_egg, 3);
  assert.equal(require("../../src/server/events/easter-hunt").count(p, f.now()), 3);
  assert.ok(require("../../src/server/profiles/accessory-access").isOwned(p, "title_king_hat"));
  assert.ok(store.view(p).wardrobe.owned.includes("gold_bow"));
  assert.deepEqual(p.honors, honors); assert.equal(store.view(p).account.premium, false);
  assert.ok(store.view(p).appearance.unlocked.includes(rewards.find(r => r.kind === "theme").id));
  store.setLoadout(f.player.token, { requestId: randomUUID(), skinId: "premium-1", quickSlots: [] });
  assert.equal(store.identity(store.find(f.player.token)).skinId, "premium-1");
  assert.equal(p.clanChests.items.length, 1);
  const chestId = p.clanChests.items[0].id;
  for (const action of ["claim", "prepare", "open"])
    store.clanChestAction(f.player.token, { action, chestId, requestId: randomUUID() });
  assert.equal(store.find(f.player.token).clanChests.items.length, 0, "a promo chest is usable without clan membership");
  promo.validate(store.data);
});
test("failure rolls back counter, rewards, claim and operation receipt; unrelated profiles retain identity", t => {
  const f = fixture(t); f.apply(f.command());
  const before = structuredClone(f.store.data), other = f.store.find(f.other.token), save = f.store.save;
  const input = { requestId: randomUUID() };
  f.store.save = () => { throw Error("disk full"); };
  assert.throws(() => f.redeem(input), /disk full/); assert.deepEqual(f.store.data, before);
  f.store.save = save; f.redeem(input);
  assert.equal(f.store.find(f.other.token), other, "redeem must not copy or settle every player");
  assert.equal(f.store.data.promoCodes.items[0].redeemed, 1);
});
test("owner authorization, revision checks, immutable codes and globally exhausted codes", t => {
  const f = fixture(t), cmd = f.command({ maxRedemptions: 1 });
  assert.throws(() => actions.apply(f.store, f.access, f.store.find(f.player.token), "promoCodes", cmd, promo.normalize), /Только владелец/);
  const created = f.apply(cmd); f.redeem();
  assert.throws(() => f.redeem({}, f.other.token), /Лимит/);
  assert.throws(() => f.apply(f.command({ revision: 0 })), /изменился/);
  assert.throws(() => f.apply(f.command()), /уже существует/);
  assert.throws(() => f.apply(f.command({ id: created.id, code: "RENAMED" })), /менять нельзя/);
  assert.throws(() => f.apply({ ...cmd, title: "Другой состав" }), /уже использован/);
});
test("disabled, upcoming, expired, malformed, duplicated and overflowing rewards cannot change state", t => {
  const f = fixture(t);
  for (const extra of [{ enabled: false }, { startsAt: f.now() + 100 }, { endsAt: f.now() }]) {
    const code = "CODE-" + randomUUID(), cmd = f.command({ code, ...extra }); f.apply(cmd);
    const before = structuredClone(f.store.data);
    assert.throws(() => f.redeem({ code }), /недоступен/); assert.deepEqual(f.store.data, before);
  }
  for (const rewards of [[], [{kind:"currency",id:"coins",amount:-1}], [{kind:"skin",id:"<script>",amount:1}],
    [{kind:"currency",id:"coins",amount:1},{kind:"currency",id:"coins",amount:2}]])
    assert.throws(() => f.apply(f.command({ rewards })));
  f.apply(f.command()); f.store.find(f.player.token).wallet.coins = Number.MAX_SAFE_INTEGER;
  assert.throws(() => f.redeem(), /баланс/); assert.equal(f.store.data.promoCodes.items.at(-1).redeemed, 0);
});
test("published news and drafts persist with date-only values and literal untrusted text", t => {
  const f = fixture(t), cmd = { requestId: randomUUID(), revision: 0, reason: "Проверка новости", title: "Новости",
    body: "<script>alert('text only')</script>", date: "2026-11-13", category: "news", visible: false };
  const apply = input => actions.apply(f.store, f.access, f.store.find(f.owner.token), "gameNews", input, news.normalize);
  const created = apply(cmd); assert.equal(news.view(f.store).items.length, 0);
  apply({ ...cmd, id: created.id, revision: 1, visible: true, requestId: randomUUID() });
  const restored = new ProfileStore({ filePath: f.filePath, now: f.now });
  assert.equal(news.view(restored).items[0].body, cmd.body);
  assert.equal(news.view(restored).items[0].date, "2026-11-13");
  assert.equal(news.view(restored).items[0].createdAt, undefined);
  assert.throws(() => news.normalize({ ...cmd, date: "2026-02-30" }));
});
