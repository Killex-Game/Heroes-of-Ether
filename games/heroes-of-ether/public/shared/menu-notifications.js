/* Новые предметы отмечаются один раз; ожидающие действия остаются до выполнения. */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.KillexMenuNotices = api;
})(typeof globalThis !== "undefined" ? globalThis : this, () => {
  "use strict";
  const platform = typeof module === "object" && module.exports
    ? require("./platform-contract") : globalThis.KillexPlatform;
  const groups = [
    "skins",
    "inventory",
    "wardrobe",
    "quests",
    "shop",
    "tops",
    "achievements",
    "clan",
    "pets",
  ];
  const set = (ids) => Object.fromEntries((ids || []).map((id) => [id, 1]));
  function snapshot(p, catalog) {
    const result = {
      skins: {
        ...set(p.appearance?.unlocked),
        ...set(["vip", "premium"].filter((tier) => p.account?.[tier])),
      },
      inventory: { ...p.inventory },
      wardrobe: set(p.wardrobe?.owned),
      quests: set([
        ...(p.quests?.items || []).filter((q) => q.completedAt != null).map((q) => q.id),
        ...(p.quests?.pending || []).map((q) => q.id),
      ]),
      achievements: Object.fromEntries(
        (p.progress?.achievements || []).map((a) => [
          `${a.id}:${a.eventRunId || ""}`,
          a.claimed || 0,
        ]),
      ),
      pets: Object.fromEntries(
        Object.entries(p.pets?.owned || {}).map(([id, pet]) => [id, (pet.level || 0) + 1]),
      ),
    };
    if (catalog)
      result.shop = set((catalog.items || []).filter((item) => item.ready).map((item) => item.id));
    return result;
  }
  function actions(p) {
    const titleChests =
      !!p.honors?.pending || !!p.honors?.tiers?.some((t) => t.state === "closed" && !t.reason);
    const treasury =
      !!p.quests?.pending?.length ||
      !!p.easter?.chests?.length ||
      !!p.fridayChests?.length ||
      !!p.clanChests?.items?.some((c) => c.stored);
    return {
      clan:
        p.menuNotifications?.clanApplications > 0 || !!p.clanChests?.items?.some((c) => !c.stored),
      inventory: titleChests || treasury,
      chests: titleChests || treasury,
      titleChests,
      treasury,
      tops: !!p.dailyRankingRewards?.length,
    };
  }
  class Notices {
    constructor(storage) {
      this.storage = storage;
      this.profile = null;
      this.state = { baseline: {}, unread: {} };
    }
    key() {
      return platform.storageKey(".menu-notices.v1.") + this.profile.id;
    }
    save() {
      try {
        this.storage?.setItem(this.key(), JSON.stringify(this.state));
      } catch (_) {}
    }
    update(profile, catalog) {
      if (
        !profile?.id ||
        (profile.id === this.profile?.id && profile.revision < this.profile.revision)
      )
        return;
      if (profile.id !== this.profile?.id) {
        this.profile = profile;
        this.state = { baseline: {}, unread: {} };
        try {
          const saved = JSON.parse(this.storage?.getItem(this.key()));
          if (saved?.baseline && saved?.unread) this.state = saved;
        } catch (_) {}
      }
      this.profile = profile;
      const next = snapshot(profile, catalog);
      let changed = false;
      for (const [group, values] of Object.entries(next)) {
        const before = this.state.baseline[group];
        if (!before && group === "quests" && profile.quests?.pending?.length)
          this.state.unread.quests = true;
        if (before && Object.entries(values).some(([id, count]) => count > (before[id] || 0)))
          this.state.unread[group] = true;
        if (JSON.stringify(before) !== JSON.stringify(values)) changed = true;
        this.state.baseline[group] = values;
      }
      if (changed) this.save();
    }
    attention() {
      return this.profile
        ? {
            ...this.state.unread,
            inventoryItems: !!this.state.unread.inventory,
            ...Object.fromEntries(
              Object.entries(actions(this.profile)).map(([group, active]) => [
                group,
                !!(active || this.state.unread[group]),
              ]),
            ),
          }
        : {};
    }
    seen(group) {
      if (!this.profile || !groups.includes(group) || !this.state.unread[group]) return;
      delete this.state.unread[group];
      this.save();
    }
  }
  return { Notices, actions, snapshot, groups };
});
