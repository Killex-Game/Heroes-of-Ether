"use strict";
const { createHash } = require("node:crypto");
const RETENTION_MS = 48 * 60 * 60 * 1000;
const validated = new WeakMap();
function result(left, right, a, b, endedAt) {
  const sides = [{ id: left.id, name: left.name, prefix: left.prefix, score: a },
    { id: right.id, name: right.name, prefix: right.prefix, score: b }].sort((x, y) => x.id.localeCompare(y.id));
  return { id: "battle-" + createHash("sha256").update(JSON.stringify([endedAt, sides.map(s => s.id)])).digest("hex").slice(0, 32),
    endedAt, sides, winnerId: a === b ? null : a > b ? left.id : right.id };
}
function append(left, right, a, b, endedAt) {
  const entry = result(left, right, a, b, endedAt);
  for (const clan of [left, right]) {
    const rows = clan.battleHistory || [];
    if (!rows.some(row => row.id === entry.id)) clan.battleHistory = [...rows, entry];
  }
}
function validate(clan) {
  const rows = clan.battleHistory;
  if (rows === undefined || validated.get(rows) === clan.id) return;
  const broken = () => { throw Error("Повреждена история клановых битв."); };
  if (!Array.isArray(rows)) broken();
  const ids = new Set();
  for (const row of rows) {
    if (!row || !Number.isSafeInteger(row.endedAt) || row.endedAt < 0 || !Array.isArray(row.sides) || row.sides.length !== 2 ||
        row.sides.some(s => !s || typeof s.id !== "string" || !s.id || typeof s.name !== "string" || !s.name ||
          typeof s.prefix !== "string" || !Number.isSafeInteger(s.score) || s.score < 0) ||
        row.sides[0].id === row.sides[1].id || !row.sides.some(s => s.id === clan.id)) broken();
    const [a, b] = row.sides, expected = result(a, b, a.score, b.score, row.endedAt);
    if (row.id !== expected.id || row.winnerId !== expected.winnerId || ids.has(row.id)) broken();
    ids.add(row.id);
  }
  validated.set(rows, clan.id);
}
function message(row) {
  let [left, right] = row.sides;
  if (row.winnerId === right.id) [left, right] = [right, left];
  const name = side => (side.prefix ? "[" + side.prefix + "] " : "") + side.name;
  const text = row.winnerId
    ? "Клан «" + name(left) + "» победил клан «" + name(right) + "» со счётом " + left.score + ":" + right.score + "."
    : "Клановая битва «" + name(left) + "» и «" + name(right) + "» завершилась вничью: " + left.score + ":" + right.score + ".";
  return { id: row.id, at: row.endedAt, kind: "clan-battle-result", text,
    author: { id: "system:clan-battles", name: "Клановая битва", clanTag: "", status: "basic", level: null } };
}
function messages(clan, lastBattle, now) {
  const cutoff = now - RETENTION_MS;
  // The ledger remains durable; only the chat's existing 48-hour window is projected.
  const rows = (clan.battleHistory || []).filter(row => row.endedAt > cutoff && row.endedAt <= now);
  if (lastBattle?.opponent?.id && lastBattle.endedAt > cutoff && lastBattle.endedAt <= now) {
    const old = result(clan, lastBattle.opponent, lastBattle.own, lastBattle.enemy, lastBattle.endedAt);
    if (!rows.some(row => row.id === old.id)) rows.push(old);
  }
  return rows.map(message);
}
// Settlement may copy mutable clan state, but the append-only ledger is shared
// until a completed battle adds a new array. No growing history clone per tick.
function cloneClans(clans) {
  const { clanDraft } = require("./clan-draft");
  return Object.fromEntries(Object.entries(clans).map(([id, clan]) =>
    [id, clanDraft(clan, structuredClone)]));
}
module.exports = { append, validate, messages, cloneClans };
