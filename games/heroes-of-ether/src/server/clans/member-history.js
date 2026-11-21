"use strict";

const { BoosterError } = require("../boosters/booster-catalog");
const ACTIONS = new Set(["created", "joined", "accepted", "role", "transfer", "kicked", "left"]);
const ROLES = new Set(["head", "manager", "officer", "member", "recruit"]);
const checked = new WeakSet();
const PAGE_SIZE = 40;
const person = (p) => ({ id: p.id, name: p.name });

// Called inside the same world transaction as the membership change. Names are
// snapshots: leaving the clan or renaming a profile must not erase its history.
function append(clan, action, actor, target, at, fromRole = null, toRole = null) {
  const rows = clan.memberHistory || [];
  clan.memberHistory = [...rows, {
    id: rows.length + 1, at, action, actor: person(actor), target: person(target),
    fromRole, toRole,
  }];
}

function validate(clan) {
  const rows = clan.memberHistory;
  if (rows === undefined || checked.has(rows)) return;
  const validPerson = (p) => p && typeof p.id === "string" && p.id.length > 0 &&
    typeof p.name === "string" && p.name.length > 0;
  if (!Array.isArray(rows) || rows.some((r, i) => !r || r.id !== i + 1 ||
    !Number.isSafeInteger(r.at) || r.at < 0 || !ACTIONS.has(r.action) ||
    !validPerson(r.actor) || !validPerson(r.target) ||
    (r.fromRole !== null && !ROLES.has(r.fromRole)) ||
    (r.toRole !== null && !ROLES.has(r.toRole))))
    throw Error("Повреждена история участников клана. Файл сохранений не перезаписан.");
  checked.add(rows);
}

// Membership must be authorized by the caller. History is never included in
// public clan listings, arena snapshots or the unrelated chat save file.
function page(clan, { after = "", before = "", genderOf = () => "unspecified" } = {}) {
  const displayPerson = (p) => {
    const gender = genderOf(p.id);
    return { ...person(p), gender: ["male", "female"].includes(gender) ? gender : "unspecified" };
  };
  const cursor = (s) => {
    if (s === "" || s === null) return 0;
    if (!/^[1-9]\d{0,15}$/.test(String(s)) || !Number.isSafeInteger(Number(s)))
      throw new BoosterError("Некорректный указатель истории клана.");
    return Number(s);
  };
  const newer = cursor(after), older = cursor(before), rows = clan.memberHistory || [];
  if (newer && older) throw new BoosterError("Укажи одно направление истории.");
  const reset = !older && (!newer || newer > rows.length);
  const end = older ? Math.min(older - 1, rows.length) :
    reset ? rows.length : Math.min(newer + PAGE_SIZE, rows.length);
  const start = newer && !reset ? Math.min(newer, end) : Math.max(0, end - PAGE_SIZE);
  return {
    entries: rows.slice(start, end).reverse().map((r) => ({
      id: r.id, at: r.at, action: r.action,
      actor: displayPerson(r.actor), target: displayPerson(r.target),
      fromRole: r.fromRole, toRole: r.toRole,
    })),
    reset, hasOlder: start > 0,
  };
}

module.exports = { append, validate, page };
