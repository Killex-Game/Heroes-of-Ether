"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const { clanDraft } = require("../../src/server/clans/clan-draft");
const members = require("../../src/server/clans/member-history");
const battles = require("../../src/server/clans/battle-history");

test("audited clan drafts share immutable ledgers but isolate every other field", () => {
  const person = { id: "p", name: "Игрок" };
  const clan = { id: "a", name: "А", prefix: "A", treasury: 100,
    members: [person.id], futureEvent: { inventory: [1, 2] } };
  const rival = { id: "b", name: "Б", prefix: "B" };
  members.append(clan, "created", person, person, 1);
  battles.append(clan, rival, 3, 2, 2);
  const freeze = value => { if (value && typeof value === "object") {
    Object.freeze(value); Object.values(value).forEach(freeze);
  } };
  freeze(clan);
  for (const draft of [clanDraft(clan), battles.cloneClans({ a: clan }).a]) {
    assert.deepEqual(draft, clan);
    assert.strictEqual(draft.memberHistory, clan.memberHistory);
    assert.strictEqual(draft.battleHistory, clan.battleHistory);
    draft.futureEvent.inventory.push(3); draft.members.push("q"); draft.treasury--;
    assert.deepEqual(clan.futureEvent.inventory, [1, 2]);
    assert.deepEqual(clan.members, [person.id]); assert.equal(clan.treasury, 100);
    members.append(draft, "joined", person, person, 3);
    battles.append(draft, { ...rival, battleHistory: [] }, 4, 1, 4);
    assert.equal(clan.memberHistory.length, 1); assert.equal(clan.battleHistory.length, 1);
    assert.equal(draft.memberHistory.length, 2); assert.equal(draft.battleHistory.length, 2);
    members.validate(draft); battles.validate(draft);
  }
});
