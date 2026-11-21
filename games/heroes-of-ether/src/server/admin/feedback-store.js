"use strict";
const fs = require("node:fs"), path = require("node:path"), { createHash } = require("node:crypto");
const { BoosterError } = require("../boosters/booster-catalog");
const HOUR = 3600000, hash = value => createHash("sha256").update(value).digest("hex");
const fail = (message, status = 400) => { throw new BoosterError(message, status); };
const requestId = id => typeof id === "string" && /^[a-zA-Z0-9_-]{16,80}$/.test(id);
function normalize(input) {
  if (!input || !requestId(input.requestId) || typeof input.text !== "string" || input.text.length > 4000) fail("Проверь текст отзыва.");
  const text = input.text.replace(/\r\n?/g, "\n").trim();
  if (!text || Array.from(text).length > 1000 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(text)) fail("Отзыв должен содержать от 1 до 1000 символов.");
  return { requestId: input.requestId, text };
}
// Single writer: the independent admin service. Its directory is already part
// of the protected administrative backup. No profile/world copies or Atlas I/O.
class FeedbackStore {
  constructor({ file = null, now = Date.now } = {}) {
    Object.assign(this, { file, now }); this.rows = new Map(); this.requests = new Map(); this.players = new Map();
    this.tail = Promise.resolve(); this.pending = 0; this.next = 1; this.closed = false;
    if (file) {
      fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
      fs.closeSync(fs.openSync(file, "a", 0o600));
      const fd = fs.openSync(file, "r+");
      try {
        const bytes = fs.readFileSync(fd); let offset = 0;
        while (offset < bytes.length) {
          const end = bytes.indexOf(10, offset); if (end < 0) { fs.ftruncateSync(fd, offset); fs.fsyncSync(fd); break; }
          const frame = JSON.parse(bytes.subarray(offset, end).toString("utf8"));
          if (frame.hash !== hash(JSON.stringify(frame.record))) throw Error("FEEDBACK_JOURNAL_CORRUPT");
          this.apply(frame.record); offset = end + 1;
        }
      } finally { fs.closeSync(fd); }
      if (process.platform !== "win32") { const dir = fs.openSync(path.dirname(file), "r"); try { fs.fsyncSync(dir); } finally { fs.closeSync(dir); } }
    }
  }
  apply(record) {
    if (record.op === "create") {
      const t = record.ticket;
      if (t.number !== this.next || t.status !== "new" || t.version !== 1 || t.dueAt !== t.createdAt + 72 * HOUR || !t.playerId || normalize({ text: t.text, requestId: record.requestId }).text !== t.text) throw Error("FEEDBACK_JOURNAL_CORRUPT");
      this.rows.set(t.number, Object.freeze(t)); this.next++;
      const list = this.players.get(t.playerId) || []; list.push(t.number); this.players.set(t.playerId, list);
      this.requests.set(t.playerId + ":" + record.requestId, { signature: t.text, number: t.number });
    } else if (record.op === "status") {
      const old = this.rows.get(record.number);
      if (!old || old.version !== record.version || !["new", "processed"].includes(record.status)) throw Error("FEEDBACK_JOURNAL_CORRUPT");
      this.rows.set(record.number, Object.freeze({ ...old, version: old.version + 1, status: record.status, updatedAt: record.at,
        handledAt: record.status === "processed" ? record.at : null, handledBy: record.status === "processed" ? record.actorName : null }));
      this.requests.set("admin:" + record.actorId + ":" + record.requestId, { signature: JSON.stringify([record.number, record.version, record.status]), number: record.number });
    } else throw Error("FEEDBACK_JOURNAL_CORRUPT");
  }
  enqueue(work) {
    if (this.closed || this.failed || this.pending >= 32) return Promise.reject(new BoosterError("Отзывы временно недоступны. Попробуй позже.", 503));
    this.pending++;
    const job = this.tail.then(() => {
      if (this.failed) throw new BoosterError("Отзывы временно недоступны. Попробуй позже.", 503);
      return work();
    }); this.tail = job.catch(() => {}).finally(() => { this.pending--; }); return job;
  }
  async append(record) {
    if (!this.file) return;
    const fd = await fs.promises.open(this.file, "r+"); let length;
    try {
      length = (await fd.stat()).size;
      const bytes=Buffer.from(JSON.stringify({ record, hash: hash(JSON.stringify(record)) }) + "\n");
      for(let offset=0;offset<bytes.length;){const {bytesWritten}=await fd.write(bytes,offset,bytes.length-offset,length+offset);if(!bytesWritten)throw Error('FEEDBACK_SHORT_WRITE');offset+=bytesWritten;}
      await fd.sync();
    }
    catch (error) { if (length !== undefined) { try { await fd.truncate(length); await fd.sync(); } catch { this.failed = true; } } throw new BoosterError("Не удалось сохранить отзыв. Повтори отправку.", 503); }
    finally { try { await fd.close(); } catch { this.failed = true; } }
  }
  submit(player, input) {
    const body = normalize(input);
    if (!player || typeof player.id !== "string" || !player.id || player.id.length > 100 || typeof player.name !== "string" || !player.name || player.name.length > 100) fail("Войди в игру заново.", 401);
    const identity = { id: player.id, name: player.name };
    return this.enqueue(async () => {
      const replay = this.requests.get(identity.id + ":" + body.requestId);
      if (replay) { if (replay.signature !== body.text) fail("Этот запрос уже отправлен с другим текстом.", 409); return { number: replay.number, replay: true }; }
      const at = this.now(), recent = (this.players.get(identity.id) || []).map(n => this.rows.get(n)).filter(t => t.createdAt > at - 24 * HOUR);
      if (recent.length >= 5 || recent.some(t => t.createdAt > at - 60000)) fail("Отзыв уже отправлен. Пожалуйста, попробуй позже.", 429);
      const record = { op: "create", requestId: body.requestId, ticket: { number: this.next, playerId: identity.id, playerName: identity.name, text: body.text,
        createdAt: at, dueAt: at + 72 * HOUR, status: "new", version: 1, handledAt: null, handledBy: null } };
      await this.append(record); this.apply(record); return { number: record.ticket.number, replay: false };
    });
  }
  detail(number) { const row = this.rows.get(Number(number)); if (!row) fail("Отзыв не найден.", 404); return { ...row }; }
  list({ page = 1, status = "all" } = {}) {
    if (!["all", "new", "processed"].includes(status)) fail("Неизвестный статус.");
    const rows = [...this.rows.values()].filter(t => status === "all" || t.status === status).reverse(), pages = Math.max(1, Math.ceil(rows.length / 10));
    page = Math.min(pages, Math.max(1, Math.floor(Number(page) || 1)));
    return { page, pages, total: rows.length, serverNow: this.now(), items: rows.slice((page - 1) * 10, page * 10).map(({ text, ...row }) => row) };
  }
  update(actor, input, authorize = () => {}) {
    if (!actor || !["owner", "moderator"].includes(actor.role)) fail("Нет доступа к отзывам.", 403);
    if (!input || !requestId(input.requestId) || !Number.isSafeInteger(input.number) || !Number.isSafeInteger(input.version) || !["new", "processed"].includes(input.status)) fail("Проверь статус отзыва.");
    const { number, version, status, requestId: id } = input, signature = JSON.stringify([number, version, status]);
    return this.enqueue(async () => {
      authorize();
      const replay = this.requests.get("admin:" + actor.id + ":" + id);
      if (replay) { if (replay.signature !== signature) fail("Номер запроса уже использован.", 409); return this.detail(number); }
      const old = this.detail(number); if (old.version !== version) fail("Статус уже изменён. Открой отзыв заново.", 409);
      if (old.status === status) return old;
      const record = { op: "status", number, version, status, requestId: id, at: this.now(), actorId: actor.id, actorName: actor.name || actor.login || actor.id };
      await this.append(record); this.apply(record); return this.detail(number);
    });
  }
  async close() { this.closed = true; await this.tail; }
}
module.exports = { FeedbackStore, normalize };
