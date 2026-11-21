"use strict";
// Explicit offline repair; never imported by the running game.
const assert = require("node:assert/strict");
const { MARKER } = require("./arena-test-bots");
const { spacedNickname } = require("./spaced-nickname");
const { nicknamePool } = require("./population-name-catalog");
const { key } = require("../profiles/nickname-rules");
const { cleanName } = require("../arena/arena-simulation");
const { countProfanity } = require("../chat/profanity");
const { validateWorld } = require("../clans/clan-service");
const { REVISION } = require("../profiles/profile-journal");
const eligible = p => p.testBot === MARKER && p.testDisplayNameVersion === 2 && spacedNickname(p.name) !== p.name;
const valid = n => cleanName(n) === n && [...n].length <= 16 && !countProfanity(n);
function assertOnlyRenames(before, after) {
  const restored = structuredClone(after);
  for (const [id, p] of Object.entries(before.profiles)) if (eligible(p)) {
    const q = restored.profiles[id];
    assert.equal(q.revision, p.revision + 1);
    assert.equal(q.testDisplayNameVersion, 3);
    assert(valid(q.name));
    q.name = p.name; q.revision = p.revision; q.testDisplayNameVersion = p.testDisplayNameVersion;
  }
  if (Object.hasOwn(before, REVISION)) restored[REVISION] = before[REVISION];
  else delete restored[REVISION];
  assert.deepEqual(restored, before, "Only authored bot nicknames and their revisions may change");
}
function renamePopulation(data) {
  const next = structuredClone(data), profiles = Object.values(next.profiles);
  const reserved = new Set(profiles.filter(p => !eligible(p)).map(p => key(p.name)));
  const fallback = nicknamePool().filter(valid), changes = [];
  for (const p of profiles.filter(eligible).sort((a, b) => a.id.localeCompare(b.id))) {
    let name = spacedNickname(p.name);
    if (!valid(name) || reserved.has(key(name))) name = fallback.find(n => !reserved.has(key(n)));
    assert(name, "No free authored nickname");
    reserved.add(key(name)); changes.push({ id: p.id, before: p.name, after: name });
    p.name = name; p.revision++; p.testDisplayNameVersion = 3;
  }
  validateWorld(next); assertOnlyRenames(data, next);
  return { data: next, renamedBots: changes.length, renamedClans: 0, botChanges: changes, clanChanges: [] };
}
module.exports = { renamePopulation, assertOnlyRenames };
