"use strict";
const rules = require("../../../public/shared/alchemy-rules");
const { CircleIndex } = require("./spatial-collision-index");
const { modifiers } = require("./alchemy-effects");
class AlchemyField {
  constructor(arena) { this.arena = arena; this.runId = null; this.items = []; this.serial = 0; this.index = null; this.nextSpawnAt = 0; this.candidates = []; }
  setRun(run, now) {
    if ((run?.id || null) === this.runId) return;
    this.runId = run?.id || null; this.items = []; this.index = null; this.nextSpawnAt = now;
    if (this.runId) for (let i = 0; i < rules.MAX_PICKUPS; i++) this.spawn();
  }
  spawn() {
    const a = this.arena; let pick = a.random() * 100, ingredient = rules.ingredients.at(-1);
    for (const item of rules.ingredients) { pick -= item.weight; if (pick < 0) { ingredient = item; break; } }
    const radius = rules.PICKUP_RADIUS;
    this.items = [...this.items, { id: "alchemy:" + ++this.serial, alchemyIngredient: ingredient.id, eggType: null,
      x: radius + a.random() * (a.world.width - radius * 2),
      y: radius + a.random() * (a.world.height - radius * 2), radius }];
    this.index = null;
  }
  tick(now) {
    if (!this.runId || now < this.nextSpawnAt) return;
    this.nextSpawnAt = now + 1000;
    for (let i = 0; i < 2 && this.items.length < rules.MAX_PICKUPS; i++) this.spawn();
  }
  collect(p, parts, now) {
    if (!this.runId || !this.items.length || !p.profileId || p.isRemnant || p.dead || p.effects.lock > now) return false;
    if (!this.index) this.index = new CircleIndex(this.items, 256);
    const nearby = this.index.queryMany(parts, 0, this.candidates); let collected;
    for (const item of nearby) {
      if (!parts.some(part => { const r = part.radius + item.radius, dx = part.x - item.x, dy = part.y - item.y; return Math.abs(dx) < r && Math.abs(dy) < r && dx * dx + dy * dy < r * r; })) continue;
      if (p.alchemyRun !== this.runId) { p.alchemyRun = this.runId; p.alchemyIngredients = {}; p.alchemyPickupCount = 0; }
      const every = modifiers(p).ingredientEvery;
      const count = 1 + (every && ++p.alchemyPickupCount % every === 0 ? 1 : 0);
      p.alchemyIngredients[item.alchemyIngredient] = (p.alchemyIngredients[item.alchemyIngredient] || 0) + count;
      (collected ||= new Set()).add(item);
    }
    if (collected) { this.items = this.items.filter(i => !collected.has(i)); this.index = null; }
    return !!collected;
  }
  snapshot() { return this.items; }
}
function report(arena, p) {
  if (!p.profileId || p.isRemnant) return;
  arena.progressEvents.push({ type: "alchemyGather", playerId: p.id, lifeId: p.lifeId,
    natural: p.alchemyNatural || 0, runId: p.alchemyRun || null,
    ...(p.alchemyIngredients && { ingredients: { ...p.alchemyIngredients } }) });
}
module.exports = { AlchemyField, report };
