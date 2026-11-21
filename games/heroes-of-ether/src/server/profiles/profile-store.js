/* Загрузка и атомарное сохранение профилей, транзакции и публичные представления. */
"use strict";
const { copyRecord } = require("./copy-record");
const { lobbyDraft } = require("./owned-profile-draft");
const { clanProgress, clanCapacity } = require("../clans/clan-level-progress");
const skinCollections = require("../../../public/shared/skin-collection-preview");
const appearanceTestAccess = require("./appearance-test-access");
const crestKit = require("../../../public/shared/clan-crest-rules");
const { isDeepStrictEqual } = require("node:util");
const { performance } = require("node:perf_hooks");
function currentClanRule(clan, unlocked) {
  const crest = unlocked
    ? crestKit.normalize(clan.crest)
    : crestKit.restrictToLevel(clan.crest, clanProgress(clan.xp).level);
  const capacity = clanCapacity(clan.xp);
  return capacity === clan.capacity && (!crest || isDeepStrictEqual(crest, clan.crest))
    ? clan : { ...clan, capacity, ...(crest ? { crest } : {}) };
}
function currentClanRules(clans, unlockClanCrests = false, cache) {
  let result = clans;
  for (const [id, clan] of Object.entries(clans)) {
    const unlocked = unlockClanCrests || appearanceTestAccess.clan(clan);
    const updated = cache ? cache.currentClanRules(clan, unlocked, currentClanRule)
      : currentClanRule(clan, unlocked);
    if (updated === clan) continue;
    if (result === clans) result = { ...clans };
    result[id] = updated;
  }
  return result;
}
const fs = require("node:fs");
const persistence = require("./profile-journal");
const dailyLogin = require("../progression/daily-login");
const transactions = require("./transaction-history");
const roulette = require("../roulette/roulette-service");
const lite = require("../accounts/lite-account");
const clanAppearance = require("../clans/clan-appearance");
const { trophyBenefits } = require("../../../public/shared/clan-competition-rules");
const path = require("node:path");
const { randomBytes, randomUUID, createHash } = require("node:crypto");
const { BOOSTERS, BOOSTER_RULES, BoosterError } = require("../boosters/booster-catalog");
const { validSkin } = require("../../../public/shared/player-identity");
const accessories = require("../../../public/shared/accessory-catalog");
const accessoryAccess = require("./accessory-access");
const wardrobeState = require("./wardrobe-state");
const activity = require("../progression/activity-achievements");
const quests = require("../progression/personal-quests");
const clanQuests = require("../clans/daily-quests/service");
const easter = require("../events/easter-hunt");
const eventAlbum = require("../events/event-album");
const blackFriday = require("../events/black-friday");
const alchemy = require("../events/ether-alchemy");
const luckyWeek = require("../events/lucky-week");
const socialCalendar = require("../progression/social-calendar");
const moderation = require("../admin/moderation");
const playerIdentity = require("../../../public/shared/player-identity");
const eventRankings = require("../rankings/event-leaderboards");
const pets = require("../pets/pet-service");
const accounts = require("../accounts/account-benefits");
const appearance = require("./league-appearance");
const personalTrophies = require("./season-trophy-history");
const trophyCorrection = require("../clans/trophy-correction-20261122");
const virtualProducts = require("../../../public/shared/virtual-product-catalog");
const promotions = require("../shop/promotion-offers");
const clanCompetition = require("../clans/clan-competition-service"),
  clanChests = require("../clans/clan-chest-rewards");
const social = require("./player-social");
const nicknames = require("./nickname-rules");
const loadout = require("../../../public/shared/quick-slot-rules");
const dailyRankings = require("../rankings/daily-leaderboards"),
  personalDetails = require("./profile-validation");
const {
  freshProgress,
  migrateKingProgress,
  validateProgress,
  applyEvent,
  successfulBooster,
  publicProgress,
} = require("../progression/experience-progression");
const {
  freshHonors,
  awardTitles,
  rebalanceTitles,
  rebalanceChestBonuses,
  validateHonors,
  publicTitle,
  publicTitleMedals,
  publicHonors,
  prepareChest,
  openChest,
} = require("../progression/title-chest-rewards");
const tokenHash = (token) => createHash("sha256").update(token).digest("hex");
const requestPattern = /^[a-zA-Z0-9_-]{16,80}$/;
const clone = (value) => JSON.parse(JSON.stringify(value));
const { copyArenaData, shareArenaData } = require("./arena-profile-copy");
const tableDeltas = require("./immutable-table-delta");
const { replaceBatchProfile } = require("./profile-batch");
const operationReceipts = require("./operation-receipts");
// These fields are read-only during arena progress/casts, or replaced as a
// whole (quick slots, transaction history and the receipt map). Keep unknown
// future fields isolated by default. Spins stay shared when a level adds tickets.
const arenaSharedFields = new Set([
  "administrativeNotices",
  "gameGiftNotices",
  "roulette",
  "receipts",
  "arenaReceipts",
  "transactions",
  "social",
  "appearance",
  "outfit",
  "quickSlots",
  "seasonTrophies",
  "purchasedAccessories",
  "purchasedSkinCollections",
  "grantedAccessories",
  "grantedSkins",
  "promoClaims",
  "wardrobeState",
  "personal",
  "honors",
  "blackFriday",
  "alchemy",
]);
const arenaSharedActivityFields = new Set(["claimed", "stageSpent", "clanLives", "leagueVisits"]);
function arenaActivityDraft(current, sharedValues = false) {
  // Arena awards replace these maps only when a degree/life is completed.
  // Migrations still receive a complete private copy, including unknown fields.
  if (current?.achievementStagesVersion !== 2) return copyArenaData(current);
  const draft = { ...current };
  for (const key of Object.keys(current))
    if (!arenaSharedActivityFields.has(key) && !(sharedValues && key === "values"))
      draft[key] = copyArenaData(current[key]);
  return draft;
}
const victimHistoryFields = ["recentVictims", "absorptionVictims"];
const castSharedProgressFields = new Set(["session", "lastLife"]);
function progressDraft(current, cast) {
  // Victim histories are detached by arenaProgressDraft before absorption.
  // Keep any future/unknown progress branch private unless its writers have
  // been audited and given an explicit copy-on-write boundary too.
  const draft = { ...current };
  for (const key of Object.keys(current))
    if (!victimHistoryFields.includes(key) && !(cast && castSharedProgressFields.has(key)))
      draft[key] = copyArenaData(current[key]);
  return draft;
}
function arenaDraft(current, cast = false, sharedActivityValues = false) {
  const draft = { ...current };
  // Both legacy and bucketed receipts are immutable. An absorption replaces
  // only one bucket; samples and casts retain the validated history by identity.
  const seen = current.quests?.session?.seen;
  // Copy only mutable fields directly. Deleting shared fields from a temporary
  // object first forced a dictionary layout and a second full property copy.
  for (const key of Object.keys(current)) {
    if (arenaSharedFields.has(key)) continue;
    // Progress only earns/settles counters and unopened prizes. Inventory writes
    // happen in separate cast/claim transactions, which still detach this map.
    if (!cast && key === "inventory") continue;
    // A cast cannot update a life, an absorption ledger or pet training.
    // Retain these immutable branches; counters, claims, migrations and all
    // unknown fields still get private copies. Progress events also isolate
    // session and pet changes; their victim histories detach before absorption.
    if (cast && key === "pets") continue;
    if (key === "progress") {
      draft[key] = progressDraft(current[key], cast);
      continue;
    }
    const value =
      key === "quests" && seen
        ? {
            ...current.quests,
            session: { ...current.quests.session, seen: undefined, seenBuckets: undefined },
          }
        : current[key];
    draft[key] = key === "activity" ? arenaActivityDraft(value, sharedActivityValues) : copyArenaData(value);
  }
  if (seen) {
    draft.quests.session.seen = seen;
    if (current.quests.session.seenBuckets)
      draft.quests.session.seenBuckets = current.quests.session.seenBuckets;
  }
  if (current.roulette) draft.roulette = { ...current.roulette };
  return draft;
}
const arenaCastDraft = current => arenaDraft(current, true, true);
function clanDraft(current) {
  // Clan commands cannot edit social/arena histories. Reuse the audited cast
  // draft, but detach the extra fields changed by membership and storage.
  const draft = arenaDraft(current, true);
  if (draft.activity?.stageSpent) draft.activity.stageSpent = { ...draft.activity.stageSpent };
  if (draft.progress?.session) draft.progress.session = { ...draft.progress.session };
  if (current.blackFriday?.chests) draft.blackFriday = {
    ...current.blackFriday, chests: copyArenaData(current.blackFriday.chests),
  };
  return draft;
}
// Only audited passive/sample events use copy-on-write activity counters.
// Confirmed booster credits change core progress, while clan actions only
// advance their clan receipt/session. Their activity writes use the same
// copy-on-write award/calendar path as passive samples. Life endings, pet
// training, absorptions and future event types keep a fully
// private values record. Ordering and every individual event remain unchanged.
const passiveActivityEvents = new Set(["massPeak", "lifeTime", "questSample", "clanFoodSample", "massAccrual", "arenaAction", "clanArenaAction", "boosterUsed", "alchemyGather"]);
// Сохранения заменяют таблицу profiles целиком; WeakMap автоматически
// освобождает индекс предыдущей версии после завершения транзакции.
const profileIndexes = require("./profile-index");
const { profileKeys } = profileIndexes;
function firstRecordedDates(filePath, data, at) {
  const savedAt = Math.min(at, Math.max(0, Math.floor(fs.statSync(filePath).mtimeMs)));
  const dates = new Map(Object.values(data.profiles).map((p) => [p.id, savedAt]));
  const directory = path.join(path.dirname(filePath), "backups");
  // Старые профили не хранили дату регистрации. Ищем самое раннее
  // существующее серверное сохранение, в котором действительно есть этот ID.
  if (fs.existsSync(directory))
    for (const name of fs.readdirSync(directory)) {
      if (!/^profiles-.*\.json$/.test(name)) continue;
      try {
        const candidate = path.join(directory, name),
          stat = fs.statSync(candidate);
        if (!stat.isFile()) continue;
        const time = Math.min(at, Math.max(0, Math.floor(stat.mtimeMs)));
        if (![...dates.values()].some((value) => time < value)) continue;
        const old = JSON.parse(fs.readFileSync(candidate, "utf8"));
        if (!old.profiles || Array.isArray(old.profiles) || typeof old.profiles !== "object")
          continue;
        for (const p of Object.values(old.profiles))
          if (p && dates.has(p.id)) dates.set(p.id, Math.min(dates.get(p.id), time));
      } catch (_) {
        /* Повреждённая резервная копия не заменяет основное сохранение. */
      }
    }
  return dates;
}

class ProfileStore {
  get rouletteConfig() {
    return this.events
      ? this.events.rouletteConfig(this.baseRouletteConfig, this.now())
      : this.baseRouletteConfig;
  }
  set rouletteConfig(value) {
    this.baseRouletteConfig = value;
  }
  constructor({
    petEvents = [],
    rouletteConfig = {},
    promotionConfig = {},
    filePath = null,
    journal = false,
    arenaProgressWorker = false,
    incrementalSettlement = false,
    clanDailyQuests = false,
    residentRoomExperiment = false,
    now = Date.now,
    unlockLeagueBackgrounds = false,
    unlockLeagueFrames = false,
    unlockClanCrests = false,
  } = {}) {
    this.petEvents = pets.validateEvents(petEvents);
    this.rouletteConfig = roulette.configuration(rouletteConfig);
    this.promotionConfig = promotions.configuration(promotionConfig);
    this.filePath = filePath;
    this.settlementCache = incrementalSettlement
      ? new (require("./settlement-cache").SettlementCache)() : null;
    this.now = now;
    this.clanDailyQuests = clanDailyQuests;
    this.residentRoomExperiment = residentRoomExperiment === true;
    this.residentRecoveryProfiles = new Set();
    // Тестовая настройка сервера: не выдаёт награды и не меняет сроки лиг.
    this.unlockLeagueBackgrounds = unlockLeagueBackgrounds === true;
    this.unlockLeagueFrames = unlockLeagueFrames === true;
    this.unlockClanCrests = unlockClanCrests === true;
    this.data = { version: 13, profiles: {}, clans: {} };
    const restored = filePath ? persistence.recover(filePath) : null;
    if (restored && (fs.existsSync(filePath) || restored.revision)) {
      const { data } = restored;
      const legacyTitleOrder = data.version >= 5 && data.version <= 7;
      if (
        ![1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14,
          ...(this.residentRoomExperiment ? [15] : [])].includes(data.version) ||
        (data.residentRooms && !this.residentRoomExperiment) ||
        !data.profiles ||
        typeof data.profiles !== "object" ||
        Array.isArray(data.profiles)
      )
        throw Error("Неверный формат профилей. Файл сохранений не перезаписан.");
      if (data.version === 15 || data.residentRooms)
        require("../arena/resident/room-ledger-validation").validate(data);
      if (data.version === 15) for (const room of Object.values(data.residentRooms))
        if (room.status !== "CLOSED") for (const id of room.profiles) this.residentRecoveryProfiles.add(id);
      if (this.residentRecoveryProfiles.size)
        this.clanQuestSettlementReady = () => this.residentRecoveryProfiles.size === 0;
      for (const [key, p] of Object.entries(data.profiles)) {
        dailyLogin.validate(p?.loginReward);
        if (
          !/^[a-f0-9]{64}$/.test(key) ||
          !p ||
          typeof p.id !== "string" ||
          !p.wallet ||
          !p.inventory ||
          !p.receipts ||
          !Number.isSafeInteger(p.revision) ||
          p.revision < 0 ||
          ![p.wallet.coins, p.wallet.crystals, ...Object.values(p.inventory)].every(
            (n) => Number.isSafeInteger(n) && n >= 0,
          )
        ) {
          throw Error("Повреждены данные профиля. Файл сохранений не перезаписан.");
        }
        operationReceipts.validate(p, data.version);
      }
      // Миграция старого сохранения в памяти. Баланс, инвентарь и receipts сохраняются.
      if (data.version === 1) {
        data.version = 2;
        data.clans = {};
        for (const p of Object.values(data.profiles))
          Object.assign(p, {
            name: "Путник",
            skinId: "moon-dragon",
            level: 1,
            greatness: 0,
            clanId: null,
            quickSlots: null,
          });
      }
      require("../clans/clan-service").validateWorld(data);
      for (const p of Object.values(data.profiles)) {
        if (p.quickSlots?.length === 7) {
          p.quickSlots = p.quickSlots.slice(0, 6);
          p.revision++;
          this.loadoutMigrationPending = true;
        }
      }
      for (const p of Object.values(data.profiles))
        if (
          p.quickSlots?.some(
            (id) => id && (!p.inventory[id] || !loadout.itemAllowed(BOOSTERS.get(id), p.level)),
          )
        ) {
          p.quickSlots = p.quickSlots.map((id) =>
            id && p.inventory[id] > 0 && loadout.itemAllowed(BOOSTERS.get(id), p.level) ? id : null,
          );
          this.loadoutMigrationPending = true;
          p.revision++;
        }
      if (data.version === 2) {
        for (const p of Object.values(data.profiles)) p.progress = freshProgress(p.level);
        data.version = 3;
      }
      if (data.version === 3) {
        for (const p of Object.values(data.profiles))
          Object.assign(p.progress, { session: null, lastLife: null });
        data.version = 4;
      }
      for (const p of Object.values(data.profiles)) {
        if (migrateKingProgress(p)) {
          p.revision++;
          this.achievementStagesMigrationPending = true;
        }
        validateProgress(p);
      }
      if (data.version === 4) {
        for (const p of Object.values(data.profiles)) {
          p.wallet.bucks = 0;
          p.honors = freshHonors();
          awardTitles(p);
          p.revision++;
        }
        data.version = 5;
      }
      for (const p of Object.values(data.profiles)) {
        if (
          p.purchasedAccessories !== undefined &&
          (!Array.isArray(p.purchasedAccessories) ||
            p.purchasedAccessories.some(
              (id) => typeof id !== "string" || !accessories.item(id)?.price,
            ) ||
            new Set(p.purchasedAccessories).size !== p.purchasedAccessories.length)
        )
          throw Error("Повреждены покупки аксессуаров. Файл сохранений не перезаписан.");
        if (p.accessoryAbility != null && !accessories.item(p.accessoryAbility)?.ability)
          throw Error("Повреждён выбор способности аксессуара.");
      }
      for (const p of Object.values(data.profiles))
        if (p.outfit !== undefined) {
          if (
            !p.outfit ||
            Array.isArray(p.outfit) ||
            typeof p.outfit !== "object" ||
            Object.keys(p.outfit).some((slot) => !accessories.slots.includes(slot)) ||
            accessories.slots.some(
              (slot) => p.outfit[slot] !== null && accessories.item(p.outfit[slot])?.slot !== slot,
            )
          )
            throw Error("Повреждены данные гардероба. Файл сохранений не перезаписан.");
        }
      if (data.version === 5) {
        // Ранее сохранялось окончание окна в 5 минут; новая длительность — 3 минуты.
        for (const p of Object.values(data.profiles)) {
          for (const id of Object.keys(p.progress.recentVictims)) {
            p.progress.recentVictims[id] = Math.max(
              0,
              p.progress.recentVictims[id] - 2 * 60 * 1000,
            );
          }
          p.revision++;
        }
        data.version = 6;
      }
      // Уже записанный опыт прежних соединений восстанавливается без времени простоя.
      if (data.version === 6) {
        for (const clan of Object.values(data.clans))
          Object.assign(clan, {
            roles: Object.fromEntries(
              clan.members.map((id) => [id, id === clan.ownerId ? "head" : "member"]),
            ),
            privacy: "closed",
            xp: 0,
            applicationFees: Object.fromEntries(clan.applications.map((id) => [id, 0])),
          });
        data.version = 7;
      }
      if (data.version === 7) {
        const at = this.now(),
          recorded = firstRecordedDates(filePath, data, at);
        for (const p of Object.values(data.profiles)) {
          p.activity = activity.freshActivity(
            at,
            p.clanId,
            Number.isSafeInteger(p.createdAt) ? p.createdAt : recorded.get(p.id),
          );
          if (legacyTitleOrder) {
            const chests = p.honors.chests,
              master = chests.master,
              sage = chests.sage;
            delete chests.master;
            delete chests.sage;
            if (master !== undefined) chests.sage = master;
            if (sage !== undefined) chests.master = sage;
          }
          p.revision++;
        }
        data.version = 8;
      }
      if (data.version === 8) {
        for (const p of Object.values(data.profiles)) {
          rebalanceTitles(p);
          p.revision++;
        }
        data.version = 9;
      }
      if (data.version === 9) {
        for (const p of Object.values(data.profiles)) {
          rebalanceChestBonuses(p);
          clanChests.rebalanceAccountBonuses(p);
          p.revision++;
        }
        data.version = 10;
      }
      if (data.version === 10) {
        for (const p of Object.values(data.profiles)) activity.migrateLeagues(p);
        data.version = 11;
        this.leagueMigrationPending = true;
      }
      if (data.version === 11) {
        for (const p of Object.values(data.profiles)) {
          p.pets = pets.fresh();
          activity.migratePets(p);
        }
        data.version = 12;
        this.petsMigrationPending = true;
      }
      if (data.version === 12) {
        for (const p of Object.values(data.profiles)) p.roulette = roulette.fresh(p.level);
        data.version = 13;
        this.rouletteMigrationPending = true;
      }
      for (const p of Object.values(data.profiles)) {
        quests.validate(p);
        if (quests.migrationDue(p)) this.questRulesMigrationPending = true;
        easter.validate(p);
        eventAlbum.validate(p);
        blackFriday.validate(p);
        alchemy.validate(p);
        roulette.validate(p);
        pets.validate(p);
        if (pets.migrateVitality(p)) {
          p.revision++;
          this.petsMigrationPending = true;
        }
        pets.validate(p);
        const migratedPetLevels = activity.migratePetLevels(p);
        const migratedAccessories = activity.migrateAccessories(p);
        social.validate(p);
        accounts.validate(p);
        require('../admin/adjustment-notices').validate(p);
        validateHonors(p);
        activity.validateActivity(p);
        dailyRankings.validate(p);
        personalDetails.validate(p);
        if (
          p.purchasedSkinCollections !== undefined &&
          (!Array.isArray(p.purchasedSkinCollections) ||
            p.purchasedSkinCollections.some((id) => !skinCollections.get(id)) ||
            new Set(p.purchasedSkinCollections).size !== p.purchasedSkinCollections.length)
        )
          throw Error("Повреждены наборы скинов.");
        appearance.validate(p);
        clanChests.validate(p);
        personalTrophies.validate(p);
        transactions.validate(p);
        const migratedActivity = activity.migrateStageRules(p);
        const migratedEvent = require("../events/lucky-week").migrate(p);
        const migratedFriday = blackFriday.migrate(p);
        const migratedWardrobe = wardrobeState.migrate(p, data.clans, this.now());
        wardrobeState.validate(p);
        if (
          migratedActivity ||
          migratedEvent ||
          migratedFriday ||
          migratedWardrobe ||
          migratedPetLevels ||
          migratedAccessories
        ) {
          p.revision++;
          this.achievementStagesMigrationPending = true;
        }
      }
      if (social.migrateValuable(data)) this.achievementStagesMigrationPending = true;
      clanCompetition.validate(data);
      clanQuests.validate(data);
      this.trophyMigrationPending = personalTrophies.migrate(data);
      this.trophyCorrectionPending = !!trophyCorrection.plan(data);
      dailyRankings.validateWorld(data);
      eventRankings.validate(data);
      require("../clans/clan-service").validateWorld(data);
      for (const p of Object.values(data.profiles))
        if (p.progress.session && !this.residentRecoveryProfiles.has(p.id)) {
          if(p.clanQuestSession) p.clanQuestSession=null;
          easter.settleLife(p, p.progress.session.id);
          pets.progress(
            p,
            { type: "lifeEnded", lifeId: p.progress.session.id, durationSeconds: 0 },
            this.now(),
            this.petEvents,
          );
          applyEvent(
            p,
            {
              type: "lifeEnded",
              lifeId: p.progress.session.id,
              durationSeconds: 0,
              reason: "recovered",
            },
            this.now(),
          );
          p.revision++;
        }
      const currentClans = currentClanRules(data.clans, this.unlockClanCrests);
      this.appearanceMigrationPending = Object.entries(currentClans).some(
        ([id, clan]) => JSON.stringify(clan.crest) !== JSON.stringify(data.clans[id].crest),
      );
      data.clans = currentClans;
      data.clans = Object.fromEntries(
        Object.entries(data.clans).map(([id, clan]) => {
          const captured = clanAppearance.capture(
            clan,
            this.now(),
            true,
            this.unlockLeagueBackgrounds,
          );
          if (captured !== clan) this.appearanceMigrationPending = true;
          return [id, captured];
        }),
      );
      data.profiles = Object.fromEntries(
        Object.entries(data.profiles).map(([key, p]) => {
          const captured = appearance.capture(
            p,
            data.clans,
            this.now(),
            true,
            this.unlockLeagueBackgrounds,
            this.unlockLeagueFrames,
          );
          if (captured !== p) this.appearanceMigrationPending = true;
          return [key, captured];
        }),
      );
      require("../admin/moderation").validate(data);
      require("./promo-codes").validate(data);
      require("../admin/game-grants").validate(data);
      require("./game-news").validate(data);
      require("../admin/service-availability").validate(data);
      this.transactionsMigrationPending = Object.values(data.profiles).some((p) => !p.transactions);
      for (const p of Object.values(data.profiles)) transactions.initialize(p, this.now());
      this.data = transactions.syncWorld(data, this.now(), {
        kind: "recovery",
        label: "Восстановление прогресса после перезапуска",
      });
    }
    if (filePath && journal) {
      this.journal = new persistence.ProfileJournal(filePath);
      this.data = require('./recovery-sharing').share(this.journal.previous,this.data);
    }
    if (arenaProgressWorker && this.journal)
      this.arenaPreparer = new (require("./arena-progress-preparer").ArenaProgressPreparer)();
  }
  prepareSnapshot(next, at = this.now(), context, previous = this.data) {
    if (this.trophyCorrectionPending) next = trophyCorrection.apply(next, at);
    if (this.questRulesMigrationPending) {
      let profiles = next.profiles;
      const changed = [];
      for (const [key, p] of Object.entries(next.profiles)) {
        if (!quests.migrationDue(p)) continue;
        const draft = lobbyDraft(p);
        quests.migrate(draft, at, this.events?.active(at));
        draft.revision++;
        if (profiles === next.profiles) profiles = copyRecord(profiles);
        profiles[key] = draft; changed.push(key);
      }
      if (profiles !== next.profiles) {
        tableDeltas.remember(profiles, next.profiles, changed, true);
        next = { ...next, profiles };
      }
    }
    if (this.clanDailyQuests) next = clanQuests.initialize(next, at);
    const cache = this.settlementCache;
    const originalChanges=tableDeltas.changedKeys(previous.profiles,next.profiles);
    const removed=(originalChanges || Object.keys(previous.profiles)).filter(key => !Object.hasOwn(next.profiles,key));
    const scoped = cache?.known(previous);
    const keys = scoped ? cache.selectKeys(next,previous,at) : Object.keys(next.profiles);
    const included = scoped && new Set(keys);
    let trackedProfiles = next.profiles;
    const trackChanges = () => {
      if (!scoped || trackedProfiles === next.profiles) return;
      for (const key of tableDeltas.changedKeys(trackedProfiles,next.profiles) || Object.keys(next.profiles))
        if (!included.has(key) && next.profiles[key] !== trackedProfiles[key]) {
          included.add(key); keys.push(key);
        }
      trackedProfiles = next.profiles;
    };
    let capturedProfiles = next.profiles;
    for (const key of keys) {
      if (cache && !cache.needs(next.profiles[key], previous.profiles[key], at)) continue;
      const p = next.profiles[key],
        updated = easter.capture(p, at);
      if (updated === p) continue;
      if (capturedProfiles === next.profiles) capturedProfiles = copyRecord(capturedProfiles);
      capturedProfiles[key] = updated;
    }
    if (capturedProfiles !== next.profiles) {
      tableDeltas.remember(capturedProfiles, next.profiles, keys, true);
      next = { ...next, profiles: capturedProfiles };
    }
    const easterCapturedProfiles = next.profiles;
    next = luckyWeek.recover(next, this.events, at, cache);
    next = blackFriday.recover(next, this.events, at, cache);
    trackChanges();
    // A changed marriage/clan can affect the untouched spouse as well. Calendar
    // boundaries already include all expired personal captures in keys.
    const socialKeys = scoped && !keys.some(key => {
      const p = next.profiles[key], before = previous.profiles[key];
      return p.social?.marriage !== before?.social?.marriage || p.clanId !== before?.clanId ||
        p.activity?.clanSince !== before?.activity?.clanSince;
    }) ? keys : undefined;
    next = socialCalendar.settle(next, at, socialKeys);
    trackChanges();
    moderation.validate(next, scoped ? keys : undefined);
    next = transactions.syncWorld(next, at, context, keys);
    let economyProfiles = next.profiles;
    next = { ...next, clans: currentClanRules(next.clans, this.unlockClanCrests, cache) };
    next = clanCompetition.capture(next, previous, at, {
      incremental: !!cache, validatedPrevious: !!scoped, cache, profileKeys: scoped ? keys : undefined,
    });
    next = clanQuests.capture(next, previous, at, {canSettle:this.clanQuestSettlementReady?.(at)!==false});
    trackChanges();
    if (next.profiles !== economyProfiles) next = transactions.syncWorld(next, at, {
      kind: "reward",
      label: "Награда клана",
    }, keys);
    economyProfiles = next.profiles;
    // Keep unchanged clan records shared. Rebuilding this map on every arena
    // sample defeated the competition service's already-validated fast path.
    let appearanceClans = next.clans;
    for (const [id, clan] of Object.entries(next.clans)) {
      const unlocked = this.unlockLeagueBackgrounds || appearanceTestAccess.clan(clan);
      const updated = cache ? cache.clanAppearance(clan, at, unlocked, clanAppearance.capture)
        : clanAppearance.capture(clan, at, false, unlocked);
      if (updated === clan) continue;
      if (appearanceClans === next.clans) appearanceClans = { ...appearanceClans };
      appearanceClans[id] = updated;
    }
    if (appearanceClans !== next.clans) next = { ...next, clans: appearanceClans };
    capturedProfiles = next.profiles;
    for (const key of keys) {
      const p = next.profiles[key];
      if (cache && !cache.needs(p, previous.profiles[key], at)) continue;
      const updated = dailyRankings.capture(
        appearance.capture(
          p,
          next.clans,
          at,
          false,
          this.unlockLeagueBackgrounds,
          this.unlockLeagueFrames,
        ),
        previous.profiles[key],
        at,
      );
      if (updated === p) continue;
      if (capturedProfiles === next.profiles) capturedProfiles = copyRecord(capturedProfiles);
      capturedProfiles[key] = updated;
    }
    if (capturedProfiles !== next.profiles) {
      tableDeltas.remember(capturedProfiles, next.profiles, keys, true);
      next = { ...next, profiles: capturedProfiles };
    }
    const personalCapturedProfiles = next.profiles;
    next = dailyRankings.settle(next, previous, at, this.events);
    if (this.eventRankingReady?.() !== false) next = eventRankings.settle(next, this.events, at);
    trackChanges();
    if (next.profiles !== economyProfiles) next = transactions.syncWorld(next, at, {
      kind: "reward",
      label: "Награда суточного рейтинга",
    }, keys);
    let orderProfiles = next.profiles;
    for (const key of keys) {
      if (next.profiles[key] === previous.profiles[key]) continue;
      const p = next.profiles[key],
        updated = blackFriday.captureOrders(p, previous.profiles[key], this.events, at);
      if (updated === p) continue;
      if (orderProfiles === next.profiles) orderProfiles = copyRecord(orderProfiles);
      orderProfiles[key] = updated;
    }
    if (orderProfiles !== next.profiles) {
      tableDeltas.remember(orderProfiles, next.profiles, keys, true);
      next = { ...next, profiles: orderProfiles };
    }
    if (cache) for (const key of keys) {
      const p = next.profiles[key];
      // Later rewards may replace a profile. Do not mark that new value as
      // captured until every personal capture has actually seen it.
      // Daily capture may replace only the derived ranking row. Easter's due
      // predicate reads only the immutable Easter state, so that replacement
      // does not invalidate the capture that has already completed. Later
      // rewards still require the personal capture again.
      if (p.easter === easterCapturedProfiles[key]?.easter && p === personalCapturedProfiles[key])
        cache.remember(p, at);
    }
    tableDeltas.remember(next.profiles,previous.profiles,[...keys,...removed]);
    cache?.rememberWorld(next,at,previous,keys);
    return next;
  }
  save(next, at = this.now(), context) {
    this.writeSnapshot(this.prepareSnapshot(next, at, context));
    this.markMigrationsSaved();
  }
  markMigrationsSaved() {
    this.trophyCorrectionPending = false;
    this.questRulesMigrationPending = false;
    this.petsMigrationPending = false;
    this.rouletteMigrationPending = false;
    this.appearanceMigrationPending = false;
    this.leagueMigrationPending = false;
    this.trophyMigrationPending = false;
    this.loadoutMigrationPending = false;
    this.transactionsMigrationPending = false;
    this.achievementStagesMigrationPending = false;
  }
  writeSnapshot(next, staged) {
    if (this.journal) {
      // Durable journal commit precedes in-memory publication and every reply.
      if (staged) {
        if (!this.journal.publishStaged(staged, next)) return false;
      } else this.journal.commit(next);
    } else if (this.filePath) {
      // Offline tools keep the recovered sequence so old WAL segments cannot
      // overwrite their newer changes on the next server startup.
      if (this.data[persistence.REVISION])
        next = { ...next, [persistence.REVISION]: this.data[persistence.REVISION] };
      fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
      const temporary = this.filePath + ".tmp";
      // Compact JSON keeps the same atomic format without writing indentation
      // for the complete profile archive on every arena progress commit.
      fs.writeFileSync(temporary, JSON.stringify(next) + "\n", {
        encoding: "utf8",
        mode: 0o600,
      });
      fs.renameSync(temporary, this.filePath);
    }
    this.data = next;
    return true;
  }
  async close() {
    await this.arenaPreparer?.close();
    if (this.journal) await this.journal.close();
  }
  rotateOwnerSession() {
    const entries = Object.entries(this.data.profiles).filter(([, p]) => p.id === this.ownerId);
    if (!this.ownerId || entries.length !== 1)
      throw new BoosterError("Профиль владельца не найден. Восстановление остановлено.", 409);
    const [oldKey, profile] = entries[0];
    if (profile.progress?.session)
      throw new BoosterError("Сначала заверши текущую жизнь владельца на арене.", 409);
    const token = randomBytes(32).toString("hex"),
      key = tokenHash(token);
    if (this.data.profiles[key]) throw Error("Session collision");
    const profiles = { ...this.data.profiles, [key]: profile };
    delete profiles[oldKey];
    if (this.filePath) {
      const backupDir = path.join(path.dirname(this.filePath), "recovery-backups");
      fs.mkdirSync(backupDir, { recursive: true, mode: 0o700 });
      fs.copyFileSync(
        this.filePath,
        path.join(backupDir, `profiles-${this.now()}-${randomBytes(6).toString("hex")}.json`),
        fs.constants.COPYFILE_EXCL,
      );
    }
    // Change only the authentication binding. Do not rerun rewards, calendars
    // or migrations against a new map key. Memory changes after durable write.
    this.writeSnapshot({ ...this.data, profiles });
    return token;
  }
  find(token, world = this.data) {
    return typeof token === "string" && /^[a-f0-9]{64}$/.test(token)
      ? world.profiles[tokenHash(token)]
      : undefined;
  }
  open(token) {
    this.refreshCompetition();
    const existing = this.find(token);
    if (existing) {
      const draft = lobbyDraft(existing),
        at = this.now();
      activity.refreshCalendar(draft, at, true);
      quests.ensure(draft, at);
      require("../progression/treasury-capacity").fill(draft, at);
      awardTitles(draft, at);
      if (shareArenaData(existing, draft) !== existing) {
        activity.validateActivity(draft);
        validateHonors(draft);
        draft.revision++;
        const key = tokenHash(token), profiles = Object.assign(copyRecord(this.data.profiles), { [key]: draft });
        tableDeltas.remember(profiles, this.data.profiles, [key], true);
        this.save({ ...this.data, profiles });
      }
      return { token, profile: this.view(this.find(token)), created: false };
    }
    const freshToken = randomBytes(32).toString("hex");
    const profile = {
      id: randomUUID(),
      wallet: { coins: 100, crystals: 10, bucks: 0 },
      inventory: {},
      receipts: {},
      revision: 0,
      name: nicknames.available(Object.values(this.data.profiles)),
      personal: { nameSet: false, gender: "unspecified", vkUrl: "", introPending: true },
      skinId: "moon-dragon",
      level: 1,
      greatness: 0,
      clanId: null,
      quickSlots: [],
      outfit: accessories.outfit(),
      wardrobeState: wardrobeState.fresh(),
      progress: freshProgress(),
      honors: freshHonors(),
      seasonTrophies: [],
      pets: pets.fresh(),
      roulette: roulette.fresh(),
      activity: activity.freshActivity(this.now()),
    };
    activity.refreshCalendar(profile, this.now(), true);
    quests.ensure(profile, this.now());
    const next = {
      ...this.data,
      profiles: { ...this.data.profiles, [tokenHash(freshToken)]: profile },
    };
    this.save(next);
    return { token: freshToken, profile: this.view(profile), created: true };
  }
  view(profile) {
    const progress = publicProgress(profile);
    const easterPictures = easter.albumPictures(profile);
    return {
      id: profile.id,
      dailyLoginAvailable: dailyLogin.due(profile, this.now()),
      dailyLoginReward: dailyLogin.preview(profile, this.now()),
      wallet: { ...profile.wallet },
      purchasedSkinCollections: [...(profile.purchasedSkinCollections || [])],
      grantedSkins: [...(profile.grantedSkins || [])],
      revision: profile.revision,
      ...this.identity(profile),
      appearance: appearance.view(
        profile,
        this.data.clans,
        this.now(),
        this.unlockLeagueBackgrounds,
        this.unlockLeagueFrames,
      ),
      clanId: profile.clanId,
      menuNotifications: this.menuNotifications(profile),
      seasonBenefits: trophyBenefits(this.data.clans[profile.clanId]),
      seasonTrophies: personalTrophies.view(profile),
      regalia: dailyRankings.publicRegalia(profile),
      dailyRankingRewards: require("../rankings/daily-ranking-notices").view(profile),
      administrativeNotices: require('../admin/adjustment-notices').view(profile),
      gameGiftNotices: require('../admin/game-grants').viewNotice(profile),
      greatness: profile.greatness,
      pets: pets.view(profile, this.now(), this.petEvents),
      roulette: roulette.view(profile, this.rouletteConfig, this.now(), this.events),
      event: this.events?.publicView(this.now()) || null,
      scheduledEvent: this.events?.publicScheduled?.(this.now()) || null,
      newsRevision: this.data.gameNews?.revision || 0,
      easter: easter.view(profile, this.events, this.now(), this.rouletteConfig, easterPictures),
      eventAlbum: eventAlbum.view(profile, easterPictures),
      blackFriday: blackFriday.view(profile, this.events, this.now()),
      alchemy: alchemy.view(profile, this.events, this.now()),
      fridayChests: require("../events/black-friday-chests").view(
        profile,
        this.rouletteConfig,
        this.now(),
        this.events,
      ),
      eventRegalia: blackFriday.regalia(profile),
      eventVersion: this.events?.stamp(this.now()) || "0:closed",
      quests: quests.view(
        profile,
        this.now(),
        this.events?.active(this.now()),
        this.rouletteConfig,
        this.events,
      ),
      arenaObjectives: require("../progression/arena-objectives").view(
        profile,
        this.events,
        this.now(),
      ),
      promotions: promotions.view(profile, this.promotionConfig, this.now()),
      seenPromotionIds: [...(profile.seenPromotionIds || [])],
      promotionVersion: require("../shop/weekend-promotions").version(this.promotionConfig.weekend, this.now()),
      promotionEndsAt: Object.fromEntries(
        promotions
          .ids(profile, this.promotionConfig, this.now())
          .map((id) => [id, promotions.deadline(profile, virtualProducts.get(id))]),
      ),
      promotionServerTime: this.now(),
      promotionPreview:
        this.promotionConfig.enabled && this.promotionConfig.preview
          ? { productIds: [...this.promotionConfig.productIds, ...this.promotionConfig.weekend.offerIds], cycleMs: 7 * 86400000 }
          : null,
      personal: personalDetails.view(profile),
      social: social.view(this, profile, true),
      progress: {
        ...progress,
        achievements: [
          ...luckyWeek.view(profile, this.events, this.now()),
          ...easter.achievementView(profile, this.events, this.now()),
          ...blackFriday.achievementView(profile, this.events, this.now()),
          ...progress.achievements,
        ],
      },
      honors: publicHonors(profile, this.now(), this.rouletteConfig),
      titleMedals: publicTitleMedals(profile),
      clanChests: clanChests.view(profile, this.now(), this.rouletteConfig, this.events),
      wardrobe: {
        seen: [...(profile.wardrobeState?.seen || [])],
        owned: accessories.items
          .filter((item) => accessoryAccess.isOwned(profile, item.id))
          .map((item) => item.id),
        equipped: accessoryAccess.outfit(profile),
        ...(accessoryAccess.ability(profile) ? { ability: accessoryAccess.ability(profile) } : {}),
      },
      quickSlots: profile.quickSlots ? [...profile.quickSlots] : null,
      inventory: Object.fromEntries(
        [...BOOSTERS.keys()].map((id) => [
          id,
          id === "easter_egg" ? easter.count(profile, this.now()) : profile.inventory[id] || 0,
        ]),
      ),
    };
  }
  arenaView(profile) {
    // The battle needs live counters and inventory, not every lobby catalogue.
    // This projection never changes persistence or the reward transaction.
    return {
      id: profile.id,
      revision: profile.revision,
      level: profile.level,
      title: publicTitle(profile),
      greatness: profile.greatness,
      wallet: { ...profile.wallet },
      account: this.arenaAppearance(profile).account,
      easter: easter.arenaView(profile, this.events, this.now()),
      alchemy: alchemy.view(profile, this.events, this.now()),
      arenaObjectives: require("../progression/arena-objectives").view(
        profile,
        this.events,
        this.now(),
      ),
      progress: publicProgress(profile, { achievements: false }),
      quickSlots: profile.quickSlots ? [...profile.quickSlots] : null,
      inventory: Object.fromEntries(
        [...BOOSTERS.keys()].map((id) => [
          id,
          id === "easter_egg" ? easter.count(profile, this.now()) : profile.inventory[id] || 0,
        ]),
      ),
    };
  }
  menuNotifications(profile) {
    const clan = this.data.clans[profile.clanId];
    const canRecruit = require("../clans/clan-service").permissions(
      clan,
      profile.id,
      this.now(),
    ).recruit;
    return { clanApplications: canRecruit ? clan.applications.length : 0 };
  }
  identity(profile) {
    const clan = this.data.clans[profile.clanId];
    const account = accounts.publicAccount(profile, this.now());
    return {
      name: profile.name,
      online: this.isOnline?.(profile.id) || false,
      skinId: playerIdentity.skinAllowed(
        profile.skinId,
        account,
        appearance.skinSets(profile),
        profile.purchasedSkinCollections,
        profile.grantedSkins,
      )
        ? profile.skinId
        : "moon-dragon",
      account,
      appearance: appearance.selected(
        profile,
        this.data.clans,
        this.now(),
        this.unlockLeagueBackgrounds,
        this.unlockLeagueFrames,
      ),
      outfit: accessoryAccess.outfit(profile),
      potionEquipped: profile.alchemy?.equipped || null,
      potionQueue: [...alchemy.rules.equipped(profile.alchemy)],
      level: profile.level,
      clanPrefix: clan?.prefix || "",
      clanId: clan?.id || null,
      clanName: clan?.name || "",
      clanEmblem: clan?.emblem || "",
      clanCrest: clan?.crest || null,
      clanFrame: clan?.competition?.frame || null,
      title: publicTitle(profile),
    };
  }
  arenaAppearance(profile) {
    // Profiles are replaced on committed mutations. Do not rebuild lobby account
    // bonuses and appearance grants at 20 Hz for an unchanged profile. Expiry
    // boundaries are exact, including account login-day rollover and clock rewind.
    this.arenaAppearanceCache ||= new WeakMap();
    const at = this.now(),
      cached = this.arenaAppearanceCache.get(profile);
    if (
      cached &&
      cached.revision === profile.revision &&
      cached.clan === this.data.clans[profile.clanId] &&
      cached.testBackgrounds === this.unlockLeagueBackgrounds &&
      cached.testFrames === this.unlockLeagueFrames &&
      at >= cached.from &&
      at < cached.until
    )
      return cached.value;
    const { account, skinId, appearance: selected } = this.identity(profile);
    let until = account.currencyBonusResetAt;
    for (const end of [
      account.vipUntil,
      account.premiumUntil,
      ...Object.values(profile.appearance?.grants || {}),
    ])
      if (Number.isFinite(end) && end > at) until = Math.min(until, end);
    const value = { account, skinId, appearance: selected };
    this.arenaAppearanceCache.set(profile, {
      value,
      from: at,
      until,
      revision: profile.revision,
      clan: this.data.clans[profile.clanId],
      testBackgrounds: this.unlockLeagueBackgrounds,
      testFrames: this.unlockLeagueFrames,
    });
    return value;
  }
  publicPlayer(id) {
    this.refreshCompetition();
    const p = this.byId(id);
    if (!p) throw new BoosterError("Игрок не найден.", 404);
    const leaders = Object.values(this.data.profiles).sort(
      (a, b) => b.greatness - a.greatness || a.id.localeCompare(b.id),
    );
    return {
      id: p.id,
      ...this.identity(p),
      greatness: p.greatness,
      titleMedals: publicTitleMedals(p),
      rank: leaders.findIndex((row) => row.id === id) + 1,
      maxMass: p.progress.maxMass,
      bestAbsorptions: p.progress.bestAbsorptions || 0,
      absorptionsTracked: p.progress.bestAbsorptions !== undefined,
      vkUrl: p.personal?.vkUrl || "",
      social: social.view(this, p),
      regalia: dailyRankings.publicRegalia(p),
      eventRegalia: blackFriday.regalia(p),
      easter: { trophies: easter.view(p, this.events, this.now()).trophies },
      seasonTrophies: personalTrophies.view(p),
    };
  }
  byId(id, data = this.data) {
    const key = profileKeys(data.profiles).get(id);
    return key === undefined ? undefined : data.profiles[key];
  }
  startLife(profileId, lifeId, newArena = true, batch) {
    if (this.residentRecoveryProfiles.has(profileId)) throw Error("Resident progress recovery is still pending");
    if (batch) {
      const draft = this.arenaProgressDraft(
        batch.next,
        `start:${lifeId}`,
        [{ type: "lifeStarted", profileId, lifeId, newArena }],
        this.now(),
      );
      if (draft) batch.next = draft.next;
      return draft?.ids || [];
    }
    return this.applyArenaProgress(
      `start:${lifeId}`,
      [{ type: "lifeStarted", profileId, lifeId, newArena }],
      this.now(),
    );
  }
  applyArenaProgress(batchId, events, at, background = false) {
    if (background && this.arenaPreparer && !this.arenaPreparer.failed)
      return this.applyArenaGroup([{ id: batchId, progress: events, at }]).then(
        (changes) => changes?.[0] || changes,
      );
    this.refreshCompetition(at);
    const draft = this.arenaProgressDraft(this.data, batchId, events, at);
    if (!draft) return [];
    if (background && this.journal)
      return this.flushArenaSnapshot(this.prepareSnapshot(draft.next, at), draft.ids);
    this.save(draft.next, at);
    return draft.ids;
  }
  flushArenaSnapshot(snapshot, result) {
    return this.journal
      .commitArena(snapshot, () => {
        this.data = snapshot;
        this.markMigrationsSaved();
      })
      .then((published) => (published ? result : null));
  }
  // Under contention several completed ticks can share a disk flush. Each
  // still sees its own timestamp and the exact result of the preceding tick.
  applyArenaGroup(batches, budgetMs = 8) {
    this.refreshCompetition(batches[0].at);
    if (this.arenaPreparer && !this.arenaPreparer.failed)
      return this.prepareArenaInWorker(batches, budgetMs);
    const { snapshot, changes } = this.prepareArenaBatches(batches, budgetMs);
    return snapshot === this.data ? changes : this.flushArenaSnapshot(snapshot, changes);
  }
  async prepareArenaInWorker(batches, budgetMs) {
    let result = await this.arenaPreparer.prepare(this, batches, budgetMs);
    if (result === null) return null;
    if (result === undefined) {
      this.refreshCompetition(batches[0].at);
      result = this.prepareArenaBatches(batches, budgetMs);
    }
    return result.snapshot === this.data
      ? result.changes
      : this.flushArenaSnapshot(result.snapshot, result.changes);
  }
  prepareArenaBatches(batches, budgetMs = 8) {
    const started = performance.now();
    let previous = this.data;
    const changes = [];
    for (const { id, progress, at } of batches) {
      // A cheap backlog can share fsync; costly ticks must return control to
      // sockets and physics. Commit only this FIFO prefix, never skip/re-time
      // the rest. The caller removes exactly changes.length queued batches.
      if (
        changes.length &&
        (performance.now() - started >= budgetMs || this.competitionDue(previous, at))
      )
        break;
      const draft = this.arenaProgressDraft(previous, id, progress, at);
      if (draft) previous = this.prepareSnapshot(draft.next, at, undefined, previous);
      changes.push(draft?.ids || []);
    }
    return { snapshot: previous, changes };
  }
  arenaProgressDraft(previous, batchId, events, at) {
    if (previous.progressReceipt === batchId) return null;
    const drafts = new Map(),
      clanXp = new Map(),
      clanDrafts = new Map(),
      keys = profileKeys(previous.profiles);
    const receiptDraft = new WeakMap();
    const privateActivity = new Set();
    for (const event of events) if (!passiveActivityEvents.has(event.type)) privateActivity.add(event.profileId);
    for (const event of events) {
      const key = keys.get(event.profileId);
      if (!key) continue;
      if (!drafts.has(key)) {
        const passive = !privateActivity.has(event.profileId), draft = arenaDraft(previous.profiles[key], false, passive);
        if (passive) activity.beginPassiveArenaBatch(draft);
        drafts.set(key, draft);
      }
      const p = drafts.get(key);
      // Gathering only updates its cumulative counters. Arena food, XP and
      // achievements are already accounted by their existing simulation events.
      if (event.type === "alchemyGather") { alchemy.progress(p, this.events, event, at); continue; }
      const
        before = p.progress.xp + (p.progress.session?.xp || 0);
      const clanBefore = {kills:p.progress.absorptionKills || 0, mass:p.progress.absorbedMass || 0};
      const balance = transactions.snapshot(p),
        previousLevel = p.level;
      // Only order events inspect the pre-update session. Mass/food samples
      // that do not use it must not copy this growing object on every event.
      const questSession = blackFriday.usesQuestSession(event) && p.quests?.session
        ? { ...p.quests.session } : undefined;
      const questChanges = quests.progress(p, event, at, this.events?.active(at), receiptDraft);
      blackFriday.progress(p, this.events, event, at, questSession, questChanges);
      easter.progress(p, this.events, event, at);
      alchemy.progress(p, this.events, event, at);
      pets.progress(p, event, at, this.petEvents);
      const luckyLevel = p.progress.session?.luckyLevel;
      const fridayLevel = p.progress.session?.fridayLevel;
      // Only absorption writes these cooldown maps. A time/food/mass sample
      // must not copy a long life history. Detach once before the first write
      // in this private batch, retaining the original duplicate/expiry rules.
      if (event.type === "absorbed")
        for (const field of victimHistoryFields)
          if (p.progress[field] === previous.profiles[key].progress[field])
            p.progress[field] = copyArenaData(p.progress[field]);
      const awardsCurrent = applyEvent(p, event, at) === true;
      const settledGreatness = p.greatness, settledHonors = p.honors;
      luckyWeek.arena(p, this.events, { ...event, luckyLevel }, before, previousLevel, at);
      blackFriday.arena(p, this.events, { ...event, fridayLevel }, before, previousLevel, at);
      activity.refreshCalendar(p, at, false, awardsCurrent);
      // applyEvent already settles titles when awardsCurrent is true. Event
      // and calendar rewards can add greatness afterwards, so recheck then.
      if (!awardsCurrent || p.greatness !== settledGreatness || p.honors !== settledHonors)
        awardTitles(p, at);
      transactions.record(p, balance, at, {
        kind: "reward",
        label: p.level > previousLevel ? "Награда за повышение уровня" : "Награда арены",
        detail: p.level > previousLevel ? `Уровень ${previousLevel} → ${p.level}` : event.type,
      });
      const earned = p.progress.xp + (p.progress.session?.xp || 0) - before;
      clanQuests.progress(previous, clanDrafts, p, event, at, questChanges, earned, clanBefore);
      // Зачёт в момент заработка: вступление/исключение посреди жизни не переносит старый XP.
      if (earned > 0 && p.clanId && previous.clans[p.clanId])
        clanXp.set(p.clanId, (clanXp.get(p.clanId) || 0) + earned);
    }
    const changed = [];
    for (const [key, draft] of drafts) {
      activity.endPassiveArenaBatch(draft);
      const current = previous.profiles[key];
      let modified = Object.keys(current).length !== Object.keys(draft).length;
      // The journal uses identity to omit unchanged profile fields. Arena drafts
      // are isolated copies, so restore sharing after all events have run.
      for (const field of Object.keys(draft)) {
        if (Object.hasOwn(current, field)) draft[field] = shareArenaData(current[field], draft[field]);
        if (!Object.hasOwn(current, field) || draft[field] !== current[field]) modified = true;
      }
      if (modified) changed.push([key, draft]);
    }
    if (!changed.length) return null;
    const next = { ...previous, profiles: copyRecord(previous.profiles), progressReceipt: batchId };
    // Arena updates never create/delete identities. Reuse the immutable lookup
    // across this replacement instead of indexing every idle profile again.
    profileIndexes.remember(next.profiles, keys);
    if (clanXp.size || clanDrafts.size) {
      next.clans = { ...previous.clans, ...Object.fromEntries(clanDrafts) };
      for (const [id, earned] of clanXp) {
        const clan = next.clans[id],
          xp = clan.xp + earned;
        if (!Number.isSafeInteger(xp)) throw Error("Опыт клана достиг предела.");
        next.clans[id] = { ...clan, xp };
      }
    }
    for (const [key, p] of changed) {
      easter.validate(p);
      if (p.alchemy !== previous.profiles[key].alchemy) alchemy.validate(p);
      quests.validate(
        p,
        previous.profiles[key].quests?.session?.seen,
        previous.profiles[key].quests?.session?.seenBuckets,
      );
      roulette.validate(p, p.roulette?.results === previous.profiles[key].roulette?.results);
      pets.validate(p);
      validateProgress(p);
      validateHonors(p);
      activity.validateActivity(p, previous.profiles[key]);
      p.revision++;
      next.profiles[key] = p;
    }
    tableDeltas.remember(next.profiles,previous.profiles,changed.map(([key]) => key),true);
    return { next, ids: changed.map(([, p]) => p.id) };
  }
  chatAccepted(profileId, count, batch) {
    const world = batch?.next || this.data;
    const index = profileKeys(world.profiles), key = index.get(profileId);
    if (!key) return;
    const current = world.profiles[key],
      previous = current.activity.chatAccepted || 0;
    if (!Number.isSafeInteger(count) || count < 0) throw Error("Неверный счётчик чата.");
    if (count <= previous) return;
    // Chat changes activity/greatness and may unlock honors. awardTitles
    // detaches honors before writing; unrelated inventory/history stays shared.
    const p = { ...current, activity: copyArenaData(current.activity) },
      at = this.now();
    p.activity.values.sociable += count - previous;
    p.activity.chatAccepted = count;
    activity.awardExtra(p, at);
    awardTitles(p, at);
    activity.validateActivity(p);
    p.revision++;
    const next = replaceBatchProfile(batch, world, key, p) || {
      ...world, profiles: { ...world.profiles, [key]: p },
    };
    if (!batch) tableDeltas.remember(next.profiles, world.profiles, [key], true);
    profileIndexes.remember(next.profiles, index);
    if (batch) { batch.next = next; return; }
    this.save(next, at, {
      kind: "reward",
      label: "Достижение «Общительный»",
    });
  }
  socialAction(token, input) {
    return social.mutate(this, token, input);
  }
  socialState(token) {
    const p = this.find(token);
    if (!p) throw new BoosterError("Сначала открой лобби.", 401);
    return { catalog: require("./event-gift-unlocks").catalog(p), social: social.view(this, p, true) };
  }
  setPersonal(token, input) {
    const details = personalDetails.normalize(input);
    return this.transactProfile(token, input.requestId, JSON.stringify(["personal", details]), (p) => {
      require("../admin/reserved-name").requireAllowedName(p.id, details.name, this.ownerId);
      if (details.name !== p.name)
        nicknames.requireAvailable(Object.values(this.data.profiles), details.name, p.id);
      personalDetails.update(p, details, this.now());
    });
  }
  buySkinCollection(token, input, batch) {
    const item = skinCollections.get(input.collectionId);
    if (!item) throw new BoosterError("Этот набор скинов не продаётся.");
    return this.transactProfile(
      token,
      input.requestId,
      JSON.stringify(["buy-skin-collection", item.id]),
      (p) => {
        if (p.purchasedSkinCollections?.includes(item.id)) return;
        if (p.wallet[item.currency] < item.price)
          throw new BoosterError(
            {
              coins: "Недостаточно монет.",
              crystals: "Недостаточно кристаллов.",
              bucks: "Недостаточно эфира.",
            }[item.currency],
            409,
          );
        p.wallet[item.currency] -= item.price;
        activity.spend(p, item.currency, item.price, this.now());
        p.purchasedSkinCollections = [...(p.purchasedSkinCollections || []), item.id];
      },
      undefined,
      undefined,
      batch,
    );
  }
  setAccessory(token, input) {
    if (input.action === "buy") {
      const item = accessories.item(input.accessoryId);
      if (!item?.price || !["coins", "crystals"].includes(item.currency))
        throw new BoosterError("Этот аксессуар не продаётся.");
      return this.transactProfile(
        token,
        input.requestId,
        JSON.stringify(["buy-accessory", item.id]),
        (p) => {
          if (p.purchasedAccessories?.includes(item.id)) return;
          if (p.wallet[item.currency] < item.price)
            throw new BoosterError(
              item.currency === "coins" ? "Недостаточно монет." : "Недостаточно кристаллов.",
              409,
            );
          p.wallet[item.currency] -= item.price;
          activity.spend(p, item.currency, item.price, this.now());
          p.purchasedAccessories = [...(p.purchasedAccessories || []), item.id];
        },
      );
    }
    if (input.action !== undefined) throw new BoosterError("Неизвестное действие с аксессуаром.");
    if (input.mode === "ability")
      throw new BoosterError(
        "Бустеры на E используются автоматически: сначала бабочка, затем шапка.",
        409,
      );
    if (
      !accessories.slots.includes(input.slot) ||
      (input.accessoryId !== null && accessories.item(input.accessoryId)?.slot !== input.slot)
    )
      throw new BoosterError("Выбери доступный аксессуар для этого места.");
    return this.transactProfile(
      token,
      input.requestId,
      JSON.stringify(["accessory", input.slot, input.accessoryId]),
      (p) => {
        if (input.accessoryId && !accessoryAccess.isOwned(p, input.accessoryId))
          throw new BoosterError(
            accessories.item(input.accessoryId)?.eventReward
              ? "Сначала собери все четыре коллекции Пасхальной охоты."
              : "Этот аксессуар пока недоступен.",
            409,
          );
        p.outfit = { ...accessories.outfit(p.outfit), [input.slot]: input.accessoryId };
        if (input.accessoryId) wardrobeState.mark(p, "accessory:" + input.accessoryId);
      },
    );
  }
  setAppearance(token, input) {
    return this.transactProfile(
      token,
      input.requestId,
      JSON.stringify(
        input.action === undefined
          ? ["appearance", input.slot, input.themeId]
          : ["appearance", input.slot, input.themeId, input.action],
      ),
      (p) => {
        appearance.update(
          p,
          input,
          this.data.clans,
          this.now(),
          this.unlockLeagueBackgrounds,
          this.unlockLeagueFrames,
        );
        const slots = input.slot === "set" ? ["lobbyBackground", "profileBackground", "avatarFrame", "arenaFrame", "uiTheme"] : input.slot === "frames" ? ["avatarFrame", "arenaFrame"] : input.slot === "theme" ? ["lobbyBackground", "uiTheme"] : [input.slot];
        for (const slot of slots) wardrobeState.mark(p, slot + ":" + input.themeId);
      },
    );
  }
  setLoadout(token, input, batch) {
    if (!validSkin(input.skinId)) throw new BoosterError("Выбери доступный скин.");
    return this.transactProfile(
      token,
      input.requestId,
      JSON.stringify(["loadout", input.name, input.skinId, input.quickSlots]),
      (p) => {
        if (
          !require("../../../public/shared/player-identity").skinAllowed(
            input.skinId,
            accounts.benefits(p, this.now()),
            appearance.skinSets(p),
            p.purchasedSkinCollections,
            p.grantedSkins,
          )
        )
          throw new BoosterError(
            playerIdentity.collectionSkins.some((skin) => skin.id === input.skinId)
              ? "Сначала купи этот набор скинов."
              : playerIdentity.themeSkins.some((skin) => skin.id === input.skinId)
                ? "Для этого набора сначала купи соответствующую тему интерфейса."
                : "Для этого аватара нужен активный VIP или Premium.",
            409,
          );
        const slots = input.quickSlots;
        if (
          !Array.isArray(slots) ||
          slots.length > loadout.keys.length ||
          new Set(slots.filter(Boolean)).size !== slots.filter(Boolean).length ||
          slots.some((id) => id !== null && (!BOOSTERS.get(id)?.ready || !(p.inventory[id] > 0)))
        )
          throw new BoosterError("В слоты можно выбрать до шести разных имеющихся бустеров.");
        const lockedItem = slots.find(
          (id) => id && !loadout.itemAllowed(BOOSTERS.get(id), p.level),
        );
        if (lockedItem)
          throw new BoosterError(
            "Этот бустер доступен с " + BOOSTERS.get(lockedItem).useLevel + " уровня.",
            409,
          );
        // После истечения статуса сохраняем выбор, но не разрешаем новые назначения
        // в закрытые слоты. Предметы остаются в инвентаре.
        if (
          slots.some(
            (id, i) =>
              !loadout.unlocked(i, accounts.benefits(p, this.now()), p.level) &&
              id !== null &&
              id !== p.quickSlots?.[i],
          )
        )
          throw new BoosterError(
            "Четвёртый слот открывается с 12 уровня, пятый - с VIP или Premium, шестой - с Premium.",
            409,
          );
        // Имя меняется только отдельной подтверждённой операцией личных данных.
        p.skinId = input.skinId;
        wardrobeState.mark(p, "skin:" + input.skinId);
        p.quickSlots = [...slots];
      },
      undefined,
      undefined,
      batch,
    );
  }
  // Только локальная симуляция. Для настоящей оплаты выдача должна быть
  // связана с проверенным серверным уведомлением платёжного провайдера.
  confirmMockPurchase(token, input) {
    const product = virtualProducts.get(input.productId);
    if (!product) throw new BoosterError("Этот игровой продукт не найден.");
    if (input.confirmed !== true) throw new BoosterError("Сначала подтверди тестовую покупку.");
    const result = this.transactProfile(
      token,
      input.requestId,
      JSON.stringify(
        ["lite", "manya-coupon"].includes(product.type)
          ? ["mock-purchase", product.id, input.eventId]
          : ["mock-purchase", product.id],
      ),
      (p) => {
        if (product.type === "manya-coupon") {
          blackFriday.activateCoupon(p, this.events, input.eventId, this.now());
        } else if (product.type === "lite") {
          lite.activate(p, this.rouletteConfig, this.now(), input.eventId);
          require("../events/lucky-week").record(
            p,
            require("../events/lucky-week").runAt(this.events, this.now()),
            "lucky_lite",
            1,
          );
        } else if (product.type === "promotion") {
          promotions.grant(p, product, this.promotionConfig, this.now());
          blackFriday.activity(
            p,
            this.events,
            {
              purchasedBoosters: Object.values({ ...product.boosters, ...product.exactBoosters }).reduce(
                (sum, n) => sum + n,
                0,
              ),
            },
            this.now(),
          );
        } else if (product.type === "currency") {
          const at = this.now();
          const before = transactions.snapshot(p);
          const promo = blackFriday.runAt(this.events, at);
          if (
            input.currencyPromoRunId !== undefined &&
            input.currencyPromoRunId !== (promo?.id || null)
          )
            throw new BoosterError("Условия акции изменились. Открой покупку заново.", 409);
          const amount = product.amount * (promo ? 2 : 1);
          const balance = p.wallet[product.currency] + amount;
          if (!Number.isSafeInteger(balance))
            throw new BoosterError("Превышен допустимый баланс валюты.");
          p.wallet[product.currency] = balance;
          const achievement = { coins: "wealthy", crystals: "miner", bucks: "banker" }[
            product.currency
          ];
          // Полный состав купленного пакета, включая его процентный бонус.
          // Ежедневные подарки учитываются отдельно и сюда не попадают.
          const purchased = p.activity.values[achievement] + amount;
          if (!Number.isSafeInteger(purchased))
            throw new BoosterError("Превышен допустимый прогресс покупки.");
          p.activity.values[achievement] = purchased;
          const fridayTokens = blackFriday.rewardCurrencyPack(p, promo, product.votes, at);
          transactions.record(p, before, at, {
            ...transactions.operation(
              JSON.stringify(["mock-purchase", product.id]),
              input.requestId,
              p.id,
            ),
            reward: { [product.currency]: amount, ...(fridayTokens ? { fridayTokens } : {}) },
          });
        } else {
          const at = this.now();
          p.account ||= accounts.fresh();
          const key = product.kind + "Until";
          const until = Math.max(at, p.account[key]) + accounts.WEEK;
          const weeks = p.activity.values[product.kind] + 1;
          if (
            !Number.isSafeInteger(until) ||
            until > 8640000000000000 ||
            !Number.isSafeInteger(weeks)
          )
            throw new BoosterError("Превышен допустимый срок статуса.");
          p.account[key] = until;
          p.activity.values[product.kind] = weeks;
        }
      },
    );
    return {
      ...result,
      ...(product.type === "currency"
        ? {
            reward: transactions.currencyReward(
              this.find(token),
              input.requestId,
              product.currency,
            ),
          }
        : {}),
      payment: {
        simulated: true,
        status: "confirmed",
        requestId: input.requestId,
        productId: product.id,
        votes: product.votes,
      },
    };
  }
  claimLoginReward(token, input = {}) {
    const current = this.find(token),
      at = this.now();
    if (!current) throw new BoosterError("Сначала открой лобби.", 401);
    if (!dailyLogin.due(current, at)) return { profile: this.view(current), loginReward: null };
    if (input.date !== undefined && input.date !== dailyLogin.preview(current, at).date)
      throw new BoosterError(
        "Наступил новый день. Обнови страницу, чтобы увидеть сегодняшнюю награду.",
        409,
      );
    const draft = lobbyDraft(current),
      loginReward = dailyLogin.grant(draft, at);
    draft.revision++;
    const key = tokenHash(token), profiles = Object.assign(copyRecord(this.data.profiles), { [key]: shareArenaData(current, draft) });
    tableDeltas.remember(profiles, this.data.profiles, [key], true);
    this.save(
      { ...this.data, profiles },
      at,
      { kind: "reward", label: "Ежедневный бонус", detail: "День " + loginReward.day },
    );
    return { profile: this.view(this.find(token)), loginReward };
  }
  claimAccountCurrencyBonus(token, input, batch) {
    const { kind, currency } = input;
    const rewards = virtualProducts.accountLoginRewards;
    if (!Object.hasOwn(rewards, kind) || !Object.hasOwn(rewards[kind], currency))
      throw new BoosterError("Выбери бонус VIP или Premium и игровую валюту.");
    return this.transactProfile(
      token,
      input.requestId,
      JSON.stringify(["account-currency-bonus", kind, currency]),
      (p) => {
        const at = this.now(),
          today = accounts.loginRewardDay(at);
        if (!accounts.benefits(p, at)[kind])
          throw new BoosterError(
            `Для этого бонуса нужен активный ${kind === "vip" ? "VIP" : "Premium"}.`,
            409,
          );
        if ((p.account.currencyClaims?.[kind]?.[currency] ?? -1) >= today)
          throw new BoosterError("Этот бонус уже получен. Новый доступен после 00:00 МСК.", 409);
        const balance = p.wallet[currency] + rewards[kind][currency];
        if (!Number.isSafeInteger(balance))
          throw new BoosterError("Превышен допустимый баланс валюты.");
        p.wallet[currency] = balance;
        p.account.currencyClaims ||= {};
        p.account.currencyClaims[kind] ||= {};
        p.account.currencyClaims[kind][currency] = today;
      },
      undefined,
      undefined,
      batch,
    );
  }
  activateAccount(token, input) {
    if (!["vip", "premium"].includes(input.kind)) throw new BoosterError("Выбери VIP или Premium.");
    return this.transactProfile(
      token,
      input.requestId,
      JSON.stringify(["account-test-week", input.kind]),
      (p) => {
        const at = this.now();
        p.account ||= accounts.fresh();
        const key = input.kind + "Until";
        if (p.account[key] > at)
          throw new BoosterError(
            "Этот статус уже активен. Повторное продление пока недоступно.",
            409,
          );
        p.account[key] = at + accounts.WEEK;
        const weeks = p.activity.values[input.kind] + 1;
        if (!Number.isSafeInteger(weeks))
          throw new BoosterError("Превышен допустимый срок статуса.");
        p.activity.values[input.kind] = weeks;
      },
    );
  }
  transactWorld(token, requestId, signature, change, participantIds) {
    this.refreshCompetition();
    const current = this.find(token);
    if (!current) throw new BoosterError("Сначала открой лобби.", 401);
    if (typeof requestId !== "string" || !requestPattern.test(requestId))
      throw new BoosterError("Неверный номер операции.");
    const recorded = operationReceipts.read(current, requestId);
    if (recorded !== operationReceipts.MISSING) {
      if (recorded !== signature)
        throw new BoosterError("Этот номер уже использован для другой операции.", 409);
      return { profile: this.view(current), replay: true };
    }
    // Resolve a write set after refreshCompetition, against the committed
    // world that this transaction will actually use. Unrelated profiles and
    // clans remain immutable and shared, including if validation/save fails.
    const writeSet = typeof participantIds === "function" ? participantIds(current, this.data) : null;
    const ids = writeSet ? writeSet.profileIds : participantIds;
    const selected = ids && new Set([tokenHash(token)]);
    if (selected) {
      const index = profileKeys(this.data.profiles);
      for (const id of ids) {
        const key = index.get(id);
        if (key) selected.add(key);
      }
    }
    const next = selected
      ? { ...this.data, profiles: copyRecord(this.data.profiles) }
      : clone(this.data);
    if (selected) for (const key of selected)
      next.profiles[key] = writeSet?.profileDraft === "clan" ? clanDraft(this.data.profiles[key]) :
        writeSet?.profileDraft === "owned" ? lobbyDraft(this.data.profiles[key]) : clone(this.data.profiles[key]);
    if (writeSet?.clanIds) {
      next.clans = copyRecord(this.data.clans);
      for (const id of writeSet.clanIds)
        if (Object.hasOwn(this.data.clans, id)) next.clans[id] = clone(this.data.clans[id]);
    }
    const entries = selected ? [...selected].map(key => [key, next.profiles[key]]) : Object.entries(next.profiles);
    const participants = entries.map(([, p]) => p), draft = next.profiles[tokenHash(token)];
    const at = this.now();
    for (const p of participants) activity.refreshCalendar(p, at);
    for (const p of participants)
      transactions.record(p, transactions.snapshot(p), at);
    change(draft, next, participants);
    require("../progression/treasury-capacity").fill(draft, at);
    for (const [key, p] of entries) {
      transactions.capture(p, at, transactions.operation(signature, requestId, current.id));
      const balance = transactions.snapshot(p);
      if (p.clanId !== this.data.profiles[key].clanId) activity.changeClan(p, p.clanId, at);
      activity.awardExtra(p, at);
      awardTitles(p, at);
      transactions.record(p, balance, at, { kind: "reward", label: "Награда за достижения" });
      accounts.validate(p);
      validateHonors(p);
      activity.validateActivity(p);
      if (
        p !== draft &&
        p.revision === this.data.profiles[key].revision &&
        shareArenaData(this.data.profiles[key], p) !== this.data.profiles[key]
      )
        p.revision++;
    }
    draft.revision++;
    if (selected) for (const key of selected)
      next.profiles[key] = shareArenaData(this.data.profiles[key], next.profiles[key]);
    if (draft.receipts === current.receipts) {
      draft.receipts = copyRecord(current.receipts);
      draft.receipts[requestId] = signature;
      require("./immutable-receipt-delta").remember(draft.receipts, current.receipts, { [requestId]: signature });
    } else draft.receipts[requestId] = signature;
    if (writeSet?.clanIds) for (const id of writeSet.clanIds)
      if (next.clans[id] && this.data.clans[id])
        next.clans[id] = shareArenaData(this.data.clans[id], next.clans[id]);
    require("../clans/clan-service").validateWorld(next);
    if (selected) {
      tableDeltas.remember(next.profiles, this.data.profiles, [...selected], true);
      profileIndexes.remember(next.profiles, profileKeys(this.data.profiles));
    }
    this.save(next);
    return { profile: this.view(this.find(token)), replay: false };
  }
  // Only the audited game commands call this entry point.
  transactProfile(token, requestId, signature, change, project, makeDraft = lobbyDraft, batch) {
    return this.transact(token, requestId, signature, change, project, makeDraft, batch);
  }
  transact(
    token,
    requestId,
    signature,
    change,
    project = (p) => this.view(p),
    makeDraft = clone,
    batch,
  ) {
    const arena = makeDraft === arenaDraft || makeDraft === arenaCastDraft;
    if (!batch) this.refreshCompetition();
    const world = batch?.next || this.data;
    const current = this.find(token, world);
    if (!current) throw new BoosterError("Сначала открой лобби, чтобы загрузить профиль.", 401);
    if (typeof requestId !== "string" || !requestPattern.test(requestId))
      throw new BoosterError("Неверный номер операции.");
    const recorded = operationReceipts.read(current, requestId);
    if (recorded !== operationReceipts.MISSING) {
      if (recorded !== signature)
        throw new BoosterError("Этот номер уже использован для другой операции.", 409);
      return batch ? { replay: true } : { profile: project(current), replay: true };
    }
    const draft = makeDraft(current);
    const at = this.now();
    activity.refreshCalendar(draft, at);
    easter.expire(draft, at);
    const balance = transactions.snapshot(draft);
    transactions.record(draft, balance, at);
    change(draft);
    require("../progression/treasury-capacity").fill(draft, at);
    transactions.capture(draft, at, transactions.operation(signature, requestId, current.id));
    const rewardBalance = transactions.snapshot(draft);
    activity.awardExtra(draft, at);
    awardTitles(draft, at);
    transactions.record(draft, rewardBalance, at, {
      kind: "reward",
      label: "Награда за достижения",
    });
    quests.validate(draft, current.quests?.session?.seen, current.quests?.session?.seenBuckets);
    easter.validate(draft);
    blackFriday.validate(draft);
    alchemy.validate(draft);
    pets.validate(draft);
    roulette.validate(draft, arena || draft.roulette?.results === current.roulette?.results);
    accounts.validate(draft);
    validateHonors(draft);
    activity.validateActivity(draft);
    const sharedReceipts = !arena && draft.receipts === current.receipts;
    if (arena) operationReceipts.recordArena(draft, requestId, signature);
    else {
      if (sharedReceipts) draft.receipts = copyRecord(current.receipts);
      draft.receipts[requestId] = signature;
      if (sharedReceipts) require("./immutable-receipt-delta").remember(
        draft.receipts, current.receipts, { [requestId]: signature });
    }
    draft.revision++;
    if (arena || makeDraft === clone || makeDraft === lobbyDraft) {
      // Reconcile private changed branches after validation. Audited lobby
      // writers share immutable archives; arbitrary callbacks get a full copy.
      // Neither path may rewrite unchanged history for a one-field purchase.
      for (const field of Object.keys(draft))
        if (Object.hasOwn(current, field) && !(sharedReceipts && field === "receipts"))
          draft[field] = shareArenaData(current[field], draft[field]);
    }
    const key = tokenHash(token);
    const next = replaceBatchProfile(batch, world, key, draft) ||
      { ...world, profiles: Object.assign(copyRecord(world.profiles), { [key]: draft }) };
    // This synchronous transaction changed exactly one existing profile. Its
    // completed table is immutable from here; do not rescan every account for
    // each lobby purchase when preparing settlement and the durable journal.
    if (!batch) tableDeltas.remember(next.profiles, world.profiles, [key], true);
    // Older servers must fail closed instead of overlooking the new ledger.
    if (arena) next.version = Math.max(world.version, 14);
    if (world.profiles[key]?.id === draft.id && profileIndexes.has(world.profiles))
      profileIndexes.remember(next.profiles, profileKeys(world.profiles));
    if (batch) {
      batch.next = next;
      return { replay: false };
    }
    this.save(next);
    return { profile: project(this.find(token)), replay: false };
  }
  competitionDue(data, at) {
    return (
      (this.clanDailyQuests && !data.clanQuests) || clanQuests.due(data, at) ||
      this.questRulesMigrationPending ||
      this.petsMigrationPending ||
      this.rouletteMigrationPending ||
      this.appearanceMigrationPending ||
      this.leagueMigrationPending ||
      this.trophyMigrationPending ||
      this.trophyCorrectionPending ||
      this.loadoutMigrationPending ||
      this.transactionsMigrationPending ||
      this.achievementStagesMigrationPending ||
      clanCompetition.due(data, at, this.settlementCache) ||
      dailyRankings.due(data, at) ||
      (this.eventRankingReady?.() !== false && eventRankings.due(data, this.events, at)) ||
      socialCalendar.due(data, at, this.settlementCache) ||
      luckyWeek.recoveryDue(data, this.events, this.settlementCache) ||
      blackFriday.recoveryDue(data, this.events, this.settlementCache) ||
      (this.settlementCache
        ? this.settlementCache.easterRefreshDue(data.profiles, at, easter.refreshDue)
        : Object.values(data.profiles).some((p) => easter.refreshDue(p, at)))
    );
  }
  refreshCompetition(at = this.now()) {
    if (!this.competitionDue(this.data, at)) return false;
    this.save(this.data, at);
    return true;
  }
  // Наградные сундуки, кроме сундуков титулов, используют бонусы статусов.
  // Покупки за голоса и акции используют обычную transact без бонуса за сундук.
  chestTransaction(token, requestId, signature, change, opening = false, source = null) {
    return this.transactProfile(token, requestId, signature, (p) => {
      const at = this.now();
      change(p, at);
      if (opening)
        require("../progression/chest-bonuses").opened(
          p,
          this.rouletteConfig,
          at,
          this.events,
          source,
        );
    });
  }
  questAction(token, input) {
    if (input.action === "notice") {
      if (
        !Array.isArray(input.ids) ||
        !input.ids.length ||
        input.ids.length > 100 ||
        input.ids.some((id) => typeof id !== "string" || !id || id.length > 100)
      )
        throw new BoosterError("Некорректные уведомления заданий.");
      const ids = [...new Set(input.ids)].sort();
      return this.transactProfile(token, input.requestId, JSON.stringify(["quest-notices", ids]), (p) => {
        const at = this.now();
        for (const reward of p.quests?.pending || [])
          if (ids.includes(reward.id) && reward.notifiedAt === undefined) reward.notifiedAt = at;
      });
    }
    if (
      !["receive", "prepare", "claim", "reroll"].includes(input.action) ||
      typeof input.questId !== "string" ||
      input.questId.length > 100
    )
      throw new BoosterError("Некорректное действие задания.");
    return this.chestTransaction(
      token,
      input.requestId,
      JSON.stringify(["quest", input.action, input.questId, input.expectedCost]),
      (p, at) => quests.act(p, input, at),
      input.action === "claim",
      "quest",
    );
  }
  dismissDailyRankingRewards(token, input) {
    return this.transactProfile(
      token,
      input.requestId,
      JSON.stringify(["daily-ranking-notices", input.ids]),
      (p) => {
        const notices = require("../rankings/daily-ranking-notices");
        notices.dismiss(p, input.ids);
        notices.validate(p);
      },
    );
  }
  acknowledgePromotions(token, input) {
    return this.transactProfile(token, input.requestId, JSON.stringify(["promotion-notices", input.ids]),
      p => promotions.acknowledge(p, this.promotionConfig, input, this.now()));
  }
  clanChestAction(token, input) {
    if (input.action === "notice") {
      if (
        !Array.isArray(input.ids) ||
        !input.ids.length ||
        input.ids.length > 100 ||
        input.ids.some((id) => typeof id !== "string" || !id || id.length > 100)
      )
        throw new BoosterError("Некорректные уведомления клана.");
      const ids = [...new Set(input.ids)].sort();
      return this.transactProfile(token, input.requestId, JSON.stringify(["clan-notices", ids]), (p) => {
        const at = this.now();
        for (const notice of p.clanChests?.notices || [])
          if (ids.includes(notice.id) && notice.notifiedAt === undefined) notice.notifiedAt = at;
      });
    }
    if (!["claim", "dismiss", "prepare", "open"].includes(input.action))
      throw new BoosterError("Неизвестное действие сундука.");
    return this.chestTransaction(
      token,
      input.requestId,
      JSON.stringify(["clan-chest", input.action, input.chestId]),
      (p, at) => clanChests.act(p, input.action, input.chestId, at),
      input.action === "open",
      "clan",
    );
  }
  openChest(token, id, requestId) {
    return this.transactProfile(token, requestId, JSON.stringify(["chest", id]), (p) =>
      openChest(p, id, this.now()),
    );
  }
  acknowledgeTitle(token, { degree, requestId }) {
    if (!Number.isInteger(degree) || degree < 1 || degree > 10)
      throw new BoosterError("Некорректный титул.");
    return this.transactProfile(token, requestId, JSON.stringify(["title-notice", degree]), (p) => {
      if (degree > p.honors.claimed) throw new BoosterError("Титул ещё не получен.", 409);
      p.honors.notified = Math.max(p.honors.notified ?? p.honors.claimed, degree);
    });
  }
  prepareChest(token, id, requestId) {
    return this.transactProfile(token, requestId, JSON.stringify(["prepare-chest", id]), (p) =>
      prepareChest(p, id, this.now()),
    );
  }
  buy(token, id, requestId, batch) {
    if (BOOSTERS.get(id)?.tier === "potion")
      throw new BoosterError("Зелья создаются в лаборатории.", 409);
    if (BOOSTERS.get(id)?.tier === "event")
      throw new BoosterError("Этот бустер выдаётся за событие.", 409);
    if (BOOSTERS.get(id)?.tier === "clan")
      throw new BoosterError("Этот бустер покупается главой или управляющим из казны клана.");
    const booster = BOOSTERS.get(id);
    if (!booster?.ready)
      throw new BoosterError(booster?.unavailableReason || "Такого бустера нет в магазине.");
    if (booster.tier === "rare" && !BOOSTER_RULES.RARE_SHOP_ENABLED)
      throw new BoosterError("Редкие бустеры доступны на ярмарках.");
    return this.transactProfile(
      token,
      requestId,
      "buy:" + id,
      (p) => {
        if (p.level < booster.purchaseLevel)
          throw new BoosterError(
            `Этот бустер доступен для покупки с ${booster.purchaseLevel} уровня.`,
            409,
          );
        const { currency, amount, quantity } = booster.price;
        if (p.wallet[currency] < amount)
          throw new BoosterError(
            "Недостаточно " + (currency === "coins" ? "монет." : "кристаллов."),
            409,
          );
        const count = (p.inventory[id] || 0) + quantity;
        if (!Number.isSafeInteger(count)) throw new BoosterError("Инвентарь переполнен.");
        p.wallet[currency] -= amount;
        activity.spend(p, currency, amount, this.now());
        p.inventory[id] = count;
        blackFriday.activity(p, this.events, { purchasedBoosters: quantity }, this.now());
        p.quickSlots ||= [];
        if (!p.quickSlots.includes(id) && loadout.itemAllowed(BOOSTERS.get(id), p.level)) {
          const available = loadout.count(accounts.benefits(p, this.now()));
          const empty = loadout.emptyIndex(p.quickSlots, available, (i) =>
            loadout.unlocked(i, accounts.benefits(p, this.now()), p.level),
          );
          if (empty >= 0) {
            while (p.quickSlots.length <= empty) p.quickSlots.push(null);
            p.quickSlots[empty] = id;
          }
        }
      },
      undefined,
      undefined,
      batch,
    );
  }
  consume(token, id, requestId, signature, validate, arenaOnly = false, batch) {
    return this.transactProfile(
      token,
      requestId,
      signature,
      (p) => {
        if (!BOOSTERS.get(id)?.ready || !(p.inventory[id] > 0))
          throw new BoosterError("Этого бустера нет в инвентаре.", 409);
        const prepared = validate(); // Ошибка цели или эффекта не расходует предмет.
        if (BOOSTERS.get(id).kind === "potion") {
          if (!prepared?.lifeId || p.progress.session?.id !== prepared.lifeId)
            throw new BoosterError("Эта жизнь уже завершена. Зелье сохранено.", 409);
          const potionId = alchemy.rules.get(id).id;
          const used = p.alchemy?.active?.lifeId === prepared.lifeId ? alchemy.rules.activeIds(p.alchemy.active) : [];
          if (used.includes(potionId) || used.length >= alchemy.rules.MAX_ACTIVE)
            throw new BoosterError("Можно применить только три разных зелья за жизнь.", 409);
          const next = alchemy.rules.equipped(p.alchemy).find(key =>
            !used.includes(key) && p.inventory[alchemy.rules.get(key).boosterId] > 0);
          if (next !== potionId) throw new BoosterError("Используй следующее зелье из выбранного набора.", 409);
          const ids = [...used, potionId];
          p.alchemy = { ...p.alchemy, active: { lifeId: prepared.lifeId, id: ids[0], ids } };
        }
        if (id === "easter_egg") easter.consume(p, this.now());
        p.inventory[id]--;
        if (p.inventory[id] === 0 && p.quickSlots)
          p.quickSlots = p.quickSlots.map((slot) => (slot === id ? null : slot));
        successfulBooster(p, prepared?.mass, this.now());
      },
      arenaOnly ? (p) => this.arenaView(p) : undefined,
      arenaCastDraft,
      batch,
    );
  }
}
module.exports = { ProfileStore, arenaCastDraft };
