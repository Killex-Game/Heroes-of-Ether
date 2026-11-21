"use strict";
const { randomUUID } = require("node:crypto"),
  fixture = require("./black-friday-fixture"),
  B = require("../../src/server/events/black-friday"),
  F = require("../../src/server/events/black-friday-chests"),
  Q = require("../../src/server/progression/personal-quests"),
  C = require("../../src/server/clans/clan-chest-rewards");
module.exports = function tokenChests(options = {}) {
  const f = fixture(options);
  const seed = (kind, tier) => {
    let id;
    if (kind === "friday") {
      // Create a valid event state without buying a coupon or crediting tokens.
      f.p().blackFriday ||= { runs: {} };
      f.p().blackFriday.runs[f.run.id] ||= { tokens: 0, completedOrders: 0,
        days: {}, purchases: {}, finalAt: null };
      F.grant(f.p(), f.run.id, f.now());
      id = f.p().blackFriday.chests.at(-1).id;
    } else if (kind === "clan") id = C.grant(f.p(), tier, f.now()).id;
    else {
      const def = Q.CATALOG.find(q => q.tier === tier);
      id = randomUUID();
      f.p().quests.pending.push({ ...Q.makeReward(tier, f.now(), true, () => 0),
        id, questId: def.id, title: def.name, receivedAt: f.now(), stored: true });
    }
    const act = (action, requestId = randomUUID(), extra = {}) => {
      if (kind === "friday") return B.mutate(f.store, f.user.token,
        f.input(action, id, { requestId, ...extra }), max => max - 1);
      if (kind === "clan") return f.store.clanChestAction(f.user.token,
        { action, chestId: id, requestId, ...extra });
      return f.store.questAction(f.user.token,
        { action: action === "open" ? "claim" : action, questId: id, requestId, ...extra });
    };
    if (kind === "clan") act("claim");
    const reward = () => {
      const view = f.store.view(f.p());
      if (kind === "friday") return view.fridayChests.find(c => c.id === id)?.reward;
      if (kind === "clan") return view.clanChests.items.find(c => c.id === id)?.reward;
      return view.quests.pending.find(c => c.id === id);
    };
    return { id, act, reward };
  };
  const tokens = () => f.p().blackFriday?.runs[f.run.id]?.tokens || 0;
  return { ...f, seed, tokens };
};
