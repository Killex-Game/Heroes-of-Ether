"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const { capture, createAudit } = require("../../scripts/benchmarks/alchemy-load-audit.cjs");
const rules = require("../../public/shared/alchemy-rules");
function scenario() {
  const profile = arena => ({ inventory: Object.fromEntries(rules.potions.map(p => [p.boosterId, 30])), receipts: {},
    progress: { session: arena ? { id: "life" } : null },
    alchemy: { natural: 1000000, ingredients: Object.fromEntries(rules.ingredients.map(i => [i.id, 100])) } });
  const world = { profiles: { arena: profile(true), lobby: profile(false) } }, before = capture(world), acks = [];
  for (const potion of rules.potions) {
    world.profiles.arena.inventory[potion.boosterId]--;
    acks.push({ key: "arena", type: "booster:" + potion.boosterId, id: "cast-" + potion.id });
  }
  const p = rules.potions[0], lobby = world.profiles.lobby;
  lobby.inventory[p.boosterId] += p.yield;
  for (const i of p.ingredients) lobby.alchemy.ingredients[i.id] -= i.count;
  lobby.alchemy.natural -= rules.NATURAL_PER_EXCHANGE;
  lobby.receipts.brew = JSON.stringify(["alchemy", "brew", p.id, "run"]);
  lobby.receipts.exchange = JSON.stringify(["alchemy", "exchange", null, null]);
  acks.push({ key: "lobby", type: "lobby:alchemy-brew", id: "brew" }, { key: "lobby", type: "lobby:alchemy-exchange", id: "exchange" });
  const audit = createAudit(before);
  for (const ack of acks) audit.observe(ack, world.profiles[ack.key]);
  return { world, before, acks, audit };
}
test("mixed alchemy audit reconciles every potion, recipe ingredient and lobby natural ether with ACKs", () => {
  const s = scenario(), result = s.audit.finish(s.world);
  assert.equal(result.casts, 16); assert.equal(result.brews, 1); assert.equal(result.exchanges, 1);
  assert.equal(result.exactInventories, true);
});
test("extra potion charge, lost recipe ingredient, bad exchange or duplicate ACK cannot pass", () => {
  for (const damage of [
    s => s.world.profiles.arena.inventory.alchemy_strength--,
    s => s.world.profiles.lobby.alchemy.ingredients.mushroom--,
    s => s.world.profiles.lobby.alchemy.natural++,
  ]) {
    const s = scenario(); damage(s); assert.throws(() => s.audit.finish(s.world), /mismatch/);
  }
  const s = scenario(); assert.throws(() => s.audit.observe(s.acks[0], s.world.profiles.arena), /Repeated/);
});
