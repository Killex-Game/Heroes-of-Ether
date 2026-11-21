"use strict";
const { ProfileStore } = require('../profiles/profile-store');
const { MARKER } = require('./arena-test-bots');
const { freshProgress } = require('../progression/experience-progression');
const { validateWorld } = require('../clans/clan-service');
const SEED = 'sandbox-population-20261111';
// Explicit offline fixture; existing players, clan results and wallets are untouched.
function prepareSandboxPopulation(data, at) {
  const next = structuredClone(data), sessions = [];
  const clans = Object.values(next.clans).filter(c => c.testOnly === MARKER);
  for (const [index, c] of clans.entries()) {
    if (Object.values(next.profiles).some(p => p.testSeedKey === SEED && p.testSeedClanId === c.id)) continue;
    if (c.members.length >= c.capacity) continue;
    const fresh = new ProfileStore({now: () => at}), auth = fresh.open(), p = fresh.find(auth.token);
    p.name = `Бот ${c.prefix} Росток`;
    p.personal.nameSet = true; p.personal.introPending = false;
    p.testBot = MARKER; p.testSeedKey = SEED; p.testSeedClanId = c.id;
    require('./bot-identity').assignBotGender(p);
    p.level = 1 + index % 9; p.progress = freshProgress(p.level);
    // Beginner arena profiles remain clanless until ordinary level-12 admission.
    p.clanId = null; p.wallet = {coins: 100, crystals: 10, bucks: 0};
    Object.assign(next.profiles, fresh.data.profiles);
    sessions.push({id:p.id,token:auth.token});
  }
  validateWorld(next);
  return {data:next,sessions,added:sessions.length};
}
module.exports = {prepareSandboxPopulation,SEED};
