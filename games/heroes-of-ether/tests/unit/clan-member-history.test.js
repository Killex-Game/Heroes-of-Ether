"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto"), path = require("node:path");
const { ProfileStore } = require("../../src/server/profiles/profile-store");
const { ClanService, validateWorld } = require("../../src/server/clans/clan-service");
const history = require("../../src/server/clans/member-history");
const { xpForLevel } = require("../../src/server/progression/experience-progression");
const { temporary } = require("../temp");
function fixture(filePath = null) {
  const store = new ProfileStore({ filePath }), service = new ClanService(store);
  const [a, b, c] = ["Глава", "Участник", "Другой"].map((name) => {
    const u = store.open(), p = store.find(u.token);
    Object.assign(p, { name, level: 12 }); p.progress.xp = xpForLevel(12); p.wallet.coins = 10000;
    return u;
  });
  const act = (u, action, extra = {}) => service.mutate(u.token, { action, requestId: randomUUID(), ...extra });
  act(a, "create", { name: "Хранители", prefix: "LOG", emblem: "astral", privacy: "closed" });
  const clanId = store.find(a.token).clanId;
  return { store, service, a, b, c, act, clanId, rows: () => store.data.clans[clanId].memberHistory };
}
test("История состава: приём, обе смены роли, передача главы, исключение, выход и повтор", () => {
  const { store, a, b, c, act, clanId, rows } = fixture();
  for (const u of [b, c]) { act(u, "apply", { clanId }); act(a, "accept", { clanId, memberId: u.profile.id }); }
  act(a, "role", { clanId, memberId: b.profile.id, role: "officer" });
  act(a, "role", { clanId, memberId: b.profile.id, role: "member" });
  const before = rows().length;
  act(a, "role", { clanId, memberId: b.profile.id, role: "member" });
  assert.equal(rows().length, before, "no role change, no event");
  assert.throws(() => act(b, "kick", { clanId, memberId: a.profile.id }));
  assert.equal(rows().length, before);
  const requestId = randomUUID();
  act(a, "kick", { clanId, memberId: c.profile.id, requestId });
  act(a, "kick", { clanId, memberId: c.profile.id, requestId });
  act(a, "transfer", { clanId, memberId: b.profile.id });
  act(a, "leave", { clanId });
  assert.deepEqual(rows().map((r) => r.action), ["created", "accepted", "accepted", "role", "role", "kicked", "transfer", "left"]);
  assert.equal(rows()[4].fromRole, "officer");
  assert.equal(rows()[4].toRole, "member");
  store.find(a.token).name = "Переименован";
  assert.equal(rows().at(-1).actor.name, "Глава");
  assert.doesNotThrow(() => validateWorld(store.data));
});
test("История атомарна с составом и восстанавливается из сохранений; старые кланы без выдуманных записей", (t) => {
  const filePath = path.join(temporary(t, "member-history"), "profiles.json");
  const { store, a, b, act, clanId, rows } = fixture(filePath);
  act(b, "apply", { clanId });
  const before = structuredClone(store.data), save = store.save;
  store.save = () => { throw Error("disk full"); };
  assert.throws(() => act(a, "accept", { clanId, memberId: b.profile.id }), /disk full/);
  assert.deepEqual(store.data, before);
  store.save = save;
  act(a, "accept", { clanId, memberId: b.profile.id });
  const restored = new ProfileStore({ filePath });
  assert.deepEqual(restored.data.clans[clanId].memberHistory, rows());
  const legacy = { ...restored.data.clans[clanId] };
  delete legacy.memberHistory;
  assert.doesNotThrow(() => history.validate(legacy));
  assert.deepEqual(history.page(legacy).entries, []);
});
test("Ограниченные страницы и обновления истории не теряют записи и не меняют опубликованные снимки", () => {
  const clan = {}, p = { id: "x", name: "Имя" };
  for (let i = 0; i < 95; i++) history.append(clan, "joined", p, p, 1000 + i);
  const snapshot = clan.memberHistory;
  history.append(clan, "left", p, p, 1100);
  assert.equal(snapshot.length, 95);
  assert.equal(history.page(clan).entries.length, 40);
  assert.equal(history.page(clan).entries[0].id, 96);
  assert.deepEqual(history.page(clan, { after: "95" }).entries.map((r) => r.id), [96]);
  assert.deepEqual(history.page(clan, { after: "96" }).entries, []);
  assert.equal(history.page(clan, { before: "57" }).entries[0].id, 56);
  assert.equal(history.page(clan, { before: "17" }).hasOlder, false);
  assert.throws(() => history.page(clan, { after: "-1" }));
  assert.throws(() => history.validate({ memberHistory: [{ ...snapshot[0], action: "forged" }] }));
});
