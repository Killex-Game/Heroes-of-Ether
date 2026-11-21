"use strict";
const rules = require("../../../public/shared/pet-rules");
const passive = require("../arena/accessory-passives");
const access = require("../profiles/accessory-access");
const { BoosterError } = require("../boosters/booster-catalog");
const activity = require("../progression/activity-achievements");
const integer = (n) => Number.isSafeInteger(n) && n >= 0;
const fresh = () => ({
  vitalityVersion: 1,
  owned: {},
  equipped: null,
  food: 0,
  feeds: 0,
  games: 0,
  life: null,
});
function validate(p) {
  const s = p.pets;
  if (
    !s ||
    (s.vitalityVersion !== undefined && s.vitalityVersion !== 1) ||
    !s.owned ||
    Array.isArray(s.owned) ||
    ![s.food, s.feeds, s.games].every(integer) ||
    (s.equipped !== null && !Object.hasOwn(s.owned, s.equipped)) ||
    Object.entries(s.owned).some(
      ([id, v]) =>
        !rules.get(id) ||
        !v ||
        ![v.games, v.vitalityMs, v.refillAt, v.purchasedAt].every(integer) ||
        v.vitalityMs >
          (s.vitalityVersion === 1 ? rules.capacityMs(id, v.games) : legacyCapacity(id)),
    ) ||
    (s.life !== null &&
      (!s.life ||
        typeof s.life.id !== "string" ||
        !Object.hasOwn(s.owned, s.life.petId) ||
        ![s.life.elapsedMs, s.life.activeMs, s.life.startedAt].every(integer) ||
        s.life.activeMs > s.life.elapsedMs ||
        (s.life.accessoryPetMs !== undefined &&
          (!integer(s.life.accessoryPetMs) ||
            s.life.accessoryPetMs >
              rules.capacityMs(s.life.petId, s.owned[s.life.petId].games) / 10))))
  )
    throw Error("Повреждены данные питомцев. Сохранение не перезаписано.");
}
const legacyCapacity = (id) => ({ zaya: 60, leva: 120, drakosha: 180, manya: 240 })[id] * 60000;
// One-time rebalance preserves the stored percentage, refill date and all progression.
function migrateVitality(p) {
  if (p.pets.vitalityVersion === 1) return false;
  validate(p);
  for (const [id, pet] of Object.entries(p.pets.owned))
    pet.vitalityMs = Math.round(
      (pet.vitalityMs * rules.capacityMs(id, pet.games)) / legacyCapacity(id),
    );
  p.pets.vitalityVersion = 1;
  return true;
}
function refresh(p, at) {
  for (const [id, pet] of Object.entries(p.pets.owned))
    rules.advance(pet, rules.capacityMs(id, pet.games), at, at);
}
function syncAchievements(p, at) {
  const pets = Object.entries(p.pets.owned),
    values = p.activity.values;
  values.pet_nursery = pets.length;
  values.pet_master = pets.filter(([, pet]) => rules.level(pet.games) === 5).length;
  values.pet_trainer = p.pets.games;
  values.pet_feeder = p.pets.feeds;
  values.pet_exclusive = pets.filter(([id]) => rules.get(id).currency === "bucks").length;
  for (const pet of rules.pets)
    values[`pet_level_${pet.id}`] = rules.level(p.pets.owned[pet.id]?.games || 0);
  activity.awardExtra(p, at);
}
function eventAt(events, at) {
  const active = events.filter((e) => e.startsAt <= at && at < e.endsAt);
  return active.find((e) => e.id === "koteyka") || active.find((e) => e.id === "fortune") || null;
}
function validateEvents(events) {
  if (
    !Array.isArray(events) ||
    events.some(
      (e) =>
        !e ||
        !["koteyka", "fortune"].includes(e.id) ||
        !integer(e.startsAt) ||
        !integer(e.endsAt) ||
        e.endsAt <= e.startsAt,
    )
  )
    throw Error("Неверное расписание событий питомцев.");
  return events;
}
function view(p, at, events = []) {
  const { life, ...visible } = p.pets || fresh();
  const s = structuredClone(visible);
  for (const [id, v] of Object.entries(s.owned)) {
    rules.advance(v, rules.capacityMs(id, v.games), at, at);
    Object.assign(v, rules.stats(id, v.games), {
      vitality: (v.vitalityMs / rules.capacityMs(id, v.games)) * 100,
    });
  }
  const event = eventAt(events, at);
  return {
    ...s,
    available: rules.isUnlocked(p.level),
    unlockLevel: rules.UNLOCK_LEVEL,
    event: event ? { id: event.id, endsAt: event.endsAt } : null,
    prices: Object.fromEntries(
      rules.pets.map((pet) => [
        pet.id,
        Math.round(
          pet.price * (pet.id === "manya" && event ? (event.id === "koteyka" ? 0.9 : 0.95) : 1),
        ),
      ]),
    ),
  };
}
function mutate(store, token, input) {
  const { action, petId = null } = input;
  if (!["buy", "equip", "unequip", "food", "feed"].includes(action))
    throw new BoosterError("Неизвестное действие питомца.");
  if (!["food", "unequip"].includes(action) && !rules.get(petId))
    throw new BoosterError("Питомец не найден.");
  return store.transactProfile(token, input.requestId, JSON.stringify(["pet", action, petId]), (p) => {
    if (!rules.isUnlocked(p.level))
      throw new BoosterError(`Питомцы доступны с ${rules.UNLOCK_LEVEL} уровня.`, 403);
    if (p.progress.session) throw new BoosterError("Управление питомцами доступно в лобби.", 409);
    const at = store.now();
    refresh(p, at);
    const s = p.pets,
      def = rules.get(petId);
    const pay = (currency, amount) => {
      if (p.wallet[currency] < amount) throw new BoosterError("Недостаточно средств для покупки.");
      p.wallet[currency] -= amount;
      activity.spend(p, currency, amount, at);
    };
    if (action === "buy") {
      if (s.owned[petId]) throw new BoosterError("Этот питомец уже у тебя есть.", 409);
      pay(def.currency, view(p, at, store.petEvents).prices[petId]);
      s.owned[petId] = {
        games: 0,
        vitalityMs: rules.capacityMs(petId, 0),
        refillAt: at + rules.REFILL_MS,
        purchasedAt: at,
      };
      if (!s.equipped) s.equipped = petId;
    } else if (action === "food") {
      if (s.food >= 1000000) throw new BoosterError("Запас корма уже заполнен.");
      pay("crystals", 100);
      s.food++;
    } else if (action === "unequip") s.equipped = null;
    else {
      const pet = s.owned[petId];
      if (!pet) throw new BoosterError("Сначала приобрети питомца.");
      if (action === "equip") s.equipped = petId;
      else {
        if (!s.food) throw new BoosterError("Нужен корм.");
        const capacity = rules.capacityMs(petId, pet.games);
        if (pet.vitalityMs >= capacity) throw new BoosterError("Питомец уже полон сил.");
        pet.vitalityMs = Math.min(capacity, pet.vitalityMs + capacity / 10);
        s.food--;
        s.feeds++;
      }
    }
    syncAchievements(p, at);
    validate(p);
  });
}
function progress(p, event, at, events = []) {
  const s = p.pets;
  if (!rules.isUnlocked(p.level)) {
    s.life = null;
    return;
  }
  if (event.type === "lifeStarted") {
    if (s.life?.id === event.lifeId) return;
    refresh(p, at);
    s.life = s.equipped
      ? {
          id: event.lifeId,
          petId: s.equipped,
          elapsedMs: 0,
          activeMs: 0,
          startedAt: at,
          accessoryPetMs: passive.petReserve(s.owned[s.equipped].vitalityMs, access.outfit(p)),
        }
      : null;
    return;
  }
  if (!["lifeTime", "lifeEnded"].includes(event.type) || !s.life || s.life.id !== event.lifeId)
    return;
  const life = s.life,
    pet = s.owned[life.petId],
    def = rules.get(life.petId);
  const elapsed = Math.max(
    life.elapsedMs,
    integer(event.durationMs)
      ? event.durationMs
      : Math.max(0, Math.floor(event.durationSeconds || 0)) * 1000,
  );
  life.activeMs += passive.advancePet(
    pet,
    rules.capacityMs(life.petId, pet.games),
    life.startedAt + life.elapsedMs,
    life.startedAt + elapsed,
    life,
  );
  life.elapsedMs = elapsed;
  if (event.type === "lifeEnded") {
    if (life.activeMs > 60000) {
      const bonus = life.petId === "manya" && eventAt(events, at)?.id === "koteyka" ? 2 : 1;
      const previousCapacity = rules.capacityMs(life.petId, pet.games);
      pet.games += bonus;
      pet.vitalityMs = Math.round(
        (pet.vitalityMs * rules.capacityMs(life.petId, pet.games)) / previousCapacity,
      );
      s.games += bonus;
    }
    s.life = null;
    refresh(p, at);
    syncAchievements(p, at);
  }
}
module.exports = {
  fresh,
  migrateVitality,
  validate,
  refresh,
  syncAchievements,
  view,
  mutate,
  progress,
  validateEvents,
  eventAt,
};
