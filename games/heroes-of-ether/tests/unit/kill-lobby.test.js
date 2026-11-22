'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), { randomUUID } = require('node:crypto');
const { KillLobbyDetector, train } = require('../../src/server/arena/kill-lobby-detector');
const { validate, KillDetector } = require('../../src/server/arena/kill-detector');
const model = require('../../src/server/arena/kill-model');
const actions = [
  ['/api/social/action', { action: 'gift', giftId: 'clover', targetId: 'recipient' }],
  ['/api/clans/action', { action: 'deposit', amount: 100 }],
  ['/api/roulette/action', { action: 'spin-five' }],
  ['/api/shop/buy', { boosterId: 'candy' }],
];
function setup(options = {}) {
  const reports = [], profiles = { data: {}, ...options.profiles };
  const detector = new KillLobbyDetector({ profiles, report: async (id, evidence) => reports.push({ id, evidence }), ...options });
  return { detector, reports, player: { id: randomUUID() } };
}
function send(f, at, path = actions[0][0], body = actions[0][1], result = { replay: false }, extra) {
  f.detector.accept(f.player, path, { ...body, requestId: randomUUID() }, result, at, extra);
}
const flush = () => new Promise(resolve => setImmediate(resolve));
for (const [path, body] of actions) test('five sustained windows flag successful ' + path + ' without banning', async () => {
  const f = setup();
  for (let at = 100000; at <= 550000; at += 1300) send(f, at, path, body);
  await flush(); assert.equal(f.reports.length, 1);
  const c = { id: randomUUID(), status: 'new', createdAt: 560000, ...f.reports[0].evidence };
  validate(c); assert.equal(c.features, null); assert.equal(c.lobbyEvidence.samples.length, 5);
  assert(c.lobbyEvidence.samples.every(w => w.count < 50)); // spin-five is one command
  assert.equal(c.lobbyEvidence.modelReady, false); assert.equal(f.player.kill, undefined); assert.equal(f.player.moderation, undefined);
  assert.throws(() => validate({ ...c, createdAt: 1 }), /интервалы/);
  assert.throws(() => validate({ ...c, lobbyEvidence: { ...c.lobbyEvidence, vector: [1] } }), /материалы/);
});
test('replays, rejected requests, bots, open cases and unrelated reads do not contribute', async () => {
  for (const type of ['replay', 'missing', 'bot', 'open', 'prepare', 'read']) {
    const f = setup(); if (type === 'bot') f.player.testBot = true; if (type === 'open') f.player.kill = { status: 'new' };
    for (let at = 0; at < 400000; at += 1000) send(f, at,
      type === 'read' ? '/api/clans/updates' : type === 'prepare' ? '/api/roulette/action' : actions[0][0],
      type === 'prepare' ? { action: 'prepare' } : actions[0][1],
      type === 'replay' ? { replay: true } : type === 'missing' ? {} : { replay: false });
    await flush(); assert.equal(f.reports.length, 0, type); assert.equal(f.detector.states.size, 0, type);
  }
});
test('short bursts, variable manual intervals, pauses, clock reversal and server stalls do not make a five-window case', async () => {
  for (const type of ['burst', 'manual', 'pause', 'clock', 'stall']) {
    const f = setup(); let at = 0;
    for (let i = 0; i < 1000; i++) {
      at += type === 'burst' ? 1 : type === 'manual' ? [300, 1200, 4600, 2700][i % 4] : 1300;
      if (type === 'pause' && i % 100 === 0) at += 20000;
      if (type === 'clock' && i % 100 === 0) at -= 200000;
      send(f, at, ...actions[0], { replay: false }, { stalled: type === 'stall' });
    }
    await flush(); assert.equal(f.reports.length, 0, type);
  }
});
test('state is bounded across accounts and expired lazily, no separate poller needed', () => {
  const f = setup({ limit: 5 });
  for (let i = 0; i < 100; i++) { f.player = { id: 'p' + i }; send(f, i); }
  assert.equal(f.detector.states.size, 5);
  f.player = { id: 'later' }; send(f, 2000000); assert.equal(f.detector.states.size, 1);
});
test('detailed inspection starts only at a trigger and ends after a pause or its deadline', () => {
  const f = setup();
  for (let n = 0; n < 10; n++) send(f, n * 1000);
  let state = [...f.detector.states.values()][0];
  assert.equal(state.window, null); assert.equal(state.samples, undefined); assert.equal(state.until, 0);
  for (let n = 10; n < 60; n++) send(f, n * 1000);
  state = [...f.detector.states.values()][0];
  assert(state.window); assert.equal(state.trigger.kind, 'sustained-repetition');
  send(f, 80000); state = [...f.detector.states.values()][0]; assert.equal(state.window, null);
  for (let n = 1; n < 60; n++) send(f, 80000 + n * 1000);
  state = [...f.detector.states.values()][0]; const until = state.until;
  // An inspection that never satisfies the cadence rule still has a hard limit.
  for (let at = 140000; at < until; at += 7000) send(f, at);
  send(f, until); assert.equal([...f.detector.states.values()][0].window, null);
});
test('currency purchase attempts have independent evidence and exclude saved or repeated request IDs', async () => {
  const f = setup(); f.player.receipts = {}; const body = { confirmed: true, productId: 'bucks:change', requestId: randomUUID() };
  for (let n = 0; n < 450; n++) f.detector.currencyAttempt(f.player, body, n * 1000);
  assert.equal([...f.detector.states.values()][0].count, 1); assert.equal(f.reports.length, 0);
  f.detector.states.clear();
  for (let n = 0; n < 450; n++) f.detector.currencyAttempt(f.player, {...body, requestId: randomUUID()}, n * 1000);
  await flush(); assert.equal(f.reports.length, 1); assert.equal(f.reports[0].evidence.lobbyEvidence.kind, 'currency-purchase-attempt');
  validate({ id: randomUUID(), status: 'new', createdAt: 500000, ...f.reports[0].evidence });
  const saved = setup(); saved.player.receipts = { [body.requestId]: 'already completed' };
  for (let n = 0; n < 450; n++) saved.detector.currencyAttempt(saved.player, body, n * 1000);
  assert.equal(saved.detector.states.size, 0);
});
test('report persistence failure is handled and does not turn a completed action into failure', async () => {
  const errors = [], f = setup({ report: () => Promise.reject(Error('disk unavailable')), onError: e => errors.push(e.message) });
  for (let at = 0; at < 450000; at += 1000) send(f, at);
  await flush(); assert.deepEqual(errors, ['disk unavailable']);
});
test('lobby model waits for both independently reviewed classes and does not mix action domains or booster data', () => {
  const row = (id, status, kind = 'gift-send') => ({ action: 'killReview', targetId: id, after: { case: {
    reason: 'lobby-repeated-actions', status, features: null,
    lobbyEvidence: { domain: 'lobby-actions-v1', kind, vector: status === 'confirmed' ? [.8,.8,.9,.9,.2] : [.1,.2,.3,.8,.7] }
  } } });
  const rows = Array.from({ length: 40 }, (_, i) => row('p' + i, i % 2 ? 'confirmed' : 'dismissed'));
  assert(train(rows, 'gift-send').ready); assert.equal(train(rows, 'roulette').ready, false);
  assert.equal(train(Array.from({ length: 40 }, () => row('same', 'confirmed')), 'gift-send').ready, false);
  assert.equal(model.train(rows).positive, 0); assert.equal(model.train(rows).negative, 0);
  assert.equal(train([{ action: 'killReview', targetId: 'x', after: { case: { reason: 'gift-dispatch-pattern', status: 'confirmed', features: [1,1,1,1,1] } } }], 'gift-send').ready, false);
});
test('lobby evidence persists through ordinary Kill WAL queue, preserves economy and can be reviewed', async t => {
  const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
  const { ProfileStore } = require('../../src/server/profiles/profile-store');
  const { ArenaBoosterQueue } = require('../../src/server/profiles/arena-booster-queue');
  const { recover } = require('../../src/server/profiles/profile-journal');
  const { OwnerService } = require('../../src/server/admin/owner-service');
  const { OwnerAccess } = require('../../src/server/admin/owner-access');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'kill-lobby-'));
  const file = path.join(directory, 'profiles.json'); let at = Date.UTC(2026, 10, 22, 10);
  const profiles = new ProfileStore({ filePath: file, journal: true, now: () => at });
  t.after(async () => { await profiles.close(); assert(path.resolve(directory).startsWith(path.resolve(os.tmpdir()) + path.sep)); fs.rmSync(directory, { recursive: true, force: true }); }); const a = profiles.open(), b = profiles.open();
  const p = profiles.find(b.token), before = structuredClone(p), queue = new ArenaBoosterQueue(profiles);
  const kill = new KillDetector({ profiles, actionQueue: queue, now: () => at });
  const f = setup(); for (let n = 0; n < 450; n++) send(f, at + n * 1000); await flush(); at += 600000;
  assert(await kill.report(p.id, f.reports[0].evidence)); const saved = profiles.byId(p.id); validate(saved.kill);
  assert.deepEqual({ ...saved, kill: undefined, revision: before.revision }, { ...before, kill: undefined });
  const restored = Object.values(recover(file).data.profiles).find(x => x.id === p.id); assert.deepEqual(restored.kill, saved.kill);
  const service = new OwnerService({ profiles, access: new OwnerAccess({ ownerId: a.profile.id }), now: () => at });
  service.apply(profiles.find(a.token), { action: 'killReview', targetId: p.id, requestId: randomUUID(),
    revision: saved.revision, moderationRevision: 0, caseId: saved.kill.id, verdict: 'dismissed', reason: 'Проверен обычный игрок' });
  assert.equal(train(profiles.data.administration.audit, 'gift-send').negative, 1);
  assert(!profiles.byId(p.id).moderation.ban); assert.equal(model.train(profiles.data.administration.audit).negative, 0);
});
