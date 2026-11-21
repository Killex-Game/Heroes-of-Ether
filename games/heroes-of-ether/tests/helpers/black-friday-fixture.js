const { randomUUID } = require("node:crypto");
const { ProfileStore } = require("../../src/server/profiles/profile-store");
const { EventManager } = require("../../src/server/events/event-manager");
const B = require("../../src/server/events/black-friday");
module.exports = function fixture(options = {}) {
  let now = Date.UTC(2026, 10, 8, 12);
  const store = new ProfileStore({ ...options, now: () => now }),
    manager = new EventManager({ now: () => now });
  store.events = manager;
  const command = (action, args = {}) =>
    manager.apply("test", action, {
      requestId: randomUUID(),
      revision: manager.data.revision,
      ...args,
    });
  command("start", { eventId: B.manifest.id });
  const user = store.open(),
    p = () => store.find(user.token),
    run = manager.active();
  const view = () => B.view(p(), manager, now);
  const input = (action, id, extra = {}) => ({
    action,
    id,
    runId: run.id,
    day: B.day(now),
    requestId: randomUUID(),
    ...extra,
  });
  const act = (action, id, extra) => B.mutate(store, user.token, input(action, id, extra), () => 0);
  const progress = (...events) =>
    store.applyArenaProgress(
      randomUUID(),
      events.map((e) => ({ ...e, profileId: p().id })),
      now,
    );
  const life = () => {
    const lifeId = randomUUID();
    progress({ type: "lifeStarted", lifeId });
    now += 1000;
    progress({ type: "questSample", lifeId, food: 0, rank: 20 });
    now += 240000;
    const actions = [];
    for (let i = 0; i < 50; i++) actions.push({ type: "absorbed", lifeId: randomUUID(),
      victimProfileId: randomUUID(), victimPartId: randomUUID(), victimDefeated: true, gain: 1000 });
    let sequence = 0;
    for (const [metric, count] of [["hazards", 50], ["hazardHits", 15], ["rocketHits", 15], ["freezeHits", 15]])
      for (let i = 0; i < count; i++) actions.push({ type: "arenaAction", lifeId, metric, sequence: ++sequence, targetProfileId: randomUUID() });
    // The quota/rollover fixture exercises all catalog metrics. Dedicated action
    // tests verify their production hooks and transactional deduplication.
    store.transact(user.token, randomUUID(), "fixture-order-activity", draft => B.activity(draft, manager, {
      boosterUses:300,shieldUses:300,poisonHits:100,rareUses:200,commonUses:100,
      clanUses:300,advancedUses:150,purchasedBoosters:300,rouletteSpins:30,
      giftsGiven:10,giftsReceived:5,coinsEarned:5000,creditedKills:1500,life:50
    }, now));
    progress(
      ...actions,
      { type: "questSample", lifeId, food: 1000, rank: 20 },
      { type: "lifeEnded", lifeId, durationSeconds: 241, reason: "exit" },
    );
  };
  const complete = () => {
    for (let i = 0; i < 35 && view().dailyCompleted < 12; i++) {
      life();
      for (const o of view().orders) if (!o.claimed && o.progress >= o.target) act("order", o.id);
    }
    if (view().dailyCompleted !== 12) throw Error("Daily quota did not complete");
  };
  return {
    store,
    manager,
    user,
    p,
    run,
    command,
    view,
    input,
    act,
    progress,
    life,
    complete,
    now: () => now,
    time: (n) => (now = n),
  };
};

// Select a deterministic common order in the first visible slot for mechanics fixtures.
module.exports.forceOrder = function forceOrder(d, template) {
  let i = d.slots.findIndex(s => s.tier === 'common' && !s.complete);
  if (i < 0) {
    i = d.slots.findIndex(s => !s.complete && Number(s.current.id.split(':')[1]) === d.lanes[s.tier].issued - 1);
    const s = d.slots[i]; d.lanes[s.tier].issued--;
    s.tier = 'common'; s.current.id = 'common:' + d.lanes.common.issued++ + ':0'; s.current.revision = 0;
  }
  [d.slots[0], d.slots[i]] = [d.slots[i], d.slots[0]];
  const current = d.slots[0].current; current.template = template; current.progress = 0; delete current.opponents;
  return current;
};
