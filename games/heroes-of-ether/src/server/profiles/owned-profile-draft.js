"use strict";
const { copyArenaData } = require("./arena-profile-copy");

// Internal, audited writers only. These three archives are immutable:
// transaction-history replaces its log, receipt writers detach the map,
// roulette replaces its results map before appending a spin. Everything else,
// including unknown future fields, is private. The generic transact API keeps
// its full-copy contract for arbitrary callbacks.
function copyProfile(current, copy = structuredClone) {
  const { transactions, receipts, roulette, ...mutable } = current;
  const draft = copy(mutable);
  if (Object.hasOwn(current, "transactions")) draft.transactions = transactions;
  if (Object.hasOwn(current, "receipts")) draft.receipts = receipts;
  if (roulette && typeof roulette === "object" && !Array.isArray(roulette)) {
    const { results, ...state } = roulette;
    draft.roulette = copy(state);
    if (Object.hasOwn(roulette, "results")) draft.roulette.results = results;
  } else if (Object.hasOwn(current, "roulette")) draft.roulette = copy(roulette);
  return draft;
}
const lobbyDraft = current => copyProfile(current, copyArenaData);
module.exports = { copyProfile, lobbyDraft };
