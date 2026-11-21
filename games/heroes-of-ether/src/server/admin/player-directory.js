"use strict";
const { BoosterError } = require('../boosters/booster-catalog');
const { ownerView } = require('../chat/chat-rules');
const { activeBan } = require('./moderation');

function read(service, query = '', page = 1, options = {}) {
  const view = options.view || 'settings', registrations = view === 'registrations';
  const sort = options.sort || (registrations ? 'registeredAt' : 'name'), order = options.order || (registrations ? 'desc' : 'asc');
  if (typeof query !== 'string' || query.length > 64 ||
      !['settings', 'online', 'violators', 'registrations', 'kill'].includes(view) ||
      !['name', 'level', ...(registrations ? ['registeredAt'] : [])].includes(sort) ||
      !['asc', 'desc'].includes(order)) throw new BoosterError('Проверь параметры списка игроков.', 400);
  const q = query.trim().normalize('NFKC').toLocaleLowerCase('ru'), at = service.now();
  const found = [];
  for (const p of Object.values(service.profiles.data.profiles)) {
    if (registrations && p.testBot) continue;
    if (view === 'kill' && !p.kill) continue;
    if (q && !p.id.toLowerCase().includes(q) && !p.name.normalize('NFKC').toLocaleLowerCase('ru').includes(q)) continue;
    const inArena = service.inArena(p.id), online = inArena || !!service.profiles.isOnline?.(p.id);
    const moderation = view === 'violators' ? ownerView(p, at) : null;
    if (view === 'online' && (!online || p.testBot)) continue;
    if (view === 'violators' && !activeBan(p, at) && !moderation.mute &&
        !moderation.flood.strikes && !moderation.profanity.strikes) continue;
    const registrationTime = p.activity?.registeredAt;
    const registeredAt = Number.isSafeInteger(registrationTime) && registrationTime > 0 && registrationTime <= 8640000000000000 ? registrationTime : null;
    found.push({ p, online, inArena, moderation, registeredAt });
  }
  const direction = order === 'desc' ? -1 : 1;
  found.sort((a, b) => (view === 'settings' ? Number(b.online) - Number(a.online) : 0) ||
    (sort === 'registeredAt'
      ? Number(a.registeredAt === null) - Number(b.registeredAt === null) || direction * ((a.registeredAt || 0) - (b.registeredAt || 0))
      : direction * (sort === 'level' ? a.p.level - b.p.level : a.p.name.localeCompare(b.p.name, 'ru'))) ||
    a.p.name.localeCompare(b.p.name, 'ru') || a.p.id.localeCompare(b.p.id));
  const pages = Math.max(1, Math.ceil(found.length / 20));
  page = Math.min(pages, Math.max(1, Math.floor(Number(page) || 1)));
  return { view, sort, order, total: found.length, page, pages, capturedAt: at,
    players: found.slice((page - 1) * 20, page * 20).map(row => ({
      ...service.summary(row.p), online: row.online, inArena: row.inArena,
      ...(registrations ? { registeredAt: row.registeredAt } : {}),
      ...(view === 'kill' ? { kill: structuredClone(row.p.kill) } : {}),
      ...(row.moderation ? { chatModeration: row.moderation } : {}),
    })) };
}
module.exports = { read };
