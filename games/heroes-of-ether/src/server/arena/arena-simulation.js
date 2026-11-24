/* Серверная симуляция арены: движение, масса, деление, кормление, поглощение и снимки состояния. */
"use strict";
const accessories = require("../../../public/shared/accessory-catalog");
const accessoryPassives = require("./accessory-passives");
const turbo = require("./turbo-ability"),
  massBonus = require("./mass-kill-bonus"),
  massAccrual = require("./mass-accrual");
const { randomUUID } = require("node:crypto");
const { BOOSTERS, BOOSTER_RULES, BoosterError } = require("../boosters/booster-catalog");
const arenaPets = require("../pets/arena-pets");
const giftEffects = require("../profiles/gift-effects");
const alchemy = require("./alchemy-effects");
const alchemyField = require("./alchemy-field");
const accessoryAbilities = require("./accessory-abilities");
const { CircleIndex } = require("./spatial-collision-index");
const arenaBackgrounds = require("../../../public/shared/arena-backgrounds");
const nicknames = require("../profiles/nickname-rules");
const foodSnapshots = require("./food-snapshot");
// Derived ordering is local to an Arena, never part of a world snapshot or
// saved progress. Removed rooms can be collected with their last roster.
const { remainingTimers, timerEffects } = require("./snapshot-timers");
const absorptionOrders = new WeakMap();
// Scratch space is private to a live player and never enters progress or snapshots.
const separationScratch = new WeakMap();
const foodPickupScratch = new WeakMap();
const foodPickupIndexes = new WeakMap();

// Общие правила арены и стартовый баланс еды.
const RULES = Object.freeze({
  START_MASS: 20,
  ABSORB_PERCENT: 80,
  ABSORB_SIZE_RATIO: 1.15,
  ABSORB_DEPTH: 1 / 3,
  INSTANT_BOOSTER_ICON_MS: 1000,
  SPAWN_PROTECTION_MS: 2000,
  SPAWN_ATTEMPTS: 48,
  SPAWN_MARGIN: 160,
  ETHER_COUNT: 300,
  ETHER_FIELD_LIMIT: 1224,
  TICK_MS: 50,
  MAX_PARTS: 16,
  MIN_PART_MASS: 2,
  MIN_SPLIT_MASS: 4,
  SPLIT_IMPULSE: 20.7,
  FEED_MASS: 5,
  FEED_COOLDOWN_MS: 200,
  FEED_SPEED: 420,
  FEED_DRAG: 4,
  FEED_PICKUP_DELAY_MS: 800,
  FEED_LIFETIME_MS: 60000,
  FEED_MAX_PARTICLES: 1024,
  MERGE_DELAY_MS: 30000,
  OUTSIDE_DIAMETER_FRACTION: 0.4,
  MASS_DECAY_MS: 2000,
  INPUT_TIMEOUT_MS: 1500,
  DEPARTURE_LINGER_MS: 15000,
  DEPARTURE_FADE_MS: 1000,
  SPATIAL_CELL_SIZE: 256,
  SPATIAL_MIN_BODIES: 32,
});
const DEFAULT_WORLD = Object.freeze({ width: 6120, height: 4080 });
const ETHER_TYPES = Object.freeze(
  [
    { value: 1, share: 60, radius: 4.5 },
    { value: 3, share: 25, radius: 6 },
    { value: 5, share: 10, radius: 7.5 },
    { value: 10, share: 5, radius: 9 },
  ].map(Object.freeze),
);
const ETHER_COLORS = Object.freeze([
  "#7ce4c1",
  "#7fc8ff",
  "#bfa3ff",
  "#ff9fca",
  "#ffd46e",
  "#ff9c74",
  "#bee87e",
]);
const boosterLimitForLevel = (level) =>
  level <= 25 ? 10 : level <= 120 ? 15 : level <= 500 ? 20 : 24;
// Предел отдельного шара; общая масса всех частей отдельно не ограничивается.
const { massLimitForLevel } = require("./player-limits");
function massDecayLoss(mass) {
  if (mass <= RULES.START_MASS) return 0;
  const floor = mass > 120000 ? 120000 : mass > 1000 ? 1000 : RULES.START_MASS;
  // Удвоенная естественная потеря; округляем один раз после применения ставки.
  return Math.min(mass - floor, Math.ceil((mass * (mass > 120000 ? 15 : 9) * 206) / 1000000));
}
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const radiusForMass = (mass) => 16 + Math.sqrt(mass) * 2.5;
// Mass is integral in normal play. Cache only the pure formula, never a player
// result or an entitlement. Custom/fractional/out-of-range masses keep the exact
// original calculation. The fixed table cannot grow with sessions or online.
const speedByMass = new Float64Array(massLimitForLevel(Infinity) + 1);
function speedForMass(mass) {
  if (Number.isInteger(mass) && mass >= 0 && mass < speedByMass.length) {
    return speedByMass[mass] || (speedByMass[mass] =
      Math.max(35, 83.3 * Math.pow(Math.max(10, mass) / 10, -0.1)));
  }
  return Math.max(35, 83.3 * Math.pow(Math.max(10, mass) / 10, -0.1));
}
// Деление на 100 перед умножением не используется: масса целая, награда floor(m*80/100).
const absorptionGain = (mass) => Math.floor((mass * RULES.ABSORB_PERCENT) / 100);
// Ogar-style check: a visibly larger part and the victim's centre inside it.
// Each body's real radius is used, never the player's combined mass.
const canAbsorbSize = (eater, victim) => eater.radius > victim.radius * RULES.ABSORB_SIZE_RATIO;
const absorptionDistance = (eater, victim) =>
  Math.max(0, eater.radius - victim.radius * RULES.ABSORB_DEPTH);
function withinAbsorptionDepth(a, b) {
  const dx = a.x - b.x,
    dy = a.y - b.y,
    distance = absorptionDistance(a, b);
  return dx * dx + dy * dy < distance * distance;
}
const cleanName = (name) =>
  Array.from(
    String(name)
      .replace(/[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/g, "")
      .trim(),
  )
    .slice(0, 16)
    .join("");

function canAbsorb(eater, victim, now) {
  if ((eater.isRemnant && now >= eater.removeAt) ||
      (victim.isRemnant && now >= victim.removeAt)) return false;
  const eaterProfile = eater.profileId || eater.departedProfileId,
    victimProfile = victim.profileId || victim.departedProfileId;
  if ((eater.isRemnant || victim.isRemnant) && eaterProfile && eaterProfile === victimProfile)
    return false;
  if (eater.effects?.lock > now) return false;
  if (eater.id === victim.id || eater.dead || victim.dead) return false;
  // Защищённый новичок не может и сам поглощать других игроков.
  if (eater.protectedUntil > now || victim.protectedUntil > now) return false;
  if (!canAbsorbSize(eater, victim)) return false;
  return withinAbsorptionDepth(eater, victim);
}

class Arena {
  constructor({
    world = DEFAULT_WORLD,
    random = Math.random,
    backgroundRandom = Math.random,
    etherCount = RULES.ETHER_COUNT,
    spatialIndex = true,
  } = {}) {
    this.world = { ...world };
    this.random = random;
    this.maxParts = RULES.MAX_PARTS;
    this.backgroundRandom = backgroundRandom;
    this.backgroundId = null;
    this.spatialIndex = spatialIndex;
    this.etherCount = etherCount;
    this.players = new Map();
    this.combat = new (require("./projectile-combat").Combat)(this);
    this.boosterEffects = new (require("../boosters/booster-effects").BoosterEffects)(this);
    this.combatEvents = [];
    this.audioEvents = [];
    this.ether = [];
    // Food is room-local and never persisted. Monotonic IDs stay unique across
    // refills/W without repeating a 36-byte UUID in every movement delta.
    this.etherSequence = 0;
    this.tick = 0;
    this.progressEvents = [];
    this.alchemyField = new alchemyField.AlchemyField(this);
    this.fillEther();
  }
  bodyBounds(p) {
    const inset = p.radius * (1 - 2 * RULES.OUTSIDE_DIAMETER_FRACTION);
    const rx = Math.min(inset, this.world.width / 2),
      ry = Math.min(inset, this.world.height / 2);
    return {
      minX: rx,
      maxX: this.world.width - rx,
      minY: ry,
      maxY: this.world.height - ry,
    };
  }
  clampPlayer(p) {
    const b = this.bodyBounds(p);
    p.x = clamp(p.x, b.minX, b.maxX);
    p.y = clamp(p.y, b.minY, b.maxY);
  }
  chooseSpawn(excludeId, mass = RULES.START_MASS) {
    const r = radiusForMass(mass);
    let best = { x: this.world.width / 2, y: this.world.height / 2 },
      bestClearance = -Infinity;
    for (let i = 0; i < RULES.SPAWN_ATTEMPTS; i++) {
      const candidate = {
        x: r + this.random() * (this.world.width - 2 * r),
        y: r + this.random() * (this.world.height - 2 * r),
      };
      let clearance = Infinity;
      occupants: for (const p of this.players.values()) {
        if (p.id === excludeId || p.dead) continue;
        for (const part of this.bodies(p)) {
          clearance = Math.min(
            clearance,
            Math.hypot(part.x - candidate.x, part.y - candidate.y) - part.radius - r,
          );
          // The minimum can only decrease. Once this point cannot improve
          // the saved choice or meet the safe margin, the remaining bodies
          // cannot change the decision. Keep candidate/random order intact.
          if (clearance <= bestClearance && clearance < RULES.SPAWN_MARGIN)
            break occupants;
        }
      }
      if (clearance > bestClearance) {
        best = candidate;
        bestClearance = clearance;
      }
      if (clearance >= RULES.SPAWN_MARGIN) return candidate;
    }
    // Переполненная карта: лучшая из проверенных точек, а не обещание полной безопасности.
    return best;
  }
  resetPlayer(p, now, lifeId = randomUUID()) {
    // A new occupied arena period starts only when there are no living spheres.
    // Dead players on the results screen do not keep an otherwise empty arena occupied.
    if (![...this.players.values()].some((player) => !player.dead)) {
      this.backgroundId = arenaBackgrounds.choose(this.backgroundId, this.backgroundRandom);
    }
    p.pet = null;
    p.potion = null;
    p.alchemyNatural = 0;
    p.alchemyIngredients = null;
    p.alchemyRun = null;
    p.alchemyFoodRemainder = 0;
    p.alchemyPickupCount = 0;
    p.accessoryAbilities = null;
    p.massDecayRemainder = 0;
    p.accessoryFeedUntil = p.accessoryShieldUntil = p.accessoryShieldReadyAt = 0;
    p.mass = p.account?.startMass ?? RULES.START_MASS;
    const pos = this.chooseSpawn(p.id, p.mass);
    p.x = p.targetX = pos.x;
    p.y = p.targetY = pos.y;
    p.radius = radiusForMass(p.mass);
    p.protectedUntil = now + RULES.SPAWN_PROTECTION_MS;
    p.spawnSerial += 1;
    p.lastMoveAt = now;
    p.lifeStartedAt = now;
    p.lifeId = lifeId;
    p.dead = false;
    delete p.departureRemnantId;
    p.endedAt = null;
    p.rewardedMinutes = 0;
    p.questFoodCount = 0;
    p.clanFoodCount = 0;
    p.questAbsorptionSequence = 0;
    p.questSampleAt = now;
    p.nextMassDecayAt = now + RULES.MASS_DECAY_MS;
    p.effects = {};
    p.instantEffects = {};
    p.damageTicks = [];
    p.poisonFoodRemainder = 0;
    p.swordBurns = [];
    p.nextCakeAt = Infinity;
    p.nextEasterAt = Infinity;
    p.nextKnucklesAt = Infinity;
    p.boosterReadyAt = now;
    p.boostersUsed = 0;
    p.boosterUses = {};
    p.shieldReadyAt = {};
    p.boosterItemReadyAt = {};
    p.parts = null;
    p.mainPartId = p.id;
    p.mergeVersion = 0;
    p.mergeAt = now;
    p.splitSequence = 0;
    p.feedSequence = 0;
    p.feedReadyAt = now;
    p.stopped = false;
    p.moveDirection = null;
    turbo.reset(p, now);
    massBonus.reset(p);
    massAccrual.reset(p, now);
    this.clampPlayer(p);
  }
  addPlayer(now, id = randomUUID(), account) {
    const p = {
      id,
      account,
      name: "Игрок-" + id.slice(0, 4),
      skinId: "moon-dragon",
      level: 1,
      clanPrefix: "",
      mass: RULES.START_MASS,
      radius: radiusForMass(RULES.START_MASS),
      color: `hsl(${Math.floor(this.random() * 360)} 85% 68%)`,
      spawnSerial: -1,
      protectedUntil: 0,
      lastMoveAt: now,
    };
    this.resetPlayer(p, now);
    this.players.set(id, p);
    return p;
  }
  removePlayer(id) {
    this.players.delete(id);
  }
  leaveRemnant(p, now) {
    if (p.dead || p.isRemnant || p.departureRemnantId) return null;
    // Результат жизни сохраняется отдельно. Модель ещё участвует в поглощениях 15 секунд.
    const remnant = structuredClone(p),
      ids = new Map(this.bodies(p).map((part) => [this.bodyId(p, part), randomUUID()]));
    remnant.id = randomUUID();
    remnant.mainPartId = ids.get(p.mainPartId);
    if (remnant.parts)
      for (const part of remnant.parts) {
        part.id = ids.get(part.id);
        part.vx = part.vy = 0;
      }
    for (const burn of remnant.swordBurns) burn.partId = ids.get(burn.partId);
    remnant.departedProfileId = p.profileId;
    delete remnant.profileId;
    remnant.isRemnant = true;
    remnant.removeAt = now + RULES.DEPARTURE_LINGER_MS;
    remnant.stopped = true;
    remnant.moveDirection = null;
    remnant.targetX = remnant.x;
    remnant.targetY = remnant.y;
    remnant.turbo.active = false;
    p.departureRemnantId = remnant.id;
    this.players.set(remnant.id, remnant);
    return remnant;
  }
  bodies(p) {
    return p.parts || [p];
  }
  bodyId(p, part) {
    return part === p ? p.mainPartId : part.id;
  }
  mainBody(p) {
    if (!p.parts) return p;
    let main = p.parts.find((part) => part.id === p.mainPartId);
    for (const part of p.parts) if (!main || part.mass > main.mass) main = part;
    if (main) p.mainPartId = main.id;
    return main;
  }
  mergedMass(p, a, b) {
    return Math.min(a.mass + b.mass, massLimitForLevel(p.level));
  }
  canMerge(p, a, b) {
    // Own parts use the same entry depth, including equally sized parts.
    return a.radius >= b.radius ? withinAbsorptionDepth(a, b) : withinAbsorptionDepth(b, a);
  }
  partMergeAt(p, part) {
    return part.mergeAt ?? p.mergeAt;
  }
  prepareMergeTimers(p) {
    for (const part of p.parts || []) part.mergeAt ??= p.mergeAt;
  }
  refreshMergeTimer(p) {
    if (!p.parts?.length) return;
    let earliest = Infinity;
    for (const part of p.parts) earliest = Math.min(earliest, this.partMergeAt(p, part));
    p.mergeAt = earliest;
  }
  syncParts(p) {
    if (!p.parts?.length) return;
    let main = p.parts[0], mass = 0, weightedX = 0, weightedY = 0;
    for (const part of p.parts) {
      if (part.mass > main.mass || (part.mass === main.mass && part.id === p.mainPartId)) main = part;
      mass += part.mass;
      weightedX += part.x * part.mass;
      weightedY += part.y * part.mass;
    }
    p.mainPartId = main.id;
    p.mass = mass;
    p.radius = radiusForMass(mass);
    p.x = weightedX / mass;
    p.y = weightedY / mass;
    if (p.parts.length === 1) {
      p.x = p.parts[0].x;
      p.y = p.parts[0].y;
      p.mergeVersion = p.parts[0].mergeVersion || 0;
      p.mergeAt = this.partMergeAt(p, p.parts[0]);
      p.parts = null;
    }
  }
  gainMass(p, amount, body, now = Infinity) {
    // Бустер целиком получает главный шар; еда и поглощения — коснувшаяся часть.
    const gain = this.gainBodyMass(p, body || this.mainBody(p), amount, now);
    this.syncParts(p);
    return gain;
  }
  gainBodyMass(p, part, amount, now = Infinity) {
    const gain = Math.max(0, Math.min(amount, massLimitForLevel(p.level) - part.mass));
    part.mass += gain;
    part.radius = radiusForMass(part.mass);
    if (!p.isRemnant && !(p.effects.web > now)) this.clampPlayer(part);
    return gain;
  }
  loseMass(p, amount) {
    const parts = this.bodies(p);
    let remaining = Math.min(
      amount,
      parts.reduce((sum, part) => sum + Math.max(0, part.mass - RULES.MIN_PART_MASS), 0),
    );
    const lost = remaining;
    // Пропорционально всем частям, без дробной массы и без частей меньше минимума.
    while (remaining > 0) {
      const eligible = parts.filter((part) => part.mass > RULES.MIN_PART_MASS);
      const total = eligible.reduce((sum, part) => sum + part.mass, 0),
        budget = remaining;
      const shares = eligible.map((part) => ({
        part,
        share: (budget * part.mass) / total,
      }));
      for (const { part, share } of shares) {
        const loss = Math.min(part.mass - RULES.MIN_PART_MASS, Math.floor(share));
        part.mass -= loss;
        remaining -= loss;
      }
      shares.sort(
        (a, b) =>
          (b.share % 1) - (a.share % 1) ||
          this.bodyId(p, a.part).localeCompare(this.bodyId(p, b.part)),
      );
      for (const { part } of shares)
        if (remaining > 0 && part.mass > RULES.MIN_PART_MASS) {
          part.mass--;
          remaining--;
        }
    }
    for (const part of parts) part.radius = radiusForMass(part.mass);
    this.syncParts(p);
    return lost;
  }
  decayMass(p, now) {
    if (p.dead || now < p.nextMassDecayAt) return;
    const periods = Math.floor((now - p.nextMassDecayAt) / RULES.MASS_DECAY_MS) + 1;
    p.nextMassDecayAt += periods * RULES.MASS_DECAY_MS;
    // Пропущенные интервалы считаются последовательно от уменьшающейся массы.
    const reduction = 100 - (100 - accessories.bonus(p.outfit, "decayReduction")) * (1 - (alchemy.modifiers(p).decay || 0));
    if (reduction >= 100) return;
    for (let i = 0; i < periods && p.mass > RULES.START_MASS; i++) {
      const units = massDecayLoss(p.mass) * (100 - reduction) + (p.massDecayRemainder || 0);
      p.massDecayRemainder = units % 100;
      const lost = this.loseMass(p, Math.min(p.mass - RULES.START_MASS, Math.floor(units / 100)));
      // All remaining parts may already be at their physical minimum.
      if (!lost && units >= 100) break;
    }
  }
  splitPlayer(p, message, now) {
    if (
      message.spawnSerial !== p.spawnSerial ||
      !Number.isSafeInteger(message.sequence) ||
      message.sequence <= p.splitSequence
    )
      return false;
    p.splitSequence = message.sequence;
    if (this.hasEffect(p, "root", now)) return false;
    const bodies = this.bodies(p);
    if (
      bodies.length >= this.maxParts ||
      !bodies.some((part) => part.mass >= RULES.MIN_SPLIT_MASS)
    )
      return false;
    this.boosterEffects.tickSwordBurns(p, now);
    if (p.dead) return false;
    this.prepareMergeTimers(p);
    if (!p.parts)
      p.parts = [
        {
          id: p.mainPartId,
          x: p.x,
          y: p.y,
          mass: p.mass,
          radius: p.radius,
          vx: 0,
          vy: 0,
          mergeVersion: p.mergeVersion,
        },
      ];
    for (const part of [...p.parts].sort((a, b) => b.mass - a.mass || a.id.localeCompare(b.id))) {
      if (p.parts.length >= this.maxParts) break;
      if (part.mass < RULES.MIN_SPLIT_MASS) continue;
      const dx = p.targetX - part.x,
        dy = p.targetY - part.y,
        length = Math.hypot(dx, dy);
      const nx = length > 0.01 ? dx / length : 1,
        ny = length > 0.01 ? dy / length : 0;
      const mass = Math.floor(part.mass / 2);
      part.mass -= mass;
      part.radius = radiusForMass(part.mass);
      part.mergeAt = now + RULES.MERGE_DELAY_MS;
      const childId = randomUUID();
      p.parts.push({
        id: childId,
        birth: { tick: this.tick, x: part.x, y: part.y },
        splitStartedAt: now,
        mass,
        radius: radiusForMass(mass),
        x: part.x + nx,
        y: part.y + ny,
        spaceSplitUntil: now + RULES.TICK_MS * 13,
        vx: nx * RULES.SPLIT_IMPULSE,
        vy: ny * RULES.SPLIT_IMPULSE,
        mergeVersion: 0,
        mergeAt: part.mergeAt,
      });
      this.boosterEffects.splitSwordBurn(p, part.id, [part, p.parts[p.parts.length - 1]], now);
    }
    this.refreshMergeTimer(p);
    this.separateParts(p, now);
    this.syncParts(p);
    return true;
  }
  feedPlayer(p, message, now) {
    if (
      p.dead ||
      message.spawnSerial !== p.spawnSerial ||
      !Number.isSafeInteger(message.sequence) ||
      message.sequence <= p.feedSequence ||
      !Number.isFinite(message.x) ||
      !Number.isFinite(message.y)
    )
      return false;
    p.feedSequence = message.sequence;
    if (now < p.feedReadyAt) return false;
    const parts = this.bodies(p).filter(
      (part) => part.mass >= RULES.MIN_PART_MASS + RULES.FEED_MASS,
    );
    if (!parts.length) return false;
    if (!this.reserveFeedSpace(parts.length, now)) return false;
    const x = clamp(message.x, 0, this.world.width),
      y = clamp(message.y, 0, this.world.height),
      radius = 6;
    for (const part of parts) {
      const dx = x - part.x,
        dy = y - part.y,
        length = Math.hypot(dx, dy),
        nx = length > 0.01 ? dx / length : 1,
        ny = length > 0.01 ? dy / length : 0;
      const distance = part.radius + radius + 4;
      part.mass -= RULES.FEED_MASS;
      part.radius = radiusForMass(part.mass);
      this.ether.push({
        id: "e" + (++this.etherSequence).toString(36),
        ejected: true,
        value: RULES.FEED_MASS,
        radius,
        artValue: ETHER_TYPES[Math.floor(this.random() * ETHER_TYPES.length)].value,
        color: ETHER_COLORS[Math.floor(this.random() * ETHER_COLORS.length)],
        x: clamp(part.x + nx * distance, radius, this.world.width - radius),
        y: clamp(part.y + ny * distance, radius, this.world.height - radius),
        vx: nx * RULES.FEED_SPEED,
        vy: ny * RULES.FEED_SPEED,
        feedDx: nx,
        feedDy: ny,
        updatedAt: now,
        sourceId: p.id,
        sourceLife: p.lifeId,
        birth: Object.freeze({
          tick: this.tick,
          x: clamp(
            part.x + nx * Math.max(0, part.radius - radius),
            radius,
            this.world.width - radius,
          ),
          y: clamp(
            part.y + ny * Math.max(0, part.radius - radius),
            radius,
            this.world.height - radius,
          ),
        }),
        sourcePickupAt: now + RULES.FEED_PICKUP_DELAY_MS,
        expiresAt: now + RULES.FEED_LIFETIME_MS,
      });
    }
    this.syncParts(p);
    p.feedReadyAt = now + RULES.FEED_COOLDOWN_MS;
    if (accessories.bonus(p.outfit, "feedSpeed")) p.accessoryFeedUntil = now + 3000;
    return true;
  }
  moveFeed(now) {
    let movingCount = 0, feedIndex;
    const food = this.ether;
    let removed;
    for (let i = this.ether.length - 1; i >= 0; i--) {
      const orb = food[i];
      if (!orb.ejected) continue;
      if (now >= orb.expiresAt) {
        (removed ??= new Uint8Array(food.length))[i] = 1;
        continue;
      }
      const dt = Math.max(0, now - orb.updatedAt) / 1000,
        decay = Math.exp(-RULES.FEED_DRAG * dt),
        ax = orb.x,
        ay = orb.y;
      orb.x = clamp(
        orb.x + (orb.vx * (1 - decay)) / RULES.FEED_DRAG,
        orb.radius,
        this.world.width - orb.radius,
      );
      orb.y = clamp(
        orb.y + (orb.vy * (1 - decay)) / RULES.FEED_DRAG,
        orb.radius,
        this.world.height - orb.radius,
      );
      if (this.spatialIndex && ++movingCount === 16) feedIndex = this.hazards?.feedIndex();
      if (this.hazards?.feed(orb, ax, ay, orb.x, orb.y, now, feedIndex)) {
        (removed ??= new Uint8Array(food.length))[i] = 1;
        continue;
      }
      orb.vx *= decay;
      orb.vy *= decay;
      orb.updatedAt = now;
      if (orb.x === orb.radius || orb.x === this.world.width - orb.radius) orb.vx = 0;
      if (orb.y === orb.radius || orb.y === this.world.height - orb.radius) orb.vy = 0;
    }
    // Feeding is still resolved in reverse order, including newly reproduced
    // hazards. Compact survivors once instead of shifting the rest of the
    // array on every expiration/contact. Leave the no-removal path untouched.
    if (removed) {
      let write = 0;
      for (let i = 0; i < food.length; i++) if (!removed[i]) food[write++] = food[i];
      food.length = write;
    }
  }
  separateParts(p, now = -Infinity, anchorMain = false) {
    if (!p.parts || p.isRemnant || p.effects.web > now) return;
    // Merge deadlines do not change during these four separation passes.
    const count = p.parts.length;
    let scratch = separationScratch.get(p);
    if (!scratch || scratch.mergeReady.length < count) {
      scratch = { mergeReady: new Uint8Array(count), release: new Float64Array(count) };
      separationScratch.set(p, scratch);
    }
    const { mergeReady, release } = scratch;
    let allReady = true;
    for (let i = 0; i < count; i++) {
      const ready = this.partMergeAt(p, p.parts[i]) <= now;
      mergeReady[i] = ready ? 1 : 0;
      if (!ready) allReady = false;
    }
    if (allReady) return;
    for (let i = 0; i < count; i++) {
      const part = p.parts[i];
      release[i] = Number.isFinite(part.splitStartedAt) && Number.isFinite(now)
        ? clamp((now - part.splitStartedAt) / 200, 0, 1)
        : 1;
    }
    for (let pass = 0; pass < 4; pass++) {
      let adjusted = false;
      for (let i = 0; i < p.parts.length; i++)
        for (let j = i + 1; j < p.parts.length; j++) {
          const a = p.parts[i],
            b = p.parts[j];
          // Ready pairs keep approaching each other even while a new pair separates.
          if (mergeReady[i] && mergeReady[j]) continue;
          const dx = b.x - a.x,
            dy = b.y - a.y,
            reach = a.radius + b.radius;
          // Most pairs no longer overlap after the split launch. Keep the exact
          // solver and pair order, but reject these pairs before taking a root.
          if (Math.abs(dx) >= reach || Math.abs(dy) >= reach) continue;
          // Новая часть выходит из исходной постепенно, без мгновенного раздвигания на радиус.
          const separation = reach * Math.min(release[i], release[j]);
          const distanceSquared = dx * dx + dy * dy;
          if (distanceSquared >= separation * separation) continue;
          const distance = Math.sqrt(distanceSquared);
          const overlap = separation - distance;
          if (overlap <= 0) continue;
          const nx = distance > 0.001 ? dx / distance : 1,
            ny = distance > 0.001 ? dy / distance : 0;
          // Собирающиеся части не отталкивают выбранный центр сборки.
          const share =
            anchorMain && a.id === p.mainPartId
              ? 0
              : anchorMain && b.id === p.mainPartId
                ? 1
                : b.mass / (a.mass + b.mass);
          a.x -= nx * overlap * share;
          a.y -= ny * overlap * share;
          b.x += nx * overlap * (1 - share);
          b.y += ny * overlap * (1 - share);
          this.clampPlayer(a);
          this.clampPlayer(b);
          adjusted = true;
        }
      if (!adjusted) break;
    }
  }
  moveParts(p, now, multiplier) {
    // Web anchors every part, including merge/clamp corrections and old inertia.
    // Stone still permits impulses resolved by movePull before this method.
    if (p.effects.web > now) {
      if (p.parts) for (const part of p.parts) part.vx = part.vy = 0;
      return;
    }
    const main = this.mainBody(p);
    // При остановке малые части собираются к главной, а не тянут её к общему центру.
    const targetX = p.stopped && p.parts ? main.x : p.targetX,
      targetY = p.stopped && p.parts ? main.y : p.targetY;
    for (const part of this.bodies(p)) {
      const dx = targetX - part.x,
        dy = targetY - part.y,
        distance = Math.hypot(dx, dy);
      const speed = ((speedForMass(part.mass) * RULES.TICK_MS) / 1000) * multiplier;
      // Остановка собирает части к центру сразу; задержка слияния сохраняется.
      if ((!p.stopped || p.parts) && distance > 0) {
        const t = Math.min(1, speed / distance);
        part.x += dx * t;
        part.y += dy * t;
      }
      if (p.parts && multiplier > 0) {
        part.x += part.vx || 0;
        part.y += part.vy || 0;
        part.vx = (part.vx || 0) * 0.8;
        part.vy = (part.vy || 0) * 0.8;
      }
      this.clampPlayer(part);
    }
    if (p.parts && now >= p.mergeAt) {
      for (let i = 0; i < p.parts.length; i++)
        for (let j = i + 1; j < p.parts.length; j++) {
          const a = p.parts[i],
            b = p.parts[j];
          if (
            this.partMergeAt(p, a) > now ||
            this.partMergeAt(p, b) > now ||
            !this.canMerge(p, a, b)
          )
            continue;
          const survivor = b.mass > a.mass || (b.mass === a.mass && b.id === p.mainPartId) ? b : a;
          this.boosterEffects.mergeSwordBurns(p, [a.id, b.id], survivor.id, now);
          // Поглощённая часть добавляет массу к большей без скачка её центра.
          const x = survivor.x,
            y = survivor.y;
          a.id = survivor.id;
          a.mergeVersion = (survivor.mergeVersion || 0) + 1;
          a.mergeAt = Math.max(this.partMergeAt(p, a), this.partMergeAt(p, b));
          const mass = this.mergedMass(p, a, b);
          a.x = x;
          a.y = y;
          a.mass = mass;
          a.radius = radiusForMass(mass);
          a.vx = a.vy = 0;
          p.parts.splice(j--, 1);
          this.clampPlayer(a);
          this.mainBody(p);
        }
    }
    if (multiplier > 0) this.separateParts(p, now, p.stopped);
    this.refreshMergeTimer(p);
    this.syncParts(p);
  }
  activeEffects(p, now) {
    return timerEffects(p.effects || {}, now, true);
  }
  hasEffect(p, kind, now) {
    for (const id in p.effects)
      if (p.effects[id] > now && BOOSTERS.get(id)?.kind === kind) return true;
    return false;
  }
  prepareBooster(id, message, now, { accessory = false } = {}) {
    const p = this.players.get(id);
    let booster = BOOSTERS.get(message.boosterId);
    if (!p || p.dead || p.isRemnant)
      throw new BoosterError("Бустеры можно применять только во время жизни на арене.");
    if (!booster?.ready)
      throw new BoosterError(booster?.unavailableReason || "Неизвестный бустер.");
    if (p.level < booster.useLevel)
      throw new BoosterError(`Клановые бустеры доступны с ${booster.useLevel} уровня.`);
    if (message.spawnSerial !== p.spawnSerial)
      throw new BoosterError("После возрождения выбери бустер заново.");
    if (booster.kind === "potion") {
      const rules = require("../../../public/shared/alchemy-rules"), id = rules.get(booster.id).id;
      const ids = rules.activeIds(p.potion);
      if (ids.includes(id)) throw new BoosterError("Это зелье уже действует.", 409);
      if (ids.length >= rules.MAX_ACTIVE) throw new BoosterError("В этой жизни уже действуют три зелья.", 409);
      return () => {
        // Close the observed interval before activation: earlier time must not
        // receive a newly drunk potion's bonus in the next 30-second payout.
        this.accrueMass(p, now);
        const active = [...ids, id];
        p.potion = { id: active[0], ids: active, readyAt: p.potion?.readyAt ?? now,
          modifiers: rules.combine(active) };
        if (p.massAccrual) p.massAccrual.potionXpPercent = 100 + Math.round((alchemy.modifiers(p).xp || 0) * 100);
        p.boostersUsed++;
        p.boosterUses[booster.id] = 1;
        require("./quest-actions").record(this, p, "boosterUses", null, booster.id, null, "inventory");
        return { type: "boosterUsed", boosterId: booster.id, playerId: p.id, targetId: p.id };
      };
    }
    if (
      !accessory &&
      (p.boosterUses[booster.id] || 0) >=
        boosterLimitForLevel(p.level) + (p.account?.slotBonus || 0)
    )
      throw new BoosterError("Лимит этого слота на эту жизнь исчерпан.", 409);
    if (booster.kind === "mass" && this.mainBody(p).mass >= massLimitForLevel(p.level))
      throw new BoosterError(
        "Достигнут предел массы главного шара для вашего уровня. Предмет сохранён.",
        409,
      );
    if (p.boosterItemReadyAt[booster.id] > now)
      throw new BoosterError(
        "Подожди мгновение перед следующим применением этого бустера.",
        409,
      );
    booster = accessoryPassives.critical(p, booster, this.random);
    const alchemyCast = alchemy.prepare(p, booster, now, !accessory);
    booster = booster.flightMs || booster.kind === "vortex"
      ? alchemyCast.booster : accessoryPassives.outgoing(p, alchemyCast.booster);
    const launch =
      booster.flightMs || booster.kind === "vortex"
        ? this.combat.prepare(p, booster, message, now)
        : null;
    let target = p;
    if (booster.target === "opponent") {
      target = this.players.get(message.targetId);
      if (!target || target.dead || target.id === p.id)
        throw new BoosterError("Выбери соперника на арене.");
      if (message.targetSpawnSerial !== target.spawnSerial)
        throw new BoosterError("Соперник уже возродился. Выбери цель снова.");
      if (p.protectedUntil > now || target.protectedUntil > now)
        throw new BoosterError("Во время защиты появления атаковать нельзя.");
      const distance = Math.min(
        ...this.bodies(p).flatMap((a) =>
          this.bodies(target).map((b) => Math.hypot(a.x - b.x, a.y - b.y)),
        ),
      );
      if (distance > BOOSTER_RULES.TARGET_RANGE)
        throw new BoosterError("Цель слишком далеко. Подойди ближе.");
      if (this.hasEffect(target, "shield", now))
        throw new BoosterError("Соперника защищает щит. Предмет сохранён.");
    }
    if (booster.kind === "sponge" && !p.parts)
      throw new BoosterError("Для Губки нужны разделённые части. Предмет сохранён.");
    // Применяется только после успешного серверного списания и сохранения предмета.
    return () => {
      if (launch) launch();
      else if (booster.kind === "sponge") this.boosterEffects.startSponge(p, now, booster.durationMs);
      else if (booster.kind === "easter_growth") {
        // Finish due growth before replacing its schedule, including the last
        // +50 at the exact ten-second cooldown boundary.
        this.boosterEffects.tick(p, now);
        p.easterGiftFactor = giftEffects.arena(p, "outgoing");
        p.easterAlchemyAmount = booster.amount;
        p.effects.easter_egg = now + Math.floor(booster.durationMs * p.easterGiftFactor);
        p.nextEasterAt = now + booster.tickMs;
      } else if (booster.kind === "mass") {
        this.gainMass(
          p,
          Math.floor(
            booster.amount * arenaPets.positiveFactor(p) * giftEffects.arena(p, "outgoing"),
          ),
          undefined, now,
        );
        p.instantEffects[booster.id] = now + RULES.INSTANT_BOOSTER_ICON_MS;
      } else {
        if (booster.kind === "shield") {
          for (const id of Object.keys(p.effects))
            if (BOOSTERS.get(id)?.kind === "shield") delete p.effects[id];
          p.shieldReadyAt = {
            [booster.id]: now + booster.cooldownMs,
          };
        }
        let effect = giftEffects.adjust(
          booster,
          giftEffects.arena(p, "outgoing") *
            (target === p ? 1 : giftEffects.arena(target, "incoming")),
        );
        if (target !== p) effect = accessoryPassives.incoming(target, alchemy.incoming(target, effect));
        target.effects[booster.id] = now + effect.durationMs;
        (target.effectStrengths ||= {})[booster.id] = effect.multiplier ?? effect.speedBonus;
        if (booster.kind === "root") {
          target.targetX = target.x;
          target.targetY = target.y;
          target.stopped = true;
          for (const part of this.bodies(target)) if (target.parts) part.vx = part.vy = 0;
        }
      }
      alchemy.commit(p, alchemyCast, now);
      p.boosterItemReadyAt[booster.id] = now + booster.cooldownMs;
      p.boostersUsed++;
      require("./quest-actions").record(this, p, "boosterUses", null, booster.id, null, accessory ? 'accessory' : 'inventory');
      if (!accessory) p.boosterUses[booster.id] = (p.boosterUses[booster.id] || 0) + 1;
      return {
        type: "boosterUsed",
        boosterId: booster.id,
        playerId: p.id,
        targetId: target.id,
      };
    };
  }
  handleInput(id, message, now) {
    const p = this.players.get(id);
    if (
      !p ||
      p.dead ||
      p.isRemnant ||
      !message ||
      typeof message !== "object" ||
      Array.isArray(message)
    )
      return;
    if (message.type === "move" && Number.isFinite(message.x) && Number.isFinite(message.y)) {
      if (message.spawnSerial !== undefined && message.spawnSerial !== p.spawnSerial) return;
      p.targetX = clamp(message.x, 0, this.world.width);
      p.targetY = clamp(message.y, 0, this.world.height);
      p.lastMoveAt = now;
      p.stopped = false;
      p.moveDirection =
        message.keepDirection === true ? { x: p.targetX - p.x, y: p.targetY - p.y } : null;
    } else if (message.type === "stop") {
      if (message.spawnSerial !== undefined && message.spawnSerial !== p.spawnSerial) return;
      p.targetX = p.x;
      p.targetY = p.y;
      p.lastMoveAt = now;
      p.stopped = true;
      p.moveDirection = null;
    } else if (message.type === "split") {
      return this.splitPlayer(p, message, now);
    } else if (message.type === "feed") {
      return this.feedPlayer(p, message, now);
    } else if (message.type === "rename" && typeof message.name === "string") {
      const name = cleanName(message.name);
      if (nicknames.key(name) && !nicknames.taken(this.players.values(), name, p.id)) p.name = name;
    }
    // mass, radius, x/y игрока, rewards, protectedUntil не принимаются от клиента.
  }
  get etherLimit() {
    return Math.max(this.etherCount, Math.min(RULES.ETHER_FIELD_LIMIT, this.etherCount + RULES.FEED_MAX_PARTICLES));
  }
  reserveFeedSpace(requested, now, partial = false) {
    const free = Math.max(0, this.etherLimit - this.ether.length);
    if (requested <= free) return requested;
    // Natural drops yield first. When the field consists of player drops,
    // retire the oldest collectable ones, never a still-protected launch.
    const needed = requested - free;
    let natural = 0, mature = 0;
    for (const orb of this.ether) {
      if (!orb.ejected) {
        if (++natural === needed) break;
      } else if (orb.sourcePickupAt <= now) mature++;
    }
    mature = Math.min(mature, needed - natural);
    const available = free + natural + mature;
    if (!partial && available < requested) return 0;
    if (natural || mature) {
      // Preserve priority, survivor order and object identity without allocating
      // a new field array for each W/poison emission on a full arena.
      const food = this.ether;
      let write = 0;
      for (let read = 0; read < food.length; read++) {
        const orb = food[read];
        if (!orb.ejected && natural > 0) { natural--; continue; }
        if (orb.ejected && mature > 0 && orb.sourcePickupAt <= now) { mature--; continue; }
        food[write++] = orb;
      }
      food.length = write;
    }
    return available;
  }
  fillEther() {
    let free = this.etherLimit - this.ether.length;
    if (free <= 0 || this.etherCount === 0) return;
    const quotas = ETHER_TYPES.map((type) => Math.floor((this.etherCount * type.share) / 100));
    quotas[0] += this.etherCount - quotas.reduce((sum, count) => sum + count, 0);
    // Восстанавливаем съеденные номиналы: редкая еда не вытесняет обычную со временем.
    const counts = new Map();
    // Player-funded food is separate from the natural food quotas.
    for (const orb of this.ether)
      if (!orb.ejected) counts.set(orb.value, (counts.get(orb.value) || 0) + 1);
    for (const [index, type] of ETHER_TYPES.entries()) {
      for (let count = counts.get(type.value) || 0; count < quotas[index] && free > 0; count++, free--) {
        this.ether.push(foodSnapshots.createNatural({
          id: "e" + (++this.etherSequence).toString(36),
          x: 30 + this.random() * (this.world.width - 60),
          y: 30 + this.random() * (this.world.height - 60),
          value: type.value,
          radius: type.radius,
          color: ETHER_COLORS[Math.floor(this.random() * ETHER_COLORS.length)],
        }));
      }
    }
  }
  collectEther(now = 0) {
    const food = this.ether;
    const removed = new Uint8Array(food.length);
    let removedCount = 0;
    let foodIndex = null;
    if (this.spatialIndex && food.length >= 128) {
      // Preserve legacy radius fallback and original ordinals. Only buckets
      // and bitsets are reused; positions are rebuilt on every simulation step.
      const indexed = food.map(orb => orb.radius ? orb : { x: orb.x, y: orb.y, radius: 5.5 });
      foodIndex = foodPickupIndexes.get(this);
      if (foodIndex) foodIndex.reset(indexed, RULES.SPATIAL_CELL_SIZE, false);
      else { foodIndex = new CircleIndex(indexed, RULES.SPATIAL_CELL_SIZE); foodPickupIndexes.set(this, foodIndex); }
    } else foodPickupIndexes.delete(this);
    // Более крупные проверяются первыми: порядок прихода соединений не решает спор о частице.
    const ordered = [...this.players.values()]
      .filter((p) => !p.dead && !p.isRemnant)
      .sort((a, b) => b.mass - a.mass || a.id.localeCompare(b.id));
    const candidateBuffer = [];
    for (const p of ordered) {
      if (p.effects.lock > now) continue;
      // Outfit does not change inside a simulation step. Resolve its bonuses
      // once per player, not for every food particle and every split part.
      const foodRadius = 1 + accessories.bonus(p.outfit, "foodRadius") / 100 + (alchemy.modifiers(p).pickupRadius || 0);
      const foodPercent = 100 + accessories.bonus(p.outfit, "food");
      const naturalBefore = p.alchemyNatural || 0;
      const parts = this.bodies(p);
      // Split and unsplit bodies have different object shapes. Keep the hot
      // inner food/body loop on exact Float64 coordinates, with one scratch
      // buffer per live player. Refresh after growth because it can also clamp
      // the body away from a wall in this same pass.
      let bounds = foodPickupScratch.get(p);
      if (!bounds || bounds.length < parts.length * 4) {
        bounds = new Float64Array(Math.max(64, parts.length * 4));
        foodPickupScratch.set(p, bounds);
      }
      for (let j = 0; j < parts.length; j++) {
        const part = parts[j], offset = j * 4;
        bounds[offset] = part.x; bounds[offset + 1] = part.y;
        bounds[offset + 2] = part.radius * foodRadius; bounds[offset + 3] = part.radius;
      }
      const reach = Math.max(1, foodRadius);
      // Only nearby food can be touched. Leave a little room for growth, then
      // query again if a pickup expands or moves a body beyond those bounds.
      const regionFor = (part) => ({ x: part.x, y: part.y, radius: part.radius * reach + 32 });
      const regions = foodIndex && parts.map(regionFor);
      let candidates = foodIndex && foodIndex.queryOrdinals(regions, candidateBuffer);
      let cursor = candidates ? candidates.length : food.length;
      while (cursor > 0) {
        --cursor;
        const i = candidates ? candidates[cursor] : cursor;
        if (removed[i]) continue;
        const orb = food[i];
        if (orb.ejected && orb.sourceId === p.id && now < orb.sourcePickupAt) continue;
        let hit = -1;
        const orbRadius = orb.radius || 5.5;
        const radiusOffset = orb.ejected ? 3 : 2, ox = orb.x, oy = orb.y;
        for (let j = 0; j < parts.length; j++) {
          const offset = j * 4;
          const radius = bounds[offset + radiusOffset] + orbRadius;
          const dx = bounds[offset] - ox;
          if (dx <= -radius || dx >= radius) continue;
          const dy = bounds[offset + 1] - oy;
          if (dy <= -radius || dy >= radius) continue;
          if (dx * dx + dy * dy < radius * radius) { hit = j; break; }
        }
        if (hit >= 0) {
          const body = parts[hit];
          // Feeding transfers mass; the bow must not multiply it on repeated pickup.
          this.gainBodyMass(p, body, orb.ejected ? orb.value : alchemy.food(p, orb.value, Math.floor((orb.value * foodPercent) / 100)), now);
          const offset = hit * 4;
          bounds[offset] = body.x; bounds[offset + 1] = body.y;
          bounds[offset + 2] = body.radius * foodRadius; bounds[offset + 3] = body.radius;
          if (!orb.ejected) {
            p.questFoodCount++;
            p.alchemyNatural = (p.alchemyNatural || 0) + orb.value * Math.max(1, accessories.bonus(p.outfit, "generatorFactor"));
          }
          p.clanFoodCount++;
          removed[i] = 1;
          removedCount++;
          if (regions) {
            const region = regions[hit];
            const offset = Math.max(Math.abs(body.x - region.x), Math.abs(body.y - region.y));
            if (offset + body.radius * reach > region.radius) {
              regions[hit] = regionFor(body);
              candidates = foodIndex.queryOrdinals(regions, candidates);
              cursor = candidates.length;
              while (cursor && candidates[cursor - 1] >= i) --cursor;
            }
          }
        }
      }
      if (!(p.effects.web > now)) for (const part of this.bodies(p)) this.clampPlayer(part);
      this.syncParts(p);
      const gathered = this.alchemyField.collect(p, parts, now);
      if (gathered || p.alchemyNatural !== naturalBefore) alchemyField.report(this, p);
    }
    if (removedCount) this.ether = food.filter((_, i) => !removed[i]);
  }
  resolveAbsorptions(now) {
    // Снимок ДО начислений. Поглощённая сфера исчезнет до команды «Продолжить».
    const snapshot = [];
    let minimumRadius = Infinity, maximumRadius = 0;
    for (const p of this.players.values()) {
      if (p.dead || p.protectedUntil > now) continue;
      for (const part of this.bodies(p)) {
        minimumRadius = Math.min(minimumRadius, part.radius);
        maximumRadius = Math.max(maximumRadius, part.radius);
        snapshot.push({
          // Only collision/reward fields belong in this immutable snapshot.
          // Spreading the entire player for every part copied hundreds of
          // unrelated fields 560 times per tick in a full split room.
          x: part.x,
          y: part.y,
          radius: part.radius,
          mass: part.mass,
          vx: part.vx,
          vy: part.vy,
          spaceSplitUntil: part.spaceSplitUntil,
          isRemnant: p.isRemnant,
          removeAt: p.removeAt,
          profileId: p.profileId,
          departedProfileId: p.departedProfileId,
          effects: p.effects,
          protectedUntil: p.protectedUntil,
          dead: p.dead,
          lifeId: p.lifeId,
          lifeStartedAt: p.lifeStartedAt,
          name: p.name,
          clanPrefix: p.clanPrefix,
          level: p.level,
          skinId: p.skinId,
          id: p.id,
          cellId: this.bodyId(p, part),
        });
      }
    }
    if (maximumRadius <= minimumRadius * RULES.ABSORB_SIZE_RATIO) return [];
    // The ID tie-break does not depend on mass or position. Reuse its exact
    // locale order while this snapshot has the same bodies in the same order;
    // splits, deaths, merges and respawns invalidate it by their IDs.
    let order = absorptionOrders.get(this);
    if (!order || order.ids.length !== snapshot.length ||
        snapshot.some((body, i) => body.id !== order.ids[i] || body.cellId !== order.cells[i])) {
      // A constantly changing roster must not pay for an additional ID sort
      // every step. Use the original comparator until a roster repeats.
      order = {
        ids: snapshot.map(body => body.id), cells: snapshot.map(body => body.cellId), ranks: null,
      };
      absorptionOrders.set(this, order);
      snapshot.sort((a, b) => b.mass - a.mass || a.id.localeCompare(b.id) || a.cellId.localeCompare(b.cellId));
    } else {
      if (!order.ranks) {
        const indices = snapshot.map((_, i) => i).sort((i, j) =>
          snapshot[i].id.localeCompare(snapshot[j].id) || snapshot[i].cellId.localeCompare(snapshot[j].cellId));
        const ranks = new Uint32Array(snapshot.length);
        // Equal keys keep rank ties so the mass sort retains its original stable
        // order even for a custom snapshot containing duplicate IDs.
        let rank = 0;
        for (let i = 0; i < indices.length; i++) {
          const body = snapshot[indices[i]], previous = snapshot[indices[i - 1]];
          if (previous && (body.id.localeCompare(previous.id) || body.cellId.localeCompare(previous.cellId))) rank++;
          ranks[indices[i]] = rank;
        }
        order.ranks = ranks;
      }
      for (let i = 0; i < snapshot.length; i++) snapshot[i].tieOrder = order.ranks[i];
      snapshot.sort((a, b) => b.mass - a.mass || a.tieOrder - b.tieOrder);
    }
    // Mass order normally also orders radii. Verify that invariant once: an
    // imported/custom body with a different radius must keep the full search.
    let orderedRadii = true;
    for (let i = 1; i < snapshot.length; i++)
      if (snapshot[i].radius > snapshot[i - 1].radius) { orderedRadii = false; break; }
    const consumed = new Set();
    const events = [];
    const candidates =
      this.spatialIndex && snapshot.length >= RULES.SPATIAL_MIN_BODIES
        // Absorption requires the victim's centre inside the eater. Index
        // each centre once: covering every cell touched by a large victim
        // only creates extra candidates. Keep the exact depth/size checks
        // and the original snapshot order below.
        ? new CircleIndex(snapshot, RULES.SPATIAL_CELL_SIZE, true)
        : null;
    const candidateBuffer = [], candidateRegion = [];
    for (const eater of snapshot) {
      if (eater.radius <= minimumRadius * RULES.ABSORB_SIZE_RATIO || consumed.has(eater.cellId) ||
          eater.effects?.lock > now ||
          (eater.isRemnant && now >= eater.removeAt))
        continue;
      let firstVictim = 0;
      if (candidates && orderedRadii) {
        let end = snapshot.length;
        while (firstVictim < end) {
          const mid = (firstVictim + end) >>> 1;
          if (canAbsorbSize(eater, snapshot[mid])) end = mid;
          else firstVictim = mid + 1;
        }
      }
      // A synchronous absorption pass owns these two buffers. No candidate
      // list escapes; the original snapshot ordering remains unchanged.
      candidateRegion[0] = eater;
      for (const victim of candidates ? candidates.queryMany(candidateRegion, firstVictim, candidateBuffer) : snapshot) {
        if (consumed.has(victim.cellId) || !canAbsorb(eater, victim, now)) continue;
        consumed.add(victim.cellId);
        events.push({
          type: "absorbed",
          // Authoritative contacts are generated once in this ordered loop.
          // A per-eater-life cursor replaces an unbounded list of victim parts
          // in durable quest receipts. Never derive this cursor from input.
          absorptionSequence: ++this.players.get(eater.id).questAbsorptionSequence,
          eaterLifeId: eater.lifeId,
          eaterId: eater.id,
          victimId: victim.id,
          eaterPartId: eater.cellId,
          victimPartId: victim.cellId,
          victimDefeated: false,
          spaceSplit: eater.spaceSplitUntil > now && Math.hypot(eater.vx || 0, eater.vy || 0) >= 1,
          victimMass: victim.mass,
          tick: this.tick,
          victimX: victim.x,
          victimY: victim.y,
          gain: absorptionGain(victim.mass),
          lifeId: victim.lifeId,
          durationSeconds: Math.max(0, Math.floor((now - victim.lifeStartedAt) / 1000)),
          killer: {
            id: eater.profileId || eater.departedProfileId || null,
            name: eater.name,
            clanPrefix: eater.clanPrefix,
            level: eater.level,
            skinId: eater.skinId,
          },
        });
      }
    }
    if (!events.length) return events;
    // Сначала убираем съеденные части; смерть наступает только при потере последней.
    for (const p of this.players.values()) {
      if (p.dead) continue;
      const remaining = this.bodies(p).filter((part) => !consumed.has(this.bodyId(p, part)));
      if (!remaining.length) {
        this.accrueMass(p, now, true);
        p.dead = true;
        p.endedAt = now;
        const last = events.findLast((event) => event.victimId === p.id);
        if (last) last.victimDefeated = true;
      } else if (p.parts) {
        p.parts = remaining;
        this.syncParts(p);
      }
    }
    for (const event of events) {
      this.combat.continuePullAfterAbsorption(event.victimId, event.eaterId, now, "hook");
      this.combat.continuePullAfterAbsorption(event.eaterId, event.victimId, now, "harpoon");
      const eater = this.players.get(event.eaterId);
      const body = this.bodies(eater).find(
        (part) => this.bodyId(eater, part) === event.eaterPartId,
      );
      event.gain = body && !eater.dead ? this.gainMass(eater, event.gain, body, now) : 0;
    }
    return events;
  }
  step(now) {
    this.tick++;
    this.progressEvents = [];
    this.combatEvents = [];
    this.audioEvents = [];
    for (const p of this.players.values())
      if (p.isRemnant && (p.dead || now >= p.removeAt)) this.removePlayer(p.id);
    this.hazards?.beginStep(now);
    this.moveFeed(now);
    for (const p of this.players.values()) {
      if (p.isRemnant) continue;
      turbo.update(p, now);
      arenaPets.tick(this, p, now);
      accessoryPassives.tick(this, p, now);
    }
    for (const p of this.players.values()) if (!p.dead) this.boosterEffects.tick(p, now);
    this.combat.update(now);
    for (const p of this.players.values()) {
      if (p.dead) continue;
      if (p.isRemnant) {
        this.combat.movePull(p, now);
        continue;
      }
      this.decayMass(p, now);
      if (p.moveDirection) {
        p.stopped = false;
        p.targetX = clamp(p.x + p.moveDirection.x, 0, this.world.width);
        p.targetY = clamp(p.y + p.moveDirection.y, 0, this.world.height);
      } else if (!p.stopped && now - p.lastMoveAt > RULES.INPUT_TIMEOUT_MS) {
        p.targetX = p.x;
        p.targetY = p.y;
        p.stopped = true;
      }
      for (const [id, until] of Object.entries(p.effects)) if (until <= now) delete p.effects[id];
      for (const [id, until] of Object.entries(p.instantEffects))
        if (until <= now) delete p.instantEffects[id];
      const multiplier = this.hasEffect(p, "root", now)
        ? 0
        : (1 +
            (this.hasEffect(p, "speed", now)
              ? (p.effectStrengths?.speed ?? BOOSTERS.get("speed").multiplier) - 1
              : 0) +
            (p.effects.golden_shield > now
              ? (p.effectStrengths?.golden_shield ?? BOOSTERS.get("golden_shield").speedBonus)
              : 0) +
            (p.turbo.active ? 0.3 : 0) +
            arenaPets.speed(p) +
            (alchemy.modifiers(p).speed || 0) +
            accessoryPassives.speed(p, now)) *
          (this.hasEffect(p, "slow", now)
            ? (p.effectStrengths?.freeze ?? BOOSTERS.get("freeze").multiplier)
            : 1) *
          giftEffects.arena(p, "speed");
      if (!this.combat.movePull(p, now)) this.moveParts(p, now, multiplier);
    }
    this.hazards?.collect(now);
    this.alchemyField.tick(now);
    this.collectEther(now);
    // В населении комнаты считаем живых людей, без ботов и оставленных оболочек.
    const playerCount = this.activeHumanCount();
    for (const p of this.players.values()) {
      if (p.dead || p.isRemnant) continue;
      this.reportMassPeak(p, now);
      this.accrueMass(p, now, false, playerCount);
    }
    const events = this.resolveAbsorptions(now);
    for (const event of events) {
      const eater = this.players.get(event.eaterId);
      this.reportMassPeak(eater, now);
    }
    this.fillEther();
    return [...this.combatEvents, ...events];
  }
  reportMassPeak(p, now) {
    const previous = p.reportedMassPeak;
    // New peaks are saved immediately. Losing mass (W/decay/damage) cannot
    // improve a peak achievement; sample it once a second for calendar/quests.
    if (previous?.lifeId === p.lifeId && p.mass <= previous.mass && now - previous.at < 1000)
      return;
    p.reportedMassPeak = { lifeId: p.lifeId, mass: p.mass, at: now };
    this.progressEvents.push({ type: "massPeak", playerId: p.id, mass: p.mass });
  }
  activePlayerCount() {
    let count = 0;
    for (const p of this.players.values()) if (!p.dead && !p.isRemnant) count++;
    return count;
  }
  activeHumanCount() {
    let count = 0;
    for (const p of this.players.values())
      if (!p.dead && !p.isRemnant && !p.departure && !p.isTestBot) count++;
    return count;
  }
  accrueMass(p, now, force = false, playerCount = this.activeHumanCount()) {
    const event = massAccrual.sample(p, now, force, playerCount);
    if (event) this.progressEvents.push(event);
  }
  snapshot(now, events = [], includeRankings = true) {
    const players = [...this.players.values()]
      .filter((p) => !p.dead)
      .map((p) => {
        const bodies = this.bodies(p), parts = [];
        let viewRadius = -Infinity, splittable = false, canFeed = false;
        // A sword may leave several burns on one part. Resolve their maximum
        // once instead of filtering/allocating two arrays for every body.
        let burns;
        if (p.swordBurns.length) {
          burns = new Map();
          for (const burn of p.swordBurns)
            burns.set(burn.partId, Math.max(burns.get(burn.partId) || 0, burn.until - now));
        }
        for (const part of bodies) {
          const id = this.bodyId(p, part);
          // Keep the wire field order, but avoid object spread (and its
          // temporary object) for every part of every player on every tick.
          const row = {
            id, x: part.x, y: part.y, mass: part.mass, radius: part.radius,
            mergeVersion: part.mergeVersion || 0,
          };
          if (part.birth && now - part.splitStartedAt < 1000) row.birth = part.birth;
          row.mergeMs = Math.max(0, this.partMergeAt(p, part) - now);
          row.burnMs = burns?.get(id) || 0;
          parts.push(row);
          viewRadius = Math.max(viewRadius, Math.hypot(part.x - p.x, part.y - p.y) + part.radius);
          splittable ||= part.mass >= RULES.MIN_SPLIT_MASS;
          canFeed ||= part.mass >= RULES.MIN_PART_MASS + RULES.FEED_MASS;
        }
        return {
          id: p.id,
          name: p.name,
          x: p.x,
          y: p.y,
          skinId: p.skinId,
          outfit: accessories.outfit(p.outfit),
          account: p.account || null,
          arenaFrame: p.appearance?.arenaFrame || "default",
          turbo: turbo.view(p, now),
          level: p.level,
          clanPrefix: p.clanPrefix,
          clanId: p.clanId || null,
          clanName: p.clanName || "",
          clanEmblem: p.clanEmblem || "",
          clanCrest: p.clanCrest || null,
          clanFrame: p.clanFrame || null,
          title: p.title || null,
          radius: p.radius,
          mass: p.mass,
          color: p.color,
          spawnSerial: p.spawnSerial,
          departure: p.isRemnant ? {
            remainingMs: Math.max(0, p.removeAt - now),
            fadeMs: RULES.DEPARTURE_FADE_MS,
          } : undefined,
          lifeSeconds: Math.max(0, Math.floor((now - p.lifeStartedAt) / 1000)),
          lifeElapsedMs: Math.max(0, now - p.lifeStartedAt),
          pet: arenaPets.snapshot(p, now),
          potion: p.potion ? { id: p.potion.id, ids: [...require("../../../public/shared/alchemy-rules").activeIds(p.potion)],
            readyInMs: Math.max(0, p.potion.readyAt - now) } : null,
          accessoryAbilities: accessoryAbilities.snapshot(p),
          boostersUsed: p.boostersUsed,
          boosterUses: { ...p.boosterUses },
          boosterLimit: boosterLimitForLevel(p.level) + (p.account?.slotBonus || 0),
          massLimit: massLimitForLevel(p.level),
          mainPartId: p.mainPartId,
          parts,
          viewRadius,
          canSplit:
            bodies.length < this.maxParts && splittable &&
            !this.hasEffect(p, "root", now),
          canFeed,
          mergeMs: p.parts ? Math.max(0, p.mergeAt - now) : 0,
          shieldCooldowns: remainingTimers(p.shieldReadyAt, now),
          boosterCooldowns: remainingTimers(p.boosterItemReadyAt, now),
          shieldMs: Math.max(0, p.protectedUntil - now),
          effects: this.activeEffects(p, now),
          instantEffects: timerEffects(p.instantEffects, now),
          boosterCooldownMs: Math.max(0, p.boosterReadyAt - now),
          forcedMovement: this.combat.pulls.has(p.id),
        };
      });
    const rankings = includeRankings ? this.rankings(players) : {};
    const hazards = this.hazards?.snapshot() || [], ingredients = this.alchemyField.snapshot();
    return {
      type: "state",
      serverVersion: "0.6.0",
      tick: this.tick,
      world: this.world,
      backgroundId: this.backgroundId || arenaBackgrounds.DEFAULT_ID,
      players,
      hazards: ingredients.length ? [...hazards, ...ingredients] : hazards,
      ether: this.ether.map((orb) => {
        if (!orb.ejected) return foodSnapshots.snapshotNatural(orb);
        const row = {
          id: orb.id,
          x: orb.x,
          y: orb.y,
          value: orb.value,
          radius: orb.radius,
          color: orb.color,
          artValue: orb.artValue,
          ejected: true,
        };
        if (orb.birth) row.birth = orb.birth;
        return row;
      }),
      projectiles: this.combat.snapshot(),
      visualEvents: this.combat.contacts,
      audioEvents: this.audioEvents.map((event) => ({ ...event })),
      ...rankings,
      events,
    };
  }
  rankings(players) {
    players = players.filter((p) => !p.departure);
    const leaderboard = [...players]
      .sort((a, b) => b.mass - a.mass || a.id.localeCompare(b.id))
      .slice(0, 10)
      .map((p, i) => ({
        rank: i + 1,
        id: p.id,
        name: p.name,
        mass: p.mass,
        clanPrefix: p.clanPrefix,
        level: p.level,
        title: p.title,
        account: { vip: !!p.account?.vip, premium: !!p.account?.premium },
      }));
    const clans = new Map();
    for (const p of players)
      if (p.clanId) {
        if (!clans.has(p.clanId))
          clans.set(p.clanId, {
            id: p.clanId,
            name: p.clanName,
            prefix: p.clanPrefix,
            emblem: p.clanEmblem,
            crest: p.clanCrest || null,
            frame: p.clanFrame || null,
            mass: 0,
            count: 0,
          });
        const clan = clans.get(p.clanId);
        clan.mass += p.mass;
        clan.count++;
      }
    const clanLeaderboard = [...clans.values()]
      .sort((a, b) => b.mass - a.mass || a.id.localeCompare(b.id))
      .slice(0, 10)
      .map((c, i) => ({ ...c, rank: i + 1 }));
    return { leaderboard, clanLeaderboard };
  }
}
module.exports = {
  Arena,
  RULES,
  DEFAULT_WORLD,
  ETHER_TYPES,
  ETHER_COLORS,
  boosterLimitForLevel,
  massLimitForLevel,
  massDecayLoss,
  radiusForMass,
  speedForMass,
  absorptionGain,
  canAbsorbSize,
  absorptionDistance,
  canAbsorb,
  cleanName,
};
