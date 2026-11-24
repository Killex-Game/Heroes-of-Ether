/* Модульные проверки игровых правил. */
"use strict";
const test = require("node:test"),
  assert = require("node:assert/strict"),
  { randomUUID } = require("node:crypto");
const { ProfileStore } = require("../../src/server/profiles/profile-store"),
  accounts = require("../../src/server/accounts/account-benefits"),
  loadout = require("../../public/shared/quick-slot-rules");
const ids = ["candy", "ice_cream", "donut", "meat", "speed", "colorful_shield"];
const path = require("node:path"),
  fs = require("node:fs"),
  { temporary } = require("../temp");
function fixture() {
  let now = 5000;
  const store = new ProfileStore({ now: () => now }),
    { token } = store.open(),
    profile = () => store.find(token);
  profile().level = 25;
  profile().progress = require("../../src/server/progression/experience-progression").freshProgress(
    25,
  );
  for (const id of ids) profile().inventory[id] = 10;
  const save = (quickSlots) =>
    store.setLoadout(token, {
      name: "Игрок",
      skinId: "moon-dragon",
      quickSlots,
      requestId: randomUUID(),
    });
  const activate = (kind) => store.activateAccount(token, { kind, requestId: randomUUID() });
  return {
    store,
    token,
    profile,
    save,
    activate,
    expire: () => {
      now += accounts.WEEK;
    },
  };
}
test("Слоты: 5 базовых, 6 с VIP, 5 с Premium, без сложения статусов", () => {
  assert.equal(loadout.count(), 5);
  assert.equal(loadout.count({ vip: true }), 6);
  assert.equal(loadout.count({ premium: true }), 5);
  assert.equal(loadout.count({ vip: true, premium: true }), 6);
  assert.deepEqual(loadout.keys, ["A", "S", "D", "F", "G", "H"]);
  assert.equal(loadout.keyIndex("Digit1"), -1);
  assert.equal(loadout.keyIndex("KeyJ"), -1);
});

test("Перенос меняет занятые слоты местами, переносит в пустой и сохраняет закрытые назначения", () => {
  const original = ["candy", "ice_cream", null, "meat", "speed"];
  assert.deepEqual(loadout.move(original, 0, 1, 4), ["ice_cream", "candy", null, "meat", "speed"]);
  assert.deepEqual(loadout.move(original, 0, 2, 4), [null, "ice_cream", "candy", "meat", "speed"]);
  assert.deepEqual(loadout.move(["candy"], 0, 3, 4), [null, null, null, "candy"]);
  assert.deepEqual(original, ["candy", "ice_cream", null, "meat", "speed"]);
  for (const [from, to] of [
    [0, 4],
    [4, 0],
    [2, 0],
    [0, 0],
    [-1, 0],
    [0, 7],
    [0, 1.5],
  ])
    assert.equal(loadout.move(original, from, to, 4), null);
  assert.deepEqual(loadout.move(original, 4, 5, 6), [
    "candy",
    "ice_cream",
    null,
    "meat",
    null,
    "speed",
  ]);
});

test("Свободный слот учитывает короткие списки, промежутки и доступные 4/6 ячеек", () => {
  assert.equal(loadout.emptyIndex([], 4), 0);
  assert.equal(loadout.emptyIndex(["candy"], 4), 1);
  assert.equal(loadout.emptyIndex(["candy", null, "donut"], 4), 1);
  assert.equal(loadout.emptyIndex(ids.slice(0, 4), 4), -1);
  assert.equal(loadout.emptyIndex([...ids.slice(0, 4), null], 4), -1);
  assert.equal(loadout.emptyIndex(ids.slice(0, 4), 7), 4);
  assert.equal(loadout.emptyIndex(ids, 7), -1);
});
test("Сервер проверяет владение, уникальность и доступность всех шести слотов", () => {
  for (const kind of ["vip", "premium"]) {
    const f = fixture();
    f.save(ids.slice(0, 4));
    assert.throws(() => f.save(ids), /VIP/);
    f.activate(kind);
    const allowed = kind === "vip" ? 6 : 5;
    f.save(ids.slice(0, allowed));
    assert.deepEqual(f.profile().quickSlots, ids.slice(0, allowed));
    if (kind === "premium") {
      assert.throws(() => f.save(ids.slice(0, 6)), /VIP/);
      assert.throws(() => f.save(ids), /VIP/);
    }
    assert.throws(() => f.save([...ids, "web"]), /шести/);
    assert.throws(() => f.save([...ids.slice(0, 5), "candy"]), /разных/);
    assert.throws(() => f.save([...ids.slice(0, 5), "web"]), /имеющихся/);
  }
});
test("Истечение сохраняет выбор и предметы; редактирование обычных слотов не разблокирует дополнительные", () => {
  const f = fixture();
  f.activate("vip");
  f.save(ids);
  const inventory = structuredClone(f.profile().inventory);
  f.expire();
  assert.equal(loadout.count(f.store.view(f.profile()).account), 5);
  assert.deepEqual(f.profile().quickSlots, ids);
  assert.deepEqual(f.profile().inventory, inventory);
  f.save([null, ...ids.slice(1)]);
  assert.throws(
    () => f.save([null, ...ids.slice(1, 5), "candy"]),
    /VIP/,
  );
  f.store.buy(f.token, "web", randomUUID());
  assert.equal(f.profile().quickSlots[0], "web");
  assert.deepEqual(f.profile().quickSlots.slice(4), ids.slice(4));
  f.activate("vip");
  assert.equal(loadout.count(f.store.view(f.profile()).account), 6);
  assert.deepEqual(f.profile().quickSlots.slice(4), ids.slice(4));
});

test("Перезапуск сохраняет шесть слотов даже после истечения VIP; седьмой и дубли отвергаются", (t) => {
  const filePath = path.join(temporary(t, "loadout-disk"), "profiles.json"),
    f = fixture();
  f.activate("vip");
  f.save(ids);
  fs.writeFileSync(filePath, JSON.stringify(f.store.data));
  for (const now of [5000, 5000 + accounts.WEEK]) {
    const disk = new ProfileStore({ filePath, now: () => now });
    assert.deepEqual(disk.find(f.token).quickSlots, ids);
    assert.deepEqual(disk.find(f.token).inventory, f.profile().inventory);
    assert.equal(loadout.count(disk.view(disk.find(f.token)).account), now === 5000 ? 6 : 5);
  }
  for (const invalid of [
    [...ids, "web", "stone"],
    [...ids.slice(0, 5), "candy"],
  ]) {
    const data = structuredClone(f.store.data);
    Object.values(data.profiles)[0].quickSlots = invalid;
    const raw = JSON.stringify(data);
    fs.writeFileSync(filePath, raw);
    assert.throws(() => new ProfileStore({ filePath }), /Повреждены профили/);
    assert.equal(fs.readFileSync(filePath, "utf8"), raw);
  }
});

test("Истечение VIP оставляет 5 слотов Premium, сохраняя предметы в закрытом", () => {
  const f = fixture();
  f.activate("vip");
  f.save(ids);
  f.profile().inventory.golden_shield = 2;
  const inventory = structuredClone(f.profile().inventory);
  f.expire();
  f.activate("premium");
  assert.equal(loadout.count(f.store.view(f.profile()).account), 5);
  assert.deepEqual(f.profile().quickSlots, ids);
  f.save([ids[1], ids[0], ...ids.slice(2)]);
  assert.deepEqual(f.profile().quickSlots.slice(5), ids.slice(5));
  assert.equal(loadout.move(f.profile().quickSlots, 5, 0, 5), null);
  assert.throws(() => f.save([...ids.slice(0, 5), "golden_shield"]), /VIP/);
  assert.deepEqual(f.profile().inventory, inventory);
});
