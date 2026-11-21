"use strict";
const { BoosterError } = require("../boosters/booster-catalog");
const DOMAINS = new Set(["promoCodes", "gameNews"]);
// The immutable owner audit already retains the full deleted object. Use it as
// the durable trash ledger, including deletions made before this UI existed.
function entries(store) {
  const deleted = new Map();
  for (const event of store.data.administration?.audit || []) {
    if (!DOMAINS.has(event.action)) continue;
    if (event.after === null && event.before?.id) deleted.set(event.targetId, event);
    else if (event.after?.id) deleted.delete(event.targetId);
  }
  return [...deleted.values()].filter(event => !(store.data[event.action]?.items || []).some(item => item.id === event.before.id));
}
function view(store, input = {}) {
  const page = Number(input.page || 1), q = input.q || "", domain = input.domain || "all";
  if (!Number.isSafeInteger(page) || page < 1 || typeof q !== "string" || q.length > 100 || (domain !== "all" && !DOMAINS.has(domain)))
    throw new BoosterError("Некорректный фильтр корзины.");
  const text = q.trim().toLocaleLowerCase("ru");
  const found = entries(store).filter(e => (domain === "all" || e.action === domain) && (!text || ((e.before.title || "") + " " + (e.before.code || "")).toLocaleLowerCase("ru").includes(text))).reverse();
  const pages = Math.max(1, Math.ceil(found.length / 20)), current = Math.min(page, pages);
  return { page: current, pages, total: found.length, items: found.slice((current - 1) * 20, current * 20).map(e => ({
    id: e.id, objectId: e.before.id, domain: e.action, title: e.before.title, code: e.before.code || null,
    deletedAt: e.at, reason: e.reason, revision: store.data[e.action]?.revision || 0,
    description: e.action === "gameNews" ? e.before.body.slice(0, 240) : "Активаций до удаления: " + (e.before.redeemed || 0),
  })) };
}
function restore(store, access, actor, input) {
  if (!access.isOwner(actor)) throw new BoosterError("Только владелец может восстанавливать контент.",403);
  if (!input || input.confirmed !== true || typeof input.trashId !== "string" || !input.trashId || input.trashId.length > 80)
    throw new BoosterError("Подтверди восстановление объекта из корзины.");
  const event = (store.data.administration?.audit || []).find(e => e.id === input.trashId && DOMAINS.has(e.action) && e.after === null && e.before?.id);
  if (!event) throw new BoosterError("Удалённая запись не найдена.",404);
  return require("./content-actions").apply(store,access,actor,event.action,input,
    () => ({action:"restore",id:event.before.id,trashId:event.id}),event);
}
module.exports = { entries, view, restore };
