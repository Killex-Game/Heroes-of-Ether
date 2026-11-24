/* Общее золотое обрамление витрины и уведомлений; иллюстрация сохраняет свою палитру. */
"use strict";
(() => {
  const illustrated = new Set([
    "fashionista",
    "friday_orders",
    "friday_trophy",
    "friday_tokens",
    "friday_exchange",
    "friday_shopper",
    "friday_levels",
    "friday_common",
    "friday_advanced",
    "friday_rare",
    "friday_clan",
    "friday_currency",
    "friday_status",
    "friday_case",
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
    "lucky_gold_mine",
    "lucky_lite",
    "lucky_arsenal",
    "lucky_marriage_games",
    "vip",
    "premium",
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
  ]);
  const layers = new Map();
  const template = ["interior-mask.svg", "canonical-gold-frame.png"]
    .map(name => `assets/achievements/template/${name}?art=20261123-interface-art`);
  function loaded(src) {
    if (!layers.has(src)) {
      const image = new Image();
      const ready = new Promise((resolve, reject) => {
        image.onload = () => resolve();
        image.onerror = () => reject(new Error("Achievement image unavailable"));
        image.src = src;
      }).then(() => typeof image.decode === "function" ? image.decode() : undefined);
      layers.set(src, ready);
      ready.catch(() => layers.delete(src));
    }
    return layers.get(src);
  }
  function paint(badge, id) {
    badge.dataset.badge = id;
    // Easter art is already approved; every other illustration uses the same
    // overlay frame and a small, stable category palette beneath the artwork.
    const colors = id.startsWith("easter_") ? null
      : /love|loving|marriage|together|needed|valuable/.test(id) ? ["#ef8ca6", "#a43a6c", "#58274f"]
      : /pet_|investment|for_clan|resident|not_stingy/.test(id) ? ["#76d7ae", "#20847b", "#174d57"]
      : /miner|spendthrift_i$|league_|cup_|champion|victory/.test(id) ? ["#81d3f4", "#316cb7", "#263771"]
      : /friday_|wealthy|spendthrift$|banker|top/.test(id) ? ["#f5cd84", "#a66739", "#65383f"]
      : ["#b48bea", "#7041af", "#3b2866"];
    if (colors) badge.style.setProperty("--achievement-background", `radial-gradient(ellipse at 32% 25%, ${colors[0]}, ${colors[1]} 50%, ${colors[2]} 100%)`);
    else badge.style.removeProperty("--achievement-background");
    const src = illustrated.has(id)
      ? `assets/achievements/illustrated-v2/${id}.webp${id.startsWith("friday_") ? "?v=20261109-complete" : ""}`
      : window.KillexProgressionArt.achievement(id);
    const image = badge.querySelector("img"), url = window.KillexArtRevision.url(src);
    if (badge.dataset.source === url && badge.dataset.ready === "true") return;
    badge.dataset.source = url;
    badge.dataset.ready = "false";
    image.src = url;
    const generation = (badge._paintGeneration || 0) + 1;
    badge._paintGeneration = generation;
    Promise.all([...template, url].map(loaded)).then(() => {
      if (badge._paintGeneration === generation) badge.dataset.ready = "true";
    }).catch(() => {
      if (badge._paintGeneration === generation) badge.dataset.ready = "error";
    });
  }
  function create(id, cls = "achievement-emblem", size = 80) {
    const badge = document.createElement("span"),
      image = document.createElement("img");
    badge.className = "achievement-badge " + cls;
    badge.setAttribute("aria-hidden", "true");
    image.className = "achievement-symbol";
    image.alt = "";
    image.width = image.height = size;
    badge.append(image);
    if (id) paint(badge, id);
    return badge;
  }
  window.KillexAchievementBadge = { create, paint };
})();
