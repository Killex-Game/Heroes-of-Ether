"use strict";
(() => {
  const rewards = Object.freeze([
    { coins: 100 },
    { crystals: 25 },
    { bucks: 5 },
    { rare: 10 },
    { coins: 300, crystals: 50 },
    { bucks: 10, advanced: 50 },
    { vipHours: 1, coins: 500, crystals: 100 },
  ].map(Object.freeze));
  if (typeof module === "object" && module.exports) module.exports = rewards;
  else window.KillexLoginRewards = rewards;
})();
