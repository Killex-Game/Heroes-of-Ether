"use strict";
const { ProfileStore } = require('../profiles/profile-store');
const { MARKER } = require('./arena-test-bots');
const { freshProgress } = require('../progression/experience-progression');
const { BATTLE_MIN_MEMBERS } = require('../../../public/shared/clan-competition-rules');
const { skins } = require('../../../public/shared/player-identity');
const { validateWorld } = require('../clans/clan-service');
const SEED = 'battle-population-20261111';
// Explicit offline fixture. Never run automatically when a person leaves a clan.
function prepareBattlePopulation(data, at = Date.now(), { includeClanIds = [] } = {}) {
  const next = structuredClone(data), sessions = [];
  const included = new Set(includeClanIds);
  const clans = Object.values(next.clans).filter(c => c.testOnly === MARKER || included.has(c.id));
  for (const [index, c] of clans.entries()) {
    if (c.capacity < BATTLE_MIN_MEMBERS) throw Error("Недостаточно мест в тестовом клане");
    while (c.members.length < BATTLE_MIN_MEMBERS) {
      const slot = c.members.length, n = index * 10 + slot;
      const fresh = new ProfileStore({ now: () => at }), auth = fresh.open(), p = fresh.find(auth.token);
      p.name = require("../profiles/nickname-rules").available(Object.values(next.profiles),
        `Бот ${c.prefix} ${['Росток','Ручей','Лист','Роса','Сокол','Факел'][slot % 6]} ${slot + 1}`, p.id);
      p.personal.nameSet = true; p.personal.introPending = false;
      p.testBot = MARKER; p.testSeedKey = SEED;
      require('./bot-identity').assignBotGender(p);
      p.level = slot % 6 < 4 ? 12 + n % 109 : 121 + n % 380;
      p.progress = freshProgress(p.level);
      p.skinId = skins[n % skins.length].id;
      p.clanId = c.id; p.wallet = { coins: 2000, crystals: 100, bucks: 20 };
      const transactions = require('../profiles/transaction-history');
      transactions.capture(p, at, { kind: 'test-population', label: 'Начальный баланс тестового бота' });
      transactions.validate(p);
      c.members.push(p.id); c.roles[p.id] = 'member';
      Object.assign(next.profiles, fresh.data.profiles);
      sessions.push({ id: p.id, token: auth.token });
    }
  }
  validateWorld(next);
  return { data: next, sessions, added: sessions.length };
}
module.exports = { prepareBattlePopulation, SEED };
