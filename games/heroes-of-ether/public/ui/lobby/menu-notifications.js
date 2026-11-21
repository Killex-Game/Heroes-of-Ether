"use strict";
(() => {
  let storage;
  try {
    storage = localStorage;
  } catch (_) {}
  const notices = new window.KillexMenuNotices.Notices(storage);
  const buttons = {
    inventory: "inventorySection",
    wardrobe: "wardrobeSection",
    quests: "questsSection",
    shop: "shopSection",
    tops: "rankingsButton",
    achievements: "achievementsButton",
    clan: "clanSection",
    pets: "petsSection",
  };
  const dialogs = {
    skinsDialog: "wardrobe",
    questsDialog: "quests",
    topsDialog: "tops",
    achievementsDialog: "achievements",
    clanDialog: "clan",
    petsDialog: "pets",
  };
  const badges = new Map();
  let catalog = null,
    catalogProfileId = null;
  for (const [group, id] of Object.entries(buttons)) {
    const button = document.getElementById(id);
    if (!button) continue;
    const badge = document.createElement("span");
    badge.className = "menu-notification-dot";
    badge.id = "menuNotice-" + group;
    badge.hidden = true;
    badge.setAttribute("role", "img");
    badge.setAttribute("aria-label", "Есть новое");
    button.append(badge);
    badges.set(group, badge);
  }
  function render() {
    for (const dialog of document.querySelectorAll("dialog[open]")) {
      const group =
        dialog.id === "boosterDialog"
          ? ["shop", "inventory"].includes(dialog.dataset.mode)
            ? dialog.dataset.mode
            : null
          : dialogs[dialog.id];
      if (group) notices.seen(group);
      if (dialog.id === "skinsDialog") notices.seen("skins");
    }
    const active = notices.attention();
    for (const button of document.querySelectorAll("[data-notice-group]")) {
      let dot = button.querySelector(".menu-notification-dot");
      if (!dot) {
        button.classList.add("menu-notification-target");
        dot = document.createElement("span");
        dot.className = "menu-notification-dot";
        dot.id = "sectionNotice-" + button.dataset.noticeGroup;
        dot.setAttribute("role", "img");
        dot.setAttribute("aria-label", "Есть новое");
        dot.setAttribute("aria-hidden", "true");
        button.append(dot);
      }
      dot.hidden = !active[button.dataset.noticeGroup];
      dot.title =
        button.dataset.noticeGroup === "inventoryItems"
          ? "Получены новые бустеры"
          : "Есть сундуки для открытия";
      if (!dot.hidden) button.setAttribute("aria-description", dot.title);
      else button.removeAttribute("aria-description");
    }
    for (const [group, badge] of badges) {
      badge.hidden = !(active[group] || (group === "wardrobe" && active.skins));
      const text =
        group === "quests"
          ? "Задание выполнено, сундук в сокровищнице"
          : group === "clan" && notices.profile?.menuNotifications?.clanApplications > 0
            ? "Есть заявки в клан"
            : group === "inventory" &&
                window.KillexMenuNotices.actions(notices.profile || {}).inventory
              ? "Есть сундуки для открытия"
              : "Есть новое";
      badge.setAttribute("aria-label", text);
      badge.title = text;
    }
  }
  function update(profile) {
    notices.update(profile, catalogProfileId === profile?.id ? catalog : null);
    render();
  }
  document.addEventListener("killex:profile", (event) =>
    update(event.detail?.profile || event.detail),
  );
  document.addEventListener("killex:catalog", (event) => {
    catalogProfileId = event.detail.profileId;
    catalog = event.detail.catalog;
    if (notices.profile?.id === catalogProfileId) update(notices.profile);
  });
  document.addEventListener("killex:menu-notifications", (event) => {
    if (notices.profile?.id !== event.detail.profileId) return;
    update({ ...notices.profile, menuNotifications: event.detail.menuNotifications });
  });
  new MutationObserver(render).observe(document.body, {
    subtree: true,
    attributes: true,
    attributeFilter: ["open", "data-mode"],
  });
})();
