"use strict";
const { parentPort } = require("node:worker_threads");
const { ProfileStore } = require("./profile-store");
const { EventManager } = require("../events/event-manager");
const { difference } = require("./profile-journal");
const { applyTransfer } = require("./profile-transfer");
const store = new ProfileStore();
let base = { profiles: {}, clans: {} }, prediction = null, at = 0;
store.now = () => at;
// Calculation only. This worker has no WAL, MongoDB, sockets or authority to
// publish a reward. Global competition/calendar settlement stays with the owner.
parentPort.on("message", message => {
  const started = performance.now();
  try {
    if (message.adopt !== null) {
      if (prediction?.id !== message.adopt) throw Error("Unknown calculation base");
      base = prediction.world;
    }
    base = applyTransfer(base, message.patch);
    store.data = base;
    Object.assign(store, message.context.options);
    store.events = message.context.events ? new EventManager({ now: store.now }) : undefined;
    if (store.events) store.events.data = message.context.events;
    const batches = message.batches || [message.batch], steps = [];
    let next = base;
    for (const batch of batches) {
      at = batch.at;
      const prior = next;
      store.data = prior;
      const draft = store.arenaProgressDraft(prior, batch.id, batch.progress, at);
      next = draft?.next || prior;
      const clanXp = prior.clanQuests ? [] : Object.entries(next.clans).flatMap(([id, clan]) => {
        const delta = clan.xp - prior.clans[id].xp;
        return delta ? [[id, delta]] : [];
      });
      steps.push({ ids: draft?.ids || [], clanXp,
        patch: difference({ profiles: next.profiles, ...(prior.clanQuests ? {clans:next.clans} : {}) },
          { profiles: prior.profiles, ...(prior.clanQuests ? {clans:prior.clans} : {}) }) });
    }
    prediction = { id: message.id, world: { profiles: next.profiles, clans: next.clans,
      ...(next.clanQuests ? {clanQuests:next.clanQuests} : {}) } };
    parentPort.postMessage({ id: message.id, ...(message.batches ? { steps } : steps[0]),
      computeMs: performance.now() - started });
  } catch {
    parentPort.postMessage({ id: message.id, failed: true });
  }
});
