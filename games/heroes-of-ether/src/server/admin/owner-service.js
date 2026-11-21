"use strict";
const { copyProfile } = require("../profiles/owned-profile-draft");

const { createHash, randomUUID } = require("node:crypto");
const { BoosterError, BOOSTERS } = require("../boosters/booster-catalog");
const accounts = require("../accounts/account-benefits");
const { activeBan, validate } = require("./moderation");
const { banId, newBanId } = require("./ban-identifiers");
const { cleanName } = require("../arena/arena-simulation");
const { validateWorld } = require("../clans/clan-service");
const experience = require("../progression/experience-progression");
const loadout = require("../../../public/shared/quick-slot-rules");
const { copyRecord } = require("../profiles/copy-record");
const profileIndex = require("../profiles/profile-index");
const tableDeltas = require("../profiles/immutable-table-delta");
const clone = (value) => structuredClone(value);
const fail = (message) => {
  throw new BoosterError(message, 400);
};
const labels = {
  ban: "Блокировка",
  unban: "Разблокировка",
  rename: "Смена ника",
  level: "Изменение уровня",
  wallet: "Правка валюты",
  account: "Статус аккаунта",
  inventory: "Правка бустеров",
  killReview: "Проверка Kill",
};
class OwnerService {
  constructor({ profiles, access, inArena = () => false, now = Date.now }) {
    Object.assign(this, { profiles, access, inArena, now });
    this.paymentReports = new (require("./payment-report").PaymentReport)(profiles, now);
    this.globalTransactions = new (require("./global-transactions").GlobalTransactions)(profiles);
  }
  summary(p) {
    const clan = this.profiles.data.clans[p.clanId];
    return {
      id: p.id,
      name: p.name,
      level: p.level,
      revision: p.revision,
      clan: clan ? `[${clan.prefix}] ${clan.name}` : null,
      online: !!this.profiles.isOnline?.(p.id),
      inArena: this.inArena(p.id),
      isOwner: this.access.isOwner(p),
      testBot: !!p.testBot,
      moderationRevision: p.moderation?.version || 0,
      ban: activeBan(p, this.now()),
      killReview: p.kill ? { id: p.kill.id, status: p.kill.status, createdAt: p.kill.createdAt } : null,
    };
  }
  player(id) {
    const p = this.profiles.byId(id);
    if (!p) throw new BoosterError("Игрок не найден.", 404);
    return {
      ...this.summary(p),
      chatModeration: require("../chat/chat-rules").ownerView(p, this.now()),
      wallet: clone(p.wallet),
      inventory: clone(p.inventory),
      account: clone(p.account || accounts.fresh()),
      boosters: [...BOOSTERS.values()]
        .map((b) => ({ id: b.id, name: b.name, icon: b.icon, effect: b.usage || b.effect, tier: b.tier })),
    };
  }
  players(query = "", page = 1, options = {}) {
    return require('./player-directory').read(this, query, page, options);
  }

  audit(targetId = "", page = 1, source = "all") {
    if(!['all','actions','security'].includes(source))fail('Неизвестный вид журнала.');
    const found = [...(source==='security'?[]:this.profiles.data.administration?.audit || []), ...(source==='actions'?[]:this.access.security?.audit() || [])].sort((a, b) => a.at - b.at).filter(
      (e) => !targetId || e.targetId === targetId,
    );
    const pages = Math.max(1, Math.ceil(found.length / 10));
    page = Math.min(pages, Math.max(1, Math.floor(Number(page) || 1)));
    return {
      entries: found
        .slice()
        .reverse()
        .slice((page - 1) * 10, page * 10),
      total: found.length,
      page,
      pages,
    };
  }
  transactions(targetId, page = 1, filter = "all") {
    if (!["all", "coins", "crystals", "bucks", "account", "payment"].includes(filter))
      fail("Неизвестный фильтр транзакций.");
    if (targetId === "all") return this.globalTransactions.read(page, filter);
    this.profiles.refreshCompetition();
    const p = this.profiles.byId(targetId);
    if (!p) throw new BoosterError("Игрок не найден.", 404);
    if (!["all", "coins", "crystals", "bucks", "account", "payment"].includes(filter))
      fail("Неизвестный фильтр транзакций.");
    return require("../profiles/transaction-history").page(p, page, filter, 10);
  }
  normalize(input) {
    const { action, targetId, requestId, revision } = input;
    if (
      !Object.hasOwn(labels, action) ||
      typeof targetId !== "string" ||
      targetId.length > 100 ||
      typeof requestId !== "string" ||
      !/^[a-zA-Z0-9_-]{16,80}$/.test(requestId) ||
      !Number.isSafeInteger(revision) ||
      revision < 0
    )
      fail("Некорректные параметры правки.");
    if (
      typeof input.reason !== "string" ||
      input.reason.trim().length < 3 ||
      input.reason.length > 500
    )
      fail("Укажи причину от 3 до 500 символов.");
    const command = { action, targetId, requestId, revision, reason: input.reason.trim() };
    if (["ban", "unban", "killReview"].includes(action)) {
      if (!Number.isSafeInteger(input.moderationRevision) || input.moderationRevision < 0)
        fail("Обнови сведения о блокировке.");
      command.moderationRevision = input.moderationRevision;
    }
    if (action === 'killReview') {
      if (!['confirmed','dismissed'].includes(input.verdict) || typeof input.caseId !== 'string' || !/^[a-f0-9-]{36}$/.test(input.caseId)) fail('Выбери результат проверки Kill.');
      command.verdict=input.verdict;command.caseId=input.caseId;
    }
    if (action === "ban") {
      if (
        input.minutes !== null &&
        (!Number.isSafeInteger(input.minutes) || input.minutes < 1 || input.minutes > 525600)
      )
        fail("Срок бана: от минуты до года или бессрочно.");
      command.minutes = input.minutes;
    }
    if (action === "rename") {
      if (
        typeof input.name !== "string" ||
        input.name.trim().length < 1 ||
        input.name.trim().length > 16 ||
        /[\u0000-\u001f\u007f<>]/u.test(input.name) ||
        !cleanName(input.name)
      )
        fail("Ник должен содержать от 1 до 16 символов без управляющих знаков.");
      command.name = cleanName(input.name);
    }
    if (action === "level") {
      if (!Number.isSafeInteger(input.level) || input.level < 1)
        fail("Уровень должен быть целым числом от 1.");
      try { experience.xpForLevel(input.level + 1); }
      catch { fail("Уровень превышает допустимый размер опыта."); }
      command.level = input.level;
    }
    if (action === "wallet") {
      if (
        !["coins", "crystals", "bucks"].includes(input.currency) ||
        !Number.isSafeInteger(input.amount) ||
        !input.amount ||
        Math.abs(input.amount) > 1000000
      )
        fail("Изменение валюты: целое число от −1 000 000 до 1 000 000, кроме нуля.");
      command.currency = input.currency;
      command.amount = input.amount;
    }
    if (action === "account") {
      if (
        !["vip", "premium"].includes(input.kind) ||
        !Number.isSafeInteger(input.days) ||
        input.days < 0 ||
        input.days > 365
      )
        fail("Укажи VIP или Premium и от 0 до 365 дней. Ноль отключает статус.");
      command.kind = input.kind;
      command.days = input.days;
    }
    if (action === "inventory") {
      const booster = BOOSTERS.get(input.boosterId);
      if (
        !booster ||
        !Number.isSafeInteger(input.amount) ||
        !input.amount ||
        Math.abs(input.amount) > 10000
      )
        fail("Выбери бустер и количество от −10 000 до 10 000, кроме нуля.");
      command.boosterId = input.boosterId;
      command.amount = input.amount;
    }
    return command;
  }
  apply(actor, input) {
    if (!this.access.canManagePlayers(actor))
      throw new BoosterError("Нет права менять данные игроков.", 403);
    const command = this.normalize(input);
    const signature = createHash("sha256").update(JSON.stringify(command)).digest("hex");
    const previous = this.profiles.data.administration?.receipts[command.requestId];
    if (previous) {
      if (previous.signature !== signature || (previous.actorId || this.access.ownerId) !== actor.id)
        throw new BoosterError("Номер запроса уже использован для другой правки.", 409);
      return { duplicate: true, eventId: previous.eventId, player: this.player(command.targetId) };
    }
    const current = this.profiles.byId(command.targetId);
    if (!current) throw new BoosterError("Игрок не найден.", 404);
    if (this.access.isOwner(current) && !this.access.isOwner(actor))
      throw new BoosterError("Аккаунт владельца изменяет только владелец.", 403);
    if ((command.action === "ban" || command.action === 'killReview' && command.verdict === 'confirmed') && this.access.isOwner(current))
      throw new BoosterError("Единственного владельца нельзя заблокировать.", 403);
    if (!["ban", "unban", "killReview"].includes(command.action) && this.inArena(current.id))
      throw new BoosterError("Для правки данных игрок должен выйти с арены.", 409);
    const stale = ["ban", "unban", "killReview"].includes(command.action)
      ? (current.moderation?.version || 0) !== command.moderationRevision
      : current.revision !== command.revision;
    if (stale)
      throw new BoosterError(
        "Данные игрока изменились. Обнови карточку и проверь правку заново.",
        409,
      );
    if (command.action === 'killReview' && (current.kill?.id !== command.caseId || current.kill.status !== 'new'))
      throw new BoosterError('Эта проверка уже обработана. Обнови список.',409);
    const committed = this.profiles.data, key = profileIndex.profileKeys(committed.profiles).get(current.id);
    const next = { ...committed, profiles: copyRecord(committed.profiles) },
      p = next.profiles[key] = copyProfile(current),
      at = this.now(),
      eventId = randomUUID();
    if (committed.administration) next.administration = {
      ...committed.administration,
      audit: [...committed.administration.audit],
      receipts: { ...committed.administration.receipts },
    };
    let before, after;
    switch (command.action) {
      case 'killReview': {
        before={case:p.kill,ban:p.moderation?.ban||null};
        p.kill={...p.kill,status:command.verdict,reviewedAt:at,reviewedBy:actor.id,reviewReason:command.reason};
        let ban=p.moderation?.ban||null;
        if(command.verdict==='confirmed' && (!ban || ban.until!==null && ban.until<at+180*86400000))ban={reason:'Нарушение правил игры по пункту 3.2',at,until:at+180*86400000,by:actor.id,id:newBanId(next),byName:this.access.isOwner(actor)?'Killex':actor.name||actor.login||'Модератор'};
        p.moderation={...p.moderation,ban,version:(p.moderation?.version||0)+1};after={case:p.kill,ban};break;
      }
      case "ban":
      case "unban":
        before = p.moderation?.ban ? { ...p.moderation.ban, id: banId(p, next) } : null;
        after =
          command.action === "unban"
            ? null
            : {
                reason: command.reason,
                at,
                by: actor.id,
                id: newBanId(next),
                byName: this.access.isOwner(actor) ? "Killex"
                  : this.access.security?.account(actor.id)?.name || actor.name || actor.login,
                until: command.minutes === null ? null : at + command.minutes * 60000,
              };
        p.moderation = { ban: after, version: (p.moderation?.version || 0) + 1 };
        break;
      case "rename":
        require("./reserved-name").requireAllowedName(p.id, command.name, this.access.ownerId);
        require("../profiles/nickname-rules").requireAvailable(
          Object.values(next.profiles),
          command.name,
          p.id,
        );
        before = p.name;
        after = p.name = command.name;
        break;
      case "level": {
        if (p.progress.session || p.quests?.session)
          throw new BoosterError("Дождись сохранения прогресса арены и обнови карточку.", 409);
        if (p.clanId && command.level < 12)
          fail("Участнику клана нельзя установить уровень ниже 12. Сначала игрок должен выйти из клана.");
        if (p.level === command.level)
          throw new BoosterError("У игрока уже установлен этот уровень.", 409);
        before = { level: p.level, xp: p.progress.xp };
        p.level = command.level;
        p.progress.xp = experience.xpForLevel(command.level);
        p.progress.arenaXpTarget = null;
        if (p.progress.levelOffers) p.progress.levelOffers = Object.fromEntries(
          Object.entries(p.progress.levelOffers).filter(([level]) => Number(level) <= p.level));
        // Administrative changes are not earned levels: no deferred roulette
        // tickets on the next arena event, including after lowering and raising.
        p.roulette.levelGrantedThrough = Math.max(p.roulette.levelGrantedThrough, p.level);
        if (p.quickSlots) p.quickSlots = p.quickSlots.map((id, i) =>
          id && ((i === 3 && p.level < 12) || !loadout.itemAllowed(BOOSTERS.get(id), p.level)) ? null : id);
        after = { level: p.level, xp: p.progress.xp };
        experience.validateProgress(p);
        require("../roulette/roulette-service").validate(p);
        break;
      }
      case "wallet":
        before = { [command.currency]: p.wallet[command.currency] };
        const balance = p.wallet[command.currency] + command.amount;
        if (!Number.isSafeInteger(balance) || balance < 0)
          fail("Баланс после правки не может быть отрицательным или превышать допустимое число.");
        after = { [command.currency]: balance };
        p.wallet[command.currency] = balance;
        break;
      case "account":
        p.account ||= accounts.fresh();
        const key = command.kind + "Until";
        before = { [key]: p.account[key] };
        p.account[key] = command.days ? Math.max(at, p.account[key]) + command.days * 86400000 : 0;
        if (!Number.isSafeInteger(p.account[key])) fail("Недопустимый срок аккаунта.");
        after = { [key]: p.account[key] };
        accounts.validate(p);
        break;
      case "inventory":
        before = { [command.boosterId]: p.inventory[command.boosterId] || 0 };
        const count = before[command.boosterId] + command.amount;
        if (!Number.isSafeInteger(count) || count < 0) fail("Недостаточно бустеров для списания.");
        p.inventory[command.boosterId] = count;
        after = { [command.boosterId]: count };
        if (!count && p.quickSlots)
          p.quickSlots = p.quickSlots.map((id) => (id === command.boosterId ? null : id));
        break;
    }
    if (JSON.stringify(before) === JSON.stringify(after))
      throw new BoosterError("Эта правка не меняет данные.", 409);
    p.revision++;
    const administration = (next.administration ||= { version: 1, audit: [], receipts: {} });
    const event = {
      id: eventId,
      at,
      actorId: actor.id,
      actorName: actor.login || actor.name || "owner",
      targetId: p.id,
      targetName: p.name,
      action: command.action,
      label: labels[command.action],
      reason: command.reason,
      before,
      after,
      requestId: command.requestId,
      ...(command.action === "ban" ? { banId: after.id } : {}),
    };
    require('./adjustment-notices').append(next, p, event, command, this.access.isOwner(actor) ? 'Killex' : this.access.security.account(actor.id).name);
    administration.audit.push(event);
    administration.receipts[command.requestId] = { signature, eventId: event.id, actorId: actor.id };
    validateWorld(next);
    validate(next);
    tableDeltas.remember(next.profiles, committed.profiles, [key], true);
    profileIndex.remember(next.profiles, profileIndex.profileKeys(committed.profiles));
    this.profiles.save(next, at, {
      kind: "admin",
      label: labels[command.action] + (this.access.isOwner(actor) ? " владельцем" : " модератором " + actor.login),
      actorId: actor.id,
      requestId: command.requestId,
      detail: command.reason,
    }); // Данные, оба журнала и защита от повтора фиксируются одной атомарной заменой.
    return { duplicate: false, eventId: event.id, player: this.player(p.id) };
  }
}
module.exports = { OwnerService };
