"use strict";
const { copyProfile } = require("../profiles/owned-profile-draft");

const { randomUUID, createHash } = require('node:crypto');
const { BoosterError } = require('../boosters/booster-catalog');
const rewards = require('../profiles/promo-codes');
const { newBanId, isShort } = require('./ban-identifiers');
const accounts = require('../accounts/account-benefits');
const deltas = require('../profiles/immutable-table-delta');
const catalog = [...rewards.catalog, ...['vip', 'premium'].map(id => ({
  kind: 'account', id, name: id === 'vip' ? 'VIP (дни)' : 'Premium (дни)', category: 'Статусы', max: 365,
}))];
const fail = (message, status = 400) => { throw new BoosterError(message, status); };
const request = id => typeof id === 'string' && /^[a-zA-Z0-9_-]{16,80}$/.test(id);
const integer = n => Number.isSafeInteger(n) && n >= 0;
function normalizeRewards(rows) {
  if (!Array.isArray(rows) || !rows.length || rows.length > 50) fail('Добавь от 1 до 50 наград.');
  const seen = new Set();
  return rows.map(r => {
    if (!r || seen.has(r.kind + ':' + r.id)) fail('Объедини одинаковые награды.');
    seen.add(r.kind + ':' + r.id);
    if (r.kind !== 'account') return rewards.rewards([r])[0];
    if (!['vip', 'premium'].includes(r.id) || !integer(r.amount) || r.amount < 1 || r.amount > 365)
      fail('Укажи от 1 до 365 дней статуса.');
    return { kind: r.kind, id: r.id, amount: r.amount };
  });
}
function normalize(input) {
  if (typeof input.title !== 'string' || !input.title.trim() || input.title.length > 100 ||
      typeof input.message !== 'string' || input.message.trim().length < 3 || input.message.length > 500)
    fail('Укажи название подарка и сообщение игрокам (3–500 символов).');
  return { title: input.title.trim(), message: input.message.trim(), rewards: normalizeRewards(input.rewards) };
}
function describe(rows) {
  return rows.map(r => r.kind === 'account' ? { ...r, name: r.id === 'vip' ? 'VIP (дни)' : 'Premium (дни)',
    icon: null } : rewards.describe([r])[0]);
}
function viewNotice(p) { return (p.gameGiftNotices || []).slice(0, 20).map(n => ({ ...n, rewards: describe(n.rewards) })); }
function acknowledge(store, token, input) {
  if (!isShort(input.id)) fail('Неверный ID подарка.');
  return store.transactProfile(token, input.requestId, JSON.stringify(['game-gift-read', input.id]), p => {
    p.gameGiftNotices = (p.gameGiftNotices || []).filter(n => n.id !== input.id);
  });
}
function validateNotice(n) {
  if (!n || !isShort(n.id) || !integer(n.at)) throw Error('Повреждено уведомление о подарке.');
  normalize(n);
}
function validateProfile(p) {
  if (p.gameGiftNotices === undefined) return;
  if (!Array.isArray(p.gameGiftNotices) || new Set(p.gameGiftNotices.map(n => n?.id)).size !== p.gameGiftNotices.length)
    throw Error('Повреждены уведомления о подарках.');
  p.gameGiftNotices.forEach(validateNotice);
}
function validate(world) {
  const state = world.gameGrants;
  if (state !== undefined) {
    if (state?.version !== 1 || !Array.isArray(state.campaigns) || new Set(state.campaigns.map(c => c?.id)).size !== state.campaigns.length)
      throw Error('Повреждён журнал массовых начислений.');
    for (const c of state.campaigns) {
      validateNotice(c);
      if (!request(c.requestId) || !request(c.previewId) || typeof c.actorId !== 'string' ||
          !Array.isArray(c.targets) || new Set(c.targets).size !== c.targets.length || c.targets.some(id => typeof id !== 'string') ||
          !c.outcomes || typeof c.outcomes !== 'object' || Array.isArray(c.outcomes) ||
          Object.entries(c.outcomes).some(([id, o]) => !c.targets.includes(id) || !o || !integer(o.at) ||
            !['delivered', 'error', 'excluded'].includes(o.status) || (o.status === 'error' && typeof o.message !== 'string')))
        throw Error('Повреждены получатели массового начисления.');
    }
  }
  for (const p of Object.values(world.profiles)) validateProfile(p);
}
class GameGrants {
  constructor({ profiles, access, inArena = () => false, now = Date.now }) {
    Object.assign(this, { profiles, access, inArena, now });
    this.previews = new Map();
  }
  owner(actor) { if (!this.access.isOwner(actor)) fail('Массовые начисления доступны только владельцу.', 403); }
  preview(actor, input) {
    this.owner(actor);
    const value = normalize(input), at = this.now();
    for (const [id, p] of this.previews) if (p.expiresAt <= at) this.previews.delete(id);
    if (this.previews.size >= 20) this.previews.delete(this.previews.keys().next().value);
    const targets = Object.values(this.profiles.data.profiles).filter(p => !p.testBot).map(p => p.id).sort();
    if (!targets.length) fail('Нет реальных игроков для начисления.', 409);
    const previewId = randomUUID(), expiresAt = at + 10 * 60000;
    this.previews.set(previewId, { ...value, targets, actorId: actor.id, expiresAt });
    return { ...value, rewards: describe(value.rewards), previewId, expiresAt, recipients: targets.length };
  }
  summary(c) {
    const rows = Object.values(c.outcomes);
    return { id: c.id, at: c.at, title: c.title, message: c.message, rewards: describe(c.rewards), total: c.targets.length,
      delivered: rows.filter(o => o.status === 'delivered').length,
      excluded: rows.filter(o => o.status === 'excluded').length,
      pending: c.targets.length - rows.length,
      errors: Object.entries(c.outcomes).filter(([, o]) => o.status === 'error').map(([id, o]) => ({
        id, name: this.profiles.byId(id)?.name || id, message: o.message,
      })) };
  }
  view(actor, page = 1) {
    this.owner(actor);
    const rows = this.profiles.data.gameGrants?.campaigns || [], pages = Math.max(1, Math.ceil(rows.length / 10));
    page = Math.min(pages, Math.max(1, Math.floor(Number(page) || 1)));
    return { catalog, page, pages, total: rows.length, campaigns: rows.slice().reverse().slice((page - 1) * 10, page * 10).map(c => this.summary(c)) };
  }
  create(actor, input) {
    this.owner(actor);
    if (!request(input.requestId) || !request(input.previewId) || input.confirmed !== true) fail('Подтверди подготовленное начисление.');
    const world = this.profiles.data, rows = world.gameGrants?.campaigns || [];
    const signature = createHash('sha256').update(JSON.stringify(['game-grant', input.previewId])).digest('hex');
    const previous = world.administration?.receipts[input.requestId];
    if (previous) {
      if (previous.signature !== signature || previous.actorId !== actor.id) fail('Номер запроса уже использован.', 409);
      return { duplicate: true, campaign: this.summary(rows.find(c => c.requestId === input.requestId)) };
    }
    const preview = this.previews.get(input.previewId), at = this.now();
    if (!preview || preview.actorId !== actor.id || preview.expiresAt <= at) fail('Предпросмотр устарел. Проверь начисление заново.', 409);
    const existing = rows.find(c => c.previewId === input.previewId);
    if (existing) return { duplicate: true, campaign: this.summary(existing) };
    if (rows.filter(c => c.targets.length > Object.keys(c.outcomes).length).length >= 3) fail('Дождись завершения текущих начислений.', 409);
    const c = { id: newBanId(world), at, actorId: actor.id, requestId: input.requestId, previewId: input.previewId,
      title: preview.title, message: preview.message, rewards: preview.rewards, targets: preview.targets, outcomes: {} };
    const event = { id: randomUUID(), operationId: c.id, at, actorId: actor.id, actorName: 'Killex', targetId: '', targetName: 'Реальные игроки',
      action: 'game-grant', label: 'Подарок от игры', reason: c.message, before: null,
      after: { id: c.id, title: c.title, rewards: c.rewards, recipients: c.targets.length }, requestId: c.requestId };
    const admin = world.administration || { version: 1, audit: [], receipts: {} };
    this.profiles.save({ ...world, gameGrants: { version: 1, campaigns: [...rows, c] }, administration: {
      ...admin, audit: [...admin.audit, event], receipts: { ...admin.receipts,
        [c.requestId]: { signature, actorId: actor.id, eventId: event.id } },
    } }, at);
    return { duplicate: false, campaign: this.summary(c) };
  }
  retry(actor, input) {
    this.owner(actor);
    if (!isShort(input.id) || !request(input.requestId) || input.confirmed !== true) fail('Подтверди повторную доставку.');
    const world = this.profiles.data, rows = world.gameGrants?.campaigns || [], c = rows.find(c => c.id === input.id);
    if (!c) fail('Начисление не найдено.', 404);
    const signature = createHash('sha256').update('game-grant-retry:' + c.id).digest('hex'), admin = world.administration;
    const previous = admin.receipts[input.requestId];
    if (previous) {
      if (previous.signature !== signature || previous.actorId !== actor.id) fail('Номер запроса уже использован.', 409);
      return { duplicate: true, campaign: this.summary(c) };
    }
    const failed = Object.keys(c.outcomes).filter(id => c.outcomes[id].status === 'error');
    if (!failed.length) fail('Нет ошибок доставки для повторной попытки.', 409);
    const at = this.now(), event = { id: randomUUID(), at, actorId: actor.id, actorName: 'Killex', targetId: '',
      action: 'game-grant-retry', label: 'Повтор доставки подарка', reason: c.id, before: failed.length, after: 0, requestId: input.requestId };
    const next = { ...c, outcomes: Object.fromEntries(Object.entries(c.outcomes).filter(([, o]) => o.status !== 'error')) };
    this.profiles.save({ ...world, gameGrants: { version: 1, campaigns: rows.map(r => r === c ? next : r) },
      administration: { ...admin, audit: [...admin.audit, event], receipts: { ...admin.receipts,
        [input.requestId]: { signature, actorId: actor.id, eventId: event.id } } } }, at);
    return { duplicate: false, campaign: this.summary(next) };
  }
  deliver(limit = 10) {
    const world = this.profiles.data, rows = world.gameGrants?.campaigns;
    if (!rows) return false;
    const c = rows.find(c => c.targets.length > Object.keys(c.outcomes).length);
    if (!c) return false;
    const keys = new Map(Object.entries(world.profiles).map(([key, p]) => [p.id, key]));
    const at = this.now(), outcomes = { ...c.outcomes }, changed = [], table = { ...world.profiles };
    let processed = 0;
    for (const id of c.targets) {
      if (Object.hasOwn(outcomes, id) || this.inArena(id)) continue;
      const key = keys.get(id), current = table[key];
      if (!current || current.testBot) outcomes[id] = { status: 'excluded', at };
      else {
        const p = copyProfile(current);
        try {
          require('../events/easter-hunt').expire(p, at);
          rewards.grant(p, c.rewards.filter(r => r.kind !== 'account'), at);
          for (const r of c.rewards.filter(r => r.kind === 'account')) {
            p.account ||= accounts.fresh();
            p.account[r.id + 'Until'] = Math.max(at, p.account[r.id + 'Until']) + r.amount * 86400000;
          }
          accounts.validate(p);
          rewards.validateProfile(p);
          require('../profiles/league-appearance').validate(p);
          require('../events/easter-hunt').validate(p);
          require('../clans/clan-chest-rewards').validate(p);
          p.gameGiftNotices = [...(p.gameGiftNotices || []), { id: c.id, at, title: c.title, message: c.message, rewards: c.rewards }];
          p.revision++;
          table[key] = p; changed.push(key);
          outcomes[id] = { status: 'delivered', at };
        } catch (error) {
          // Validation/storage bugs must stop the batch; only a known balance
          // limit may isolate a recipient without losing everyone else's gift.
          if (!(error instanceof BoosterError)) throw error;
          outcomes[id] = { status: 'error', at, message: error.message };
        }
      }
      if (++processed >= Math.max(1, Math.min(10, limit))) break;
    }
    if (!processed) return false;
    deltas.remember(table, world.profiles, changed, true);
    this.profiles.save({ ...world, profiles: table,
      gameGrants: { version: 1, campaigns: rows.map(row => row === c ? { ...c, outcomes } : row) },
    }, at, { kind: 'admin', label: 'Подарок от игры: ' + c.title, actorId: c.actorId, requestId: c.requestId, detail: c.message });
    return true;
  }
}
module.exports = { GameGrants, normalizeRewards, describe, viewNotice, acknowledge, validate, validateProfile };
