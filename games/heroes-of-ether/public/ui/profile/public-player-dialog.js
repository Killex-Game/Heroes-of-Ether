/* Просмотр другого игрока, аватар, награды и ссылка VK. */
"use strict";
(() => {
  const el = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  };
  const number = (n) => (n || 0).toLocaleString("ru-RU");
  let ownProfile;
  document.addEventListener("killex:profile", (event) => {
    ownProfile = event.detail;
  });
  function avatar(p, className = "", { showPresence = true, imageSize } = {}) {
    const box = el("span", "player-avatar " + className),
      disc = el("span", "avatar-disc"),
      img = el("img");
    const identity = window.KillexIdentity;
    const skin = identity.allSkins.find((item) => item.id === p.skinId) || identity.skins[0];
    if (skin.variants)
      // A portrait enlarged by its caller needs a matching source, including
      // the 2x variant selected by setSkinImage on high-density screens.
      identity.setSkinImage(img, skin, imageSize || (className === "public-player-avatar" ? 160 : 64));
    else img.src = skin.arena;
    img.alt = "";
    disc.append(img);
    box.append(disc);
    window.KillexAppearance?.paintFrame(box, p.appearance?.avatarFrame, p.account);
    const tier = p.account?.premium ? "premium" : p.account?.vip ? "vip" : null;
    if (tier) {
      box.dataset.account = tier;
      const badge = el("img", "player-account-badge");
      badge.src = "assets/accounts/" + tier + ".png";
      badge.alt = tier === "vip" ? "VIP" : "Premium";
      box.append(badge);
    }
    if (showPresence) {
      const presence = el("span", "player-online-indicator");
      presence.dataset.online = String(p.online === true);
      presence.title = p.online ? "В сети" : "Не в сети";
      presence.setAttribute("role", "img");
      presence.setAttribute("aria-label", presence.title);
      box.append(presence);
    }
    return box;
  }
  class PlayerProfileUI {
    constructor() {
      this.dialog = el("dialog", "player-profile-dialog");
      this.dialog.id = "playerProfileDialog";
      this.dialog.setAttribute("aria-labelledby", "publicPlayerTitle");
      document.body.append(this.dialog);
      this.dialog.addEventListener("close", () => {
        if (this.dialog.open) return; // Событие закрытия может прийти после быстрого повторного открытия.
        this.abort?.abort();
        clearTimeout(this.giftExpiryTimer);
        this.awards?.destroy();
        this.request++;
      });
      this.request = 0;
      document.addEventListener("killex:profile", (event) => {
        if (!this.dialog.open || this.player?.id !== event.detail.id) return;
        const fields = [
          "appearance",
          "title",
          "titleMedals",
          "regalia",
          "eventRegalia",
          "seasonTrophies",
          "social",
          "easter",
        ];
        if (
          !fields.some((key) =>
            key === "appearance"
              ? ["avatarFrame", "profileBackground"].some(
                  (slot) => this.player.appearance?.[slot] !== event.detail.appearance?.[slot],
                )
              : JSON.stringify(this.player[key]) !== JSON.stringify(event.detail[key]),
          )
        )
          return;
        this.render({
          ...this.player,
          ...Object.fromEntries(fields.map((key) => [key, event.detail[key]])),
        });
      });
    }
    async open(id) {
      clearTimeout(this.giftExpiryTimer);
      this.player = null;
      this.abort?.abort();
      this.abort = new AbortController();
      const request = ++this.request;
      const header = el("header", "personal-heading"),
        title = el("h2", "", "Профиль игрока");
      title.id = "publicPlayerTitle";
      const close = el("button", "personal-close", "×");
      close.type = "button";
      close.setAttribute("aria-label", "Закрыть профиль игрока");
      close.onclick = () => this.dialog.close();
      header.append(title, close);
      this.body = el("div", "public-player-content", "");
      this.dialog.replaceChildren(header, this.body);
      window.KillexWindows.open(this.dialog);
      try {
        const response = await fetch("/api/players/" + encodeURIComponent(id), {
          signal: AbortSignal.any([this.abort.signal, AbortSignal.timeout(8000)]),
        });
        const data = await response.json();
        if (!response.ok) throw Error(data.error || "Не удалось открыть профиль.");
        if (request !== this.request) return;
        title.textContent = window.KillexIdentity.label(data.player);
        this.render(data.player);
      } catch (error) {
        if (request === this.request && error.name !== "AbortError")
          this.body.textContent = error.message;
      }
    }
    async refresh(id) {
      if (!this.dialog.open || this.player?.id !== id) return;
      this.abort?.abort();
      this.abort = new AbortController();
      const request = ++this.request;
      try {
        const response = await fetch("/api/players/" + encodeURIComponent(id), {
          signal: AbortSignal.any([this.abort.signal, AbortSignal.timeout(8000)]),
        });
        const data = await response.json();
        if (!response.ok || data.player?.id !== id) return;
        if (request !== this.request || !this.dialog.open || this.player?.id !== id) return;
        this.dialog.querySelector("#publicPlayerTitle").textContent = window.KillexIdentity.label(data.player);
        this.render(data.player);
      } catch {
        // The gift is already committed. A failed read must neither report
        // a failed gift nor reopen a closed/different player's profile.
      }
    }
    render(p) {
      const previousPlayer = this.player, previousAwards = this.awards,
        shelfPosition = previousPlayer?.id === p.id && this.dialog.open
          ? previousAwards?.position() : null;
      this.player = p;
      clearTimeout(this.giftExpiryTimer);
      const now = Date.now(),
        nextExpiry = Math.min(
          ...(p.social?.effects || []).map((e) => e.until).filter((expiry) => expiry > now),
          ...(p.social?.gifts || []).flatMap((gift) =>
              [gift.nextExpiry, ...gift.history.map((received) => received.expiresAt)].filter((expiry) => expiry > now),
          ),
        );
      if (Number.isFinite(nextExpiry))
        this.giftExpiryTimer = setTimeout(
          () => {
              if (this.dialog.open) {
                if (this.player.social?.gifts.some(g => g.historyMore)) this.refresh(this.player.id);
                else this.render(this.player);
              }
          },
          Math.min(2147483647, nextExpiry - now + 1),
        );
      queueMicrotask(() => document.dispatchEvent(new Event("killex:profile-scene")));
      const hero = el("div", "public-player-hero");
      window.KillexAppearance?.paintBackground(
        hero,
        p.appearance?.profileBackground,
        "profile",
      );
      if (p.appearance?.profileBackground === "heroic") {
        const glow = el("div", "heroic-magic"); glow.setAttribute("aria-hidden", "true");
        for (let i=0;i<7;i++) { const mote=el("i"); mote.style.cssText="--x:"+(12+i*13)+"%;--delay:"+(-i*1.7)+"s;--duration:11s"; glow.append(mote); }
        hero.append(glow);
      }
      hero.append(avatar(p, "public-player-avatar", { showPresence: false }));
      if (ownProfile?.id === p.id) {
        const edit = el("button", "public-background-edit");
        edit.type = "button";
        edit.setAttribute("aria-label", "Изменить фон мини-профиля");
        edit.title = "Изменить фон мини-профиля";
        edit.innerHTML =
          '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m4 16-1 5 5-1L20 8l-4-4L4 16Zm10-10 4 4M4 16l4 4" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>';
        edit.onclick = () => window.KillexAppearance.open("profileBackground");
        hero.append(edit);
      }
      window.KillexSocial?.giftButton(hero, p);
      const activeGifts = (p.social?.effects || []).filter((e) => e.until > now);
      const effects = el("div", "public-gift-effects");
      if (activeGifts.length) {
        effects.setAttribute("aria-label", "Действующие подарки");
        for (const e of activeGifts) {
          const item = el("span", "public-gift-effect"),
            image = el("img");
          image.src = e.icon;
          image.alt = "";
          const cancelled = activeGifts.some(
            (other) => other.stat === e.stat && other.percent === -e.percent,
          );
          item.append(image, el("span", "", e.name + (cancelled ? ": компенсирован" : "")));
          item.title = `${e.description}. До ${new Date(e.until).toLocaleString("ru-RU")}`;
          effects.append(item);
        }
      }
      const awardKey = JSON.stringify({
        seasonTrophies:p.seasonTrophies, clanQuestMedals:p.clanQuestMedals,
        eventRegalia:p.eventRegalia, easter:p.easter?.trophies, regalia:p.regalia,
        titleMedals:p.titleMedals, title:p.title, clanFrame:p.clanFrame,
        gifts:p.social?.gifts.map(g=>({id:g.id,count:g.count,latestAt:g.latestAt,
          effectUntil:g.effectUntil > now ? g.effectUntil : 0,historyMore:!!g.historyMore,
          history:g.history.filter(h=>h.expiresAt > now).map(h=>
            [h.id,h.at,h.expiresAt,h.fromName,!!h.anonymous])}))
      });
      if (previousPlayer?.id !== p.id || this.awardKey !== awardKey || !this.awards) {
        this.awards?.destroy();
        this.awards = window.KillexPlayerAwards.create(p);
        this.awardKey = awardKey;
      }
      const shelf = this.awards.element;
      const details = el("div", "public-player-details"),
        social = el("section", "public-player-social");
      social.append(avatar(p), el("strong", "public-player-name", p.name));
      window.KillexSocial?.profileControls(social, p, avatar);
      const clan = el("section", "public-player-clan");
      if (p.clanId) {
        const crest = el("img", "clan-crest");
        window.KillexClanCrests.paintImage?.(crest, p.clanCrest, p.clanEmblem);
        crest.alt = "";
        clan.append(
          crest,
          el(
            "strong",
            p.clanFrame === "champion" ? "clan-champion-name" : "",
            "[" + p.clanPrefix + "] " + p.clanName,
          ),
        );
      } else clan.append(el("span", "clan-muted", "Без клана"));
      const stats = el("dl", "public-player-stats");
      for (const [label, value, greatness] of [
        ["Величие:", p.greatness, true],
        ["Место в топе:", p.rank],
        ["Рекорд массы:", p.maxMass],
        ["Съедено игроков:", p.bestAbsorptions],
      ]) {
        const dt = el("dt", "", label),
          dd = el("dd");
        dd.append(
          greatness
            ? window.KillexGreatnessUI.value(number(value))
            : document.createTextNode(number(value)),
        );
        stats.append(dt, dd);
      }
      if (!p.absorptionsTracked)
        stats.title = "Рекорд реальных поглощений учитывается с этого обновления.";
      details.append(social, clan, stats);
      this.body.replaceChildren(
        hero,
        ...(activeGifts.length ? [effects] : []),
        el("h3", "public-shelf-title", "Витрина наград"),
        shelf,
        details,
      );
      if (shelfPosition) this.awards.restore(shelfPosition);
    }
  }
  let dialog;
  window.KillexPlayerProfile = {
    avatar,
    open: (id) => (dialog ||= new PlayerProfileUI()).open(id),
    refresh: (id) => dialog?.refresh(id),
  };
})();
