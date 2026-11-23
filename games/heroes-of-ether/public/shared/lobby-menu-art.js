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
  const themes = Object.freeze(["default", "heroic"]);
  function source(theme, icon) {
    if (!themes.includes(theme)) theme = "default";
    if (theme === "default") return `assets/menu-icons/avatar-style-v1/128/${icon}.webp?art=20261123-interface-art`;
    return `assets/interface-packs/${theme}/${theme === "heroic" || ["promo","news","pets"].includes(icon) ? "menu-v2/" : ""}nav-${icon}.webp?art=20261123-interface-art`;
  }
  return Object.freeze({ buttons, themes, source });
});
