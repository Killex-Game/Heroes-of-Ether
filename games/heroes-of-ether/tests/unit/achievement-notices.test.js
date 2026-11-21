/* Модульные проверки игровых правил. */
"use strict";
const test = require("node:test"),
  assert = require("node:assert/strict");
const { Notices } = require("../../public/shared/achievement-notifications");
const storage = () => {
  const data = new Map();
  return { getItem: (k) => data.get(k) || null, setItem: (k, v) => data.set(k, v) };
};
const profile = (degree, revision = 1, id = "one") => ({
  id,
  revision,
  progress: { achievements: [{ id: "king", name: "Царь", claimed: degree }] },
});
test("event notices reset for each run and disappear when the event ends", () => {
  const n = new Notices(storage());
  const p = (run) => ({
    ...profile(1),
    progress: { achievements: [{ id: "lucky_lite", name: "Lite", claimed: 1, eventRunId: run }] },
  });
  n.update(p("first"));
  n.dismiss("lucky_lite", 1);
  assert.deepEqual(n.pending(), []);
  n.update({ ...profile(0), progress: { achievements: [] } });
  assert.deepEqual(n.pending(), []);
  n.update(p("second"));
  assert.equal(n.pending().length, 1);
});
test("Уведомления сохраняют непрочитанные степени до закрытия, не повторяют прочитанные после перезагрузки", () => {
  const saved = storage(),
    n = new Notices(saved);
  n.update(profile(0));
  assert.deepEqual(n.pending(), []);
  n.update(profile(1, 2));
  assert.deepEqual(n.pending(), [{ id: "king", name: "Царь", degree: 1 }]);
  const reloaded = new Notices(saved);
  reloaded.update(profile(1, 2));
  assert.equal(reloaded.pending().length, 1);
  reloaded.dismiss("king", 1);
  assert.deepEqual(reloaded.pending(), []);
  const closed = new Notices(saved);
  closed.update(profile(1, 2));
  assert.deepEqual(closed.pending(), []);
  closed.update(profile(3, 3));
  assert.equal(closed.pending()[0].degree, 3);
  closed.update(profile(0, 1));
  assert.equal(closed.pending()[0].degree, 3, "запоздалый снимок не отменяет награду");
});
test("Достижения другого профиля уведомляют отдельно; Карьера удалена", () => {
  const n = new Notices(storage());
  n.update(profile(1));
  n.dismiss("king", 1);
  n.update({ ...profile(1, 1, "two"), honors: { claimed: 2 } });
  assert.deepEqual(
    n.pending().map((a) => [a.id, a.degree]),
    [["king", 1]],
  );
  n.dismiss("king", 9);
  assert.equal(n.pending().length, 1);
  n.update(profile(1, 2));
  assert.deepEqual(n.pending(), []);
});
test("Повреждённое или недоступное хранилище не мешает уведомлениям и игре", () => {
  for (const saved of [
    { getItem: () => "{broken" },
    {
      getItem: () => {
        throw Error();
      },
      setItem: () => {
        throw Error();
      },
    },
  ]) {
    const n = new Notices(saved);
    n.update(profile(1));
    assert.equal(n.pending().length, 1);
    n.dismiss("king", 1);
    assert.deepEqual(n.pending(), []);
  }
});
