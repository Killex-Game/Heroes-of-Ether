"use strict";
const test = require("node:test"), assert = require("node:assert/strict"), path = require("node:path"), fs = require("node:fs");
const { ProfileStore } = require("../../src/server/profiles/profile-store");
const { MARKER } = require("../../src/server/testing/arena-test-bots");
const { renamePopulation, assertOnlyRenames } = require("../../src/server/testing/population-name-spacing");
const { spacedNickname } = require("../../src/server/testing/spaced-nickname");
const { ProfileJournal, atomicSnapshot, recover } = require("../../src/server/profiles/profile-journal");
const { temporary } = require("../temp");
function fixture() {
  const store = new ProfileStore();
  for (const [name, bot] of [["МорскойМанул", true], ["ПельменьЗаУглом", true], ["Барсик", true], ["Морской манул", false]]) {
    const p = store.find(store.open().token); p.name = name;
    if (bot) { p.testBot = MARKER; p.testDisplayNameVersion = 2; }
  }
  return store.data;
}
test("spaced generated nicknames: cases, short alternatives, one-word names unchanged", () => {
  for (const [input, output] of [["НеВТильте", "Не в тильте"], ["МорскойМанул", "Морской манул"],
    ["sleepyFox", "Sleepy fox"], ["ПельменьЗаУглом", "Пельмень рядом"], ["Барсик", "Барсик"], ["ВЖУХ", "ВЖУХ"]])
    assert.equal(spacedNickname(input), output);
});
test("only marked composed bot names change; collisions, full world preservation and restart", async t => {
  const before = fixture(), saved = structuredClone(before), named = renamePopulation(before);
  assert.deepEqual(before, saved); assert.equal(named.renamedBots, 2); assert.equal(named.renamedClans, 0);
  assertOnlyRenames(before, named.data); assert(!named.botChanges.some(p => p.after === "Морской манул"));
  assert.deepEqual(renamePopulation(named.data).data, named.data);
  const file = path.join(temporary(t, "bot-spacing"), "profiles.json"); atomicSnapshot(file, before);
  const journal = new ProfileJournal(file); journal.commit(named.data); await journal.close();
  assertOnlyRenames(before, recover(file).data);
  const damaged = structuredClone(named.data); Object.values(damaged.profiles)[0].wallet.coins++;
  assert.throws(() => assertOnlyRenames(before, damaged));
});
test("failed fsync does not commit renamed bots", async t => {
  const before = fixture(), named = renamePopulation(before), file = path.join(temporary(t, "bot-spacing-failure"), "profiles.json");
  atomicSnapshot(file, before); const journal = new ProfileJournal(file), original = fs.fsyncSync;
  let fail = true; fs.fsyncSync = fd => { if (fd === journal.fd && fail) { fail = false; throw Error("Injected fsync"); } return original(fd); };
  try { assert.throws(() => journal.commit(named.data), /Injected/); }
  finally { fs.fsyncSync = original; await journal.close(); }
  assert.deepEqual(recover(file).data, before);
});
