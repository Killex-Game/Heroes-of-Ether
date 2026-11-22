"use strict";
const KINDS = ['gift-send', 'clan-deposit', 'roulette', 'booster-purchase', 'currency-purchase', 'currency-purchase-attempt'];
const integer = (n, min = 0) => Number.isSafeInteger(n) && n >= min;
function validate(c) {
  const e = c?.lobbyEvidence;
  if (!c || c.version !== 1 || !/^[a-f0-9-]{36}$/.test(c.id || '') ||
      !['new', 'confirmed', 'dismissed'].includes(c.status) || !integer(c.createdAt) ||
      c.reason !== 'lobby-repeated-actions' || c.features !== null ||
      c.modelReady !== false || c.modelScore !== null || !Array.isArray(c.windows) || c.windows.length ||
      !e || e.version !== 1 || e.domain !== 'lobby-actions-v1' || !KINDS.includes(e.kind) ||
      e.rule !== 'five-sustained-windows-v1' || !Array.isArray(e.samples) || e.samples.length !== 5 ||
      !Array.isArray(e.vector) || e.vector.length !== 5 || e.vector.some(v => !Number.isFinite(v) || v < 0 || v > 1) ||
      typeof e.modelReady !== 'boolean' ||
      (e.modelScore !== null && (!Number.isFinite(e.modelScore) || e.modelScore < 0 || e.modelScore > 1)))
    throw Error('Повреждены материалы наблюдения Kill в лобби.');
  const trigger = e.trigger;
  if (!trigger || !['rapid-commands', 'sustained-repetition'].includes(trigger.kind) ||
      !integer(trigger.start) || !integer(trigger.end) || trigger.end <= trigger.start ||
      trigger.end > e.samples[0].start || !integer(trigger.count, 20) || e.samples.at(-1).end > trigger.end + 600000)
    throw Error('Повреждено основание включения Kill.');
  let previous = 0;
  for (const w of e.samples) {
    if (!w || !integer(w.start) || !integer(w.end) || w.end <= w.start || w.start < previous || w.end > c.createdAt ||
        !integer(w.count, 2) || !integer(w.medianIntervalMs, 1) || !integer(w.maxIntervalMs, 1) ||
        w.maxIntervalMs < w.medianIntervalMs || !Number.isFinite(w.regularFraction) || w.regularFraction < 0 || w.regularFraction > 1 ||
        !Number.isFinite(w.burstFraction) || w.burstFraction < 0 || w.burstFraction > 1 ||
        !/^[a-f0-9]{64}$/.test(w.eventsSha256 || ''))
      throw Error('Повреждены интервалы наблюдения Kill в лобби.');
    previous = w.end;
  }
  if (c.status !== 'new' && (!integer(c.reviewedAt) || c.reviewedAt < c.createdAt ||
      typeof c.reviewedBy !== 'string' || typeof c.reviewReason !== 'string' || c.reviewReason.length > 500))
    throw Error('Повреждено решение Kill по лобби.');
}
module.exports = { KINDS, validate };
