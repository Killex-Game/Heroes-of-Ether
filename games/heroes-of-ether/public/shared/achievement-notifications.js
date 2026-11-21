/* Учёт прочитанных уведомлений о полученных степенях. */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else {
    root.KillexAchievementNotices = api;
    let storage = null;
    try {
      storage = root.localStorage;
    } catch (_) {}
    const notices = new api.Notices(storage);
    const el = (tag, cls, text) => {
      const n = document.createElement(tag);
      n.className = cls;
      if (text !== undefined) n.textContent = text;
      return n;
    };
    const card = el("dialog", "achievement-earned-dialog");
    card.id = "achievementNotice";
    card.setAttribute("aria-label", "Полученное достижение");
    const banner = el("div", "achievement-earned-banner");
    const heading = el("h2", "", "Достижение выполнено!");
    const icon = root.KillexAchievementBadge.create(null, "achievement-earned-icon", 112);
    const name = el("h3", "achievement-earned-name");
    const stars = el("div", "achievement-earned-stars");
    const description = el("p", "achievement-earned-description");
    const reward = el("p", "achievement-earned-reward");
    const done = el("button", "sf-button sf-primary", "Отлично");
    done.type = "button";
    const close = el("button", "booster-close", "×");
    close.type = "button";
    close.setAttribute("aria-label", "Закрыть уведомление о достижении");
    banner.append(heading);
    card.append(banner, close, icon, stars, name, description, reward, done);
    document.body.append(card);
    let shown = null,
      renderedKey = "";
    function render() {
      const next = notices
        .pending()
        .find((n) => n.id !== "career" || !root.KillexTitleNoticeUI);
      const visible = document.body.dataset.screen === "lobby" && !!next;
      if (!visible) {
        if (card.open) card.close();
        shown = null;
        renderedKey = "";
        return;
      }
      if (root.KillexBoot?.active || document.querySelector('dialog[data-required="true"]')) return;
      const entry = notices.profile.progress.achievements.find(a => a.id === next.id);
      const key = notices.profile.id + ":" + next.id + ":" + (entry.eventRunId || "") + ":" + next.degree;
      shown = next;
      if (key === renderedKey && card.open) return;
      card.dataset.achievementNotice = next.id;
      root.KillexAchievementBadge.paint(icon, next.id);
      name.textContent = next.name;
      const total = Math.max(next.degree, entry.thresholds?.length || next.degree);
      stars.replaceChildren(...Array.from({length:total}, (_,i) => el("span", i < next.degree ? "earned" : "", "★")));
      stars.setAttribute("aria-label", "Получено степеней: " + next.degree);
      description.textContent = entry.description || "";
      reward.replaceChildren();
      const amount = entry.rewards?.[next.degree - 1];
      reward.hidden = !Number.isFinite(amount);
      if (Number.isFinite(amount)) reward.append("Награда степени: ", root.KillexGreatnessUI.value("+" + amount.toLocaleString("ru-RU")));
      root.KillexUITheme?.inherit(card, document.body);
      card.dataset.eventStyle = next.id.startsWith("friday_") ? "black-friday"
        : next.id.startsWith("easter_") ? "easter" : next.id.startsWith("lucky_") ? "lucky-week" : "";
      root.KillexWindows.open(card);
      if (card.open) {
        renderedKey = key;
        done.focus({preventScroll:true});
      }
    }
    function dismiss() {
      if (shown) notices.dismiss(shown.id, shown.degree);
      shown = null;
      renderedKey = "";
      card.close();
      queueMicrotask(render);
    }
    close.onclick = done.onclick = dismiss;
    document.addEventListener("killex:boot-ready", render);
    card.addEventListener("cancel", event => { event.preventDefault(); dismiss(); });
    new MutationObserver(() => queueMicrotask(render)).observe(document.body, {
      subtree: true,
      attributes: true,
      attributeFilter: ["data-screen", "open"],
    });
    root.KillexAchievementNoticeUI = {
      update(profile) {
        if (notices.profile?.id !== profile?.id) { if(card.open)card.close(); shown=null; renderedKey=""; }
        notices.update(profile);
        queueMicrotask(render);
      },
    };
  }
})(typeof globalThis !== "undefined" ? globalThis : this, () => {
  "use strict";
  const platform = typeof module === "object" && module.exports
    ? require("./platform-contract") : globalThis.KillexPlatform;
  const key = (id) => platform.storageKey(".achievement-notices.v1.") + id;
  const achievementKey = (a) => (a.eventRunId ? `${a.id}:${a.eventRunId}` : a.id);
  class Notices {
    constructor(storage) {
      this.storage = storage;
      this.profile = null;
      this.seen = {};
    }
    update(profile) {
      if (!profile?.id || !profile.progress) return;
      if (this.profile?.id === profile.id && this.profile.revision > profile.revision) return;
      if (this.profile?.id !== profile.id) {
        this.seen = {};
        try {
          const saved = JSON.parse(this.storage.getItem(key(profile.id)));
          if (saved && typeof saved === "object" && !Array.isArray(saved)) this.seen = saved;
        } catch (_) {}
      }
      this.profile = profile;
    }
    pending() {
      if (!this.profile) return [];
      const list = [...(this.profile.progress.achievements || [])];
      return list
        .filter(
          (a) =>
            Number.isInteger(a.claimed) &&
            a.claimed > 0 &&
            a.claimed <= 10 &&
            a.claimed > (Number(this.seen[achievementKey(a)]) || 0),
        )
        .map((a) => ({ id: a.id, name: a.name, degree: a.claimed }));
    }
    dismiss(id, degree) {
      if (!this.profile || !this.pending().some((a) => a.id === id && a.degree === degree)) return;
      const entry = this.profile.progress.achievements.find((a) => a.id === id) || { id };
      this.seen[achievementKey(entry)] = degree;
      try {
        this.storage.setItem(key(this.profile.id), JSON.stringify(this.seen));
      } catch (_) {}
    }
  }
  return { Notices };
});
