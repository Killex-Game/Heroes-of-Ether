"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { ArenaDirectory, desiredArenaCount, FULL_MESSAGE } = require("../arena-directory");
function ready(directory) {
  for (const room of directory.list()) if (room.status !== "ready") directory.markReady(room.id);
}
function join(directory, id, preferred) {
  assert.equal(directory.enterLobby(id).ok, true);
  const reservation = directory.reserve(id, preferred);
  assert.equal(reservation.ok, true);
  assert.equal(directory.confirm(id, reservation.ticket, reservation.workerLease).ok, true);
  ready(directory);
  return reservation;
}
test("точные пороги расширения до 13 арен", () => {
  for (const [count, arenas] of [
    [0, 3],
    [79, 3],
    [80, 5],
    [149, 5],
    [150, 7],
    [219, 7],
    [220, 9],
    [289, 9],
    [290, 11],
    [359, 11],
    [360, 13],
    [400, 13],
  ])
    assert.equal(desiredArenaCount(count), arenas, `players=${count}`);
});
test("starting не принимает игроков; заполненная выбранная арена перенаправляет", () => {
  const d = new ArenaDirectory();
  d.enterLobby("waiting");
  assert.equal(d.reserve("waiting").code, "ARENAS_FULL");
  ready(d);
  for (let i = 0; i < 35; i++) join(d, `p${i}`, "arena-1");
  const next = join(d, "next", "arena-1");
  assert.equal(next.arenaId, "arena-2");
  assert.equal(next.redirected, true);
  assert.equal(d.list()[0].playing, 35);
});
test("400 участников плюс 30 мест лобби; 401-й вход на арену отклонён", () => {
  const d = new ArenaDirectory();
  ready(d);
  for (let i = 0; i < 400; i++) join(d, `p${i}`);
  assert.equal(d.list().length, 13);
  assert.equal(
    d.list().reduce((sum, r) => sum + r.playing, 0),
    400,
  );
  assert.ok(d.list().every((r) => r.playing <= 35));
  for (let i = 0; i < 30; i++) assert.equal(d.enterLobby(`lobby${i}`).ok, true);
  assert.equal(d.reserve("lobby0").message, FULL_MESSAGE);
  assert.equal(d.enterLobby("overflow").code, "ONLINE_LIMIT");
  d.leaveArena("p0");
  assert.equal(d.reserve("lobby0").ok, true);
  assert.equal(d.players.size, 430);
});
test("бронь занимает место, истекает, привязана к игроку и применяется один раз", () => {
  let time = 0;
  const d = new ArenaDirectory({ now: () => time, policy: { workerHeartbeatTtlMs: 60000 } });
  ready(d);
  d.enterLobby("a");
  d.enterLobby("b");
  const first = d.reserve("a");
  assert.equal(d.reserve("a").code, "ALREADY_JOINING_OR_PLAYING");
  assert.equal(d.confirm("b", first.ticket, first.workerLease).ok, false);
  time = 15000;
  assert.equal(d.confirm("a", first.ticket, first.workerLease).ok, false);
  const second = d.reserve("a");
  assert.equal(d.confirm("a", second.ticket, "wrong-worker").ok, false);
  assert.equal(d.confirm("a", second.ticket, second.workerLease).ok, true);
  assert.equal(d.confirm("a", second.ticket, second.workerLease).ok, false);
});
test("одновременная волна броней не превышает 35; новые комнаты ждут готовности", () => {
  const d = new ArenaDirectory();
  ready(d);
  for (let i = 0; i < 105; i++) {
    d.enterLobby(`p${i}`);
    assert.equal(d.reserve(`p${i}`).ok, true);
  }
  d.enterLobby("wait");
  assert.equal(d.reserve("wait").ok, false);
  assert.ok(d.list().every((r) => r.reserved <= 35));
  assert.equal(d.list().length, 5);
  ready(d);
  assert.equal(d.reserve("wait").ok, true);
});
test("падение worker освобождает места, старые heartbeat и ticket не оживляют его", () => {
  let time = 0;
  const d = new ArenaDirectory({ now: () => time });
  ready(d);
  const old = join(d, "a");
  d.enterLobby("b");
  const pending = d.reserve("b");
  time = 10000;
  assert.equal(d.heartbeat(old.arenaId, old.workerLease), false);
  assert.equal(d.occupancy(), 0);
  assert.equal(d.confirm("b", pending.ticket, pending.workerLease).ok, false);
  const newLease = d.markReady(old.arenaId);
  assert.notEqual(newLease, old.workerLease);
  assert.equal(d.markOffline(old.arenaId, old.workerLease), false);
  assert.equal(d.heartbeat(old.arenaId, newLease), true);
});
test("лобби имеет срок присутствия, повторная вкладка не занимает второе место", () => {
  let time = 0;
  const d = new ArenaDirectory({ now: () => time });
  d.enterLobby("a");
  d.enterLobby("a");
  assert.equal(d.players.size, 1);
  time = 90000;
  d.sweep();
  assert.equal(d.players.size, 0);
});
test("отказ от брони и выход не уменьшают список и не удаляют чужие сессии", () => {
  const d = new ArenaDirectory();
  ready(d);
  for (let i = 0; i < 80; i++) join(d, `p${i}`);
  for (let i = 0; i < 79; i++) d.disconnect(`p${i}`);
  assert.equal(d.list().length, 5);
  assert.equal(d.occupancy(), 1);
  assert.equal(d.leaveArena("unknown"), false);
});
