/* Чат арены живёт в памяти сервера; последние сообщения кланов сохраняются отдельно. */
"use strict";
const fs = require("node:fs"),
  path = require("node:path"),
  { randomUUID, createHash } = require("node:crypto");
const { BoosterError } = require("../boosters/booster-catalog");
const { RequestLimits } = require("../http/request-rate-limits");
const { benefits } = require("../accounts/account-benefits");
const { ChatModeration } = require("./chat-moderation");
const LIMIT = 100;
const CLAN_RETENTION_MS = 48 * 60 * 60 * 1000;
const ARENA_IDLE_RETENTION_MS = 15 * 60 * 1000;
class ChatService {
  constructor({ filePath = null, now = () => Date.now(), journal = false } = {}) {
    this.filePath = filePath;
    this.now = now;
    this.moderation = new ChatModeration({ now });
    this.profileFor = () => null;
    this.clanFor = () => undefined;
    this.arena = [];
    this.arenaRooms = new Map();
    this.arenaEmptySince = new Map();
    this.clans = {};
    this.achievementCounts = {};
    this.messageReceipts = {};
    this.onAccepted = () => {};
    this.limits = new RequestLimits({ now, limits: { chat: { capacity: 3, perSecond: 0.5 } } });
    const restored = filePath ? require('../profiles/profile-journal').recover(filePath) : null;
    if (restored && (fs.existsSync(filePath) || restored.revision)) {
      const saved = restored.data;
      if (
        saved.version !== 1 ||
        !saved.clans ||
        typeof saved.clans !== "object" ||
        Array.isArray(saved.clans)
      )
        throw Error("Повреждена история кланового чата");
      for (const rows of Object.values(saved.clans))
        if (
          !Array.isArray(rows) ||
          rows.length > LIMIT ||
          rows.some(
            (m) =>
              !m ||
              typeof m.id !== "string" ||
              typeof m.text !== "string" ||
              !m.author?.id ||
              !Number.isFinite(m.at),
          )
        )
          throw Error("Повреждена история кланового чата");
      this.clans = saved.clans;
      this.achievementCounts = saved.achievementCounts || {};
      this.messageReceipts = saved.messageReceipts || {};
      if (
        Array.isArray(this.achievementCounts) ||
        Array.isArray(this.messageReceipts) ||
        Object.entries(this.achievementCounts).some(
          ([id, n]) => !id || !Number.isSafeInteger(n) || n < 0,
        ) ||
        Object.entries(this.messageReceipts).some(
          ([id, r]) =>
            !/^[a-f0-9]{64}$/.test(id) ||
            !/^[a-f0-9]{64}$/.test(r?.signature) ||
            typeof r?.id !== "string",
        )
      )
        throw Error("Повреждён учёт сообщений чата");
    }
    // Reconcile saved counters once after startup, then retry only failed
    // credits. A quiet chat must not rescan every historical author forever.
    this.pendingCredits = new Set(Object.keys(this.achievementCounts));
    this.creditJobs = new Map();
    if(journal && filePath)this.writer=new (require('./chat-journal').ChatJournal)(filePath);
    this.pruneClans();
  }
  persist(clans, achievementCounts = this.achievementCounts, messageReceipts = this.messageReceipts) {
    if (!this.filePath) return;
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    fs.writeFileSync(this.filePath + ".tmp",
      JSON.stringify({ version: 1, clans, achievementCounts, messageReceipts }) + "\n",
      { mode: 0o600 });
    fs.renameSync(this.filePath + ".tmp", this.filePath);
  }
  pruneClans() {
    if(this.writer){
      if(this.now() < (this.nextExpiryAt??0) || this.pruning || this.writer.closed)return;
      this.pruning=this.writer.enqueue(()=>this.pruneDurable()).catch(error=>{
        console.error('Удаление истёкшей переписки отложено:',error.code||'ошибка записи');
      }).finally(()=>{this.pruning=null;});
      return;
    }
    const at = this.now();
    if (at < (this.nextExpiryAt ?? 0)) return;
    const cutoff = at - CLAN_RETENTION_MS;
    let clans = this.clans, nextExpiry = Infinity;
    for (const [id, rows] of Object.entries(this.clans)) {
      const keep = rows.filter(m => m.at > cutoff);
      if (keep.length !== rows.length) {
        if (clans === this.clans) clans = { ...clans };
        if (keep.length) clans[id] = keep;
        else delete clans[id];
      }
      for (const m of keep) nextExpiry = Math.min(nextExpiry, m.at + CLAN_RETENTION_MS);
    }
    // Write only at an actual expiration. Keep receipts and achievement counts:
    // pruning text must never make a retried send count twice.
    if (clans !== this.clans) this.persist(clans);
    this.clans = clans;
    this.nextExpiryAt = nextExpiry;
  }
  pruneEmptyArenas(occupiedRooms, at = this.now()) {
    for (const id of new Set(['arena-1', ...this.arenaRooms.keys(), ...this.arenaEmptySince.keys()])) {
      if (occupiedRooms.has(id)) { this.arenaEmptySince.delete(id); continue; }
      if (!this.arenaEmptySince.has(id)) this.arenaEmptySince.set(id, at);
      if (at - this.arenaEmptySince.get(id) < ARENA_IDLE_RETENTION_MS) continue;
      if (id === 'arena-1') this.arena.length = 0;
      else this.arenaRooms.delete(id);
      this.arenaEmptySince.delete(id);
    }
  }
  syncProgress() {
    let failure;
    for (const id of this.pendingCredits) {
      try {
        this.applyCredit(id);
      } catch (error) { failure ||= error; }
    }
    if (failure) throw failure;
  }
  credit(profileId) {
    this.pendingCredits.add(profileId);
    try {
      this.applyCredit(profileId);
    } catch (error) {
      // The message and counter are already durable. Delivery must not be lost
      // because the separate profile file needs retrying by syncProgress().
      console.error("Достижение чата ожидает сохранения:", error.code || "ошибка записи");
    }
  }
  applyCredit(id) {
    if (this.creditJobs.has(id)) return;
    const count = this.achievementCounts[id] || 0;
    const result = this.onAccepted(id, count);
    if (!result || typeof result.then !== 'function') { this.pendingCredits.delete(id); return; }
    let saved = false;
    const job = Promise.resolve(result).then(() => {
      saved = true;
      if ((this.achievementCounts[id] || 0) === count) this.pendingCredits.delete(id);
    }, error => {
      console.error('Достижение чата ожидает сохранения:', error.code || 'ошибка записи');
    }).finally(() => {
      this.creditJobs.delete(id);
      // A newer count can arrive during fsync. Keep one in-flight credit per
      // author, then commit the latest absolute value without losing increments.
      if (saved && this.pendingCredits.has(id)) this.credit(id);
    });
    this.creditJobs.set(id, job);
  }
  authorDetails(profile) {
    const account = benefits(profile, this.now());
    return {
      level: Number.isSafeInteger(profile.level) && profile.level > 0 ? profile.level : null,
      status: account.premium ? "premium" : account.vip ? "vip" : "basic",
    };
  }
  publicMessage({ requestId, ...message }) {
    // Старая переписка получает подпись из профиля без перезаписи файла истории.
    const profile = this.profileFor(message.author.id);
    const clan = profile ? this.clanFor(profile) : undefined;
    return {
      ...message,
      author: { ...message.author, ...(profile ? {
        ...this.authorDetails(profile),
        ...(typeof profile.name === "string" ? { name: profile.name } : {}),
        ...(clan !== undefined ? { clanTag: clan?.prefix || "" } : {}),
      } : {}) },
    };
  }
  member(profiles, profile, clanId) {
    if (!profile) throw new BoosterError("Сначала войди в игру.", 401);
    const clan = profiles.data.clans[profile.clanId];
    if (!clan || clan.id !== clanId || !clan.members.includes(profile.id))
      throw new BoosterError("Этот чат доступен только соклановцам.", 403);
    return clan;
  }
  history(room = null, after = "", arenaId = "arena-1", systemMessages = []) {
    if (typeof after !== "string" || after.length > 64)
      throw new BoosterError("Некорректный указатель сообщений.");
    if (room) this.pruneClans();
    let rows = room
      ? (this.clans[room] || []).filter(m=>m.at>this.now()-CLAN_RETENTION_MS)
      : arenaId === "arena-1"
        ? this.arena
        : this.arenaRooms.get(arenaId) || [];
    if (room && systemMessages.length) rows = [...rows, ...systemMessages]
      .sort((a, b) => a.at - b.at || a.id.localeCompare(b.id)).slice(-LIMIT);
    const index = after ? rows.findIndex((m) => m.id === after) : -1;
    const authors = {};
    if (room) for (const m of rows) {
      if (!Object.hasOwn(authors, m.author.id)) authors[m.author.id] = this.publicMessage(m).author;
    }
    return { messages: rows.slice(index + 1).map((m) => this.publicMessage(m)), reset: index < 0,
      ...(room ? { authors, expiresBefore: this.now() - CLAN_RETENTION_MS,
        systemMessages: rows.filter(m => m.kind === "clan-battle-result") } : {}) };
  }
  send(profile, clan, room, input, arenaId = "arena-1", authorize) {
    if(!this.writer)return this.sendNow(profile,clan,room,input,arenaId);
    // Bound and copy network input before queuing; later caller mutation cannot
    // change what is authorized or persisted. Membership is checked at execution.
    if(!input || typeof input.requestId!=='string' || input.requestId.length>36 ||
      typeof input.text!=='string' || input.text.length>560)
      return Promise.reject(new BoosterError('Некорректное сообщение.'));
    const message={requestId:input.requestId,text:input.text};
    return this.writer.enqueue(()=>{
      const current=authorize?.();
      return this.sendNow(current?.profile||profile,current ? current.clan : clan,room,message,arenaId);
    },profile?.id);
  }
  sendNow(profile, clan, room, input, arenaId) {
    if (!profile) throw new BoosterError("Сначала войди в игру.", 401);
    this.moderation.assertCanSend(profile);
    if (!input || typeof input.requestId !== "string" || !/^[a-f0-9-]{36}$/i.test(input.requestId))
      throw new BoosterError("Некорректный номер сообщения.");
    if (typeof input.text !== "string" || input.text.length > 560 || [...input.text].length > 280)
      throw new BoosterError("Сообщение должно содержать от 1 до 280 символов.");
    const text = input.text
      .replace(/[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/g, " ")
      .replace(/\s+/gu, " ")
      .trim();
    if (!text) throw new BoosterError("Напиши сообщение.");
    if (room) this.pruneClans();
    const rows = room
      ? this.clans[room] || []
      : arenaId === "arena-1"
        ? this.arena
        : this.arenaRooms.get(arenaId) || [];
    const hash = (value) => createHash("sha256").update(value).digest("hex");
    const receiptKey = hash(JSON.stringify([profile.id, input.requestId]));
    const signature = hash(
      JSON.stringify([room || (arenaId === "arena-1" ? null : arenaId), text]),
    );
    const receipt = this.messageReceipts[receiptKey];
    const previous = rows.find(
      (m) => m.author.id === profile.id && m.requestId === input.requestId,
    );
    if (receipt || previous) {
      if (receipt && receipt.signature !== signature)
        throw new BoosterError("Номер сообщения уже использован.", 409);
      this.credit(profile.id);
      // Old arena text is deliberately not persisted; its receipt still prevents a second count.
      if (!previous)
        return {
          message: {
            id: receipt.id,
            at: receipt.at,
            author: {
              id: profile.id,
              name: profile.name,
              clanTag: clan?.prefix || "",
              ...this.authorDetails(profile),
            },
            text,
          },
          duplicate: true,
        };
      if (previous.text !== text) throw new BoosterError("Номер сообщения уже использован.", 409);
      return { message: this.publicMessage(previous), duplicate: true };
    }
    const screened = this.moderation.check(profile, input.requestId, signature, text, room ? `clan:${room}` : `arena:${arenaId}`);
    // An asynchronous violation always rejects after its durable profile
    // commit. Do not deliver or count the offending message while it is staged.
    if (screened && typeof screened.then === "function") return screened;
    if (!this.limits.take(profile.id, "chat").allowed)
      throw new BoosterError("Слишком часто. Подожди пару секунд.", 429);
    const message = {
      id: randomUUID(),
      requestId: input.requestId,
      at: this.now(),
      author: {
        id: profile.id,
        name: profile.name,
        clanTag: clan?.prefix || "",
        ...this.authorDetails(profile),
      },
      text,
    };
    const next = [...rows, message].slice(-LIMIT);
    const count = (this.achievementCounts[profile.id] || 0) + 1;
    if (!Number.isSafeInteger(count))
      throw new BoosterError("Достигнут предел счётчика сообщений.", 409);
    if(this.writer)return this.persistMessage(profile,room,arenaId,next,message,receiptKey,signature,count);
    const clans = room ? { ...this.clans, [room]: next } : this.clans;
    const achievementCounts = { ...this.achievementCounts, [profile.id]: count };
    const messageReceipts = {
      ...this.messageReceipts,
      [receiptKey]: { signature, id: message.id, at: message.at },
    };
    if (this.filePath) {
      try {
        this.persist(clans, achievementCounts, messageReceipts);
      } catch (error) {
        console.error("Не удалось сохранить клановый чат:", error.message);
        throw new BoosterError("Не удалось сохранить сообщение. Повтори отправку.", 503);
      }
    }
    this.clans = clans;
    if (room) this.nextExpiryAt = Math.min(this.nextExpiryAt, message.at + CLAN_RETENTION_MS);
    if (!room) {
      if (arenaId === "arena-1") this.arena = next;
      else this.arenaRooms.set(arenaId, next);
    }
    this.achievementCounts = achievementCounts;
    this.messageReceipts = messageReceipts;
    this.credit(profile.id);
    return { message: this.publicMessage(message), duplicate: false };
  }
  async persistMessage(profile,room,arenaId,rows,message,key,signature,count){
    const receipt={signature,id:message.id,at:message.at};
    await this.writer.commit({
      ...(room?{clans:{set:{[room]:rows},remove:[]}}:{}),
      achievementCounts:{set:{[profile.id]:count},remove:[]},
      messageReceipts:{set:{[key]:receipt},remove:[]},
    },()=>{
      if(room){this.clans[room]=rows;this.nextExpiryAt=Math.min(this.nextExpiryAt??Infinity,message.at+CLAN_RETENTION_MS);}
      else if(arenaId==='arena-1')this.arena=rows;else this.arenaRooms.set(arenaId,rows);
      this.achievementCounts[profile.id]=count;this.messageReceipts[key]=receipt;
    });
    this.credit(profile.id);
    return {message:this.publicMessage(message),duplicate:false};
  }
  async pruneDurable(){
    const cutoff=this.now()-CLAN_RETENTION_MS,set={},remove=[];let nextExpiry=Infinity;
    for(const [id,rows]of Object.entries(this.clans)){
      const keep=rows.filter(m=>m.at>cutoff);
      if(keep.length!==rows.length){if(keep.length)set[id]=keep;else remove.push(id);}
      for(const m of keep)nextExpiry=Math.min(nextExpiry,m.at+CLAN_RETENTION_MS);
    }
    if(Object.keys(set).length||remove.length)await this.writer.commit({clans:{set,remove}},()=>{
      for(const id of remove)delete this.clans[id];Object.assign(this.clans,set);
    });
    this.nextExpiryAt=nextExpiry;
  }
  async close(){
    await this.writer?.close();this.syncProgress();
    while(this.creditJobs.size)await Promise.all([...this.creditJobs.values()]);
  }
}
module.exports = { ChatService };
