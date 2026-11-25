"use strict";
const { copyArenaData } = require("../profiles/arena-profile-copy");

// Only audited clan writers use this draft. Both ledgers append by replacing
// their array; no writer edits a previously published entry. Unknown fields
// stay private so a new mechanic cannot accidentally mutate a saved snapshot.
function clanDraft(current, copy = copyArenaData) {
  const draft = {};
  for (const key of Object.keys(current)) {
    const value = key === "memberHistory" || key === "battleHistory"
      ? current[key] : copy(current[key]);
    if (key === "__proto__") Object.defineProperty(draft, key, {
      value, enumerable: true, writable: true, configurable: true,
    });
    else draft[key] = value;
  }
  return draft;
}
module.exports = { clanDraft };
