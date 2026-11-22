"use strict";
const rules = require("../../../public/shared/pet-rules");
const passive = require("../arena/accessory-passives");
const access = require("../profiles/accessory-access");
const { BOOSTERS, BoosterError } = require("../boosters/booster-catalog");
const { benefits } = require("../accounts/account-benefits");
const giftEffects = require("../profiles/gift-effects");
const alchemy = require("../arena/alchemy-effects");
const MAX_STOCK = 1000;
function start(player, profile, now, wallNow) {
  player.pet = null;
  if (!rules.isUnlocked(profile.level)) return;
  const id = profile.pets?.equipped,
    saved = profile.pets?.owned[id];
  if (!saved) return;
  const def = rules.get(id),
    state = structuredClone(saved),
    stats = rules.stats(id, state.games);
  rules.advance(state, stats.capacityMs, wallNow, wallNow);
  player.pet = {
    id,
    stats,
    thornMeals: stats.thornMeals,
    thornRefillAtMs: null,
    vitalityMs: state.vitalityMs,
    accessoryPetMs: passive.petReserve(state.vitalityMs, access.outfit(profile)),
    refillAt: now + state.refillAt - wallNow,
    lastAt: now,
    activeMs: 0,
    nextGiftMs: stats.intervalMs,
    nextPremiumMs: def.premiumIntervalMs,
    premiumMs: 0,
    stock: state.vitalityMs ? { ...stats.start } : { fire: 0, claw: 0, glove: 0, carrot: 0 },
    sequence: 0,
    readyAt: {},
    receipts: new Map(),
    premium: benefits(profile, wallNow).premium,
  };
}
function active(p) {
  return !!p?.pet && (p.pet.vitalityMs > 0 || p.pet.accessoryPetMs > 0) && !p.dead;
}
function speed(p) {
  return active(p) ? p.pet.stats.speed / 100 : 0;
}
function consumeThorn(p) {
  if (!active(p) || !["leva", "zaya"].includes(p.pet.id) || !(p.pet.thornMeals > 0)) return false;
  p.pet.thornMeals--;
  if (!p.pet.thornMeals && p.pet.stats.thornRefillMs)
    p.pet.thornRefillAtMs = p.pet.activeMs + p.pet.stats.thornRefillMs;
  return true;
}
function damageFactor(p) {
  return (active(p) ? 1 - p.pet.stats.resistance / 100 : 1) * (1 - (alchemy.modifiers(p).resistance || 0));
}
function fireFraction(p) {
  return active(p) && p.pet.stats.firePercent > 0 ? p.pet.stats.firePercent / 100 : 0.5;
}
function positiveFactor(p) {
  return active(p) && p.pet.id === "manya" && p.account?.premium ? 1.2 : 1;
}
function gainMassEvenly(arena, p, amount, now) {
  const { massLimitForLevel } = require("../arena/arena-simulation"),
    limit = massLimitForLevel(p.level),
    parts = arena.bodies(p).filter((part) => part.mass < limit);
  // Сначала учитываем части у лимита, чтобы их остаток поделить между остальными.
  parts.sort((a, b) => b.mass - a.mass);
  let remaining = amount;
  for (let i = 0; i < parts.length && remaining > 0; i++) {
    remaining -= arena.gainMass(p, Math.ceil(remaining / (parts.length - i)), parts[i], now);
  }
  return amount - remaining;
}
function tick(arena, p, now) {
  const pet = p.pet;
  if (!pet || p.dead) return;
  const elapsed = passive.advancePet(pet, pet.stats.capacityMs, pet.lastAt, now, pet);
  pet.lastAt = Math.max(pet.lastAt, now);
  pet.activeMs += elapsed;
  if (pet.thornRefillAtMs !== null && pet.thornRefillAtMs <= pet.activeMs) {
    pet.thornMeals = pet.stats.thornMeals;
    pet.thornRefillAtMs = null;
  }
  while (pet.nextGiftMs <= pet.activeMs) {
    // A scheduled gift is one bundle: it spends at most one shared Strength charge.
    const gift = alchemy.prepare(p, { kind: "shield", target: "self", durationMs: 1 }, now);
    let applied = false;
    if (!arena.hasEffect(p, "shield", now)) {
      const shield = BOOSTERS.get(pet.stats.shieldId);
      p.effects[shield.id] = now + alchemy.prepare(p, shield, now).booster.durationMs;
      applied = true;
      require('../arena/quest-actions').record(arena,p,'petShield',null,shield.id);
    }
    if (pet.stats.mass) applied = gainMassEvenly(arena, p,
      Math.floor(alchemy.prepare(p, { kind: "mass", amount: pet.stats.mass }, now).booster.amount), now) > 0 || applied;
    if (applied) alchemy.commit(p, gift, now);
    pet.nextGiftMs += pet.stats.intervalMs;
  }
  if (p.account?.premium) pet.premiumMs += elapsed;
  while (pet.nextPremiumMs <= pet.premiumMs) {
    const kinds =
      pet.id === "zaya"
        ? ["carrot"]
        : pet.id === "leva"
          ? ["glove"]
          : pet.id === "manya"
            ? ["fire", "claw", "glove"]
            : ["fire", "glove"];
    for (const kind of kinds) pet.stock[kind] = Math.min(MAX_STOCK, pet.stock[kind] + 1);
    pet.nextPremiumMs += rules.get(pet.id).premiumIntervalMs;
  }
}
function use(arena, p, message, now) {
  const pet = p.pet;
  if (!pet || p.dead || message.spawnSerial !== p.spawnSerial)
    throw new BoosterError("Питомец недоступен в этой жизни.", 409);
  const { requestId, sequence, ability } = message;
  if (
    typeof requestId !== "string" ||
    !/^[a-zA-Z0-9_-]{8,100}$/.test(requestId) ||
    !Number.isSafeInteger(sequence) ||
    sequence < 1 ||
    !["fire", "secondary", "sixth"].includes(ability)
  )
    throw new BoosterError("Некорректное применение питомца.");
  const signature = JSON.stringify([sequence, ability, message.aimX, message.aimY]);
  const prior = pet.receipts.get(requestId);
  if (prior) {
    if (prior.signature !== signature)
      throw new BoosterError("Номер операции уже использован.", 409);
    return { replay: true, kind: prior.kind };
  }
  if (sequence <= pet.sequence) throw new BoosterError("Этот запрос уже обработан.", 409);
  const kind =
    ability === "fire"
      ? "fire"
      : pet.id === "zaya"
        ? "carrot"
        : pet.stock.claw > 0
          ? "claw"
          : "glove";
  if (ability === "sixth" && !["zaya", "leva"].includes(pet.id))
    throw new BoosterError("У этого питомца используются Q и R.");
  if (!pet.stock[kind]) throw new BoosterError("Этот запас питомца закончился.");
  if (readyAt(p, kind) > now)
    throw new BoosterError("Подожди мгновение перед повтором этого бустера.", 409);
  let apply, prepared;
  if (kind === "carrot") {
    const { massLimitForLevel } = require("../arena/arena-simulation");
    if (arena.bodies(p).every((part) => part.mass >= massLimitForLevel(p.level)))
      throw new BoosterError("Достигнут предел массы этой части.");
    prepared = alchemy.prepare(p, { kind: "mass", amount: 500 }, now);
    apply = () => gainMassEvenly(arena, p, Math.floor(prepared.booster.amount * giftEffects.arena(p, "outgoing")), now);
  } else {
    const standard = BOOSTERS.get(kind === "claw" ? "awl" : kind === "glove" ? "axe" : "fire");
    const booster = {
      id: rules.abilities[kind].id,
      kind: kind === "fire" ? "fire" : kind === "claw" ? "awl" : "divide",
      pieces: 2,
      flightMs: standard.flightMs,
      flightSpeed: kind === "fire" ? standard.flightSpeed : 200,
      maxDistance: standard.maxDistance,
      pet: true,
      firePercent: pet.stats.firePercent,
    };
    prepared = alchemy.prepare(p, booster, now);
    apply = arena.combat.prepare(p, prepared.booster, message, now);
  }
  // The transient stock belongs to this life; reconnecting ends it. No wallet is touched.
  apply();
  alchemy.commit(p, prepared, now);
  require("../arena/quest-actions").record(arena, p, "boosterUses", null, rules.abilities[kind].id);
    pet.stock[kind]--;
  pet.sequence = sequence;
  pet.readyAt[kind] = now + rules.ABILITY_COOLDOWN_MS;
  // Обычный и питомцевый огонь имеют один таймер: смена источника не обходит задержку.
  if (kind === "fire") p.boosterItemReadyAt.fire = pet.readyAt[kind];
  pet.receipts.set(requestId, { signature, kind });
  if (pet.receipts.size > 128) pet.receipts.delete(pet.receipts.keys().next().value);
  return { replay: false, kind };
}
function readyAt(p, kind) {
  return Math.max(p.pet?.readyAt[kind] || 0, kind === "fire" ? p.boosterItemReadyAt.fire || 0 : 0);
}
function snapshot(p, now) {
  const pet = p.pet;
  return pet
    ? {
        id: pet.id,
        level: pet.stats.level,
        active: active(p),
        vitality: (pet.vitalityMs / pet.stats.capacityMs) * 100,
        stock: { ...pet.stock },
        sequence: pet.sequence,
        firePercent: fireFraction(p) * 100,
        thornMeals: pet.thornMeals,
        thornRefillMs: pet.thornRefillAtMs === null ? 0 : Math.max(0, pet.thornRefillAtMs - pet.activeMs),
        nextGiftMs: pet.nextGiftMs - pet.activeMs,
        nextPremiumMs: pet.nextPremiumMs - pet.premiumMs,
        cooldowns: Object.fromEntries(
          Object.keys(rules.abilities).map((kind) => [kind, Math.max(0, readyAt(p, kind) - now)]),
        ),
        cooldownMs: Math.max(0, readyAt(p, pet.id === "zaya" ? "carrot" : "glove") - now),
      }
    : null;
}
module.exports = {
  start,
  active,
  consumeThorn,
  speed,
  damageFactor,
  positiveFactor,
  fireFraction,
  tick,
  use,
  snapshot,
};
