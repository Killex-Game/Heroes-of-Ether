"use strict";
const { createHash, randomUUID } = require("node:crypto");
const { BoosterError } = require("../boosters/booster-catalog");
const fail = (text, status = 400) => { throw new BoosterError(text, status); };
// Same owner session/CSRF boundary and durable ProfileStore as economy edits.
// Only the content branch and audit branch are copied, never all player profiles.
function apply(store, access, actor, domain, input, normalize, restoreSource = null, sourceEntry = null) {
  if (!access.isOwner(actor)) fail("Только владелец может менять данные.", 403);
  if (!["promoCodes", "gameNews"].includes(domain)) fail("Этот раздел не допускает удаления или редактирования контента.", 403);
  if (!input || typeof input.requestId !== "string" || !/^[a-zA-Z0-9_-]{16,80}$/.test(input.requestId) ||
      !Number.isSafeInteger(input.revision) || input.revision < 0 ||
      typeof input.reason !== "string" || input.reason.trim().length < 3 || input.reason.length > 500)
    fail("Укажи версию, номер операции и причину от 3 до 500 символов.");
  const command = normalize(input);
  const deleting = command.action === "delete";
  const restoring = command.action === "restore";
  const signature = createHash("sha256").update(JSON.stringify([domain, command, input.revision, input.reason.trim()])).digest("hex");
  const receipt = store.data.administration?.receipts[input.requestId];
  if (receipt) {
    if (receipt.signature !== signature) fail("Номер операции уже использован.", 409);
    return { replay: true, id: receipt.targetId };
  }
  const old = store.data[domain] || { version: 1, revision: 0, items: [] };
  if (old.revision !== input.revision) fail("Список изменился. Обнови его перед сохранением.", 409);
  const previous = command.id && (old.items.find(item => item.id === command.id) ||
    (domain === 'gameNews' && deleting && sourceEntry?.id === command.id && !old.retiredSources?.some(n=>n.sourceId===command.id)
      ? {...sourceEntry,createdAt:store.now(),updatedAt:store.now()} : null));
  if (command.id && !previous && !restoring) fail("Запись не найдена.", 404);
  if (restoring && (!restoreSource || previous || !require("./content-trash").entries(store).some(e => e.id === restoreSource.id)))
    fail("Запись уже восстановлена или больше не находится в корзине.",409);
  if (restoring) require(domain === "promoCodes" ? "../profiles/promo-codes" : "../profiles/game-news").normalize(restoreSource.before);
  if (!previous && old.items.length >= 5000) fail("Достигнут предел записей.");
  const candidate = restoring ? restoreSource.before : command;
  if (domain === 'gameNews' && !deleting && !restoring && candidate.sourceId && old.retiredSources?.some(n => n.sourceId === candidate.sourceId))
    fail('Эта публикация удалена. Сначала восстанови её из корзины.',409);
  if (domain === 'gameNews' && previous?.sourceId && !deleting && candidate.sourceId !== previous.sourceId)
    fail('Источник существующей публикации менять нельзя.');
  if(domain==='gameNews'&&!deleting&&candidate.sourceId&&old.items.some(n=>n.id!==candidate.id&&n.sourceId===candidate.sourceId))fail('Эта публикация уже отредактирована. Обнови список.',409);
  if (domain === "promoCodes" && !deleting) {
    if (!restoring && old.retired?.some(item => item.code === command.code))
      fail("Этот промокод удалён. Для новой акции используй другой код.", 409);
    if (previous && previous.code !== command.code) fail("Код существующего промокода менять нельзя.");
    if (old.items.some(item => item.id !== command.id && item.code === candidate.code))
      fail("Этот промокод уже существует, в том числе среди отключённых.", 409);
    if (command.maxRedemptions && command.maxRedemptions < (previous?.redeemed || 0))
      fail("Лимит не может быть меньше числа активаций.");
  }
  const at = store.now(), id = previous?.id || (restoring ? command.id : (store.newId?.() || randomUUID()));
  const item = restoring ? { ...structuredClone(candidate), updatedAt: at } : deleting ? null : { ...command, id, createdAt: previous?.createdAt ?? at, updatedAt: at,
    ...(domain === "promoCodes" ? { redeemed: previous?.redeemed || 0 } : {}) };
  const next = { ...store.data, [domain]: { ...old, version: 1, revision: old.revision + 1,
    items: deleting ? old.items.filter(row => row.id !== id) : previous ? old.items.map(row => row.id === id ? item : row) : [...old.items, item],
    ...(deleting && domain === "promoCodes" ? { retired: [...(old.retired || []), { id, code: previous.code, deletedAt: at }] } : {}),
    ...(restoring && domain === "promoCodes" ? { retired: (old.retired || []).filter(row => row.id !== id) } : {}),
    ...(deleting && domain === "gameNews" && previous.sourceId ? {retiredSources:[...(old.retiredSources||[]),{id,sourceId:previous.sourceId}]} : {}),
    ...(restoring && domain === "gameNews" ? {retiredSources:(old.retiredSources||[]).filter(row=>row.id!==id)} : {}),
  } };
  const administration = store.data.administration || { version: 1, audit: [], receipts: {} };
  const event = { id: store.newId?.() || randomUUID(), at, actorId: actor.id, targetId: domain + ":" + id,
    targetName: deleting ? previous.code || previous.title : item.code || item.title, action: domain,
    label: restoring ? (domain === "promoCodes" ? "Восстановление промокода" : "Восстановление новости") : deleting ? (domain === "promoCodes" ? "Удаление промокода" : "Удаление новости") : domain === "promoCodes" ? "Промокод" : "Новость",
    reason: input.reason.trim(), before: previous || null, after: item, requestId: input.requestId };
  next.administration = { ...administration, audit: [...administration.audit, event],
    receipts: { ...administration.receipts, [input.requestId]: { signature, eventId: event.id, targetId: id } } };
  store.save(next, at);
  return { replay: false, id };
}
module.exports = { apply, fail };
