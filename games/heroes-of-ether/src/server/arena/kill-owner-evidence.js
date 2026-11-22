"use strict";
// Owner testimony is retained separately from machine observations and ban decisions.
const integer = (n, min = 0) => Number.isSafeInteger(n) && n >= min;
const text = (s, max) => typeof s === 'string' && s.trim().length > 0 && s.length <= max;
function normalize(input) {
  if (!input || !/^[a-f0-9]{64}$/.test(input.sourceSha256 || '') ||
      !/^[a-f0-9]{64}$/.test(input.analysisSha256 || '') || !text(input.summary, 1000) ||
      !Array.isArray(input.observations) || !input.observations.length || input.observations.length > 5)
    throw Error('Некорректные материалы ручной отметки Kill.');
  const observations = input.observations.map(o => {
    if (!o || !['clan-deposit', 'roulette', 'booster-purchase', 'gift-send'].includes(o.kind) ||
        !integer(o.start) || !integer(o.end) || o.end <= o.start || !integer(o.count, 2) ||
        !integer(o.medianIntervalMs) || o.medianIntervalMs > o.end - o.start)
      throw Error('Некорректная серия действий Kill.');
    return { kind: o.kind, start: o.start, end: o.end, count: o.count, medianIntervalMs: o.medianIntervalMs };
  });
  return { sourceSha256: input.sourceSha256, analysisSha256: input.analysisSha256,
    summary: input.summary.trim(), observations };
}
function validate(c) {
  const e = c?.ownerEvidence;
  if (!c || c.version !== 1 || !/^[a-f0-9-]{36}$/.test(c.id || '') ||
      !['new', 'confirmed', 'dismissed'].includes(c.status) || !integer(c.createdAt) ||
      c.reason !== 'owner-reported-automation' || c.features !== null || c.modelReady !== false ||
      c.modelScore !== null || !Array.isArray(c.windows) || c.windows.length ||
      !e || e.version !== 1 || e.domain !== 'lobby-repeat-v1' ||
      e.label !== 'automation-confirmed-by-owner' || !text(e.reportedBy, 100) ||
      e.reportedAt !== c.createdAt ||
      (c.status !== 'new' && (!integer(c.reviewedAt) || c.reviewedAt < c.createdAt ||
        !text(c.reviewedBy, 100) || !text(c.reviewReason, 500))))
    throw Error('Повреждена ручная отметка Kill.');
  const normalized = normalize(e);
  if (normalized.observations.some(o => o.end > e.reportedAt))
    throw Error('Серия действий Kill находится в будущем.');
}
function create(input, actorId, at, id) {
  const c = { id, version: 1, status: 'new', createdAt: at, reason: 'owner-reported-automation',
    features: null, windows: [], modelReady: false, modelScore: null,
    ownerEvidence: { ...normalize(input), version: 1, domain: 'lobby-repeat-v1',
      label: 'automation-confirmed-by-owner', reportedBy: actorId, reportedAt: at } };
  validate(c);
  return c;
}
module.exports = { normalize, validate, create };
