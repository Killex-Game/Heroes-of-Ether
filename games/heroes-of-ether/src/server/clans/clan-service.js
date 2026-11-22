/* Создание кланов, состав, роли, заявки, казна и оружейная. */
"use strict";
const activity = require("../progression/activity-achievements");
const { randomUUID, createHash } = require("node:crypto");
const { BoosterError, BOOSTERS } = require("../boosters/booster-catalog");
const { validSkin } = require("../../../public/shared/player-identity");
const { clanProgress, clanCapacity } = require("./clan-level-progress");
const competition = require("./clan-competition-service");
const {
  trophyBenefits,
  discountedPrice,
} = require("../../../public/shared/clan-competition-rules");
const crestKit = require("../../../public/shared/clan-crest-rules");
const appearanceTestAccess = require("../profiles/appearance-test-access");
const clanAppearance = require("./clan-appearance");
const memberHistory = require("./member-history");
const CLAN_RULES = Object.freeze({
  createCost: 1500,
  renameCost: 50,
  applicationCost: 50,
  minLevel: 12,
  initialCapacity: 15,
  maxCapacity: 50,
  maxApplications: 5,
  prefixMin: 1,
  prefixMax: 4,
});
const ROLES = Object.freeze({
  head: "Глава",
  manager: "Управляющий",
  officer: "Офицер",
  member: "Участник",
  recruit: "Новобранец",
});
const roleOf = (clan, id, at = Date.now()) =>
  clan?.members.includes(id)
    ? clan.competition?.recruits[id] > at
      ? "recruit"
      : clan.ownerId === id
        ? "head"
        : clan.roles?.[id] || "member"
    : null;
const power = (role) => ({ head: 3, manager: 2, officer: 1, member: 0, recruit: 0 })[role] ?? -1;
const permissions = (clan, id, at) => {
  const role = roleOf(clan, id, at);
  return {
    role,
    editBasics: role === "head",
    edit: power(role) >= 2,
    recruit: power(role) >= 1,
    buy: power(role) >= 2,
    transfer: role === "head",
  };
};
const fail = (message) => {
  throw new BoosterError(message, 409);
};
function prefixValue(value) {
  if (typeof value !== "string") fail("Префикс должен содержать от 1 до 4 символов.");
  const prefix = value.normalize("NFKC").trim();
  if (
    Array.from(prefix).length < 1 ||
    Array.from(prefix).length > 4 ||
    /[\s\[\]\p{C}\p{M}]/u.test(prefix)
  )
    fail("Префикс: 1–4 символа, без пробелов, скобок и скрытых знаков.");
  return prefix;
}
const prefixKey = (value) => prefixValue(value).toLocaleUpperCase("ru-RU");
const clanAt = (data, id) =>
  typeof id === "string" && Object.hasOwn(data.clans, id) ? data.clans[id] : null;
function mutationWriteSet(player, data, input) {
  const own = clanAt(data, player.clanId), target = clanAt(data, input.clanId);
  const profileIds = new Set(), clanIds = new Set();
  // The existing identity refresh below updates every member of the actor's
  // clan, even when only its treasury or appearance changes.
  if (own) {
    clanIds.add(own.id);
    for (const id of own.members) profileIds.add(id);
  }
  if (["apply", "cancel"].includes(input.action) && target) clanIds.add(target.id);
  if (["accept", "reject", "kick", "transfer", "role"].includes(input.action))
    profileIds.add(input.memberId);
  if (input.action === "disband" && own)
    for (const id of own.applications) profileIds.add(id);
  const joining = input.action === "apply" && target?.privacy === "open";
  if (joining) for (const id of target.members) profileIds.add(id);
  const applicantId = input.action === "accept" ? input.memberId
    : input.action === "create" || joining ? player.id : null;
  if (applicantId) for (const clan of Object.values(data.clans))
    if (clan.applications.includes(applicantId)) clanIds.add(clan.id);
  return { profileIds: [...profileIds], clanIds: [...clanIds], profileDraft: "clan" };
}
function clanFields(input) {
  const prefix = prefixValue(input.prefix);
  const name = typeof input.name === "string" ? input.name.normalize("NFKC").trim() : "";
  const description = typeof input.description === "string" ? input.description.trim() : "";
  if (Array.from(name).length < 2 || Array.from(name).length > 32 || /[\p{C}\[\]]/u.test(name))
    fail("Название: 2–32 символа, без скобок и скрытых знаков.");
  if (Array.from(description).length > 180 || /[\p{C}]/u.test(description))
    fail("Описание: до 180 символов в одну строку.");
  if (!["astral", "grove"].includes(input.emblem)) fail("Выбери герб из каталога.");
  const privacy = input.privacy ?? "open";
  if (!["open", "closed"].includes(privacy)) fail("Выбери открытый или закрытый клан.");
  let crest;
  try {
    crest = crestKit.normalize(input.crest);
  } catch (error) {
    fail(error.message);
  }
  return { prefix, name, description, emblem: input.emblem, privacy, crest };
}
function validateWorld(data, { allowRetiredSkins = false } = {}) {
  const broken = () => {
    throw Error("Повреждены профили или кланы. Файл сохранений не перезаписан.");
  };
  if (!data.clans || typeof data.clans !== "object" || Array.isArray(data.clans)) broken();
  const profiles = new Map(Object.values(data.profiles).map((p) => [p.id, p]));
  if (profiles.size !== Object.keys(data.profiles).length) broken();
  for (const p of profiles.values()) {
    if (
      typeof p.name !== "string" ||
      !p.name ||
      !validSkin(allowRetiredSkins ? require("../../../public/shared/player-identity").currentSkinId(p.skinId) : p.skinId) ||
      !Number.isSafeInteger(p.level) ||
      p.level < 1 ||
      !Number.isSafeInteger(p.greatness) ||
      p.greatness < 0 ||
      (p.quickSlots !== null &&
        (!Array.isArray(p.quickSlots) ||
          p.quickSlots.length > 7 /* старое сохранение до удаления седьмого слота */ ||
          new Set(p.quickSlots.filter(Boolean)).size !== p.quickSlots.filter(Boolean).length ||
          p.quickSlots.some((id) => id !== null && !BOOSTERS.get(id)?.ready)))
    )
      broken();
  }
  const keys = new Set();
  for (const [id, clan] of Object.entries(data.clans)) {
    clanAppearance.validate(clan);
    memberHistory.validate(clan);
    require("./battle-history").validate(clan);
    if (data.version >= 7) {
      if (
        !Number.isSafeInteger(clan.xp) ||
        clan.xp < 0 ||
        !["open", "closed"].includes(clan.privacy) ||
        !clan.roles ||
        typeof clan.roles !== "object" ||
        Array.isArray(clan.roles) ||
        !Array.isArray(clan.members) ||
        Object.keys(clan.roles).length !== clan.members.length ||
        clan.members.some(
          (member) =>
            !Object.hasOwn(clan.roles, member) ||
            (member === clan.ownerId
              ? clan.roles[member] !== "head"
              : !["manager", "officer", "member"].includes(clan.roles[member])),
        )
      )
        broken();
      if (
        !clan.applicationFees ||
        typeof clan.applicationFees !== "object" ||
        Array.isArray(clan.applicationFees) ||
        !Array.isArray(clan.applications) ||
        Object.keys(clan.applicationFees).length !== clan.applications.length ||
        clan.applications.some(
          (id) =>
            !Object.hasOwn(clan.applicationFees, id) || ![0, 50].includes(clan.applicationFees[id]),
        )
      )
        broken();
    }
    if (clan.treasury !== undefined && (!Number.isSafeInteger(clan.treasury) || clan.treasury < 0))
      broken();
    try {
      clanFields(clan);
    } catch (_) {
      broken();
    }
    const key = prefixKey(clan.prefix);
    if (
      id !== clan.id ||
      keys.has(key) ||
      !Array.isArray(clan.members) ||
      clan.members.length < 1 ||
      // Existing members survive a level rebalance. Both joining routes still enforce
      // the current XP-based capacity, so overflow cannot admit new members.
      clan.members.length > CLAN_RULES.maxCapacity ||
      ![15, 20, 25, 30, 35, 40, 50].includes(clan.capacity) ||
      new Set(clan.members).size !== clan.members.length ||
      !clan.members.includes(clan.ownerId) ||
      !Number.isSafeInteger(clan.createdAt) ||
      !Array.isArray(clan.applications) ||
      new Set(clan.applications).size !== clan.applications.length ||
      clan.members.some((member) => profiles.get(member)?.clanId !== id) ||
      clan.applications.some(
        (applicant) => !profiles.has(applicant) || profiles.get(applicant).clanId,
      )
    )
      broken();
    keys.add(key);
  }
  for (const p of profiles.values())
    if (p.clanId !== null && !data.clans[p.clanId]?.members.includes(p.id)) broken();
}
class ClanService {
  constructor(profiles) {
    this.profiles = profiles;
  }
  publicClan(clan) {
    if (!clan) return null;
    const members = clan.members.map((id) => this.profiles.byId(id));
    return {
      id: clan.id,
      name: clan.name,
      prefix: clan.prefix,
      description: clan.description,
      emblem: clan.emblem,
      ownerId: clan.ownerId,
      count: members.length,
      capacity: clanCapacity(clan.xp),
      privacy: clan.privacy,
      crest: clan.crest || null,
      progress: clanProgress(clan.xp),
      frame: clanAppearance.selectedFrame(clan),
      appearance: clanAppearance.view(
        clan,
        this.profiles.now(),
        this.profiles.unlockLeagueBackgrounds,
      ),
      greatness: members.reduce((sum, p) => sum + p.greatness, 0),
    };
  }
  player(p) {
    return {
      id: p.id,
      ...this.profiles.identity(p),
      greatness: p.greatness,
      totalXp: p.progress.xp,
    };
  }
  // A separate projection: viewing another clan never grants its member-only data.
  preview(token, clanId) {
    if (!this.profiles.find(token)) throw new BoosterError("Сначала открой лобби.", 401);
    this.profiles.refreshCompetition();
    const data = this.profiles.data, clan = data.clans[clanId];
    if (!clan || typeof clanId !== "string" || !Object.hasOwn(data.clans, clanId))
      throw new BoosterError("Клан больше не существует.", 404);
    const at = this.profiles.now();
    return {
      clan: {
        ...this.publicClan(clan),
        members: clan.members.map((id) => ({
          ...this.player(this.profiles.byId(id)),
          role: roleOf(clan, id, at),
          kills: competition.memberScore(data.competition?.day, clan, id),
        })),
      },
      competition: competition.publicState(data, clan, at, ["preview"]),
    };
  }
  details(clan, viewer) {
    if (!clan) return null;
    const rights = permissions(clan, viewer.id, this.profiles.now());
    return {
      ...this.publicClan(clan),
      permissions: rights,
      members: clan.members.map((id) => {
        const role = roleOf(clan, id, this.profiles.now()),
          other = id !== viewer.id;
        return {
          ...this.player(this.profiles.byId(id)),
          role,
          canJoinArena: other && viewer.clanId === clan.id && !!this.profiles.clanArenaFor?.(viewer.id, id),
          canKick: other && power(rights.role) > power(role),
          canTransfer: other && rights.transfer && role !== "recruit",
          assignableRoles:
            other &&
            role !== "recruit" &&
            (rights.role === "head" || (rights.role === "manager" && power(role) < 2))
              ? rights.role === "head"
                ? ["manager", "officer", "member"]
                : ["officer", "member"]
              : [],
        };
      }),
      treasury: viewer.clanId === clan.id ? clan.treasury || 0 : undefined,
      requested: clan.applications.includes(viewer.id),
      applicationFee: clan.applicationFees[viewer.id] ?? null,
      applications: rights.recruit
        ? clan.applications.map((id) => this.player(this.profiles.byId(id)))
        : [],
    };
  }
  applications(profile) {
    return Object.values(this.profiles.data.clans)
      .filter((c) => c.applications.includes(profile.id))
      .map((c) => this.publicClan(c));
  }
  shop(profile) {
    const { discount } = trophyBenefits(this.profiles.data.clans[profile.clanId]);
    return [...BOOSTERS.values()]
      .filter((b) => b.tier === "clan")
      .map(({ id, name, icon, effect, price }) => ({
        id,
        name,
        icon,
        effect,
        discount,
        basePrice: price.amount,
        price: { ...price, amount: discountedPrice(price.amount, discount) },
      }));
  }
  clanData(profile, selected = "") {
    return {
      profile: this.profiles.view(profile),
      rules: {
        ...CLAN_RULES,
        testCrests: this.profiles.unlockClanCrests || appearanceTestAccess.all(profile),
      },
      competition: profile.clanId
        ? competition.publicState(
            this.profiles.data,
            this.profiles.data.clans[profile.clanId],
            this.profiles.now(),
          )
        : null,
      shop: this.shop(profile),
      mine: this.details(clanAt(this.profiles.data, profile.clanId), profile),
      selected:
        selected === profile.clanId
          ? this.details(clanAt(this.profiles.data, selected), profile)
          : null,
      applications: this.applications(profile),
    };
  }
  updates(token, parts, known = {}) {
    if (
      !Array.isArray(parts) ||
      parts.some((p) => !["battle", "league", "members"].includes(p)) ||
      !known ||
      typeof known !== "object" ||
      Array.isArray(known)
    )
      throw new BoosterError("Некорректный запрос обновлений клана.", 400);
    this.profiles.refreshCompetition();
    const profile = this.profiles.find(token);
    if (!profile) throw new BoosterError("Сначала открой лобби.", 401);
    const clan = clanAt(this.profiles.data, profile.clanId),
      at = this.profiles.now();
    const changes = {},
      versions = {};
    const publish = (key, value) => {
      const version = createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 16);
      versions[key] = version;
      if (known[key] !== version) changes[key] = value;
    };
    publish("profile", { profile: this.profiles.view(profile) });
    for (const part of new Set(parts)) {
      if (part === "members") {
        const details = this.details(clan, profile);
        if (!details) {
          publish("members", {
            mine: null,
            competition: null,
            applications: this.applications(profile),
          });
          continue;
        }
        const {
          members,
          permissions,
          count,
          capacity,
          progress,
          greatness,
          treasury,
          requested,
          applicationFee,
          applications,
          ...identity
        } = details;
        publish("members", {
          mine: {
            members,
            permissions,
            count,
            capacity,
            progress,
            greatness,
            treasury,
            requested,
            applicationFee,
            applications,
          },
          applications: this.applications(profile),
        });
        publish("identity", {
          mine: identity,
          shop: this.shop(profile),
          competition: competition.publicState(this.profiles.data, clan, at, ["identity"]),
        });
      } else
        publish(part, {
          competition: clan ? competition.publicState(this.profiles.data, clan, at, [part]) : null,
        });
    }
    return { clanId: profile.clanId, changes, versions };
  }
  state(
    token,
    search = "",
    page = 1,
    selected = "",
    playerOrder = "greatness",
    playerPage = 1,
    clanOrder = "greatness",
    scope = "all",
    playerSearch = "",
  ) {
    this.profiles.refreshCompetition();
    const profile = this.profiles.find(token);
    if (!profile) throw new BoosterError("Сначала открой лобби.", 401);
    if (scope === "clan") return this.clanData(profile, selected);
    const query = String(search).trim().slice(0, 64).toLocaleLowerCase("ru");
    const clanSort = ["greatness", "level", "treasury"].includes(clanOrder)
      ? clanOrder
      : "greatness";
    const clanScore = (c) =>
      clanSort === "level"
        ? c.progress.totalXp
        : clanSort === "treasury"
          ? c.treasury
          : c.greatness;
    const clans = Object.values(this.profiles.data.clans)
      .map((c) => ({ ...this.publicClan(c), treasury: c.treasury || 0, createdAt: c.createdAt }))
      .sort(
        (a, b) =>
          clanScore(b) - clanScore(a) || a.createdAt - b.createdAt || a.id.localeCompare(b.id),
      )
      .map((c, i) => ({ ...c, rank: i + 1 }))
      .filter((c) => (c.name + " " + c.prefix).toLocaleLowerCase("ru").includes(query));
    const pages = Math.max(1, Math.ceil(clans.length / 10)),
      currentPage = Math.max(1, Math.min(pages, Number.isInteger(Number(page)) ? Number(page) : 1));
    const daily = require("../rankings/daily-leaderboards"),
      at = this.profiles.now();
    const order = Object.hasOwn(daily.METRICS, playerOrder)
      ? playerOrder
      : playerOrder === "level"
        ? "level"
        : "greatness";
    const metric = daily.METRICS[order];
    const scores = new Map(
      Object.values(this.profiles.data.profiles).map((p) => [
        p.id,
        metric ? daily.current(p, at)[metric] : order === "level" ? p.level : p.greatness,
      ]),
    );
    const players = Object.values(this.profiles.data.profiles).sort(
      (a, b) =>
        scores.get(b.id) - scores.get(a.id) ||
        (!metric && b.progress.xp - a.progress.xp) ||
        a.id.localeCompare(b.id),
    );
    const playerQuery = String(playerSearch).trim().slice(0, 64);
    const needle = playerQuery.normalize("NFC").toLocaleLowerCase("ru");
    const matchingRanks = [];
    if (needle) players.forEach((p, i) => {
      if (p.name.normalize("NFC").toLocaleLowerCase("ru").includes(needle)) matchingRanks.push(i);
    });
    const playerMatches = needle ? matchingRanks.length : players.length;
    const playerPages = Math.max(1, Math.ceil(playerMatches / 10));
    const currentPlayerPage = Math.max(
      1,
      Math.min(playerPages, Number.isInteger(Number(playerPage)) ? Number(playerPage) : 1),
    );
    return {
      ...(scope === "rankings"
        ? {
            profile: this.profiles.view(profile),
            rules: {
              ...CLAN_RULES,
              testCrests: this.profiles.unlockClanCrests || appearanceTestAccess.all(profile),
            },
            mine: profile.clanId ? { id: profile.clanId } : null,
            applications: this.applications(profile),
          }
        : this.clanData(profile, selected)),
      clans: clans.slice((currentPage - 1) * 10, currentPage * 10),
      clanOrder: clanSort,
      page: currentPage,
      pages,
      total: clans.length,
      playerOrder: order,
      playerPage: currentPlayerPage,
      playerPages,
      playerSearch: playerQuery,
      playerMatches,
      playerTotal: players.length,
      eventRanking: require("../rankings/event-leaderboards").view(
        this.profiles,
        profile,
        playerPage,
      ),
      dailyResetAt: daily.nextReset(at),
      dailyPrizeTickets: daily.eventDay(this.profiles.events, daily.dayAt(at)),
      myRank: players.findIndex((p) => p.id === profile.id) + 1,
      playerLeaders: (needle ? matchingRanks.slice((currentPlayerPage - 1) * 10, currentPlayerPage * 10)
        : Array.from({ length: Math.min(10, Math.max(0, players.length - (currentPlayerPage - 1) * 10)) },
          (_, i) => (currentPlayerPage - 1) * 10 + i))
        .map((rank) => ({
          ...this.player(players[rank]),
          dailyScore: metric ? scores.get(players[rank].id) : undefined,
          rank: rank + 1,
        })),
    };
  }
  mutate(token, input) {
    const { action, requestId } = input;
    if (
      ![
        "create",
        "edit",
        "apply",
        "cancel",
        "accept",
        "reject",
        "leave",
        "kick",
        "transfer",
        "role",
        "disband",
        "deposit",
        "buyBooster",
        "frame",
        "background",
      ].includes(action)
    )
      fail("Неизвестное действие клана.");
    const suppliedFields = ["create", "edit"].includes(action)
      ? Object.fromEntries(
          ["name", "prefix", "description", "emblem", "privacy", "crest"]
            .filter((k) => input[k] !== undefined)
            .map((k) => [k, input[k]]),
        )
      : null;
    const signature = JSON.stringify([
      "clan",
      action,
      input.clanId,
      input.memberId,
      suppliedFields,
      input.amount,
      input.boosterId,
      input.role,
      input.frame,
      ...(action === "background" ? [input.themeId] : []),
    ]);
    return this.profiles.transactWorld(token, requestId, signature, (p, data) => {
      const history = require("../profiles/transaction-history");
      const setBalance = (target, currency, amount, label) => {
        const before = history.snapshot(target);
        target.wallet[currency] = amount;
        history.record(target, before, this.profiles.now(), {
          kind: "clan",
          label,
          requestId,
          actorId: p.id,
        });
      };
      const clan = clanAt(data, input.clanId);
      const own = clanAt(data, p.clanId);
      const fields =
        action === "create"
          ? clanFields(input)
          : action === "edit"
            ? clanFields({ ...own, ...suppliedFields })
            : null;
      const rights = permissions(own, p.id, this.profiles.now());
      const member = (id) => this.profiles.byId(id, data);
      const removeApplication = (c, id, refund) => {
        if (!c.applications.includes(id)) return;
        const target = member(id),
          fee = c.applicationFees[id];
        if (refund && fee) {
          const balance = target.wallet.coins + fee;
          if (!Number.isSafeInteger(balance)) fail("Баланс монет достиг предела.");
          setBalance(target, "coins", balance, "Возврат платы за заявку в клан");
          target.revision++;
        }
        c.applications = c.applications.filter((x) => x !== id);
        delete c.applicationFees[id];
      };
      const clearApplications = (id) => {
        for (const c of Object.values(data.clans)) removeApplication(c, id, true);
      };
      const headOnly = () => {
        if (!own || own.id !== input.clanId || own.ownerId !== p.id)
          fail("Это действие доступно только главе своего клана.");
      };
      const requireRight = (key) => {
        if (!own || own.id !== input.clanId || !rights[key])
          fail("Недостаточно прав в своём клане: обратитесь к главе.");
      };
      const unique = (excluding) => {
        if (
          Object.values(data.clans).some(
            (c) => c.id !== excluding && prefixKey(c.prefix) === prefixKey(fields.prefix),
          )
        )
          fail("Этот префикс уже занят. Регистр букв не различается.");
      };
      if (
        ["create", "edit"].includes(action) &&
        !this.profiles.unlockClanCrests &&
        !appearanceTestAccess.all(p) &&
        crestKit.requiredCrestLevel(fields.crest) >
          (action === "edit" ? clanProgress(own.xp).level : 1)
      )
        fail(
          `Выбранный элемент герба доступен с ${crestKit.requiredCrestLevel(fields.crest)} уровня клана.`,
        );
      if (action === "background") {
        headOnly();
        clanAppearance.update(
          own,
          input.themeId,
          this.profiles.now(),
          this.profiles.unlockLeagueBackgrounds,
        );
      } else if (action === "frame") {
        headOnly();
        const state = competition.clanState(own);
        const preview = appearanceTestAccess.all(p) && input.frame === "champion";
        if (input.frame !== null && !state.frames.includes(input.frame) && !preview)
          fail("Это оформление ещё не получено.");
        own.appearance ||= { background: "default", grants: {}, grantVersion: 2 };
        own.appearance.testFrame =
          preview && !state.frames.includes(input.frame) ? input.frame : null;
        state.frame = own.appearance.testFrame ? null : input.frame;
      } else if (action === "create") {
        if (p.clanId) fail("Сначала выйди из текущего клана.");
        if (p.level < CLAN_RULES.minLevel) fail("Создание клана доступно с 12 уровня.");
        unique();
        if (p.wallet.coins < CLAN_RULES.createCost) fail("Для создания клана нужно 1500 монет.");
        const id = randomUUID();
        setBalance(p, "coins", p.wallet.coins - CLAN_RULES.createCost, "Создание клана");
        p.clanId = id;
        clearApplications(p.id);
        activity.spend(p, "coins", CLAN_RULES.createCost, this.profiles.now());
        data.clans[id] = {
          id,
          ...fields,
          ownerId: p.id,
          members: [p.id],
          roles: { [p.id]: "head" },
          xp: 0,
          applications: [],
          applicationFees: {},
          treasury: 0,
          capacity: CLAN_RULES.initialCapacity,
          createdAt: Date.now(),
        };
        memberHistory.append(data.clans[id], "created", p, p, this.profiles.now(), null, "head");
      } else if (action === "edit") {
        requireRight("edit");
        const changedCrest =
          !crestKit.equal(fields.crest, own.crest) || fields.emblem !== own.emblem;
        const renamed = fields.name !== own.name || fields.prefix !== own.prefix;
        if (!rights.editBasics && (changedCrest || renamed))
          fail("Название, префикс и герб меняет только глава.");
        unique(own.id);
        const editCost =
          (changedCrest ? crestKit.EDIT_COST : 0) + (renamed ? CLAN_RULES.renameCost : 0);
        if (p.wallet.crystals < editCost)
          fail(`Для сохранения изменений нужно ${editCost} кристаллов.`);
        if (editCost) {
          setBalance(p, "crystals", p.wallet.crystals - editCost, "Изменение оформления клана");
          activity.spend(p, "crystals", editCost, this.profiles.now());
        }
        Object.assign(own, fields);
      } else if (action === "apply") {
        if (p.clanId) fail("Ты уже состоишь в клане.");
        if (!clan) fail("Клан больше не существует.");
        if (p.level < CLAN_RULES.minLevel) fail("Вступление в клан доступно с 12 уровня.");
        if (clan.members.length >= clanCapacity(clan.xp)) fail("В клане нет свободных мест.");
        if (clan.applications.includes(p.id)) fail("Заявка уже отправлена.");
        if (
          clan.privacy === "closed" &&
          Object.values(data.clans).filter((c) => c.applications.includes(p.id)).length >=
            CLAN_RULES.maxApplications
        )
          fail("Можно иметь не больше пяти ожидающих заявок.");
        if (p.wallet.coins < CLAN_RULES.applicationCost)
          fail("Для отправки заявки нужно 50 монет.");
        setBalance(
          p,
          "coins",
          p.wallet.coins - CLAN_RULES.applicationCost,
          "Плата за заявку в клан",
        );
        if (clan.privacy === "open") {
          activity.spend(p, "coins", CLAN_RULES.applicationCost, this.profiles.now());
          p.clanId = clan.id;
          clan.members.push(p.id);
          clan.roles[p.id] = "member";
          memberHistory.append(clan, "joined", p, p, this.profiles.now());
          clearApplications(p.id);
          for (const id of clan.members) if (id !== p.id) member(id).revision++;
        } else {
          clan.applications.push(p.id);
          clan.applicationFees[p.id] = CLAN_RULES.applicationCost;
        }
      } else if (action === "cancel") {
        if (!clan?.applications.includes(p.id)) fail("Этой заявки уже нет.");
        removeApplication(clan, p.id, true);
      } else if (action === "accept" || action === "reject") {
        requireRight("recruit");
        const target = member(input.memberId);
        if (!target || !own.applications.includes(target.id)) fail("Заявка уже обработана.");
        if (action === "accept") {
          if (target.clanId || own.members.length >= clanCapacity(own.xp))
            fail("Игрок уже вступил в клан или нет свободных мест.");
          if (target.level < CLAN_RULES.minLevel) fail("Для вступления игроку нужен 12 уровень.");
          target.clanId = own.id;
          target.revision++;
          own.members.push(target.id);
          own.roles[target.id] = "member";
          memberHistory.append(own, "accepted", p, target, this.profiles.now());
          activity.spend(target, "coins", own.applicationFees[target.id], this.profiles.now());
          removeApplication(own, target.id, false);
          clearApplications(target.id);
        } else removeApplication(own, target.id, true);
      } else if (action === "leave") {
        if (!own || own.id !== input.clanId) fail("Ты не состоишь в этом клане.");
        if (own.ownerId === p.id) fail("Сначала передай главу участнику или распусти клан.");
        memberHistory.append(own, "left", p, p, this.profiles.now());
        own.members = own.members.filter((id) => id !== p.id);
        delete own.roles[p.id];
        p.clanId = null;
      } else if (["kick", "transfer", "role"].includes(action)) {
        if (!own || own.id !== input.clanId) fail("Действие доступно в своём клане.");
        const target = member(input.memberId);
        if (!target || target.id === p.id || target.clanId !== own.id)
          fail("Выбери другого участника своего клана.");
        const previousRole = roleOf(own, target.id, this.profiles.now());
        if (
          ["transfer", "role"].includes(action) &&
          roleOf(own, target.id, this.profiles.now()) === "recruit"
        )
          fail("Новобранец станет участником после окончания дня.");
        if (action === "transfer") {
          headOnly();
          own.roles[p.id] = "member";
          own.roles[target.id] = "head";
          own.ownerId = target.id;
          memberHistory.append(own, "transfer", p, target, this.profiles.now(), previousRole, "head");
        } else if (action === "role") {
          if (
            !["manager", "officer", "member"].includes(input.role) ||
            !(
              rights.role === "head" ||
              (rights.role === "manager" &&
                power(roleOf(own, target.id)) < 2 &&
                power(input.role) < 2)
            )
          )
            fail("Назначение этой роли доступно только главе.");
          own.roles[target.id] = input.role;
          if (previousRole !== input.role)
            memberHistory.append(own, "role", p, target, this.profiles.now(), previousRole, input.role);
        } else {
          if (power(rights.role) <= power(roleOf(own, target.id)))
            fail("Нельзя исключать равных или старших по роли. Обратитесь к главе.");
          target.clanId = null;
          own.members = own.members.filter((id) => id !== target.id);
          delete own.roles[target.id];
          memberHistory.append(own, "kicked", p, target, this.profiles.now(), previousRole);
        }
        target.revision++;
      } else if (action === "deposit") {
        if (!own || own.id !== input.clanId) fail("Взнос доступен участнику своего клана.");
        if (!Number.isSafeInteger(input.amount) || input.amount <= 0)
          fail("Укажи целое положительное количество эфира.");
        if (p.wallet.bucks < input.amount) fail("Недостаточно эфира");
        const total = (own.treasury || 0) + input.amount;
        if (!Number.isSafeInteger(total)) fail("Казна достигла предела.");
        setBalance(p, "bucks", p.wallet.bucks - input.amount, "Взнос в казну клана");
        own.treasury = total;
        activity.deposit(p, input.amount, this.profiles.now());
      } else if (action === "buyBooster") {
        requireRight("buy");
        const b = BOOSTERS.get(input.boosterId);
        if (!b?.ready || b.tier !== "clan") fail("Выбери бустер из магазина клана.");
        const amount = discountedPrice(b.price.amount, trophyBenefits(own).discount);
        if ((own.treasury || 0) < amount) fail("Недостаточно эфира в казне.");
        for (const id of own.members) {
          const recipient = member(id),
            count = (recipient.inventory[b.id] || 0) + b.price.quantity;
          if (!Number.isSafeInteger(count)) fail("Инвентарь участника достиг предела.");
          recipient.inventory[b.id] = count;
        }
        own.treasury -= amount;
        require("../events/black-friday").activity(p, this.profiles.events, { purchasedBoosters: b.price.quantity }, this.profiles.now());
      } else if (action === "disband") {
        headOnly();
        for (const id of [...own.applications]) removeApplication(own, id, true);
        for (const id of own.members) {
          const recipient = member(id);
          recipient.clanId = null;
          if (id !== p.id) recipient.revision++;
        }
        delete data.clans[own.id];
      }
      // Изменение префикса/состава обновляет клиентские профили всех участников.
      if (own && data.clans[own.id])
        for (const id of own.members) if (id !== p.id) member(id).revision++;
    }, (player, data) => mutationWriteSet(player, data, input));
  }
}
module.exports = {
  ClanService,
  CLAN_RULES,
  ROLES,
  roleOf,
  permissions,
  validateWorld,
  prefixValue,
  prefixKey,
};
