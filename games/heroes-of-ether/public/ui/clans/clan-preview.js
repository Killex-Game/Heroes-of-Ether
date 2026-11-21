/* Public roster and battle, kept separate from the viewer's clan controls. */
"use strict";
(() => {
  const el = (tag, cls, text) => {
    const node = document.createElement(tag);
    node.className = cls || "";
    if (text !== undefined) node.textContent = text;
    return node;
  };
  class ClanPreview {
    static link(node, clan, open) {
      if (!clan?.id) return;
      const link = el("button", "clan-view-link");
      link.type = "button";
      link.setAttribute("aria-label", `Посмотреть клан [${clan.prefix}] ${clan.name}`);
      link.onclick = () => open(clan.id);
      node.classList.add("clan-view-target");
      node.append(link);
    }
    constructor(owner) {
      this.owner = owner;
      this.readOnly = true;
      this.dialog = el("dialog", "clan-dialog clan-preview-dialog");
      this.dialog.id = "clanPreviewDialog";
      this.dialog.setAttribute("aria-labelledby", "clanPreviewTitle");
      const header = el("header", "clan-heading");
      this.title = el("h2", "", "Просмотр клана");
      this.title.id = "clanPreviewTitle";
      const close = el("button", "booster-close", "×");
      close.type = "button";
      close.setAttribute("aria-label", "Закрыть просмотр клана");
      close.onclick = () => this.dialog.close();
      header.append(this.title, close);
      this.status = el("p", "clan-status");
      this.status.setAttribute("role", "status");
      this.content = el("div", "clan-content");
      this.dialog.append(header, this.status, this.content);
      document.body.append(this.dialog);
      this.battles = new window.KillexClanBattleUI(this);
      this.dialog.addEventListener("close", () => {
        this.timer?.();
        this.request?.abort();
        this.clanId = null;
      });
    }
    openClan(id) { return this.open(id); }
    async open(id) {
      if (!id || !this.owner.game.isLobby()) return;
      if (id === this.owner.data?.profile?.clanId || id === this.owner.data?.mine?.id) {
        if (this.dialog.open) this.dialog.close();
        if (window.KillexWindows.top() === this.owner.dialog && this.owner.mode === "home")
          return;
        return this.owner.open();
      }
      this.request?.abort();
      this.clanId = id;
      this.signature = "";
      this.title.textContent = "Просмотр клана";
      this.content.replaceChildren();
      this.status.textContent = "Загрузка…";
      window.KillexUITheme.inherit(this.dialog, this.owner.dialog);
      window.KillexWindows.open(this.dialog);
      this.timer?.();
      this.timer = window.KillexActivity.every(() => {
        if (document.hidden || window.KillexWindows.top() !== this.dialog) return;
        this.battles.updateCountdown();
        if (Date.now() - this.polledAt >= 5000) this.load();
      }, 1000, () => this.dialog.open);
      await this.load();
    }
    async load() {
      if (this.request && !this.request.signal.aborted) return;
      const id = this.clanId, request = new AbortController();
      this.request = request;
      this.polledAt = Date.now();
      const timeout = setTimeout(() => request.abort(), 8000);
      try {
        const response = await fetch("/api/clans/view?clanId=" + encodeURIComponent(id), {
          cache: "no-store", signal: request.signal,
        });
        const data = await response.json();
        if (!this.dialog.open || id !== this.clanId || request.signal.aborted) return;
        if (!response.ok) {
          if ([401, 403, 404].includes(response.status)) {
            this.timer?.();
            this.content.replaceChildren();
          }
          throw Error(data.error || "Не удалось открыть клан.");
        }
        this.status.textContent = "";
        const signature = JSON.stringify(data);
        if (signature === this.signature) return;
        this.signature = signature;
        this.render(data);
      } catch (error) {
        if (id === this.clanId && this.dialog.open && this.request === request)
          this.status.textContent = error.name === "AbortError" ? "Нет связи с сервером. Повторяем…" : error.message;
      } finally {
        clearTimeout(timeout);
        if (this.request === request) this.request = null;
      }
    }
    render({ clan, competition }) {
      this.title.textContent = `[${clan.prefix}] ${clan.name}`;
      window.KillexAppearance.paintBackground(this.dialog, clan.appearance?.background, "clan");
      const banner = el("section", "clan-preview-banner clan-panel");
      const crest = el("img", "clan-crest");
      crest.alt = "";
      window.KillexClanCrests.paintImage(crest, clan.crest, clan.emblem);
      const info = el("div", "clan-preview-info");
      const meta = el("small", "clan-preview-meta");
      meta.append(
        el("span", "", `Уровень клана: ${clan.progress.level}`),
        el("span", "", `Участников: ${clan.count} / ${clan.capacity}`),
      );
      info.append(el("p", "", clan.description), meta);
      banner.append(crest, info);
      const awards = el("div", "clan-award-showcases clan-preview-awards");
      awards.setAttribute("aria-label", "Награды клана за всё время");
      for (const shelf of [this.owner.medalShelf(competition, { earnedOnly: true }),
        this.owner.trophyShelf(competition, { earnedOnly: true })]) {
        if (shelf.querySelector(".clan-league-medal")) awards.append(shelf);
      }
      if (awards.childElementCount) banner.append(awards);
      const layout = el("div", "clan-preview-grid");
      const members = el("section", "clan-panel clan-preview-members");
      members.append(el("h3", "", "Участники"));
      const list = el("div", "clan-preview-member-list");
      list.tabIndex = 0;
      list.setAttribute("aria-label", "Участники клана");
      for (const p of clan.members) list.append(this.owner.memberRow(p, clan, { readOnly: true, competitionMode:competition.mode }));
      const scroll = this.content.querySelector(".clan-preview-member-list")?.scrollTop || 0;
      const panelScroll = this.content.querySelector(".clan-preview-grid > :last-child")?.scrollTop || 0;
      members.append(list);
      this.battles.countdown=null;
      layout.append(members, competition.mode==='quests'
        ? window.KillexClanDailyQuests.panel(competition)
        : this.battles.battle({ ...competition, group: competition.hasGroup ? {} : null }, clan));
      this.content.replaceChildren(banner, layout);
      list.scrollTop = scroll;
      layout.lastElementChild.scrollTop = panelScroll;
    }
  }
  window.KillexClanPreview = ClanPreview;
})();
