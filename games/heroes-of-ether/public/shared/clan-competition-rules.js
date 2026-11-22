/* Общие правила лиг и описания степеней клановых сундуков. */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.KillexClanRules = api;
})(typeof globalThis !== "undefined" ? globalThis : this, () => {
  "use strict";
  const DAY = 86400000,
    HOUR = 3600000,
    MSK = 3 * HOUR,
    BATTLE_LOSS_GREATNESS = 5;
  const BATTLE_FIXED_REWARD = Object.freeze({ coins: 100, crystals: 10, greatness: 0 });
  const BATTLE_WINNER_FIXED_REWARD = Object.freeze({ ...BATTLE_FIXED_REWARD, greatness: 1 });
  const battleFixedReward = (won) => (won ? BATTLE_WINNER_FIXED_REWARD : BATTLE_FIXED_REWARD);
  const LEAGUES = Object.freeze(
    [
      ["bronze", "Бронзовая", 5000, 100, 50, 50, 5],
      ["silver", "Серебряная", 10000, 1000, 250, 100, 10],
      ["gold", "Золотая", 50000, 2500, 500, 250, 15],
      ["platinum", "Платиновая", 100000, 5000, 1000, 500, 20],
      ["diamond", "Бриллиантовая", 500000, 10000, 2500, 750, 25],
      ["champions", "Лига Чемпионов", 1000000, 25000, 5000, 1000, 50],
    ].map(([id, name, threshold, coins, crystals, bucks, greatness], index) =>
      Object.freeze({ id, name, index, threshold, reward: { coins, crystals, bucks, greatness } }),
    ),
  );
  const CHESTS = Object.freeze({
    high: {
      name: "Клановый сундук высшей степени",
      art: "master",
      coins: [250, 300],
      crystals: [30, 50],
      boosters: 200,
      greatness: 10,
      rarityShares: { rare: 20, advanced: 20, clan: 60 },
    },
    medium: {
      name: "Клановый сундук средней степени",
      art: "prince",
      coins: [150, 200],
      crystals: [20, 30],
      boosters: 150,
      greatness: 7,
      rarityShares: { rare: 30, advanced: 10, clan: 40, common: 20 },
    },
    low: {
      name: "Клановый сундук малой степени",
      art: "novice",
      coins: [100, 150],
      crystals: [10, 15],
      boosters: 100,
      greatness: 5,
      rarityShares: { advanced: 10, clan: 30, common: 60 },
    },
  });
  const SEASON_PRIZES = Object.freeze(
    [
      [2, 1000, 100, 50],
      [4, 2000, 200, 250],
      [6, 3500, 350, 500],
      [8, 5500, 550, 2500],
      [10, 8000, 800, 5000],
      [15, 12000, 1200, 10000],
    ].map(([discount, coins, crystals, bucks]) =>
      Object.freeze({ discount, reward: Object.freeze({ coins, crystals, bucks }) }),
    ),
  );
  function trophyLabel(trophy) {
    const league = LEAGUES[trophy.league];
    return `Кубок за ${trophy.number} сезон ${league.name} ${trophy.year}`;
  }
  function trophyBenefits(clan) {
    const trophies = clan?.competition?.trophies || [],
      league = trophies.reduce((best, trophy) => Math.max(best, trophy.league), -1);
    return { league: LEAGUES[league]?.id || null, discount: SEASON_PRIZES[league]?.discount || 0 };
  }
  function discountedPrice(amount, discount) {
    if (
      !Number.isSafeInteger(amount) ||
      amount < 0 ||
      !Number.isInteger(discount) ||
      discount < 0 ||
      discount > 100
    )
      throw Error("Некорректная цена или скидка.");
    // Integer arithmetic without multiplying a potentially large balance by 100.
    const saving =
      Math.floor(amount / 100) * discount + Math.floor(((amount % 100) * discount) / 100);
    return amount - saving;
  }
  const dayStart = (at) => Math.floor((at + MSK) / DAY) * DAY - MSK;
  // Legacy saves without the clan calendar retain their original season IDs.
  // Calendar-enabled worlds use clan-season-calendar and clamp weeks to its edges.
  function season(at) {
    const d = new Date(at + MSK),
      year = d.getUTCFullYear(),
      half = d.getUTCMonth() < 6 ? 0 : 1;
    return {
      id: year + "-" + (half + 1),
      number: (year - 2026) * 2 + half + 1,
      start: Date.UTC(year, half * 6, 1) - MSK,
      end: Date.UTC(year, (half + 1) * 6, 1) - MSK,
    };
  }
  function week(at) {
    const start = dayStart(at) - ((new Date(at + MSK).getUTCDay() + 6) % 7) * DAY,
      s = season(at);
    return {
      id: String(Math.max(start, s.start)),
      start: Math.max(start, s.start),
      end: Math.min(start + 7 * DAY, s.end),
    };
  }
  function zones(index, size) {
    if (index === 5) return { promote: 1, stay: 3, demote: Math.max(0, size - 4) };
    if (index >= 3)
      return { promote: 2, stay: Math.min(7, size - 2), demote: Math.max(0, size - 9) };
    const demote = size === 10 ? 3 : Math.min(5, Math.ceil(size / 3));
    return { promote: 3, stay: size - 3 - demote, demote };
  }
  function rewardCounts(count) {
    if (!Number.isSafeInteger(count) || count < 0) throw Error("Некорректное число участников.");
    // Largest remainders preserve the 30/30/30/10 quotas with whole recipients.
    // Integer tenths avoid floating-point ties; equal remainders favour better prizes.
    const shares = ["high", "medium", "low", "fixed"].map((tier, rank) => {
      const weight = rank < 3 ? 3 : 1;
      return {
        tier,
        rank,
        count: Math.floor(count / 10) * weight + Math.floor(((count % 10) * weight) / 10),
        remainder: ((count % 10) * weight) % 10,
      };
    });
    const counts = Object.fromEntries(shares.map((share) => [share.tier, share.count]));
    const remaining = count - shares.reduce((total, share) => total + share.count, 0);
    shares.sort((a, b) => b.remainder - a.remainder || a.rank - b.rank);
    for (let i = 0; i < remaining; i++) counts[shares[i].tier]++;
    return counts;
  }
  function rewardPlan(entries) {
    const ranked = entries
      .filter((p) => p.kills > 0)
      .slice()
      .sort(
        (a, b) =>
          b.kills - a.kills ||
          (a.joinedAt || 0) - (b.joinedAt || 0) ||
          (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
      );
    const counts = rewardCounts(ranked.length);
    return ranked.map((entry, index) => ({
      ...entry,
      place: index + 1,
      tier:
        index < counts.high
          ? "high"
          : index < counts.high + counts.medium
            ? "medium"
            : index < counts.high + counts.medium + counts.low
              ? "low"
              : "fixed",
    }));
  }
  return {
    BATTLE_MIN_MEMBERS: 10,
    DAY,
    HOUR,
    MSK,
    BATTLE_LOSS_GREATNESS,
    BATTLE_FIXED_REWARD,
    BATTLE_WINNER_FIXED_REWARD,
    battleFixedReward,
    LEAGUES,
    CHESTS,
    SEASON_PRIZES,
    trophyLabel,
    trophyBenefits,
    discountedPrice,
    dayStart,
    season,
    week,
    zones,
    rewardCounts,
    rewardPlan,
  };
});
