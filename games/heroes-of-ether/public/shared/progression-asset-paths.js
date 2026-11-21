/* Пути к изображениям достижений, лиг, титулов и сундуков. */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.KillexProgressionArt = api;
})(typeof globalThis !== "undefined" ? globalThis : this, () => {
  "use strict";
  const achievements = Object.freeze({
    career: "career",
    king: "tsar",
    eaten: "big_eater",
    maximum: "maximum",
    boosters: "on_target",
    ...Object.fromEntries(
      [
        "league_conqueror",
        "league_fighter",
        "victory_march",
        "cup_keeper",
        "champion_dynasty",
        "strong_love",
        "loving",
        "always_together",
        "valuable",
        "marriage",
        "gamer",
        "jumper",
        "regular",
        "fan",
        "wealthy",
        "spendthrift",
        "miner",
        "spendthrift_i",
        "banker",
        "spendthrift_ii",
        "top",
        "generous",
        "needed",
        "sociable",
        "for_clan",
        "investment",
        "not_stingy",
        "resident",
      ].map((id) => [id, id]),
    ),
  });
  const temporary = new Set(["vip", "premium"]);
  const ranks = Object.freeze({
    novice: "novice",
    experienced: "experienced",
    expert: "expert",
    master: "master",
    sage: "sage",
    pro: "pro",
    prince: "prince",
    king: "king",
    emperor: "emperor",
    boss: "boss_of_bosses",
  });
  // «Торт Боеголовки» исключён по указанию владельца: ошибочная иллюстрация.
  const boosters = Object.freeze({
    fire: "fire",
    vortex: "whirlwind",
    awl: "awl",
    clan_shield: "clan_shield",
    fire_sword: "flaming_sword",
  });
  const leagues = Object.freeze({
    bronze: "bronze",
    silver: "silver",
    gold: "gold",
    platinum: "platinum",
    diamond: "diamond",
    champions: "champions",
  });
  const url = (group, key, size) =>
    typeof key === "string"
      ? `assets/progression/webp/${[64, 128, 256].includes(size) ? size : 128}/${group}/${key}.webp`
      : null;
  return Object.freeze({
    achievement: (id, size = 128) =>
      [
        "fashionista",
        "career",
        "king",
        "eaten",
        "maximum",
        "boosters",
        "wealthy",
        "spendthrift",
        "miner",
        "spendthrift_i",
        "banker",
        "spendthrift_ii",
        "top",
        "generous",
        "needed",
        "sociable",
        "for_clan",
        "investment",
        "not_stingy",
        "resident",
        "lucky_attempt",
        "easter_trail",
        "easter_colors",
        "easter_hunter",
        "easter_adventure",
        "easter_find",
        "easter_collection",
        "easter_extra",
        "lucky_gold_mine",
        "lucky_lite",
        "lucky_arsenal",
        "lucky_marriage_games",
        "pet_nursery",
        "pet_master",
        "pet_trainer",
        "pet_feeder",
        "pet_exclusive",
        "pet_level_zaya",
        "pet_level_leva",
        "pet_level_drakosha",
        "pet_level_manya",
      ].includes(id)
        ? `assets/achievements/illustrated-v2/${id}.webp`
        : ["vip", "premium"].includes(id)
          ? `assets/accounts/${id}.png`
          : temporary.has(id)
            ? `assets/achievements/${id}.svg`
            : url("achievements", achievements[id], size),
    rank: (id, size = 128) =>
      ranks[id]
        ? `assets/ranks/prism-progression-v2/${[64, 128, 256, 512].includes(size) ? size : 128}/${{ king: "emperor", emperor: "king" }[id] || id}.webp`
        : null,
    chest: (id, size = 128) =>
      ["pro", "prince", "king", "emperor"].includes(id)
        ? `assets/chests/prism-unified-v4/${[64, 128, 256, 512].includes(size) ? size : 128}/${id}.webp`
        : url("rank_chests", ranks[id], size),
    questChest: (art) =>
      `assets/chests/prism-unified-v4/256/quest-${art === "expert" ? "large" : art === "experienced" ? "medium" : "small"}.webp`,
    clanChest: (tier) =>
      ["low", "medium", "high"].includes(tier)
        ? `assets/chests/prism-unified-v4/256/clan-${tier}.webp`
        : null,
    booster: (id, size = 256) =>
      ["rocket", "cake", "warheads"].includes(id)
        ? `assets/boosters/png/${id}.png`
        : url("boosters", boosters[id], size),
    league: (id, size = 128) => url("leagues", leagues[id], size),
    leagueMedal: (id, size = 128) => url("league_medals", leagues[id], size),
  });
});
