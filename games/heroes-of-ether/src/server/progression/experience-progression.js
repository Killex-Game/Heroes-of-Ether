/* Уровни, опыт за арену, ограничения начисления и боевые достижения. */
"use strict";
const stages = require("./achievement-stages");
const accessories = require("../../../public/shared/accessory-catalog");
const accessoryAccess = require("../profiles/accessory-access");
const accounts = require("../accounts/account-benefits");
const massAccrual = require("../arena/mass-accrual");
const lifeCollectibles = require("../events/life-collectibles");
const { awardTitles } = require("./title-chest-rewards");
const {
  awardExtra,
  lifeTime,
  finishActivityLife,
  publicExtra,
} = require("./activity-achievements");
// Load lazily to preserve the existing module-cycle ordering, then reuse the
// modules in the hot progress path instead of resolving their filenames again.
let promotionRules, rouletteProgress, giftEffects;

// Стоимость перехода зависит от текущего уровня.
const LEVEL_BANDS = Object.freeze([
  [25, 500],
  [120, 1000],
  [500, 3000],
  [5000, 5000],
  [10000, 10000],
  [Infinity, 15000],
]);
const KILL_XP = 3,
  VICTIM_COOLDOWN_MS = 3 * 60 * 1000;
const ACHIEVEMENTS = Object.freeze([
  {
    id: "king",
    name: "Царь",
    stat: "absorptionKills",
    description: "Полностью поглотить соперников",
    thresholds: [50, 150, 300, 500, 1000],
    rewards: [25, 50, 75, 100, 150],
  },
  {
    id: "eaten",
    name: "Толстяк",
    stat: "absorbedMass",
    description: "Получить массу от соперников",
    thresholds: [1000, 5000, 10000, 50000],
  },
  {
    id: "maximum",
    name: "Максимум",
    stat: "maxMass",
    exception: true,
    description: "Достичь массы на арене",
    thresholds: [25000, 50000, 100000, 200000],
  },
  {
    id: "boosters",
    name: "По назначению",
    stat: "boosterUses",
    description: "Успешно применить бустеры",
    thresholds: [100, 500, 1000, 5000],
  },
]);
const GREATNESS_REWARDS = Object.freeze([10, 30, 50, 100]);
const integer = (n) => Number.isSafeInteger(n) && n >= 0;
function add(a, b) {
  if (!integer(a) || !integer(b) || !integer(a + b))
    throw Error("Превышен допустимый размер прогресса.");
  return a + b;
}
function levelProgress(totalXp) {
  if (!integer(totalXp)) throw Error("Неверное значение опыта.");
  let level = 1,
    remaining = totalXp;
  for (const [last, cost] of LEVEL_BANDS) {
    const transitions = Math.min(last - level + 1, Math.floor(remaining / cost));
    level += transitions;
    remaining -= transitions * cost;
    if (level <= last) return { level, totalXp, levelXp: remaining, nextLevelXp: cost };
  }
}
function xpForLevel(level) {
  if (!Number.isSafeInteger(level) || level < 1) throw Error("Неверный уровень.");
  let from = 1,
    xp = 0;
  for (const [last, cost] of LEVEL_BANDS) {
    const transitions = Math.max(0, Math.min(level - from, last - from + 1));
    xp = add(xp, transitions * cost);
    from += transitions;
    if (from === level) return xp;
  }
}
function freshProgress(level = 1) {
  return {
    xp: xpForLevel(level),
    kills: 0,
    absorptionKills: 0,
    absorptionVictims: {},
    kingLegacyDegrees: 0,
    absorbedMass: 0,
    maxMass: 0,
    boosterUses: 0,
    stageSpent: Object.fromEntries(ACHIEVEMENTS.map((a) => [a.id, 0])),
    bestAbsorptions: 0,
    claimed: Object.fromEntries(ACHIEVEMENTS.map((a) => [a.id, 0])),
    recentVictims: {},
    session: null,
    lastLife: null,
    arenaXpTarget: null,
  };
}
function migrateKingProgress(p) {
  const s = p.progress;
  if (!s || s.absorptionKills !== undefined) return false;
  const claimed = s.claimed?.king;
  // The former total mixed mass rewards and absorptions. Never convert it
  // into defeats or repay old degrees. Keep earned stars; start a clean stage.
  if (!integer(claimed) || claimed > 4 || !integer(s.kills) ||
    (claimed && s.kills < [10, 50, 100, 200][claimed - 1]))
    throw Error("Повреждён прогресс достижения Царь.");
  s.absorptionKills = 0;
  s.absorptionVictims = {};
  s.kingLegacyDegrees = claimed;
  if (s.stageSpent) s.stageSpent.king = 0;
  return true;
}
function validateProgress(p) {
  (promotionRules ||= require("../shop/promotion-offers")).validate(p);
  const s = p.progress;
  if (
    !s ||
    ![s.xp, s.kills, s.absorptionKills, s.absorbedMass, s.maxMass, s.boosterUses].every(integer) ||
    levelProgress(s.xp).level !== p.level ||
    !s.claimed ||
    !s.recentVictims ||
    Array.isArray(s.claimed) ||
    Array.isArray(s.recentVictims) ||
    typeof s.recentVictims !== "object" ||
    !Object.values(s.recentVictims).every(integer) ||
    ACHIEVEMENTS.some(
      (a) =>
        !integer(s.claimed[a.id]) ||
        s.claimed[a.id] > a.thresholds.length ||
        (a.id === "king"
          ? !integer(s.kingLegacyDegrees) || s.kingLegacyDegrees > 4 ||
            s.claimed.king < s.kingLegacyDegrees ||
            s.absorptionKills < a.thresholds.slice(s.kingLegacyDegrees, s.claimed.king).reduce((sum, n) => sum + n, 0)
          : s.claimed[a.id] > a.thresholds.filter((n) => s[a.stat] >= n).length),
    )
  )
    throw Error("Повреждён прогресс игрока. Файл сохранений не перезаписан.");
  if (!s.absorptionVictims || Array.isArray(s.absorptionVictims) ||
    typeof s.absorptionVictims !== "object" || !Object.values(s.absorptionVictims).every(integer))
    throw Error("Повреждён учёт поглощений для достижения Царь.");
  stages.validate(s, ACHIEVEMENTS, (a) => s[a.stat]);
  if (
    (s.bestAbsorptions !== undefined && !integer(s.bestAbsorptions)) ||
    (s.session?.realAbsorptions !== undefined && !integer(s.session.realAbsorptions))
  )
    throw Error("Повреждён рекорд поглощений.");
  if (
    s.session !== null &&
    (!s.session || typeof s.session.id !== "string" || !s.session.id || !integer(s.session.xp))
  )
    throw Error("Повреждён опыт текущей жизни.");
  if (s.session?.kills !== undefined && !integer(s.session.kills))
    throw Error("Повреждён счётчик киллов текущей жизни.");
  if (
    s.session?.creditedKills !== undefined &&
    (!integer(s.session.creditedKills) || s.session.creditedKills > s.session.kills)
  )
    throw Error("Повреждён зачёт киллов текущей жизни.");
  if (s.session?.massBonusSequence !== undefined && !integer(s.session.massBonusSequence))
    throw Error("Повреждён счётчик бонусов за массу.");
  for (const [key, limit] of [
    ["accessoryXpRemainder", 99],
    ["giftXpRemainder", 99],
    ["massAccrualSequence", Number.MAX_SAFE_INTEGER],
    ["massXpRemainder", massAccrual.XP_DENOMINATOR * 100 - 1],
    ["massKillRemainder", massAccrual.KILL_DENOMINATOR - 1],
  ]) {
    if (s.session?.[key] !== undefined && (!integer(s.session[key]) || s.session[key] > limit))
      throw Error("Повреждено накопление наград за массу.");
  }
  if (
    s.session?.splitVictims !== undefined &&
    (!Array.isArray(s.session.splitVictims) ||
      s.session.splitVictims.some((id) => typeof id !== "string") ||
      new Set(s.session.splitVictims).size !== s.session.splitVictims.length)
  )
    throw Error("Повреждён учёт поглощений разделением.");
  for (const mark of [s.session?.luckyLevel, s.lastLife?.pendingEventLevel,
    s.session?.fridayLevel, s.lastLife?.pendingFridayLevel])
    if (
      mark !== undefined &&
      (!mark || !/^[a-zA-Z0-9_-]{1,80}$/.test(mark.runId) || !integer(mark.at))
    )
      throw Error("Повреждён учёт уровня в событии.");
  // Поле необязательно в сохранениях предыдущей версии.
  lifeCollectibles.validate(s.lastLife?.eventItems);
  if (s.arenaXpTarget != null && !integer(s.arenaXpTarget))
    throw Error("Повреждён предел опыта захода на арену.");
  if (
    s.lastLife !== null &&
    (!s.lastLife ||
      typeof s.lastLife.id !== "string" ||
      !integer(s.lastLife.earnedXp) ||
      !integer(s.lastLife.durationSeconds))
  )
    throw Error("Повреждён итог жизни.");
}
function awardAchievements(p, at = Date.now(), extraCurrent = false) {
  migrateKingProgress(p);
  stages.ensure(p.progress, ACHIEVEMENTS, (a) => p.progress[a.stat]);
  for (const a of ACHIEVEMENTS) {
    while (
      p.progress.claimed[a.id] < a.thresholds.length &&
      stages.current(p.progress, a, p.progress[a.stat]) >= a.thresholds[p.progress.claimed[a.id]]
    ) {
      p.greatness = add(
        p.greatness,
        (a.rewards || GREATNESS_REWARDS)[p.progress.claimed[a.id]] * accounts.benefits(p, at).greatnessMultiplier,
      );
      stages.consume(p.progress, a);
      p.progress.claimed[a.id]++;
    }
  }
  // Core progress awards change greatness only. A valid lifeTime event has
  // already settled the same activity counters on this draft.
  if (!extraCurrent) awardExtra(p, at);
  const previousLevel = p.level;
  p.level = levelProgress(p.progress.xp).level;
  (promotionRules ||= require("../shop/promotion-offers")).recordLevels(p, previousLevel, at);
  (rouletteProgress ||= require("../roulette/roulette-service")).grantLevels(p, previousLevel);
  awardTitles(p, at);
}
function minuteXp(mass) {
  if (!integer(mass)) throw Error("Неверная масса для опыта.");
  return Math.floor(mass / (mass <= 75000 ? 500 : 800));
}
function earnXp(
  p,
  amount,
  repeats = 1,
  at = Date.now(),
  accountXpPercent = accounts.benefits(p, at).xpPercent,
  absorption = false,
) {
  // До завершения жизни опыт хранится отдельно и не меняет уровень/рейтинг.
  const s = p.progress;
  if (!integer(amount) || !integer(repeats)) throw Error("Неверное начисление опыта.");
  // Каждая полная минута округляется отдельно даже в догоняющем пакете.
  const extraUnits = add(
    s.session?.accessoryXpRemainder || 0,
    amount *
      (accessories.bonus(accessoryAccess.outfit(p), "xp") +
        (absorption ? accessories.bonus(accessoryAccess.outfit(p), "killXp") : 0)) *
      repeats,
  );
  amount =
    Math.floor((amount * (100 + accountXpPercent)) / 100) * repeats + Math.floor(extraUnits / 100);
  if (s.session) s.session.accessoryXpRemainder = extraUnits % 100;
  const giftPercent = Math.round((giftEffects ||= require("../profiles/gift-effects")).modifiers(p, at).xp * 100);
  const giftUnits = amount * giftPercent + (s.session?.giftXpRemainder || 0);
  amount = Math.floor(giftUnits / 100);
  if (s.session) s.session.giftXpRemainder = giftUnits % 100;
  const activePotion = p.alchemy?.active;
  const potionXp = activePotion?.lifeId === s.session?.id
    ? require("../../../public/shared/alchemy-rules").get(activePotion?.id)?.modifiers.xp || 0 : 0;
  if (potionXp && s.session) {
    const units = amount * Math.round(potionXp * 100) + (s.session.alchemyXpRemainder || 0);
    amount += Math.floor(units / 100);
    s.session.alchemyXpRemainder = units % 100;
  }
  if (!integer(amount)) throw Error("Неверное начисление опыта.");
  if (s.session) {
    const remaining = Math.max(0, s.arenaXpTarget - s.xp - s.session.xp);
    s.session.xp = add(s.session.xp, Math.min(amount, remaining));
  }
}
function finishLife(p, event, at) {
  const s = p.progress;
  if (!s.session || s.session.id !== event.lifeId) return;
  const nextXp = add(s.xp, s.session.xp);
  const levels = levelProgress(nextXp).level - levelProgress(s.xp).level;
  const levelReward = { levels, coins: levels * 10, crystals: levels };
  // Выдача в той же транзакции, что и завершение жизни. Повтор события не даёт награду.
  const coins = add(p.wallet.coins, levelReward.coins);
  const crystals = add(p.wallet.crystals, levelReward.crystals);
  finishActivityLife(p, event, at);
  s.lastLife = {
    id: event.lifeId,
    earnedXp: s.session.xp,
    kills: s.session.creditedKills ?? s.session.kills ?? 0,
    visualKills: s.session.kills || 0,
    durationSeconds: event.durationSeconds,
    eventItems: lifeCollectibles.forLife(p, event.lifeId),
    reason: event.reason,
    killer: event.killer || null,
    ...(levels > 0 ? { levelReward } : {}),
    ...(levels > 0 && s.session.luckyLevel ? { pendingEventLevel: s.session.luckyLevel } : {}),
    ...(levels > 0 && s.session.fridayLevel ? { pendingFridayLevel: s.session.fridayLevel } : {}),
  };
  p.wallet.coins = coins;
  p.wallet.crystals = crystals;
  s.xp = nextXp;
  s.session = null;
}
function awardKills(p, count, xp, at, accountXpPercent, absorption = false) {
  const s = p.progress,
    session = s.session;
  // Старые жизни до обновления уже зачислили все показанные киллы.
  if (session) {
    session.creditedKills ??= session.kills || 0;
    session.kills = add(session.kills || 0, count);
  }
  // Проверяем ДО начисления опыта: событие, достигшее лимита, засчитывается целиком.
  const capped = s.arenaXpTarget != null && s.xp + (session?.xp || 0) >= s.arenaXpTarget;
  if (!capped) {
    s.kills = add(s.kills, count);
    if (session) session.creditedKills = add(session.creditedKills, count);
    earnXp(p, xp, count, at, accountXpPercent, absorption);
  }
  return !capped;
}
function applyEvent(p, event, at) {
  migrateKingProgress(p);
  const s = p.progress;
  let extraCurrent = false;
  stages.ensure(s, ACHIEVEMENTS, (a) => s[a.stat]);
  if (event.type === "lifeStarted") {
    if (s.session?.id === event.lifeId) return;
    if (s.session) throw Error("Предыдущая жизнь ещё не завершена.");
    if (event.newArena !== false || s.arenaXpTarget == null) {
      const progress = levelProgress(s.xp);
      s.arenaXpTarget = add(s.xp, progress.nextLevelXp - progress.levelXp);
    }
    s.session = {
      id: event.lifeId,
      xp: 0,
      kills: 0,
      creditedKills: 0,
      realAbsorptions: 0,
      activitySeconds: 0,
      activityClan: p.clanId || null,
    };
  } else if (event.type === "lifeTime") {
    extraCurrent = lifeTime(p, event.lifeId, event.durationSeconds, at) === true;
  } else if (event.type === "lifeEnded") {
    finishLife(p, event, at);
  } else if (event.type === "absorbed") {
    if (!event.victimProfileId || event.victimProfileId === p.id) return;
    // Count final defeats, not individual fragments or passive mass rewards.
    // Keep the established three-minute protection against farming one victim.
    if (event.victimDefeated !== false && !(s.absorptionVictims[event.victimProfileId] > at)) {
      for (const [id, until] of Object.entries(s.absorptionVictims))
        if (until <= at) delete s.absorptionVictims[id];
      s.absorptionVictims[event.victimProfileId] = add(at, VICTIM_COOLDOWN_MS);
      s.absorptionKills = add(s.absorptionKills, 1);
    }
    if (event.spaceSplit && event.victimDefeated !== false && s.session) {
      const key = event.lifeId;
      if (typeof key === "string" && !(s.session.splitVictims ||= []).includes(key)) {
        s.session.splitVictims.push(key);
        p.activity.values.jumper++;
      }
    }
    if ((s.recentVictims[event.victimProfileId] || 0) > at) {
      awardAchievements(p, at);
      return true;
    }
    for (const [id, until] of Object.entries(s.recentVictims))
      if (until <= at) delete s.recentVictims[id];
    s.recentVictims[event.victimProfileId] = add(at, VICTIM_COOLDOWN_MS);
    s.absorbedMass = add(s.absorbedMass, event.gain);
    // За поглощение действует лучший аккаунт; бонус экипировки добавляется как прежде.
    const accountXpPercent = (accounts.benefits(p, at).absorptionXpMultiplier - 1) * 100;
    const credited = awardKills(p, 1, KILL_XP, at, accountXpPercent, true);
    // Only a real, credited defeat counts toward this public record; mass
    // rewards and kills shown after the experience cap never inflate it.
    if (credited && s.session) {
      s.session.realAbsorptions = add(s.session.realAbsorptions || 0, 1);
      s.bestAbsorptions = Math.max(s.bestAbsorptions || 0, s.session.realAbsorptions);
    }
  } else if (event.type === "massAccrual") {
    const session = s.session;
    if (
      !session ||
      session.id !== event.lifeId ||
      !integer(event.sequence) ||
      event.sequence <= (session.massAccrualSequence || 0)
    )
      return;
    if (
      !integer(event.xpUnits) ||
      !integer(event.killUnits) ||
      (event.baseXpUnits !== undefined &&
        (!integer(event.baseXpUnits) || event.baseXpUnits > event.xpUnits))
    )
      throw Error("Неверное накопление за массу.");
    const denominator = massAccrual.XP_DENOMINATOR * 100;
    const xpUnits = add(
      session.massXpRemainder || 0,
      event.xpUnits * (100 + accessories.bonus(accessoryAccess.outfit(p), "xp")) +
        (event.baseXpUnits || 0) * accessories.bonus(accessoryAccess.outfit(p), "massXp"),
    );
    const killUnits = add(session.massKillRemainder || 0, event.killUnits);
    const xp = Math.floor(xpUnits / denominator),
      kills = Math.floor(killUnits / massAccrual.KILL_DENOMINATOR);
    session.massAccrualSequence = event.sequence;
    session.massXpRemainder = xpUnits % denominator;
    session.massKillRemainder = killUnits % massAccrual.KILL_DENOMINATOR;
    // Бонусные киллы входят в награду за удержание, не умножают этот же опыт повторно.
    awardKills(p, kills, 0, at);
    const remaining = Math.max(0, s.arenaXpTarget - s.xp - session.xp);
    session.xp = add(session.xp, Math.min(xp, remaining));
  } else if (event.type === "survivalMinute") {
    earnXp(p, minuteXp(event.mass), event.minutes, at);
  } else if (event.type === "massBonus") {
    if (
      !s.session ||
      s.session.id !== event.lifeId ||
      !integer(event.sequence) ||
      event.sequence <= (s.session.massBonusSequence || 0)
    )
      return;
    if (![2, 4, 6, 8, 10, 20].includes(event.kills)) throw Error("Неверный бонус киллов за массу.");
    s.session.massBonusSequence = event.sequence;
    awardKills(p, event.kills, 3, at);
  } else if (event.type === "boosterUsed") {
    successfulBooster(p, event.mass, at);
    return true; // successfulBooster already settles the same achievements.
  } else if (event.type === "massPeak") {
    if (!integer(event.mass)) throw Error("Неверная масса для рекорда.");
    s.maxMass = Math.max(s.maxMass, event.mass);
  }
  awardAchievements(p, at, extraCurrent);
  return true;
}
function successfulBooster(p, mass, at = Date.now()) {
  migrateKingProgress(p);
  stages.ensure(p.progress, ACHIEVEMENTS, (a) => p.progress[a.stat]);
  p.progress.boosterUses = add(p.progress.boosterUses, 1);
  if (mass !== undefined) {
    if (!integer(mass)) throw Error("Неверная масса после бустера.");
    p.progress.maxMass = Math.max(p.progress.maxMass, mass);
  }
  awardAchievements(p, at);
}
function publicProgress(p, { achievements = true } = {}) {
  return {
    ...levelProgress(p.progress.xp),
    arenaXp: p.progress.session?.xp || 0,
    arenaKills: p.progress.session?.kills || 0,
    arenaCreditedKills: p.progress.session?.creditedKills ?? p.progress.session?.kills ?? 0,
    arenaXpMax:
      p.progress.arenaXpTarget != null &&
      p.progress.xp + (p.progress.session?.xp || 0) >= p.progress.arenaXpTarget,
    lastLife: p.progress.lastLife ? JSON.parse(JSON.stringify(p.progress.lastLife)) : null,
    ...(achievements
      ? {
          achievements: [
            ...ACHIEVEMENTS.map((a) => ({
              id: a.id,
              name: a.name,
              category: "arena",
              available: true,
              exception: a.exception === true,
              unit: a.id === "king" ? "соперников" : a.id === "boosters" ? "применений" : "массы",
              description: a.description,
              value: stages.current(p.progress, a, p.progress[a.stat]),
              thresholds: [...a.thresholds],
              rewards: [...(a.rewards || GREATNESS_REWARDS)],
              claimed: p.progress.claimed[a.id],
            })),
            ...publicExtra(p),
          ],
        }
      : {}),
  };
}
module.exports = {
  LEVEL_BANDS,
  KILL_XP,
  VICTIM_COOLDOWN_MS,
  ACHIEVEMENTS,
  GREATNESS_REWARDS,
  levelProgress,
  xpForLevel,
  freshProgress,
  migrateKingProgress,
  validateProgress,
  minuteXp,
  applyEvent,
  successfulBooster,
  publicProgress,
};
