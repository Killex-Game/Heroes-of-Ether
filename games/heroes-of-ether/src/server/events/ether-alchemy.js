"use strict";
const rules = require("../../../public/shared/alchemy-rules");
const { findRunAt } = require("./event-run-lookup");
const { BoosterError } = require("../boosters/booster-catalog");
const achievements = require("./alchemy-achievements");
const integer = n => Number.isSafeInteger(n) && n >= 0;
const object = value => value && typeof value === "object" && !Array.isArray(value);
const add = (a, b) => { if (!integer(a) || !integer(b) || !integer(a + b)) throw new BoosterError("Хранилище алхимии переполнено.", 409); return a + b; };
const empty = Object.freeze({ version: 1, natural: 0, ingredients: Object.freeze({}), learned: Object.freeze([]), equipped: null });
const runAt = (manager, at) => findRunAt(manager, at, rules.manifest.contentPack);
function view(profile, manager, at) {
  const saved = profile.alchemy || empty, run = runAt(manager, at);
  return { active: !!run, runId: run?.id || null, endsAt: run ? Math.min(run.endsAt, run.stoppedAt ?? Infinity) : null,
    natural: saved.natural, exchangeCount: Math.floor(saved.natural / rules.NATURAL_PER_EXCHANGE),
    ingredients: { ...saved.ingredients }, learned: [...saved.learned], equipped: saved.equipped,
    queue: [...rules.equipped(saved)],
    potions: Object.fromEntries(rules.potions.map(p => [p.id, profile.inventory[p.boosterId] || 0])),
  };
}
// Trusted, cumulative simulation counters. The existing life and batch/WAL
// boundaries reject old lives; duplicate totals do not create currency/items.
function progress(profile, manager, event, at) {
  achievements.observe(profile, manager, event, at);
  if (event.type === "lifeStarted" && profile.alchemy?.active && profile.alchemy.active.lifeId !== event.lifeId)
    profile.alchemy = { ...profile.alchemy, active: null };
  if (event.type === "lifeEnded" && profile.alchemy?.active?.lifeId === event.lifeId)
    profile.alchemy = { ...profile.alchemy, active: null };
  if (event.type !== "alchemyGather") return;
  const session = profile.progress.session;
  if (!session || session.id !== event.lifeId) return;
  if (!integer(event.natural)) throw Error("Invalid natural ether counter");
  const previous = session.alchemyNatural || 0;
  const saved = profile.alchemy || empty;
  let next = saved;
  if (event.natural > previous) {
    next = { ...saved, natural: add(saved.natural, event.natural - previous) };
    session.alchemyNatural = event.natural;
  }
  const run = event.runId && runAt(manager, at);
  if (run && run.id === event.runId && object(event.ingredients)) {
    const before = session.alchemyRun === run.id ? session.alchemyIngredients || {} : {};
    let inventory = next.ingredients, totals = before;
    for (const [id, total] of Object.entries(event.ingredients)) {
      if (!rules.ingredient(id) || !integer(total)) throw Error("Invalid alchemy pickup counter");
      if (total <= (before[id] || 0)) continue;
      if (inventory === next.ingredients) inventory = { ...inventory };
      if (totals === before) totals = { ...before };
      inventory[id] = add(inventory[id] || 0, total - (before[id] || 0));
      totals[id] = total;
    }
    if (inventory !== next.ingredients) {
      next = { ...next, ingredients: inventory };
      session.alchemyRun = run.id; session.alchemyIngredients = totals;
    }
  }
  if (next !== saved) {
    profile.alchemy = next;
    const count = Object.entries(next.ingredients).reduce((sum,[id,n]) => sum + n - (saved.ingredients[id] || 0),0);
    if (count) achievements.record(profile,run,{alchemy_ingredients:count},at);
  }
}
function mutate(store, token, input, batch) {
  if (!object(input) || !["brew", "equip", "exchange"].includes(input.action) ||
      Object.keys(input).some(k => !["action", "requestId", "potionId", "potionIds", "runId"].includes(k)))
    throw new BoosterError("Неизвестное действие лаборатории.");
  const potion = rules.get(input.potionId);
  if (input.action !== "exchange" && input.potionIds === undefined && input.potionId !== null && !potion)
    throw new BoosterError("Неизвестное зелье.");
  const queue = input.potionIds;
  if (queue !== undefined && (input.action !== "equip" || !validIds(queue)))
    throw new BoosterError("Выбери до трёх разных зелий.");
  const signature = JSON.stringify(["alchemy", input.action, queue ?? input.potionId ?? null, input.runId ?? null]);
  return store.transactProfile(token, input.requestId, signature, p => {
    const at = store.now(), next = { ...(p.alchemy || empty) };
    if (input.action === "exchange") {
      if (next.natural < rules.NATURAL_PER_EXCHANGE) throw new BoosterError("Нужно собрать 100 000 природного эфира.", 409);
      p.wallet.bucks = add(p.wallet.bucks, rules.CONCENTRATED_PER_EXCHANGE);
      next.natural -= rules.NATURAL_PER_EXCHANGE;
    } else if (input.action === "equip") {
      const selected = queue ? [...queue] : potion ? [potion.id] : [];
      if (selected.some(id => !(p.inventory[rules.get(id).boosterId] > 0)))
        throw new BoosterError("Этого зелья нет в запасе.", 409);
      next.queue = selected;
      next.equipped = selected[0] || null;
    } else {
      const run = runAt(store.events, at);
      if (!run || run.id !== input.runId) throw new BoosterError("Зельеварение доступно во время Эфирной алхимии.", 409);
      if (!potion) throw new BoosterError("Выбери рецепт.");
      if (potion.ingredients.some(i => (next.ingredients[i.id] || 0) < i.count))
        throw new BoosterError("Не хватает ингредиентов.", 409);
      const count = add(p.inventory[potion.boosterId] || 0, potion.yield);
      next.ingredients = { ...next.ingredients };
      for (const ingredient of potion.ingredients) next.ingredients[ingredient.id] -= ingredient.count;
      p.inventory[potion.boosterId] = count;
      if (!next.learned.includes(potion.id)) next.learned = [...next.learned, potion.id];
      if (!rules.equipped(next).length) { next.equipped = potion.id; next.queue = [potion.id]; }
    }
    p.alchemy = next;
    if (input.action === "brew") achievements.record(p,runAt(store.events,at),
      {alchemy_brews:1},at);
  }, undefined, undefined, batch);
}
function validIds(ids) {
  return Array.isArray(ids) && ids.length <= rules.MAX_ACTIVE && new Set(ids).size === ids.length &&
    ids.every(id => rules.potions.some(p => p.id === id));
}
function validate(profile) {
  achievements.validate(profile);
  const s = profile.alchemy;
  if (s === undefined) return;
  if (!object(s) || s.version !== 1 || !integer(s.natural) || !object(s.ingredients) ||
      Object.entries(s.ingredients).some(([id, n]) => !rules.ingredient(id) || !integer(n)) ||
      !Array.isArray(s.learned) || new Set(s.learned).size !== s.learned.length ||
      s.learned.some(id => !rules.potions.some(p => p.id === id)) ||
      !(s.equipped === null || rules.potions.some(p => p.id === s.equipped)) ||
      (s.queue !== undefined && (!validIds(s.queue) || (s.queue[0] || null) !== s.equipped)) ||
      (s.active != null && (!object(s.active) || typeof s.active.lifeId !== "string" ||
        !rules.potions.some(p => p.id === s.active.id) ||
        (s.active.ids !== undefined && (!validIds(s.active.ids) || s.active.ids[0] !== s.active.id)))))
    throw Error("Повреждены данные алхимии.");
}
module.exports = { manifest: rules.manifest, rules, view, runAt, progress, mutate, validate };
