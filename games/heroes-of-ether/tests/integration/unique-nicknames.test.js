"use strict";
const test = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  path = require("node:path"),
  { randomUUID } = require("node:crypto"),
  { once } = require("node:events"),
  WebSocket = require("ws");
const { ProfileStore } = require("../../src/server/profiles/profile-store"),
  { OwnerAccess } = require("../../src/server/admin/owner-access"),
  { OwnerService } = require("../../src/server/admin/owner-service"),
  { createGameServer } = require("../../src/server/game-server"),
  { seedTestClans } = require("../../src/server/testing/arena-test-bots"),
  names = require("../../src/server/profiles/nickname-rules"),
  { temporary } = require("../temp");
const NOW = Date.UTC(2026, 9, 22, 12);
function fixture(filePath) {
  const store = new ProfileStore({ filePath, now: () => NOW }),
    a = store.open(),
    b = store.open();
  const edit = (session, name, extra = {}) =>
    store.setPersonal(session.token, {
      name,
      expectedName: store.find(session.token).name,
      gender: "unspecified",
      confirmed: true,
      requestId: randomUUID(),
      ...extra,
    });
  return { store, a, b, edit };
}
test("Новые временные ники уникальны, первая установка остаётся бесплатной", () => {
  const f = fixture();
  for (let i = 0; i < 10; i++) f.store.open();
  const profiles = Object.values(f.store.data.profiles);
  assert.equal(new Set(profiles.map((p) => names.key(p.name))).size, profiles.length);
  assert.ok(profiles.every((p) => f.store.view(p).personal.renameCost === 0));
  f.edit(f.a, "Бот T01 Искра");
  seedTestClans(f.store, NOW);
  const seeded = Object.values(f.store.data.profiles);
  assert.equal(new Set(seeded.map((p) => names.key(p.name))).size, seeded.length);
  assert.equal(f.store.find(f.a.token).name, "Бот T01 Искра");
});
test("Занятый ник: регистр, пробелы, Unicode и скрытые символы; без списания и изменений", () => {
  const f = fixture();
  f.edit(f.a, "Moon Wolf");
  f.edit(f.b, "Свободный");
  for (const name of [
    "Moon Wolf",
    "moon wolf",
    " MOON WOLF ",
    "Moon  Wolf",
    "Moon\u00a0Wolf",
    "Ｍｏｏｎ Ｗｏｌｆ",
    "Moon\u200b Wolf",
    "Moon\ufe0f Wolf",
  ]) {
    const before = structuredClone(f.store.data);
    assert.throws(() => f.edit(f.b, name), /ник уже занят/);
    assert.deepEqual(f.store.data, before);
  }
  assert.throws(() => f.edit(f.b, "\u200b\u2060"), /видимые/);
  f.edit(f.a, "Moon Wolf", { gender: "female" });
  assert.equal(f.store.find(f.a.token).wallet.crystals, 10);
  f.edit(f.a, "moon wolf");
  assert.equal(f.store.find(f.a.token).name, "moon wolf");
  assert.equal(f.store.find(f.a.token).wallet.crystals, 0);
});
test("Офлайн-профиль и заблокированный профиль сохраняют свой ник после перезапуска", (t) => {
  const filePath = path.join(temporary(t, "unique-names"), "profiles.json"),
    f = fixture(filePath);
  f.edit(f.a, "Сохранённый");
  f.store.find(f.a.token).moderation = {
    version: 1,
    ban: { reason: "Тест", at: NOW, until: null, by: f.a.profile.id },
  };
  f.store.save(f.store.data);
  const disk = new ProfileStore({ filePath, now: () => NOW });
  assert.throws(
    () =>
      disk.setPersonal(f.b.token, {
        name: "сохранённый",
        expectedName: disk.find(f.b.token).name,
        gender: "male",
        requestId: randomUUID(),
      }),
    /ник уже занят/,
  );
});
test("Неудачная запись не занимает ник; повтор успешного запроса не отбирает его у нового владельца", (t) => {
  const filePath = path.join(temporary(t, "nickname-rollback"), "profiles.json"),
    f = fixture(filePath),
    save = f.store.save,
    before = structuredClone(f.store.data),
    bytes = fs.readFileSync(filePath, "utf8");
  f.store.save = () => {
    throw Error("disk full");
  };
  assert.throws(() => f.edit(f.a, "Феникс"), /disk full/);
  assert.deepEqual(f.store.data, before);
  assert.equal(fs.readFileSync(filePath, "utf8"), bytes);
  f.store.save = save;
  const first = { requestId: randomUUID(), expectedName: f.store.find(f.b.token).name };
  f.edit(f.b, "Феникс", first);
  assert.throws(() => f.edit(f.a, "Феникс"), /ник уже занят/);
  f.edit(f.b, "Дракон");
  f.edit(f.a, "Феникс");
  const settled = structuredClone(f.store.data);
  assert.equal(f.edit(f.b, "Феникс", first).replay, true);
  assert.deepEqual(f.store.data, settled);
});
test("Администратор не может назначить занятый ник; журнал и профиль остаются целыми", () => {
  const f = fixture();
  f.edit(f.a, "Хозяин");
  const access = new OwnerAccess({ ownerId: f.a.profile.id, now: () => NOW }),
    service = new OwnerService({ profiles: f.store, access, now: () => NOW }),
    before = structuredClone(f.store.data);
  assert.throws(
    () =>
      service.apply(f.store.find(f.a.token), {
        action: "rename",
        targetId: f.b.profile.id,
        name: "хозяин",
        reason: "Проверка",
        revision: f.store.find(f.b.token).revision,
        requestId: randomUUID(),
      }),
    /ник уже занят/,
  );
  assert.deepEqual(f.store.data, before);
});
test("Старые одинаковые временные имена не мешают менять пол и ссылку VK", () => {
  const f = fixture();
  f.store.find(f.b.token).name = f.store.find(f.a.token).name;
  f.edit(f.b, f.store.find(f.b.token).name, { gender: "female", vkUrl: "https://vk.com/example" });
  assert.equal(f.store.find(f.b.token).personal.gender, "female");
  const c = f.store.open();
  assert.throws(() => f.edit(c, f.store.find(f.a.token).name), /ник уже занят/);
});
test("HTTP: два одновременных запроса на ник подтверждают только одного игрока", async (t) => {
  const f = fixture(),
    app = createGameServer({ profiles: f.store, autoTick: false });
  t.after(() => app.close());
  app.httpServer.listen(0, "127.0.0.1");
  await once(app.httpServer, "listening");
  const url = `http://127.0.0.1:${app.httpServer.address().port}`;
  const replies = await Promise.all(
    [f.a, f.b].map((s, i) =>
      fetch(url + "/api/profile/personal", {
        method: "POST",
        headers: {
          Cookie: `sferorumiya_session=${s.token}`,
          "Content-Type": "application/json",
          Origin: url,
        },
        body: JSON.stringify({
          name: i ? "победитель" : "Победитель",
          expectedName: s.profile.name,
          gender: "male",
          requestId: randomUUID(),
        }),
      }),
    ),
  );
  assert.deepEqual(replies.map((r) => r.status).sort(), [200, 409]);
  assert.match((await replies.find((r) => r.status === 409).json()).error, /ник уже занят/);
  assert.equal(
    Object.values(f.store.data.profiles).filter((p) => names.key(p.name) === "победитель").length,
    1,
  );
  assert.ok(Object.values(f.store.data.profiles).every((p) => p.wallet.crystals === 10));
});
test("WebSocket без профиля не позволяет выдать себя за сохранённого игрока или другого гостя", async (t) => {
  const f = fixture();
  f.edit(f.a, "Страж");
  const app = createGameServer({ profiles: f.store, autoTick: false });
  t.after(() => app.close());
  app.httpServer.listen(0, "127.0.0.1");
  await once(app.httpServer, "listening");
  const connect = async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${app.httpServer.address().port}`);
    const [raw] = await once(ws, "message"),
      welcome = JSON.parse(raw);
    return { ws, player: app.arena.players.get(welcome.id) };
  };
  const rename = async (client, name) => {
    client.ws.send(JSON.stringify({ type: "rename", name }));
    const pong = once(client.ws, "pong");
    client.ws.ping();
    await pong;
  };
  const a = await connect(),
    b = await connect(),
    initial = a.player.name;
  await rename(a, "страж");
  assert.equal(a.player.name, initial);
  await rename(a, "Гость");
  assert.equal(a.player.name, "Гость");
  const before = b.player.name;
  await rename(b, "ГОСТЬ");
  assert.equal(b.player.name, before);
});
