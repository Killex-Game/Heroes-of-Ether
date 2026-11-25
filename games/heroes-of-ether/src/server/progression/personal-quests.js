"use strict";
const { createHash, randomInt, randomUUID } = require("node:crypto");
const { BoosterError, BOOSTERS, boosterRarity } = require("../boosters/booster-catalog");
const { POOLS } = require("./title-chest-rewards");
const treasury = require("./treasury-capacity");
const bonuses = require("./chest-bonuses");
const questReceipts = require("./quest-receipts");
const questOpponents = require("./quest-opponents");
const { totalMassLimitForLevel } = require("../arena/player-limits");
const DAY = 86400000,
  OFFSET = 3 * 3600000;
const CHESTS = Object.freeze({
  large: {
    name: "Большой сундук",
    art: "expert",
    common: [10, 10],
    advanced: [15, 15],
    rare: [10, 10],
    greatness: 5,
    coins: [100, 200],
    crystals: [15, 20],
    tickets: 3,
  },
  medium: {
    name: "Средний сундук",
    art: "experienced",
    common: [15, 15],
    advanced: [10, 10],
    rare: [5, 5],
    greatness: 3,
    coins: [70, 100],
    crystals: [10, 15],
    tickets: 2,
  },
  small: {
    name: "Малый сундук",
    art: "novice",
    common: [10, 15],
    advanced: [7, 10],
    rare: [5, 7],
    greatness: 2,
    coins: [50, 70],
    crystals: [7, 10],
    tickets: 1,
  },
});
const RULES_VERSION = 1;
const LEGACY_TARGETS = Object.freeze({"sky_hunter":50,"arena_predator":100,"unstoppable":40,"acrobat":15,"feast":25000,"thorns_large":50,"rocket_hit_small":1,"glove_hit_small":2});
const CATALOG = Object.freeze([
  ["sky_hunter","Воздушный охотник","large","jumpKills",15,"Поглотить 15 соперников в прыжке после деления пробелом"],
  ["arena_predator","Хищник арены","large","kills",50,"Полностью поглотить 50 соперников"],
  ["unstoppable","Неудержимый","large","lifeKills",20,"Полностью поглотить 20 соперников за вход на арену"],
  ["great_feast","Большой пир","large","absorbedMass",100000,"Получить 100 000 массы от поглощения соперников"],
  ["giant","Великан","large","mass",50000,"Достичь общей массы 50 000 за вход на арену"],
  ["leader","Лидер арены","large","top1",300,"Удерживать первое место 5 минут подряд"],
  ["marathon","Марафонец","large","survival",1800,"Продержаться на арене 30 минут за вход на арену."],
  ["harvest","Богатый урожай","large","food",5000,"Собрать 5 000 частиц еды"],
  ["top_ten","В десятке","medium","top10",600,"Удерживаться в топ-10 арены 10 минут подряд"],
  ["hunter","Охотник","medium","kills",30,"Полностью поглотить 30 соперников"],
  ["acrobat","Акробат","medium","jumpKills",10,"Поглотить 10 соперников в прыжке после деления пробелом"],
  ["feast","Знатный обед","medium","absorbedMass",50000,"Получить 50 000 массы от поглощения соперников"],
  ["heavyweight","Тяжеловес","medium","mass",15000,"Достичь общей массы 15 000 за вход на арену"],
  ["survivor","Стойкий","medium","survival",900,"Продержаться 15 минут за вход на арену"],
  ["gatherer","Собиратель","medium","food",2000,"Собрать 2 000 частиц еды"],
  ["ten_in_life","Десятка за вход на арену","small","lifeKills",10,"Полностью поглотить 10 соперников за вход на арену"],
  ["appetite","Хороший аппетит","small","kills",15,"Полностью поглотить 15 соперников"],
  ["first_jumps","Ловкий прыжок","small","jumpKills",5,"Поглотить 5 соперников в прыжке после деления пробелом"],
  ["growing","Набираем вес","small","mass",5000,"Достичь общей массы 5 000 за вход на арену"],
  ["snack","Перекус","small","food",500,"Собрать 500 частиц еды"],
  ["thorns_small","Колючий перекус","small","lifeHazards",10,"Поглотить 10 колючек за вход на арену"],
  ["rocket_small","Ракетный залп","small","rocketHits",5,"Попасть Ракетой по 5 соперникам"],
  ["thorn_attack_small","Колючий выпад","small","hazardHits",5,"Попасть запущенной колючкой по 5 соперникам"],
  ["thorns_medium","Колючий обед","medium","lifeHazards",25,"Поглотить 25 колючек за вход на арену"],
  ["rocket_medium","Точный ракетчик","medium","rocketHits",10,"Попасть Ракетой по 10 соперникам"],
  ["thorn_attack_medium","Колючая атака","medium","hazardHits",10,"Попасть запущенной колючкой по 10 соперникам"],
  ["thorns_large","Колючий пир","large","lifeHazards",30,"Поглотить 30 колючек за вход на арену"],
  ["rocket_large","Гроза арены","large","rocketHits",15,"Попасть Ракетой по 15 соперникам"],
  ["thorn_attack_large","Повелитель колючек","large","hazardHits",15,"Попасть запущенной колючкой по 15 соперникам"],
  ["thorn_hit_medium","Колючая атака","medium","lifeHazardHits",3,"Попасть колючкой по 3 соперникам за вход на арену"],
  ["thorn_hit_large","Колючая атака","large","lifeHazardHits",5,"Попасть колючкой по 5 соперникам за вход на арену"],
  ["rocket_hit_small","Ракетная атака","small","lifeRocketHits",3,"Попасть Ракетой по 3 соперникам за вход на арену"],
  ["rocket_hit_medium","Ракетная атака","medium","lifeRocketHits",3,"Попасть Ракетой по 3 соперникам за вход на арену"],
  ["rocket_hit_large","Ракетная атака","large","lifeRocketHits",5,"Попасть Ракетой по 5 соперникам за вход на арену"],
  ["freeze_hit_small","Ледяной приём","small","lifeFreezeHits",3,"Заморозить 3 соперников за вход на арену"],
  ["freeze_hit_medium","Ледяной приём","medium","lifeFreezeHits",5,"Заморозить 5 соперников за вход на арену"],
  ["freeze_hit_large","Ледяной приём","large","lifeFreezeHits",10,"Заморозить 10 соперников за вход на арену"],
  ["hook_hit_small","Ближе к цели","small","hookHits",5,"Притянуть к себе 5 соперников"],
  ["hook_hit_medium","Ближе к цели","medium","hookHits",10,"Притянуть к себе 10 соперников"],
  ["hook_hit_large","Ближе к цели","large","hookHits",15,"Притянуть к себе 15 соперников"],
  ["candy_use_small","Сладкий запас","small","lifeCandyUses",5,"Использовать Конфету 5 раз за вход на арену"],
  ["candy_use_medium","Сладкий запас","medium","lifeCandyUses",10,"Использовать Конфету 10 раз за вход на арену"],
  ["glove_hit_small","Прочь с дороги","small","lifePushHits",3,"Оттолкнуть Перчаткой 3 соперников за вход на арену"],
  ["glove_hit_medium","Прочь с дороги","medium","lifePushHits",5,"Оттолкнуть Перчаткой 5 соперников за вход на арену"],
  ["glove_hit_large","Прочь с дороги","large","lifePushHits",10,"Оттолкнуть Перчаткой 10 соперников за вход на арену"]
].map(([id,name,tier,metric,target,description]) => Object.freeze({id,name,tier,metric,target,description})));
const retired = new Set(["marathon"]);
const byId = new Map(CATALOG.map((q) => [q.id, q]));
const integer = (n) => Number.isSafeInteger(n) && n >= 0;
let cachedDayNumber, cachedDay;
function day(at) {
  const number = Math.floor((at + OFFSET) / DAY);
  if (number !== cachedDayNumber) {
    cachedDay = new Date(at + OFFSET).toISOString().slice(0, 10);
    cachedDayNumber = number;
  }
  return cachedDay;
}
const dayStart = (at) => Math.floor((at + OFFSET) / DAY) * DAY - OFFSET;
function add(a, b) {
  if (!integer(a) || !integer(b) || !integer(a + b))
    throw new BoosterError("Превышен допустимый размер награды.", 409);
  return a + b;
}
function seeded(seed) {
  let i = 0;
  return (max) => createHash("sha256").update(`${seed}:${i++}`).digest().readUInt32BE(0) % max;
}
function eligible(def, p) {
  // Absorbed mass is cumulative; only a simultaneous peak has this ceiling.
  return def.metric !== "mass" || def.target <= totalMassLimitForLevel(p.level);
}
function pick(tier, excluded, random, p) {
  const choices = CATALOG.filter((q) => q.tier === tier && !retired.has(q.id) && !excluded.includes(q.id) && eligible(q, p));
  if (!choices.length) throw new BoosterError("Нет доступного задания этой категории.", 409);
  return choices[random(choices.length)];
}
function entry(def, id, at) {
  return { id, questId: def.id, assignedAt: at, progress: 0, completedAt: null, claimedAt: null };
}
function ensure(p, at) {
  const today = day(at);
  if (p.quests?.day >= today) {
    const old = p.quests;
    const replace = row => row.completedAt === null && (retired.has(row.questId) || !eligible(byId.get(row.questId), p));
    if (old.items.some(replace)) {
      const used = old.items.filter(row => !replace(row)).map(row => row.questId);
      p.quests = { ...old, items: old.items.map(row => {
        if (!replace(row)) return row;
        const def = pick(byId.get(row.questId).tier, used, seeded(row.id + ':eligibility-20261114'), p);
        used.push(def.id);
        return entry(def, row.id + '-eligible-v1', at);
      }) };
    }
    return p.quests;
  }
  const random = seeded(`${p.id}:${today}`),
    items = [];
  // 80% наборов содержат малый сундук, 20% — второй средний.
  for (const tier of ["large", "large", "medium", random(5) === 0 ? "medium" : "small"]) {
    const def = pick(
      tier,
      items.map((q) => q.questId),
      random,
      p,
    );
    items.push(entry(def, `${today}-${items.length}-${def.id}`, at));
  }
  p.quests = {
    rulesVersion: RULES_VERSION,
    day: today,
    rerolls: 0,
    items,
    pending: p.quests?.pending || [],
    session: p.quests?.session || null,
  };
  return p.quests;
}
function makeReward(tier, at, event, random = randomInt) {
  const def = CHESTS[tier],
    range = ([min, max]) => min + random(max - min + 1);
  const reward = {
    tier,
    earnedAt: at,
    items: {},
    coins: range(def.coins),
    crystals: range(def.crystals),
    greatness: def.greatness,
    tickets: event ? def.tickets : 0,
  };
  for (const rarity of ["common", "advanced", "rare"]) {
    const count = range(def[rarity]),
      pool = POOLS[rarity];
    for (let i = 0; i < count; i++) {
      const id = pool[random(pool.length)];
      reward.items[id] = (reward.items[id] || 0) + 1;
    }
  }
  return reward;
}
function complete(p, q, row, at, event) {
  const def = byId.get(row.questId);
  if (row.completedAt !== null || row.progress < def.target) return;
  row.progress = def.target;
  row.completedAt = at;
  q.pending.push({
    ...makeReward(def.tier, at, event),
    id: row.id,
    questId: row.questId,
    title: def.name,
    stored: false,
    receivedAt: null,
  });
  treasury.queue(p, q.pending[q.pending.length - 1], at);
}
// Runs only on a private draft. Existing rewards and their timestamps are retained.
function migrationDue(p) { return !!p.quests && p.quests.rulesVersion === undefined; }
function migrate(p, at, activeEvent) {
  if (!migrationDue(p)) return false;
  validate(p);
  const q = p.quests;
  for (const row of q.items) {
    const def = byId.get(row.questId);
    row.progress = row.completedAt !== null ? def.target : Math.min(row.progress, def.target);
    if (row.opponents?.length > def.target) row.opponents = row.opponents.slice(0, def.target);
    // Older days must not acquire retrospective rewards.
    if (q.day === day(at)) complete(p, q, row, at, activeEvent);
  }
  q.rulesVersion = RULES_VERSION;
  validate(p);
  return true;
}
function resetLife(q) {
  for (const row of q.items)
    if (
      row.completedAt === null &&
      ["lifeKills", "lifeHazards", "lifeHazardHits", "lifeRocketHits", "lifeFreezeHits", "lifePushHits", "lifeCandyUses", "survival", "top1", "top10"].includes(byId.get(row.questId).metric)
    ) {
      row.progress = 0;
      delete row.opponents;
    }
}
function progress(p, event, at, activeEvent, receiptDraft) {
  migrate(p, at, activeEvent);
  const q = ensure(p, at);
  if (q.day !== day(at)) return;
  if (event.type === "lifeStarted") {
    if (q.session?.id !== event.lifeId) {
      resetLife(q);
      q.session = { id: event.lifeId, startedAt: at, sampledAt: at, rank: null, food: 0, seen: {} };
    }
    return;
  }
  // Старые профили, которые уже были на арене при первом открытии раздела.
  if (!q.session && p.progress.session)
    q.session = {
      id: p.progress.session.id,
      startedAt: at,
      sampledAt: at,
      rank: null,
      food: 0,
      seen: {},
    };
  const session = q.session;
  if (!session || (event.type === "questSample" && event.lifeId !== session.id)) return;
  const changes = {};
  if (event.type === "arenaAction") {
    if (event.lifeId !== session.id || !integer(event.sequence) ||
        event.sequence <= (session.actionSequence || 0) ||
        !["hazards", "hazardHits", "rocketHits", "freezeHits", "hookHits", "pushHits", "poisonHits", "boosterUses"].includes(event.metric)) return;
    session.actionSequence = event.sequence;
    changes[event.metric] = 1;
    if (event.metric === "hazards") changes.lifeHazards = 1;
    const lifeMetric = { hazardHits: 'lifeHazardHits', rocketHits: 'lifeRocketHits', freezeHits: 'lifeFreezeHits', pushHits: 'lifePushHits' }[event.metric];
    if (lifeMetric) changes[lifeMetric] = 1;
    if (event.metric === 'boosterUses') {
      const booster = BOOSTERS.get(event.boosterId);
      if (!booster && !['pet_fire','pet_claw','pet_glove','pet_carrot'].includes(event.boosterId)) return;
      const rarity = booster && boosterRarity(booster);
      if (['common', 'advanced', 'rare', 'clan'].includes(rarity)) changes[rarity + 'Uses'] = 1;
      if (booster?.kind === 'shield') changes.shieldUses = 1;
      if (booster?.id === 'candy') changes.lifeCandyUses = 1;
    }
  }
  if (event.type === "absorbed") {
    if (
      !event.victimProfileId ||
      event.victimProfileId === p.id ||
      !event.lifeId ||
      !event.victimPartId
    )
      return;
    if (event.absorptionSequence !== undefined) {
      // Room ownership and FIFO/WAL acknowledgement preserve this server-only
      // sequence. Old queued events without a cursor retain exact-key receipts.
      if (event.eaterLifeId !== session.id || !integer(event.absorptionSequence) ||
          event.absorptionSequence <= (session.absorptionSequence || 0)) return;
      session.absorptionSequence = event.absorptionSequence;
    } else {
      const key = `${event.lifeId}:${event.victimPartId}`;
      if (!questReceipts.record(session, key, receiptDraft)) return;
    }
    changes.absorbedMass = Math.max(0, Math.floor(event.gain || 0));
    if (event.victimDefeated !== false) {
      changes.kills = changes.lifeKills = 1;
      if (event.spaceSplit) changes.jumpKills = 1;
    }
  }
  if (event.type === "questSample") {
    if (at <= session.sampledAt) return;
    changes.food = Math.max(0, event.food - session.food);
  }
  for (const row of q.items) {
    if (row.completedAt !== null) continue;
    const def = byId.get(row.questId);
    if (changes[def.metric] && questOpponents.accepts(row, def.metric, event, p.id, def.target))
      row.progress = Math.min(def.target, row.progress + changes[def.metric]);
    if (def.metric === "mass" && event.type === "massPeak")
      row.progress = Math.max(row.progress, Math.min(def.target, event.mass));
    if (def.metric === "survival" && ["questSample", "lifeEnded"].includes(event.type)) {
      if (event.lifeId === session.id)
        row.progress = Math.min(
          def.target,
          Math.floor(
            Math.max(0, at - Math.max(session.startedAt, row.assignedAt, dayStart(at))) / 1000,
          ),
        );
    }
    if (["top1", "top10"].includes(def.metric) && event.type === "questSample") {
      const limit = def.metric === "top1" ? 1 : 10;
      const eligible = event.rank >= 1 && event.rank <= limit;
      const previouslyEligible = session.rank >= 1 && session.rank <= limit;
      if (!eligible) {
        row.progress = 0;
        delete row.streakAt;
      } else {
        if (!previouslyEligible || !integer(row.streakAt)) row.streakAt = at;
        row.progress = Math.min(def.target, Math.floor((at - row.streakAt) / 1000));
      }
    }
    complete(p, q, row, at, activeEvent);
  }
  treasury.fill(p, at);
  if (event.type === "questSample") {
    session.sampledAt = at;
    session.rank = event.rank;
    session.food = event.food;
  }
  if (event.type === "lifeEnded" && event.lifeId === session.id) {
    resetLife(q);
    q.session = null;
  }
  return changes;
}
function act(p, input, at) {
  const q = ensure(p, at);
  treasury.fill(p, at);
  if (["receive", "prepare", "claim"].includes(input.action)) {
    const base = q.pending.find((r) => r.id === input.questId);
    if (!base) throw new BoosterError("Награда уже получена или задание ещё не выполнено.", 409);
    if (input.action === "receive") {
      if (base.stored !== false) return;
      base.receivedAt ??= at;
      treasury.fill(p, at);
      return;
    }
    if (base.stored === false)
      throw new BoosterError("Освободи место: открой сундук в Сокровищнице.", 409);
    if (base.multiplier === undefined) {
      base.multiplier = bonuses.multiplier(p, at);
      base.greatnessMultiplier = bonuses.greatnessMultiplier(p, at);
    }
    if (input.action === "prepare") return;
    const reward = bonuses.scale(base, base.multiplier, base.greatnessMultiplier);
    for (const [id, count] of Object.entries(reward.items))
      p.inventory[id] = add(p.inventory[id] || 0, count);
    for (const currency of ["coins", "crystals"])
      p.wallet[currency] = add(p.wallet[currency], reward[currency]);
    p.greatness = add(p.greatness, reward.greatness);
    require("../accounts/lite-account").grantTickets(p, reward.tickets);
    q.pending = q.pending.filter((r) => r.id !== reward.id);
    treasury.fill(p, at);
    const row = q.items.find((r) => r.id === reward.id);
    if (row) row.claimedAt = at;
    return;
  }
  if (input.action !== "reroll") throw new BoosterError("Неизвестное действие задания.");
  const row = q.items.find((r) => r.id === input.questId);
  if (!row || row.completedAt !== null)
    throw new BoosterError("Сменить можно только текущее невыполненное задание.", 409);
  const cost = q.rerolls ? 100 : 0;
  if (input.expectedCost !== cost)
    throw new BoosterError("Цена смены обновилась. Проверь стоимость и повтори.", 409);
  if (p.wallet.coins < cost) throw new BoosterError("Для смены задания нужно 100 монет.", 409);
  const def = pick(
    byId.get(row.questId).tier,
    q.items.map((r) => r.questId),
    randomInt,
    p,
  );
  p.wallet.coins -= cost;
  if (cost) require("./activity-achievements").spend(p, "coins", cost, at);
  q.items[q.items.indexOf(row)] = entry(def, randomUUID(), at);
  q.rerolls++;
}
function view(p, at, event, config, manager) {
  // Представление не изменяет зафиксированные данные профиля.
  const q = ensure({ id: p.id, level: p.level, quests: p.quests }, at);
  return {
    day: q.day,
    resetsAt: dayStart(at) + DAY,
    rerollCost: q.rerolls ? 100 : 0,
    freeRerolls: q.rerolls ? 0 : 1,
    items: q.items.map(({ opponents, ...row }) => ({
      ...row,
      ...byId.get(row.questId),
      id: row.id,
      questId: row.questId,
      chest: bonuses.preview(
        {
          ...bonuses.scale(CHESTS[byId.get(row.questId).tier], bonuses.multiplier(p, at), bonuses.greatnessMultiplier(p, at)),
          tickets: event ? CHESTS[byId.get(row.questId).tier].tickets : 0,
        },
        p,
        config,
        at,
        manager,
        "quest",
      ),
    })),
    // При заполнении хранилища награда ждёт свободного места без потери состава.
    pending: q.pending
      .filter((reward) => !treasury.expired(reward, at))
      .map((reward) => ({
        ...bonuses.preview(
          bonuses.scale(reward, reward.multiplier ?? bonuses.multiplier(p, at), reward.greatnessMultiplier ?? reward.multiplier ?? bonuses.greatnessMultiplier(p, at)),
          p,
          config,
          at,
          manager,
          "quest",
        ),
        prepared: reward.multiplier !== undefined,
        chest: { name: CHESTS[reward.tier].name, art: CHESTS[reward.tier].art },
      })),
  };
}
function validate(p, previousSeen, previousBuckets) {
  if (p.quests === undefined) return;
  const q = p.quests,
    fail = () => {
      throw Error("Повреждены личные задания. Сохранение не перезаписано.");
    };
  if (
    !q ||
    (q.rulesVersion !== undefined && q.rulesVersion !== RULES_VERSION) ||
    !/^\d{4}-\d{2}-\d{2}$/.test(q.day) ||
    !integer(q.rerolls) ||
    !Array.isArray(q.items) ||
    q.items.length !== 4 ||
    !Array.isArray(q.pending)
  )
    fail();
  if (
    new Set(q.items.map((r) => r.questId)).size !== 4 ||
    new Set(q.items.map((r) => r.id)).size !== 4
  )
    fail();
  const tiers = { large: 0, medium: 0, small: 0 };
  for (const row of q.items) {
    const def = byId.get(row.questId);
    const target = q.rulesVersion === undefined ? (LEGACY_TARGETS[row.questId] ?? def?.target) : def?.target;
    if (
      !def ||
      typeof row.id !== "string" ||
      !row.id ||
      !integer(row.assignedAt) ||
      !integer(row.progress) ||
      row.progress > target ||
      !questOpponents.valid(row, target) ||
      (row.completedAt !== null && (!integer(row.completedAt) || row.progress !== target)) ||
      (row.claimedAt !== null && (!integer(row.claimedAt) || row.completedAt === null)) ||
      (row.expiredAt !== undefined &&
        (!integer(row.expiredAt) || row.completedAt === null || row.claimedAt !== null)) ||
      (row.streakAt !== undefined && !integer(row.streakAt))
    )
      fail();
    tiers[def.tier]++;
  }
  if (tiers.large !== 2 || ![1, 2].includes(tiers.medium) || tiers.medium + tiers.small !== 2)
    fail();
  if (new Set(q.pending.map((r) => r.id)).size !== q.pending.length) fail();
  for (const reward of q.pending) {
    const def = CHESTS[reward.tier];
    if (
      !def ||
      typeof reward.id !== "string" ||
      !byId.has(reward.questId) ||
      byId.get(reward.questId).tier !== reward.tier ||
      !integer(reward.earnedAt) ||
      !treasury.validStorage(reward) ||
      (reward.notifiedAt !== undefined && !integer(reward.notifiedAt)) ||
      (reward.stored !== undefined && typeof reward.stored !== "boolean") ||
      (reward.receivedAt !== undefined &&
        reward.receivedAt !== null &&
        !integer(reward.receivedAt)) ||
      (reward.multiplier !== undefined && ![1, 2, 3].includes(reward.multiplier)) ||
      (reward.greatnessMultiplier !== undefined && (![1, 2].includes(reward.greatnessMultiplier) || reward.multiplier === undefined)) ||
      !reward.items ||
      typeof reward.items !== "object" ||
      Array.isArray(reward.items) ||
      reward.greatness !== def.greatness ||
      ![0, def.tickets].includes(reward.tickets)
    )
      fail();
    for (const currency of ["coins", "crystals"])
      if (
        !integer(reward[currency]) ||
        reward[currency] < def[currency][0] ||
        reward[currency] > def[currency][1]
      )
        fail();
    if (
      Object.entries(reward.items).some(
        ([id, n]) =>
          !Object.values(POOLS)
            .slice(0, 3)
            .some((pool) => pool.includes(id)) ||
          !integer(n) ||
          !n,
      )
    )
      fail();
    for (const rarity of ["common", "advanced", "rare"]) {
      const total = POOLS[rarity].reduce((sum, id) => sum + (reward.items[id] || 0), 0);
      if (total < def[rarity][0] || total > def[rarity][1]) fail();
    }
  }
  if (q.session !== null) {
    const s = q.session;
    if (
      !s ||
      typeof s.id !== "string" ||
      (s.actionSequence !== undefined && !integer(s.actionSequence)) ||
      (s.absorptionSequence !== undefined && !integer(s.absorptionSequence)) ||
      ![s.startedAt, s.sampledAt, s.food].every(integer) ||
      (s.rank !== null && (!integer(s.rank) || !s.rank)) ||
      !s.seen ||
      typeof s.seen !== "object" ||
      Array.isArray(s.seen) ||
      // Only a previously validated, published receipt map may skip the scan.
      // Loading and every changed receipt map still receive full validation.
      (s.seen !== previousSeen && Object.values(s.seen).some((v) => v !== true)) ||
      !questReceipts.valid(s.seenBuckets, previousBuckets)
    )
      fail();
  }
}
module.exports = { RULES_VERSION, migrationDue, migrate, CATALOG, activeCatalog: CATALOG.filter(q => !retired.has(q.id)),  CHESTS, day, ensure, progress, act, view, validate, makeReward };
