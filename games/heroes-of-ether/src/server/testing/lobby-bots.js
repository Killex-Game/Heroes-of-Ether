"use strict";
const fs = require("node:fs");
const { randomUUID } = require("node:crypto");
const { MARKER } = require("./arena-test-bots");
const { skins } = require("../../../public/shared/player-identity");
const { BATTLE_MIN_MEMBERS } = require("../../../public/shared/clan-competition-rules");
const { gifts } = require("../profiles/gift-catalog");
const { sessionCookie } = require("../../../public/shared/platform-contract");

// Slow, opt-in actors using the same authenticated HTTP API as human players.
// No free currency, mocked gifts, chat messages or synthetic competition kills.
class LobbyBots {
  constructor({ profiles, configPath, sessionsPath, baseUrl, occupied, enabled, random = Math.random }) {
    Object.assign(this, { profiles, configPath, sessionsPath, baseUrl, occupied, enabled, random });
    this.busy = new Set();
    this.stats = { actions: 0, gifts: 0, outfits: 0, transfers: 0, events: 0, errors: 0 };
    this.pending = null;
    this.closed = false;
    this.cursor = 0;
  }
  start() {
    if (!this.configPath || !this.sessionsPath) return;
    this.timer = setInterval(() => this.tick(), 5000);
    this.timer.unref();
  }
  async post(session, route, input) {
    const body = JSON.stringify({ ...input, requestId: randomUUID() });
    // Same receipt on a transport retry; never repeat a financial operation with a new id.
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const res = await fetch(this.baseUrl() + route, { method: "POST", body,
          headers: { "content-type": "application/json", cookie: `${sessionCookie}=${session.token}` },
          signal: AbortSignal.timeout(8000) });
        if (!res.ok) throw Object.assign(Error("Bot action rejected"), { status: res.status });
        return await res.json();
      } catch (e) { if (e.status || attempt || this.closed) throw e; }
    }
  }
  tick() {
    if (this.closed || this.pending || !this.enabled()) return;
    this.pending = this.act().catch(() => { this.stats.errors++; }).finally(() => { this.pending = null; });
  }
  async act() {
    const config = JSON.parse(await fs.promises.readFile(this.configPath, "utf8"));
    if (!config.enabled || !config.lobbyEnabled) return;
    const sessions = JSON.parse(await fs.promises.readFile(this.sessionsPath, "utf8"));
    const idle = sessions.filter(s => {
      const p = this.profiles.find(s.token);
      return p?.id === s.id && p.testBot === MARKER && !this.occupied(s.id);
    });
    if (idle.length < 2 || this.closed) return;
    const session = idle[this.cursor++ % idle.length], p = this.profiles.byId(session.id);
    this.busy.add(p.id);
    try {
      if (this.cursor % 2 === 0 && await this.eventAction(session, p)) {
        this.stats.events++;
      } else if (this.cursor % 20 === 0) {
        const own = this.profiles.data.clans[p.clanId];
        const targets = Object.values(this.profiles.data.clans).filter(c => c.id !== p.clanId &&
          c.testOnly === MARKER && c.privacy === "open" && c.members.length < c.capacity);
        if ((!own || (own.testOnly === MARKER && own.ownerId !== p.id && own.members.length > BATTLE_MIN_MEMBERS)) &&
            targets.length && p.level >= 12 && p.wallet.coins >= 50) {
          const target = targets[Math.floor(this.random() * targets.length)];
          if (own) await this.post(session, "/api/clans/action", { action: "leave", clanId: own.id });
          await this.post(session, "/api/clans/action", { action: "apply", clanId: target.id });
          this.stats.transfers++;
        }
      } else if (this.cursor % 3 === 0) {
        // Public avatars only; existing slots and nickname are preserved.
        const current = this.profiles.byId(p.id);
        await this.post(session, "/api/profile/loadout", { name: current.name,
          skinId: skins[Math.floor(this.random() * skins.length)].id, quickSlots: current.quickSlots });
        this.stats.outfits++;
      } else {
        const affordable = gifts.filter(g => g.currency === "coins" && g.price <= p.wallet.coins);
        if (!affordable.length) return;
        const recipient = idle[(this.cursor + Math.floor(this.random() * (idle.length - 1))) % idle.length];
        if (recipient.id === p.id) return;
        await this.post(session, "/api/social/action", { action: "gift", confirmed: true,
          targetId: recipient.id, giftId: affordable[Math.floor(this.random() * affordable.length)].id });
        this.stats.gifts++;
      }
      this.stats.actions++;
    } finally { this.busy.delete(p.id); }
  }
  async eventAction(session, p) {
    // One ordinary action per visit. No invented progress, votes or free inventory.
    const view = this.profiles.view(p), f = view.blackFriday;
    if (f?.active) {
      const order = f.orders.find(o => !o.claimed && o.progress >= o.target);
      const base = { runId:f.runId, day:f.day };
      if (order) { await this.post(session,"/api/black-friday/action",{...base,action:"order",id:order.id}); return true; }
      if (!f.finalClaimed && f.completedOrders >= f.finalTarget) {
        await this.post(session,"/api/black-friday/action",{...base,action:"final"}); return true;
      }
      const stock = f.shop.filter(o => o.tokens <= f.tokens && (o.limit == null || o.bought < o.limit));
      if (stock.length && this.random() < .6) {
        const item = stock[Math.floor(this.random()*stock.length)];
        await this.post(session,"/api/black-friday/action",{...base,action:"buy",id:item.id}); return true;
      }
      const exchanges = f.exchanges.filter(o => (o.limit == null || o.used < o.limit) && p.wallet[o.currency] >= o.cost);
      if (exchanges.length && this.random() < .3) {
        const item=exchanges[Math.floor(this.random()*exchanges.length)];
        await this.post(session,"/api/black-friday/action",{...base,action:"exchange",id:item.id}); return true;
      }
    }
    const wheel = view.roulette;
    if (wheel?.available && wheel.tickets > 0) {
      const rulesVersion=require("../../../public/shared/roulette-rules").version;
      await this.post(session,"/api/roulette/action",wheel.offer
        ? {action:"spin",offerId:wheel.offer.id,rulesVersion}
        : {action:"prepare",rulesVersion});
      return true;
    }
    const easter=view.easter;
    if (easter?.active && easter.eggs?.every(n=>n>=require("../../../public/shared/easter-rules").eggsPerType)) {
      await this.post(session,"/api/easter/action",{action:"exchange",runId:easter.runId}); return true;
    }
    return false;
  }
  async close() { this.closed = true; clearInterval(this.timer); await this.pending; }
}
module.exports = { LobbyBots };
