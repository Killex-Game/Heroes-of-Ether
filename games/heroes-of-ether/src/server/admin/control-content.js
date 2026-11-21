"use strict";
// The control service owns only this outbox. The game remains the sole writer
// of profiles, content and their shared WAL. Revisions never silently rebase.
const fs = require('node:fs'), path = require('node:path');
const { randomUUID, createHash } = require('node:crypto');
const { BoosterError } = require('../boosters/booster-catalog');
const actions = require('./content-actions'), news = require('../profiles/game-news'), trash = require('./content-trash');
const domains = ['gameNews', 'promoCodes'];
const clone = value => structuredClone(value);
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const uuid = id => typeof id === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(id);
const fail = (message, status = 409) => { throw new BoosterError(message, status); };
function atomic(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const temp = file + '.' + randomUUID() + '.tmp', fd = fs.openSync(temp, 'wx', 0o600);
  try { fs.writeFileSync(fd, JSON.stringify(value)); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  try { fs.renameSync(temp, file); } catch (error) { fs.unlinkSync(temp); throw error; }
  if (process.platform !== 'win32') { const dir = fs.openSync(path.dirname(file), 'r'); try { fs.fsyncSync(dir); } finally { fs.closeSync(dir); } }
}
function snapshot(store, sources) {
  const audit = (store.data.administration?.audit || []).filter(e => domains.includes(e.action) || ['news-delete-many', 'editor-batch'].includes(e.action));
  const events = new Set(audit.map(e => e.id));
  return clone({ at: store.now(), sources, data: { profiles: {}, clans: {},
    ...Object.fromEntries(domains.filter(key => store.data[key]).map(key => [key, store.data[key]])),
    administration: { version: 1, audit, receipts: Object.fromEntries(Object.entries(store.data.administration?.receipts || {}).filter(([, r]) => events.has(r.eventId))) },
  } });
}
function validateSnapshot(value) {
  if (!value || !Number.isSafeInteger(value.at) || !Array.isArray(value.sources) || !value.data ||
      Object.keys(value.data.profiles || {}).length || Object.keys(value.data.clans || {}).length) throw Error('Invalid editor snapshot');
  news.validate(value.data); require('../profiles/promo-codes').validate(value.data); require('./moderation').validate(value.data);
}
function perform(store, access, actor, route, body, sources) {
  if (route === 'news') {
    if (body.action === 'delete-many') return require('./news-bulk-delete').remove(store, access, actor, body, sources);
    return actions.apply(store, access, actor, 'gameNews', body, news.normalize, null,
      body.action === 'delete' ? sources.find(row => row.id === body.id) : null);
  }
  if (route === 'trash') return trash.restore(store, access, actor, body);
  fail('Недоступная операция редакции.', 400);
}
function applyBundle(store, access, actor, bundle, sources) {
  if (!access.isOwner(actor)) fail('Редакция доступна только владельцу.', 403);
  if (!uuid(bundle?.id) || !Array.isArray(bundle.commands) || !bundle.commands.length || bundle.commands.length > 100 ||
      !bundle.base || Object.keys(bundle.base).some(key => !domains.includes(key))) fail('Некорректная очередь редакции.', 400);
  const signature = digest(bundle), previous = store.data.administration?.receipts[bundle.id];
  if (previous) {
    if (previous.signature !== signature || previous.actorId !== actor.id) fail('Номер очереди уже использован.');
    return { replay: true, snapshot: snapshot(store, sources) };
  }
  for (const [domain, hash] of Object.entries(bundle.base)) if (hash !== digest(store.data[domain] || null))
    fail('Данные изменились, пока игра была недоступна. Проверь ожидающие правки редакции.');
  const draft = { data: store.data, now: store.now.bind(store), save: next => { draft.data = next; } };
  const used = new Set();
  for (const command of bundle.commands) {
    if (!command || !Number.isSafeInteger(command.at) || command.at < 0 || command.at > store.now() + 30000 ||
        !command.body || !Array.isArray(command.ids) || command.ids.length>300 || new Set(command.ids).size!==command.ids.length || command.ids.some(id => !uuid(id) || used.has(id)))
      fail('Повреждена очередь редакции.', 400);
    command.ids.forEach(id => used.add(id));
    let index = 0; draft.now = () => command.at; draft.newId = () => {
      if (index >= command.ids.length) fail('Не совпадает состав операции редакции.');
      return command.ids[index++];
    };
    perform(draft, access, actor, command.route, command.body, sources);
    if (index !== command.ids.length) fail('Не совпадает результат операции редакции.');
  }
  for (const domain of domains) if (digest(draft.data[domain] || null) !== digest(store.data[domain] || null) &&
      !Object.hasOwn(bundle.base, domain)) fail('Не указана исходная версия данных редакции.', 400);
  const at = store.now(), event = { id: randomUUID(), at, actorId: actor.id, targetId: 'editor', targetName: 'Редакция',
    action: 'editor-batch', label: 'Правки редакции после обновления', reason: 'Применение сохранённой очереди', before: null,
    after: { commands: bundle.commands.length }, requestId: bundle.id };
  const admin = draft.data.administration;
  draft.data = { ...draft.data, administration: { ...admin, audit: [...admin.audit, event], receipts: { ...admin.receipts,
    [bundle.id]: { signature, actorId: actor.id, eventId: event.id } } } };
  store.save(draft.data, at);
  return { replay: false, snapshot: snapshot(store, sources) };
}
class ContentOutbox {
  constructor({ file, access, now = Date.now }) {
    Object.assign(this, { file, access, now });
    this.state = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null;
    if (this.state) {
      if (this.state.version !== 1 || !Array.isArray(this.state.commands) || this.state.commands.length > 100 ||
          (this.state.commands.length && !uuid(this.state.id))) throw Error('Invalid editor outbox');
      validateSnapshot(this.state.base); validateSnapshot(this.state.current);
    }
  }
  write(next) { atomic(this.file, next); this.state = next; }
  refresh(value) {
    validateSnapshot(value);
    if (this.state?.commands.length) return false;
    this.write({ version: 1, base: value, current: value, commands: [], id: null, sealed: false, error: null });
    return true;
  }
  view(route, input) {
    if (!this.state) fail('Редакция ещё не получила данные игрового сервера.', 503);
    const store = { data: this.state.current.data }, editor = this.status();
    return route === 'news' ? { ...news.view(store, true), sources: this.state.current.sources, editor }
      : { ...trash.view(store, input), editor };
  }
  status() { return { pending: this.state?.commands.length || 0, capturedAt: this.state?.base.at || null,
    sealed: !!this.state?.sealed, error: this.state?.error || null, operations: (this.state?.commands || []).map(c => c.route === "trash" ? "Восстановление из корзины" : c.body.action === "delete-many" ? "Удаление новостей: " + c.body.ids.length : c.body.action === "delete" ? "Удаление новости: " + c.body.id : c.body.title) }; }
  accept(actor, route, body) {
    if (!this.access.isOwner(actor)) fail('Редакция доступна только владельцу.', 403);
    if (!this.state) fail('Редакция ещё не получила данные игры.', 503);
    if (this.state.sealed || this.state.error) fail('Дождись применения или проверь конфликт предыдущих правок.');
    if (this.state.commands.length >= 100) fail('Очередь редакции заполнена. Дождись запуска игры.');
    const at = this.now(), ids = [], current = this.state.current;
    const draft = { data: current.data, now: () => at, newId: () => { const id = randomUUID(); ids.push(id); return id; }, save: next => { draft.data = next; } };
    const result = perform(draft, this.access, actor, route, body, current.sources);
    if (result.replay) return { ...result, queued: !!this.state.commands.length };
    const command = { route, body: clone(body), ids, at };
    this.write({ ...this.state, id: this.state.id || randomUUID(), current: { ...current, data: draft.data }, commands: [...this.state.commands, command] });
    return { ...result, queued: true };
  }
  bundle() {
    if (!this.state?.commands.length) return null;
    const changed = domains.filter(key => digest(this.state.current.data[key] || null) !== digest(this.state.base.data[key] || null));
    const value = { id: this.state.id, base: Object.fromEntries(changed.map(key => [key, digest(this.state.base.data[key] || null)])), commands: this.state.commands };
    if (!this.state.sealed) this.write({ ...this.state, sealed: true });
    return clone(value);
  }
  complete(value) { validateSnapshot(value); this.write({ version: 1, base: value, current: value, commands: [], id: null, sealed: false, error: null }); }
  conflict(message) { if (this.state) this.write({ ...this.state, error: String(message).slice(0,500) }); }
  discard(actor, value, input) {
    if (!this.access.isOwner(actor)) fail('Редакция доступна только владельцу.', 403);
    if (!this.state?.commands.length || (this.state.sealed && !this.state.error) || input.confirmed !== true ||
        typeof input.reason !== 'string' || input.reason.trim().length < 3 || input.reason.length > 500)
      fail('Сначала проверь результат доставки и подтверди отмену ожидающих правок.');
    validateSnapshot(value);
    atomic(path.join(path.dirname(this.file), 'cancelled', this.state.id + '.json'), {
      at: this.now(), actorId: actor.id, reason: input.reason.trim(), outbox: this.state,
    });
    this.complete(value);
  }
}
module.exports = { atomic, snapshot, applyBundle, ContentOutbox };
