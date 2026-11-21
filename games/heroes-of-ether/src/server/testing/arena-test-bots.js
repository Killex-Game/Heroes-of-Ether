/* Тестовые кланы, составы и боты, активные при присутствии живого игрока. */
"use strict";
// Local test population. No sockets, external services, background kills or admin API.
const fs = require("node:fs");
const { randomUUID } = require("node:crypto");
const { ProfileStore } = require("../profiles/profile-store");
const { validateWorld } = require("../clans/clan-service");
const { freshProgress } = require("../progression/experience-progression");
const crests = require("../../../public/shared/clan-crest-rules");
const { skins } = require("../../../public/shared/player-identity");
const accounts = require("../accounts/account-benefits");
const { radiusForMass } = require("../arena/arena-simulation");
const { BotBrain } = require("./arena-bot-brain");
const { activeBan } = require("../admin/moderation");
const nicknames = require("../profiles/nickname-rules");
const { MARKER, assignBotGender } = require("./bot-identity");
const MAX_ACTIVE_BOTS = 30;
const independentRosters = new WeakMap();
function independentBots(profiles, at) {
  let cached = independentRosters.get(profiles);
  if (!cached || at < cached.at || at - cached.at >= 1000) {
    // One bounded roster refresh per store/second, shared by all rooms.
    // Beginner bots are real clanless profiles, not fictitious clan members.
    cached = { at, rows: Object.values(profiles.data.profiles)
      .filter(p => p.testBot === MARKER && !p.clanId)
      .map(p => ({id: 'bot:' + p.id, members: [p.id], independent: true})) };
    independentRosters.set(profiles, cached);
  }
  return cached.rows;
}
const CLAN_NAMES = [
  "Янтарные львы",
  "Золотые драконы",
  "Лунный дозор",
  "Лесные стражи",
  "Алые фениксы",
  "Северные волки",
  "Небесные рыцари",
  "Солнечный союз",
  "Морские странники",
  "Изумрудный круг",
  "Огненный орден",
  "Звёздный путь",
  "Стальные крылья",
  "Хранители света",
  "Буревестники",
  "Тихая гавань",
];

function seedTestClans(store, at = store.now()) {
  // Re-enabling or restarting must not duplicate profiles or refill their balances.
  if (Object.values(store.data.clans).some((c) => c.testOnly === MARKER)) return false;
  const count = Math.max(0, 16 - Object.keys(store.data.clans).length);
  if (!count) return false;
  const stage = new ProfileStore({ now: () => at }),
    newClans = {};
  const prefixes = new Set(Object.values(store.data.clans).map((c) => c.prefix.toUpperCase()));
  let serial = 1;
  for (let i = 0; i < count; i++) {
    let prefix;
    do {
      prefix = "T" + String(serial++).padStart(2, "0");
    } while (prefixes.has(prefix));
    prefixes.add(prefix);
    const id = randomUUID(),
      members = [];
    for (let j = 0; j < 10; j++) {
      const opened = stage.open(),
        p = stage.find(opened.token);
      p.name = nicknames.available(
        [...Object.values(store.data.profiles), ...Object.values(stage.data.profiles)],
        "Бот " + prefix + " " + ["Искра", "Ветер", "Луч", "Гром", "Роса", "Кедр", "Заря", "Волна", "Снег", "Лист"][j],
        p.id,
      );
      p.testBot = MARKER;
      assignBotGender(p);
      p.level = 12 + (i % 8);
      p.progress = freshProgress(p.level);
      p.skinId = skins[(i + j) % skins.length].id;
      p.greatness = 20 + i * 7 + j * 3;
      p.wallet = { coins: 2000, crystals: 100, bucks: 20 };
      if (j < 2) {
        p.account = accounts.fresh();
        p.account[j === 0 ? "vipUntil" : "premiumUntil"] = at + 30 * 86400000;
      }
      members.push(p.id);
    }
    newClans[id] = {
      id,
      name: CLAN_NAMES[i],
      prefix,
      description: "Тестовый клан с ботами для проверки битв и лиг.",
      emblem: i % 2 ? "grove" : "astral",
      privacy: "open",
      testOnly: MARKER,
      crest: {
        frame: crests.frames[i % crests.frames.length].id,
        color: crests.colors[i % crests.colors.length].id,
        symbol: crests.symbols[i % crests.symbols.length].id,
      },
      ownerId: members[0],
      members,
      roles: Object.fromEntries(
        members.map((id, j) => [id, (["head", "manager", "officer"][j] || "member")]),
      ),
      xp: i * 1800,
      treasury: 100 + i * 30,
      capacity: 15,
      applications: [],
      applicationFees: {},
      createdAt: at,
    };
  }
  for (const clan of Object.values(newClans))
    for (const id of clan.members) stage.byId(id).clanId = clan.id;
  const next = structuredClone(store.data);
  Object.assign(next.profiles, stage.data.profiles);
  Object.assign(next.clans, newClans);
  // Only an empty schedule may be rebuilt immediately. Live contests stay intact.
  if (
    !next.competition?.week?.groups?.length &&
    !next.competition?.day?.pairs?.length &&
    next.competition
  ) {
    next.competition.week = null;
    next.competition.day = null;
    next.competition.lastScheduledDay = null;
  }
  validateWorld(next);
  store.save(next, at);
  return true;
}

// Explicit, offline test setup. Repeating the same targets never adds duplicates.
function fillTestGroupRosters(
  store,
  { clanId, clanBotCount = 10, peerMemberCount = 10 },
  at = store.now(),
) {
  if (
    !Number.isInteger(clanBotCount) ||
    clanBotCount < 0 ||
    !Number.isInteger(peerMemberCount) ||
    peerMemberCount < 1
  )
    throw Error("Некорректное количество тестовых участников.");
  const group = store.data.competition?.week?.groups.find((g) => g.clans.includes(clanId));
  const own = store.data.clans[clanId];
  if (!own) throw Error("Клан не найден.");
  // Explicit offline bootstrap also supports an undersized clan awaiting admission.
  const targets = group?.clans || [clanId, ...Object.values(store.data.clans)
    .filter(c => c.id !== clanId && c.testOnly === MARKER &&
      c.competition?.league === own.competition?.league).map(c => c.id)];
  const plan = targets.map((id) => {
    const clan = store.data.clans[id];
    if (!clan) throw Error("Клан группы не найден.");
    const bots = clan.members.filter((member) => store.byId(member)?.testBot === MARKER).length;
    const add = Math.max(
      0,
      id === clanId ? clanBotCount - bots : peerMemberCount - clan.members.length,
    );
    if (clan.members.length + add > clan.capacity)
      throw Error("Недостаточно мест в клане " + clan.name + ".");
    return { clan, add, bots };
  });
  const added = plan.reduce((n, item) => n + item.add, 0);
  if (!added) return { added: 0 };
  const stage = new ProfileStore({ now: () => at }),
    next = structuredClone(store.data);
  for (const { clan, add, bots } of plan)
    for (let i = 0; i < add; i++) {
      const opened = stage.open(),
        p = stage.find(opened.token),
        target = next.clans[clan.id];
      p.name = nicknames.available(
        [...Object.values(store.data.profiles), ...Object.values(stage.data.profiles)],
        "Бот " + clan.prefix + " " + String(bots + i + 1).padStart(2, "0"),
        p.id,
      );
      p.testBot = MARKER;
      assignBotGender(p);
      p.level = 12;
      p.progress = freshProgress(12);
      p.skinId = skins[(bots + i) % skins.length].id;
      target.members.push(p.id);
      target.roles[p.id] = "member";
    }
  // open() replaces the staged object graph; assign memberships after all opens.
  for (const { clan } of plan)
    for (const id of next.clans[clan.id].members) {
      const p = stage.byId(id);
      if (p) p.clanId = clan.id;
    }
  Object.assign(next.profiles, stage.data.profiles);
  validateWorld(next);
  store.save(next, at);
  return { added };
}

class TestBots {
  constructor({
    arena,
    profiles,
    enabled = false,
    configPath = null,
    maxActive = 15,
    boostersEnabled = false,
    random = Math.random,
    isProfileAvailable = () => true,
    isLevelEligible = () => true,
    roomBotLimit = MAX_ACTIVE_BOTS,
  }) {
    this.arena = arena;
    this.profiles = profiles;
    this.enabled = enabled;
    this.configPath = configPath;
    this.maxActive = Math.max(0, Math.min(MAX_ACTIVE_BOTS, Math.floor(maxActive)));
    this.random = random;
    this.isProfileAvailable = isProfileAvailable;
    this.isLevelEligible = isLevelEligible;
    this.roomBotLimit = roomBotLimit;
    this.nextConfigAt = 0;
    this.nextThinkAt = 0;
    this.seeded = false;
    this.reportedError = false;
    this.slots = new Map();
    this.brain = new BotBrain(arena, random, { boostersEnabled });
    this.events = [];
  }
  livingHumans() {
    return [...this.arena.players.values()].filter((p) => !p.isTestBot && !p.dead && !p.isRemnant)
      .length;
  }
  configure(at, wallAt) {
    if (at < this.nextConfigAt) return;
    this.nextConfigAt = at + 1000;
    try {
      if (this.configPath) {
        const config = JSON.parse(fs.readFileSync(this.configPath, "utf8"));
        this.enabled = config.enabled === true;
        if (Number.isInteger(config.maxActive))
          this.maxActive = Math.max(0, Math.min(MAX_ACTIVE_BOTS, config.maxActive));
        this.brain.boostersEnabled = config.boostersEnabled === true;
      }
      if (this.enabled && !this.seeded) {
        seedTestClans(this.profiles, wallAt);
        this.seeded = true;
      }
      this.reportedError = false;
    } catch (error) {
      this.enabled = false;
      if (!this.reportedError) console.error("Тестовые боты выключены: " + error.message);
      this.reportedError = true;
    }
  }
  endPlayer(p, at) {
    const progress = require("../arena/quest-actions").takePending(this.arena, p.id)
      .map(event => ({ ...event, profileId: p.profileId }));
    this.brain.forget(p);
    this.arena.removePlayer(p.id);
    return p.dead
      ? progress
      : [
          ...progress,
          {
            type: "lifeEnded",
            profileId: p.profileId,
            lifeId: p.lifeId,
            durationSeconds: Math.max(0, Math.floor((at - p.lifeStartedAt) / 1000)),
            reason: "left",
          },
        ];
  }
  clear(at) {
    const progress = [];
    for (const p of [...this.arena.players.values()])
      if (p.isTestBot) progress.push(...this.endPlayer(p, at));
    this.slots.clear();
    return progress;
  }
  clearIfIdle(at) {
    return this.livingHumans() ? [] : this.clear(at);
  }
  status() {
    return {
      enabled: this.enabled,
      maxActive: this.maxActive,
      boostersEnabled: this.brain.boostersEnabled,
      activeBots: [...this.arena.players.values()].filter((p) => p.isTestBot && !p.dead).length,
      humanPlayers: this.livingHumans(),
      testClans: Object.values(this.profiles.data.clans).filter((c) => c.testOnly === MARKER)
        .length,
    };
  }
  update(at, wallAt, maxPlayers) {
    this.events = [];
    this.configure(at, wallAt);
    if (!this.enabled || !this.livingHumans()) return this.clear(at);
    const humans = [...this.arena.players.values()].filter(
      (p) => !p.isTestBot && !p.isRemnant,
    ).length;
    const limit = Math.min(this.maxActive, this.roomBotLimit, Math.max(0, maxPlayers - humans));
    const candidates = [...Object.values(this.profiles.data.clans), ...independentBots(this.profiles, at)].filter((c) =>
      // Crossing a level boundary affects the next spawn, never the current life.
      (this.arena.players.get(this.slots.get(c.id)?.playerId)?.dead === false) ||
      c.members.some((id) => { const p = this.profiles.byId(id); return p?.testBot === MARKER &&
        (!c.independent || !p.clanId) && this.isLevelEligible(p); }),
    );
    const offset = candidates.length > limit ? Math.floor(at / 60000) % candidates.length : 0;
    const clans = [...candidates.slice(offset), ...candidates.slice(0, offset)].slice(0, limit);
    const allowed = new Set(clans.map((c) => c.id)),
      progress = [];
    for (const [id, slot] of this.slots)
      if (!allowed.has(id)) {
        const p = this.arena.players.get(slot.playerId);
        if (p) progress.push(...this.endPlayer(p, at));
        this.slots.delete(id);
      }
    for (const [index, clan] of clans.entries()) {
      let slot = this.slots.get(clan.id);
      if (!slot) {
        slot = { playerId: null, nextSpawnAt: at, memberIndex: index % 4 };
        this.slots.set(clan.id, slot);
      }
      const old = this.arena.players.get(slot.playerId);
      if (old && activeBan(this.profiles.byId(old.profileId), wallAt)) {
        progress.push(...this.endPlayer(old, at));
        slot.playerId = null;
        slot.nextSpawnAt = at + 7000;
        slot.memberIndex++;
        continue;
      }
      if (old && !old.dead) continue;
      if (old) {
        this.brain.forget(old);
        this.arena.removePlayer(old.id);
        slot.playerId = null;
        slot.nextSpawnAt = at + 7000;
        slot.memberIndex++;
      }
      if (at < slot.nextSpawnAt) continue;
      const candidates = clan.members
        .map((id) => this.profiles.byId(id))
        .filter((p) => p?.testBot === MARKER && (!clan.independent || !p.clanId) && this.isLevelEligible(p) && !activeBan(p, wallAt) && this.isProfileAvailable(p.id));
      if (!candidates.length) continue;
      const profile = candidates[slot.memberIndex % candidates.length],
        p = this.arena.addPlayer(at);
      p.isTestBot = true;
      p.profileId = profile.id;
      Object.assign(p, this.profiles.identity(profile));
      p.mass = [10, 24, 65, 120, 220][index % 5];
      p.radius = radiusForMass(p.mass);
      slot.playerId = p.id;
      this.brain.start(p, at);
      progress.push(
        { type: "lifeStarted", profileId: profile.id, lifeId: p.lifeId, newArena: true },
        { type: "massPeak", profileId: profile.id, mass: p.mass },
      );
    }
    if (at >= this.nextThinkAt) {
      this.nextThinkAt = at + 400;
      for (const slot of this.slots.values()) {
        const p = this.arena.players.get(slot.playerId);
        if (p && !p.dead) {
          const event = this.steer(p, at);
          if (event) this.events.push(event);
        }
      }
    }
    return progress;
  }
  steer(p, at) {
    return this.brain.act(p, at);
  }
}
module.exports = { MARKER, seedTestClans, fillTestGroupRosters, TestBots };
