"use strict";
const { createHash } = require("node:crypto");
const MARKER = "local-clan-test-v1";
function assignBotGender(profile) {
  if (profile.testBot !== MARKER) throw Error("Bot identity requires the test marker");
  if (profile.testIdentityVersion === 1 && ["male", "female"].includes(profile.personal.gender)) return false;
  // Random UUIDs produce an even, stable choice. Repeating an offline repair
  // or restarting cannot reroll a bot's gender.
  const bit = createHash("sha256").update("bot-gender-v1:" + profile.id).digest()[0] & 1;
  profile.personal.gender = bit ? "female" : "male";
  profile.testIdentityVersion = 1;
  return true;
}
module.exports = { MARKER, assignBotGender };
