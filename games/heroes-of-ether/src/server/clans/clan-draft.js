"use strict";
const { copyArenaData } = require("../profiles/arena-profile-copy");

// Only audited clan writers use this draft. Both ledgers append by replacing
// their array; no writer edits a previously published entry. Unknown fields
// stay private so a new mechanic cannot accidentally mutate a saved snapshot.
function clanDraft(current, copy = copyArenaData) {
  const { memberHistory, battleHistory, ...mutable } = current;
  const draft = copy(mutable);
  if (Object.hasOwn(current, "memberHistory")) draft.memberHistory = memberHistory;
  if (Object.hasOwn(current, "battleHistory")) draft.battleHistory = battleHistory;
  return draft;
}
module.exports = { clanDraft };
