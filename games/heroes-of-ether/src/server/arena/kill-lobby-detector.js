"use strict";
const { createHash } = require('node:crypto');
const model = require('./kill-model');
const { KINDS } = require('./kill-lobby-evidence');
const WINDOW = 60000, MAX_GAP = 10000, LIMIT = 4096, TTL = 30 * 60000, INSPECTION = 10 * 60000;
const median = values => {
  const a = [...values].sort((x, y) => x - y);
  return Math.round((a[Math.floor((a.length - 1) / 2)] + a[Math.floor(a.length / 2)]) / 2);
};
function action(path, body) {
  if (path === '/api/social/action' && body?.action === 'gift') return 'gift-send';
  if (path === '/api/clans/action' && body?.action === 'deposit') return 'clan-deposit';
  if (path === '/api/roulette/action' && ['spin', 'spin-five'].includes(body?.action)) return 'roulette';
  if (path === '/api/shop/buy') return 'booster-purchase';
  if (path === '/api/mock-payments/confirm') return 'currency-purchase';
  if (path === 'currency-purchase-attempt') return 'currency-purchase-attempt';
  return null;
}
function fresh(at) { return { start: at, last: at, count: 0, intervals: [], hash: createHash('sha256') }; }
function summarize(w) {
  const m = median(w.intervals);
  return { start: w.start, end: w.last, count: w.count, medianIntervalMs: m,
    maxIntervalMs: Math.max(...w.intervals),
    regularFraction: w.intervals.filter(n => Math.abs(n - m) <= Math.max(100, m * .3)).length / w.intervals.length,
    burstFraction: w.intervals.filter(n => n < 50).length / w.intervals.length,
    eventsSha256: w.hash.digest('hex') };
}
function vector(samples) {
  const n = samples.length, average = key => samples.reduce((sum, w) => sum + w[key], 0) / n;
  return [Math.min(1, average('count') / 180), Math.min(1, 1000 / Math.max(1, average('medianIntervalMs'))),
    average('regularFraction'), 1 - average('burstFraction'), Math.min(1, average('maxIntervalMs') / MAX_GAP)];
}
function train(audit, kind) {
  // Distinct telemetry domains never share training vectors. Historical summaries
  // remain evidence; missing timing distributions are not manufactured from them.
  return model.train((audit || []).filter(e => e.action === 'killReview' &&
    e.after?.case?.reason === 'lobby-repeated-actions' &&
    e.after.case.lobbyEvidence?.domain === 'lobby-actions-v1' && e.after.case.lobbyEvidence.kind === kind)
    .map(e => ({ action: 'killReview', targetId: e.targetId,
      after: { case: { status: e.after.case.status, features: e.after.case.lobbyEvidence.vector } } })));
}
class KillLobbyDetector {
  constructor({ profiles, report, onError = () => {}, limit = LIMIT }) {
    Object.assign(this, { profiles, report, onError, limit });
    this.states = new Map(); this.retrain();
  }
  retrain() { this.models = Object.fromEntries(KINDS.map(k => [k, train(this.profiles.data.administration?.audit, k)])); }
  currencyAttempt(profile, body, at, options) {
    const receipts = require('../profiles/operation-receipts');
    if (!profile || body?.confirmed !== true || !/^[a-zA-Z0-9_-]{16,80}$/.test(body.requestId || '') ||
        !require('../../../public/shared/virtual-product-catalog').get(body.productId) ||
        receipts.read(profile, body.requestId) !== receipts.MISSING) return;
    this.accept(profile, 'currency-purchase-attempt', body, { replay: false }, at, options);
  }
  accept(profile, path, body, result, at, { stalled = false } = {}) {
    // Success samples and authenticated currency attempts are separate domains.
    // Retries never count twice; five spins in one command remain one action.
    const kind = action(path, body);
    if (!profile || profile.testBot || !kind || result?.replay !== false ||
        typeof body.requestId !== 'string' || body.requestId.length > 100 || !Number.isSafeInteger(at)) return;
    const key = profile.id + ':' + kind;
    if (profile.kill?.status === 'new') { this.states.delete(key); return; }
    if (stalled) { this.states.delete(key); return; }
    let s = this.states.get(key);
    if (!s || at < s.last || at - s.last > MAX_GAP || s.until && at >= s.until)
      s = { last: at, start: at, count: 0, window: null, until: 0 };
    this.states.delete(key);
    // Lazy LRU expiry, bounded independently of the number of registered accounts.
    while (this.states.size) {
      const [oldKey, old] = this.states.entries().next().value;
      if (this.states.size < this.limit && at - old.last <= TTL) break;
      this.states.delete(oldKey);
    }
    this.states.set(key, s); s.last = at;
    if (kind === 'currency-purchase-attempt') {
      s.seen ||= new Set(); s.ids ||= [];
      if (s.seen.has(body.requestId)) return;
      s.seen.add(body.requestId); s.ids.push(body.requestId);
      if (s.ids.length > 512) s.seen.delete(s.ids.shift());
    }
    if (!s.window) {
      // Passive trigger only: a few counters on the already processed action.
      // No interval history, hashing, prediction or player scan before arming.
      s.count++;
      const elapsed = at - s.start;
      const fast = s.count >= 20 && elapsed >= 2000 && elapsed <= 5000;
      const sustained = s.count >= 60 && elapsed >= 30000 && elapsed <= 180000;
      if (!fast && !sustained) {
        if (elapsed > 180000) { s.start = at; s.count = 1; }
        return;
      }
      s.trigger = { kind: fast ? 'rapid-commands' : 'sustained-repetition', start: s.start, end: at, count: s.count };
      s.until = at + INSPECTION; s.window = fresh(at); s.samples = [];
    }
    const w = s.window;
    if (w.count) w.intervals.push(at - w.last);
    w.last = at; w.count++;
    w.hash.update(JSON.stringify([body.requestId, at, body.action, body.giftId, body.targetId, body.amount, body.boosterId, body.productId]) + '\n');
    // A sub-second network batch is not regular human input telemetry. Drop an
    // overflowing window rather than retain unbounded per-request histories.
    if (w.intervals.length > 512) { s.window = fresh(at); s.samples = []; return; }
    if (at - w.start < WINDOW) return;
    const sample = summarize(w), m = this.models[kind];
    s.window = fresh(at);
    const enough = sample.count >= 20 && sample.medianIntervalMs >= 150 &&
      sample.medianIntervalMs <= 3000 && sample.burstFraction <= .1;
    const regular = enough && sample.regularFraction >= .75;
    if (!enough) { s.samples = []; return; }
    s.samples.push(sample); if (s.samples.length > 5) s.samples.shift();
    if (s.samples.length < 5) return;
    const x = vector(s.samples), score = m.ready ? model.predict(m, x) : null;
    if (!(regular && s.samples.every(w => w.regularFraction >= .75)) && !(m.ready && score >= .9)) return;
    const evidence = { version: 1, reason: 'lobby-repeated-actions', features: null, windows: [], modelReady: false, modelScore: null,
      lobbyEvidence: { version: 1, domain: 'lobby-actions-v1', kind, rule: 'five-sustained-windows-v1', trigger: s.trigger,
        samples: s.samples.slice(), vector: x, modelReady: m.ready, modelScore: score } };
    this.states.delete(key);
    Promise.resolve().then(() => this.report(profile.id, evidence)).catch(this.onError);
  }
}
module.exports = { KillLobbyDetector, action, train, vector };
