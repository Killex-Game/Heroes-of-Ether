"use strict";
const { randomBytes, createHash } = require('node:crypto');
const { BoosterError } = require('../boosters/booster-catalog');
const launch = require('./launch');
const hash = value => createHash('sha256').update(value).digest('hex');
const PREFIX = 'killex-session.';
class PlatformSessions {
  constructor(config, { now = Date.now, maxSessions = 10000 } = {}) {
    this.config = require('./config').validate(config);
    this.now = now; this.maxSessions = maxSessions; this.sessions = new Map();
  }
  authenticate(search) {
    const identity = launch.verify(search, this.config, this.now());
    if (!identity) throw new BoosterError('Открой игру заново из VK или Одноклассников.', 401);
    return identity;
  }
  issue(identity, profiles) {
    const at = this.now();
    // This work happens on login, never on an arena tick or an API read.
    for (const [key, session] of this.sessions) if (session.expiresAt <= at) this.sessions.delete(key);
    if (this.sessions.size >= this.maxSessions) throw new BoosterError('Попробуй войти немного позже.',503);
    const opened = profiles.openPlatform(identity, this.config.sessionSecret);
    const ticket = randomBytes(32).toString('hex'), expiresAt = at + 12 * 3600000;
    this.sessions.set(hash(ticket), { token:opened.token, expiresAt });
    return { ticket, expiresAt, profile:opened.profile, created:opened.created, network:identity.network };
  }
  token(req, cookieToken) {
    const auth = req.headers.authorization;
    const protocolHeader = req.headers['sec-websocket-protocol'] || '';
    if (auth === undefined && !protocolHeader.includes(PREFIX))
      return this.config?.requirePlatform ? undefined : cookieToken(req);
    const protocols = protocolHeader.split(',').map(s=>s.trim());
    const tickets = protocols.filter(s=>s.startsWith(PREFIX));
    if (auth !== undefined || tickets.length) {
      if ((auth !== undefined && tickets.length) || tickets.length > 1) return undefined;
      const raw = auth !== undefined ? (/^Bearer ([a-f0-9]{64})$/.exec(auth)?.[1]) : tickets[0].slice(PREFIX.length);
      if (!raw || !/^[a-f0-9]{64}$/.test(raw)) return undefined;
      const entry = this.sessions.get(hash(raw));
      if (entry && entry.expiresAt > this.now()) return entry.token;
      return undefined;
    }
    return this.config?.requirePlatform ? undefined : cookieToken(req);
  }
  requested(req) { return req.headers.authorization !== undefined || (req.headers['sec-websocket-protocol'] || '').includes(PREFIX); }
}
module.exports = { PlatformSessions };
