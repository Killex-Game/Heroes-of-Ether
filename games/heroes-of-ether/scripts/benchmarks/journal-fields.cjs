"use strict";
// Replay real in-memory profile drafts. Storage, sockets and physics are not timed.
const fs = require('node:fs'), path = require('node:path'), Module = require('node:module');
const assert = require('node:assert/strict'), { createHash } = require('node:crypto');
const filename = require.resolve('../../src/server/profiles/profile-journal');
function source(file, exported = 'difference', canonical = filename) {
  const mod = new Module(canonical, module);
  mod.filename = canonical; mod.paths = Module._nodeModulePaths(path.dirname(canonical));
  mod._compile(fs.readFileSync(file, 'utf8'), canonical);
  return mod.exports[exported];
}
const baseline = source(process.env.BASELINE_JOURNAL || filename);
const candidate = source(process.env.CANDIDATE_JOURNAL || filename);
const { ProfileStore } = require('../../src/server/profiles/profile-store');
const { applyTransfer } = require('../../src/server/profiles/profile-transfer');
const candidateTransfer = process.env.CANDIDATE_TRANSFER ? source(process.env.CANDIDATE_TRANSFER, 'applyTransfer',
  require.resolve('../../src/server/profiles/profile-transfer')) : applyTransfer;
const samePatch = process.env.JOURNAL_EQUIVALENCE !== 'state';
if (process.env.JOURNAL_EQUIVALENCE && !['patch', 'state'].includes(process.env.JOURNAL_EQUIVALENCE)) throw Error('Invalid equivalence mode');
const at = Date.parse('2026-11-13T12:00:00Z');
const store = new ProfileStore({ now: () => at });
const event = process.env.JOURNAL_EVENT;
if (event) {
  if (event !== 'black-friday') throw Error('Invalid journal replay event');
  const manager = new (require('../../src/server/events/event-manager').EventManager)({ now: () => at });
  manager.apply('fixture', 'start', { requestId: require('node:crypto').randomUUID(), revision: manager.data.revision,
    eventId: require('../../src/server/events/black-friday').manifest.id });
  store.events = manager;
}
const users = Array.from({ length: 35 }, () => store.open());
for (const [i, user] of users.entries()) store.startLife(user.profile.id, 'field-replay-life-' + i);
let world = store.data;
const frames = [];
for (let step = 0; step < 180; step++) {
  const progress = users.flatMap((user, i) => [
    { profileId: user.profile.id, lifeId: 'field-replay-life-' + i, type: 'lifeTime', durationSeconds: step + 1 },
    { profileId: user.profile.id, type: 'massPeak', mass: 30000 + step },
    ...(event ? [{ profileId: user.profile.id, lifeId: 'field-replay-life-' + i,
      type: 'questSample', food: step * 2, rank: i + 1 }] : []),
    ...(step % 10 === 0 ? [{ profileId: user.profile.id, type: 'absorbed', victimProfileId: 'rival-' + step,
      victimDefeated: true, gain: 100 }] : []),
  ]);
  const next = store.arenaProgressDraft(world, 'fields-batch-' + step, progress, at + step * 1000)?.next || world;
  frames.push({ previous: world, next }); world = next;
}
const digest = createHash('sha256'), candidateDigest = createHash('sha256'); let bytes = 0, candidateBytes = 0;
const fieldBytes = {};
function countFields(patch, prefix) {
  for (const [key, value] of Object.entries(patch.set || {}))
    fieldBytes[prefix + key] = (fieldBytes[prefix + key] || 0) + Buffer.byteLength(JSON.stringify(value));
  for (const [key, nested] of Object.entries(patch.nested || {})) countFields(nested, prefix + key + '.');
}
for (const { previous, next } of frames) {
  const before = JSON.stringify(previous), a = baseline(next, previous), b = candidate(next, previous);
  const json = JSON.stringify(a);
  const candidateJson = JSON.stringify(b);
  if (samePatch) assert.equal(candidateJson, json);
  assert.deepEqual(applyTransfer(previous, JSON.parse(json)), next);
  assert.deepEqual(candidateTransfer(previous, JSON.parse(candidateJson)), next);
  assert.equal(JSON.stringify(previous), before);
  digest.update(json); bytes += Buffer.byteLength(json);
  candidateDigest.update(candidateJson); candidateBytes += Buffer.byteLength(candidateJson);
  for (const patch of Object.values(a.tables.profileEdits || {})) countFields(patch, 'profile.');
}
const repetitions = Number(process.env.JOURNAL_REPETITIONS || 12);
if (!Number.isSafeInteger(repetitions) || repetitions < 1 || repetitions > 100) throw Error('Invalid repetitions');
const timing = process.env.JOURNAL_TIMING || 'patch';
if (!['patch', 'encode'].includes(timing)) throw Error('Invalid timing mode');
async function main() {
  const results = [];
  for (const [i, name] of [...'BAABABBA'].entries()) {
    const difference = name === 'A' ? candidate : baseline;
    for (const f of frames) difference(f.next, f.previous);
    let ms = 0, edits = 0, encodedBytes = 0;
    for (let repeat = 0; repeat < repetitions; repeat++) {
      const started = performance.now();
      for (const f of frames) {
        const patch = difference(f.next, f.previous);
        edits += Object.keys(patch.tables.profileEdits || {}).length;
        if (timing === 'encode') {
          const body = JSON.stringify({ revision: 1, change: patch });
          encodedBytes += Buffer.from(createHash('sha256').update(body).digest('hex') + ' ' + body + '\n').length;
        }
      }
      ms += performance.now() - started;
      await new Promise(resolve => setImmediate(resolve));
    }
    results.push({ index: i, variant: name === 'A' ? 'candidate' : 'baseline', ms, edits, encodedBytes });
  }
  console.log(JSON.stringify({ exactState: true, exactPatch: samePatch, scope: 'offline journal ' + timing + '; no capacity claim', timing,
    frames: frames.length, event: event || null, bytes, candidateBytes, fieldBytes,
    sha256: digest.digest('hex'), candidateSha256: candidateDigest.digest('hex'), repetitions, results }));
}
main().catch(error => { console.error(error); process.exitCode = 1; });
