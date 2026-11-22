/* Every lobby button belongs to all interface themes. Keep the catalogue complete. */
((root, factory) => {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.KillexLobbyMenuArt = api;
})(typeof globalThis !== "undefined" ? globalThis : this, () => {
  "use strict";
  const buttons = Object.freeze({
    promoCodeSection: "promo", hallOfFameSection: "hall", eventsSection: "events",
    inventorySection: "inventory", wardrobeSection: "wardrobe", questsSection: "quests",
    shopSection: "shop", rankingsButton: "top", achievementsButton: "achievements",
    clanSection: "clan", petsSection: "pets", newsSection: "news",
  });
  const themes = Object.freeze(["default", "heroic", "visual", "prism", "glass"]);
  function source(theme, icon) {
    if (!themes.includes(theme)) theme = "default";
    if (theme === "default") return icon === "pets" ? "assets/menu-icons/community-v2/pets.webp?art=20261122b" :
      icon === "top" ? "assets/menu-icons/v2/nav_tops.webp?art=20261122b" : null;
    return `assets/interface-packs/${theme}/${theme === "heroic" || ["promo","news","pets"].includes(icon) ? "menu-v2/" : ""}nav-${icon}.webp?art=20261122b`;
  }
  return Object.freeze({ buttons, themes, source });
});
