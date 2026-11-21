"use strict";
const { defaultLayout } = require('../../../public/shared/news-layout');
const { fail } = require("../admin/content-actions");
function normalize(input) {
  if (input.action === "delete") {
    if (input.confirmed !== true || typeof input.id !== "string" || !input.id || input.id.length > 80)
      fail("Подтверди удаление выбранной новости.");
    return { action: "delete", id: input.id };
  }
  if (input.action !== undefined) fail("Неизвестное действие с новостью.");
  if ((input.id !== undefined && (typeof input.id !== "string" || input.id.length > 80)) ||
      typeof input.title !== "string" || !input.title.trim() || input.title.length > 100 ||
      typeof input.body !== "string" || !input.body.trim() || input.body.length > 6000 ||
      !["news", "event", "release"].includes(input.category) || typeof input.visible !== "boolean" ||
      typeof input.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(input.date) ||
      !Number.isFinite(Date.parse(input.date)) || new Date(input.date).toISOString().slice(0, 10) !== input.date)
    fail("Заполни заголовок, текст (до 6000 знаков), дату и раздел новости.");
  if(input.layout!==undefined&&!['left','right','banner','columns'].includes(input.layout))fail('Неизвестный макет новости.');
  if(input.image!==undefined&&(typeof input.image!=='string'||(input.image!==''&&!/^\/news-media\/[a-f0-9]{64}\.png$/.test(input.image)&&!/^assets\/[a-zA-Z0-9_/-]+\.(webp|png)$/.test(input.image))))fail('Некорректный баннер новости.');
  if(input.sourceId!==undefined&&(typeof input.sourceId!=='string'||!/^(alfa-test-[a-z0-9.-]+|event:[a-zA-Z0-9_-]+)$/.test(input.sourceId)||input.sourceId.length>100))fail('Некорректный источник новости.');
  return { ...(input.id ? { id: input.id } : {}), title: input.title.trim(), body: input.body.trim(),
    date: input.date, category: input.category, visible: input.visible,
    layout:input.layout ?? defaultLayout,...(input.image!==undefined?{image:input.image}:{}),...(input.sourceId?{sourceId:input.sourceId}:{}) };
}
function view(store, admin = false) {
  const data = store.data.gameNews;
  return { revision: data?.revision || 0, hiddenSources:(data?.retiredSources||[]).map(n=>n.sourceId), items: (data?.items || []).filter(n => admin || n.visible || n.sourceId)
    .map(n => admin ? structuredClone(n) : { id: n.id, title: n.title, body: n.body, date: n.date, category: n.category,
      image:n.image,layout:n.layout,sourceId:n.sourceId,visible:n.visible,updatedAt:n.updatedAt })
    .sort((a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id)) };
}
function validate(world) {
  const data = world.gameNews;
  if (data === undefined) return;
  if (!data || data.version !== 1 || !Number.isSafeInteger(data.revision) || data.revision < 0 ||
      !Array.isArray(data.items) || new Set(data.items.map(n => n?.id)).size !== data.items.length)
    throw Error("Повреждён список новостей.");
  for (const n of data.items) {
    normalize(n);
    if (!n.id || !Number.isSafeInteger(n.createdAt) || !Number.isSafeInteger(n.updatedAt))
      throw Error("Повреждена новость.");
  }
  const sources=data.items.filter(n=>n.sourceId).map(n=>n.sourceId);if(new Set(sources).size!==sources.length)throw Error('Повтор источника новости.');
  if(data.retiredSources!==undefined&&(!Array.isArray(data.retiredSources)||data.retiredSources.some(n=>typeof n?.id!=='string'||typeof n.sourceId!=='string')))throw Error('Повреждены удалённые новости.');
}
module.exports = { normalize, view, validate };
