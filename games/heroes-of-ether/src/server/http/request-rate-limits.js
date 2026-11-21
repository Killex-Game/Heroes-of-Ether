/* Ограничение частоты HTTP/WebSocket запросов. */
"use strict";

// Лимиты относятся к адресу TCP-соединения. X-Forwarded-For не доверяем:
// заголовок клиента не должен позволять обходить ограничения.
const HTTP_LIMITS = Object.freeze({
  api: Object.freeze({ capacity: 120, perSecond: 20 }),
  mutation: Object.freeze({ capacity: 40, perSecond: 8 }),
  registration: Object.freeze({ capacity: 32, perSecond: 0.1 }),
  upgrade: Object.freeze({ capacity: 40, perSecond: 10 }),
});

class RequestLimits {
  constructor({ now, limits = HTTP_LIMITS, maxAddresses = 4096, idleMs = 600000 } = {}) {
    if (
      typeof now !== "function" ||
      !Number.isInteger(maxAddresses) ||
      maxAddresses < 1 ||
      !Number.isFinite(idleMs) ||
      idleMs <= 0
    ) {
      throw new RangeError("Invalid request limiter configuration");
    }
    this.limits = Object.fromEntries(
      Object.entries(limits).map(([name, rule]) => {
        if (
          !Number.isFinite(rule.capacity) ||
          rule.capacity < 1 ||
          !Number.isFinite(rule.perSecond) ||
          rule.perSecond <= 0
        ) {
          throw new RangeError("Invalid request budget");
        }
        return [name, { ...rule }];
      }),
    );
    this.now = now;
    this.maxAddresses = maxAddresses;
    // Удаление записи допустимо только когда любой её бюджет уже восстановился.
    this.idleMs = Math.max(
      idleMs,
      ...Object.values(this.limits).map((r) => (r.capacity / r.perSecond) * 1000),
    );
    this.addresses = new Map();
    this.nextSweep = -Infinity;
    this.lastTime = -Infinity;
  }

  take(address, name) {
    const rule = this.limits[name];
    if (!rule) throw new RangeError("Unknown request budget");
    const time = Math.max(this.lastTime, this.now());
    if (!Number.isFinite(time)) throw new RangeError("Invalid limiter clock");
    this.lastTime = time;
    if (time >= this.nextSweep) {
      for (const [key, entry] of this.addresses) {
        if (time - entry.lastSeen >= this.idleMs) this.addresses.delete(key);
      }
      this.nextSweep = time + Math.min(60000, this.idleMs);
    }
    let entry = this.addresses.get(address);
    if (!entry) {
      // Не вытесняем активного клиента: иначе поток новых адресов сбрасывал бы лимиты.
      if (this.addresses.size >= this.maxAddresses)
        return {
          allowed: false,
          retryAfter: Math.max(1, Math.ceil((this.nextSweep - time) / 1000)),
        };
      entry = { lastSeen: time, buckets: new Map() };
      this.addresses.set(address, entry);
    }
    entry.lastSeen = time;
    const bucket = entry.buckets.get(name) || { tokens: rule.capacity, at: time };
    bucket.tokens = Math.min(
      rule.capacity,
      bucket.tokens + ((time - bucket.at) * rule.perSecond) / 1000,
    );
    bucket.at = time;
    entry.buckets.set(name, bucket);
    if (bucket.tokens < 1)
      return {
        allowed: false,
        retryAfter: Math.max(1, Math.ceil((1 - bucket.tokens) / rule.perSecond)),
      };
    bucket.tokens--;
    return { allowed: true, retryAfter: 0 };
  }
}

module.exports = { HTTP_LIMITS, RequestLimits };
