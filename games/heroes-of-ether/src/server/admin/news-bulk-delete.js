"use strict";
const { createHash, randomUUID } = require('node:crypto');
const { apply, fail } = require('./content-actions');
const news = require('../profiles/game-news');
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
function remove(store, access, actor, input, sources = []) {
  if (!access.isOwner(actor)) fail('Только владелец может удалять новости.', 403);
  if (input.action !== 'delete-many' || input.confirmed !== true ||
      typeof input.requestId !== 'string' || !/^[a-zA-Z0-9_-]{16,80}$/.test(input.requestId) ||
      !Number.isSafeInteger(input.revision) || input.revision < 0 ||
      typeof input.reason !== 'string' || input.reason.trim().length < 3 || input.reason.length > 500 ||
      !Array.isArray(input.ids) || !input.ids.length || input.ids.length > 100 ||
      input.ids.some(id => typeof id !== 'string' || !id || id.length > 80) || new Set(input.ids).size !== input.ids.length)
    fail('Выбери от 1 до 100 новостей и подтверди удаление.');
  const ids = input.ids.slice().sort(), signature = hash(['news-delete-many', ids, input.revision, input.reason.trim()]);
  const previous = store.data.administration?.receipts[input.requestId];
  if (previous) {
    if (previous.signature !== signature || previous.actorId !== actor.id) fail('Номер операции уже использован.', 409);
    return { replay: true, deleted: ids.length };
  }
  if ((store.data.gameNews?.revision || 0) !== input.revision) fail('Список изменился. Обнови его перед удалением.', 409);
  const at = store.now();
  // Validate every deletion against a private content-only draft. The real
  // writer commits exactly once, with every trash item and receipt together.
  const draft = { data: store.data, now: () => at, newId: store.newId, save: next => { draft.data = next; } };
  for (const id of ids) apply(draft, access, actor, 'gameNews', {
    action: 'delete', id, confirmed: true, revision: draft.data.gameNews?.revision || 0,
    reason: input.reason.trim(), requestId: hash(['news-delete-item', input.requestId, id]),
  }, news.normalize, null, sources.find(row => row.id === id));
  const event = { id: store.newId?.() || randomUUID(), at, actorId: actor.id, targetId: 'gameNews', targetName: 'Новости',
    action: 'news-delete-many', label: 'Массовое удаление новостей', reason: input.reason.trim(),
    before: ids, after: null, requestId: input.requestId };
  const admin = draft.data.administration;
  draft.data = { ...draft.data, administration: { ...admin, audit: [...admin.audit, event],
    receipts: { ...admin.receipts, [input.requestId]: { signature, actorId: actor.id, eventId: event.id } } } };
  store.save(draft.data, at);
  return { replay: false, deleted: ids.length };
}
module.exports = { remove };
