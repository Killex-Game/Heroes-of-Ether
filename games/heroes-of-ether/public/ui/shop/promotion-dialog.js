"use strict";
(() => {
  const el = (tag, cls, text) => {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined) node.textContent = text;
    return node;
  };
  const number = value => value.toLocaleString("ru-RU");
  const isClanBundle = offer => offer.weekendId === "promotion:weekend:23" && offer.rewards?.length === 7 &&
    Object.entries(window.KillexWeekendProducts.get("promotion:weekend:23").exactBoosters)
      .every(([id,amount])=>offer.exactBoosters?.[id]===amount);
  const clanBundleIcon = "assets/boosters/bundles-v1/256/clan.webp?art=20261123-interface-art";
  function rewards(offer) {
    if (isClanBundle(offer)) return [{id:"clan",name:"Клановые бустеры*",icon:clanBundleIcon,
      note:"*По 200 штук каждого кланового бустера"}];
    if (offer.rewards) return offer.rewards;
    const items = Object.entries(offer.wallet).map(([id, amount]) => ({
      id, amount, name: {coins:"Монеты",crystals:"Кристаллы",bucks:"Эфир"}[id],
      icon:"assets/menu-icons/128/currency_"+id+".webp",
    }));
    for (const [id, label] of [["common","Обычные бустеры"],["advanced","Улучшенные бустеры"],["rare","Редкие бустеры"]]) {
      if (offer.boosters[id]) items.push({id, name:label, amount:offer.boosters[id],
        icon:"assets/boosters/bundles-v1/256/"+id+".webp", note:"Случайный набор"});
    }
    if (offer.vipMs) items.push({id:"vip",name:"VIP",amount:offer.vipMs/86400000,
      unit:"дня",icon:"assets/accounts/vip.png?art=20261123-interface-art"});
    return items;
  }
  class PromotionsUI {
    constructor(owner) {
      this.owner = owner;
      this.trigger = document.getElementById("promotionsButton");
      this.countdown = el("span", "promotions-countdown");
      this.trigger.append(this.countdown);
      this.clockOffset = 0;
      this.dialog = el("dialog", "clan-dialog promotions-dialog");
      this.dialog.id = "promotionsDialog";
      this.dialog.setAttribute("aria-labelledby", "promotionsTitle");
      const head = el("header", "clan-heading");
      this.title = el("h2", "", "Акции");
      this.title.id = "promotionsTitle";
      const close = el("button", "booster-close", "×");
      close.type = "button";
      close.setAttribute("aria-label", "Закрыть акции");
      close.onclick = () => this.dialog.close();
      head.append(this.title, close);
      this.tabs = el("nav", "promotion-tabs");
      this.tabs.setAttribute("aria-label", "Доступные акции");
      this.grid = el("div", "promotions-grid");
      this.empty = el("p", "promotions-empty", "Сейчас нет доступных акций.");
      const layout = el("div", "promotion-layout");
      layout.append(this.tabs, this.grid);
      this.dialog.append(head, layout, this.empty);
      document.body.append(this.dialog);
      this.trigger.onclick = () => this.open();
      document.addEventListener("killex:profile", () => {
        this.render();
        if (this.dialog.open) this.rememberShown();
        this.schedule();
      });
      for (const event of ["killex:boot-ready", "visibilitychange", "close"])
        document.addEventListener(event, () => this.schedule(), true);
      new MutationObserver(() => this.schedule()).observe(document.body,
        {attributes:true,attributeFilter:["data-screen"]});
      this.sessionSeen = new Set();
      this.dialog.addEventListener("close", () => {
        (this.trigger.hidden ? document.getElementById("shopSection") : this.trigger)?.focus({preventScroll:true});
      });
      window.KillexActivity.every(() => this.updateCountdown(), 1000,
        () => document.body.dataset.screen === "lobby" &&
          (this.dialog.open || window.KillexActivity.visible(this.trigger)));
      this.render();
      this.schedule();
    }
    available() {
      const profile = this.owner.getProfile(), catalog = window.KillexVirtualProducts;
      const active = (profile?.promotions || []).filter(id => profile.promotionEndsAt?.[id] > Date.now() + this.clockOffset);
      const preview = profile?.promotionPreview ? [
        ...catalog.products.filter(p => p.type === "promotion").map(p => p.id),
        ...(profile.promotionPreview.productIds || []),
      ] : [];
      if (profile?.promotionPreview && ![...active,...preview].some(id => catalog.get(id)?.milestone))
        preview.push("promotion:century:100");
      // An actual occurrence replaces its preview, never produces a second buy button.
      return [...new Set([...active,...preview])].map(id => catalog.get(id,profile))
        .filter(p => p?.type === "promotion" && (!p.weekendId || p.occurrenceId ||
          !active.some(id => catalog.get(id)?.weekendId === p.weekendId)));
    }
    render() {
      const profile = this.owner.getProfile();
      if (Number.isFinite(profile?.promotionServerTime) && profile.promotionServerTime !== this.clockStamp) {
        this.clockStamp = profile.promotionServerTime;
        this.clockOffset = this.clockStamp - Date.now();
      }
      const offers = this.available();
      this.offerCount = offers.length;
      this.trigger.hidden = offers.length === 0;
      if (!offers.length && this.dialog.open) this.dialog.close();
      this.trigger.dataset.empty = String(!offers.length);
      this.preview = profile?.promotionPreview || null;
      if (this.preview && !this.previewStartedAt) this.previewStartedAt = Date.now() + this.clockOffset;
      const active = offers.filter(p => profile.promotions?.includes(p.id));
      this.nextDeadline = active.length ? Math.min(...active.map(p => profile.promotionEndsAt[p.id])) : null;
      this.empty.hidden = !!offers.length;
      this.grid.hidden = !offers.length;
      this.tabs.hidden = offers.length < 2;
      const offer = offers.find(p => p.id === this.selected) || offers[0];
      this.selected = offer?.id;
      const renderKey = JSON.stringify([offers, this.selected, profile?.promotionEndsAt, this.preview, offers.map(p => profile?.promotions?.includes(p.id) && profile?.promotionEndsAt?.[p.id] > Date.now() + this.clockOffset)]);
      if (renderKey === this.renderKey) { this.updateCountdown(); return; }
      this.renderKey = renderKey;
      this.tabs.replaceChildren();
      for (const item of offers) {
        const tab = el("button", "promotion-tab");
        const icon = el("img"); icon.src = window.KillexArtRevision.url(isClanBundle(item) ? clanBundleIcon : item.icon); icon.alt = ""; icon.width = icon.height = 40;
        tab.append(icon,el("span","",item.name));
        tab.type = "button";
        tab.dataset.productId = item.id;
        tab.setAttribute("aria-pressed", String(item.id === this.selected));
        tab.onclick = () => { this.selected = item.id; this.render();
          [...this.tabs.children].find(n=>n.dataset.productId===item.id)?.focus({preventScroll:true}); };
        this.tabs.append(tab);
      }
      this.grid.replaceChildren();
      this.title.textContent = offer?.name || "Акции";
      if (offer) this.renderOffer(offer, profile);
      this.updateCountdown();
    }
    renderOffer(offer, profile) {
      const card = el("article", "promotion-card");
      card.dataset.productId = offer.id;
      const items = rewards(offer);
      const palettes = ["gold","ice","emerald","flame","violet","rose","ice","gold","flame","violet","emerald","emerald","gold","violet","flame","rose","emerald","rose","flame","gold","flame","violet","flame","ice","emerald","gold"];
      this.dialog.dataset.palette = offer.weekendId ? palettes[offer.number-1] : offer.milestone ? "violet" : "gold";
      this.dialog.style.setProperty("--offer-width", (Math.max(isClanBundle(offer) ? 400 : 520, items.length * 174 + 74) + (this.offerCount > 1 ? 104 : 0)) + "px");
      const list = el("ul", "promotion-rewards");
      for (const item of items) {
        const row = el("li");
        row.dataset.rewardId = item.id;
        const art = el("div", "promotion-reward-art"), image = el("img");
        image.src = window.KillexArtRevision.url(item.icon); image.alt = ""; image.width = image.height = 88;
        if (item.icon.startsWith("assets/boosters/bundles-v1/256/"))
          image.srcset = (item.id === "clan" ? [256,512] : [128,256,512]).map((size,index) =>
            item.icon.replace("/256/", "/"+size+"/")+" "+(2**index)+"x").join(", ");
        art.append(image);
        row.append(art);
        if (Number.isFinite(item.amount)) row.append(el("strong", "promotion-amount", number(item.amount) + (item.unit ? " " + item.unit : "")));
        row.append(el("span", "promotion-reward-name", item.name));
        if (item.note) row.append(el("small", item.id === "clan" ? "promotion-bundle-note" : "promotion-random", item.note));
        list.append(row);
      }
      const eligible = profile.promotions?.includes(offer.id) && profile.promotionEndsAt?.[offer.id] > Date.now()+this.clockOffset;
      const deadline = el("small", "promotion-deadline");
      if (eligible) deadline.dataset.endsAt = String(profile.promotionEndsAt[offer.id]);
      else deadline.textContent = "Предпросмотр, покупка недоступна";
      const buy = el("button", "sf-button promotion-buy", "Купить за "+window.KillexVirtualProducts.votesLabel(offer.votes));
      buy.type = "button";
      buy.setAttribute("aria-label", "Купить: "+offer.name+" за "+window.KillexVirtualProducts.votesLabel(offer.votes));
      window.KillexControls.state(buy, !eligible);
      buy.onclick = () => window.KillexMockPayments.open(offer.id, {
        getProfile:()=>this.owner.getProfile(),
        unavailable:()=>!this.owner.isLobby() || this.owner.inArena(),
        updateProfile: p=>this.owner.updateProfile(p),
      });
      const footer = el("div", "promotion-footer");
      const purchase = el("div", "promotion-purchase");
      purchase.append(buy);
      if (offer.originalVotes) purchase.append(el("del", "promotion-old-price", window.KillexVirtualProducts.votesLabel(offer.originalVotes)));
      footer.append(deadline, purchase);
      card.append(list,footer);
      this.grid.append(card);
    }
    updateCountdown() {
      const now = Date.now()+this.clockOffset;
      const format = milliseconds => {
        const s = Math.max(0,Math.ceil(milliseconds/1000)),days = Math.floor(s/86400);
        const clock = [Math.floor(s/3600)%24,Math.floor(s/60)%60,s%60].map(n=>String(n).padStart(2,"0")).join(":");
        return (days?days+" д ":"")+clock;
      };
      for (const node of this.grid.querySelectorAll("[data-ends-at]"))
        node.textContent = "До конца акции: "+format(Number(node.dataset.endsAt)-now);
      if (this.nextDeadline && this.nextDeadline <= now) { this.render(); return; }
      this.countdown.textContent = this.nextDeadline ? format(this.nextDeadline-now) : this.preview
        ? format(this.preview.cycleMs-((now-this.previewStartedAt)%this.preview.cycleMs)) : "Нет предложений";
      this.countdown.title = this.nextDeadline ? "До окончания ближайшей доступной акции" : this.preview ? "Тестовый таймер" : "Сейчас нет доступных акций";
    }
    async open() {
      if (!this.owner.isLobby() || this.owner.inArena()) return;
      this.render();
      window.KillexWindows.open(this.dialog);
      this.rememberShown();
      await this.owner.loadProfile();
      this.render();
    }
    schedule() {
      if (this.scheduled) return;
      this.scheduled = true;
      queueMicrotask(() => { this.scheduled = false; this.autoOpen(); });
    }
    autoOpen() {
      const profile = this.owner.getProfile();
      if (!profile || document.hidden || document.body.dataset.screen !== "lobby" || !this.owner.isLobby() || this.owner.inArena() ||
        window.KillexBoot?.active || window.KillexMaintenance?.blocked ||
        document.querySelector('dialog[open], dialog[data-required="true"]') ||
        !document.getElementById("settingsMenu")?.hidden) return;
      const unread = this.available().filter(p => profile.promotions?.includes(p.id) &&
        !profile.seenPromotionIds?.includes(p.id) && !this.sessionSeen.has(profile.id+":"+p.id));
      if (!unread.length) return;
      this.selected = (unread.find(p=>p.weekendId) || unread[0]).id;
      this.render(); window.KillexWindows.open(this.dialog); this.rememberShown();
    }
    async rememberShown() {
      if (!this.dialog.open || document.hidden || this.ackPending) return;
      const profile = this.owner.getProfile();
      const ids = this.available().filter(p=>profile.promotions?.includes(p.id) &&
        !profile.seenPromotionIds?.includes(p.id)).map(p=>p.id).slice(0,40);
      if (!ids.length) return;
      for(const id of ids)this.sessionSeen.add(profile.id+":"+id);
      this.ackPending = true;
      try {
        const response = await fetch("/api/profile/promotions/seen", {method:"POST",
          headers:{"Content-Type":"application/json"},signal:AbortSignal.timeout(8000),
          body:JSON.stringify({ids,requestId:window.KillexRequestIds.create()})});
        const data = await response.json();
        if (response.ok && this.owner.getProfile()?.id===profile.id) this.owner.updateProfile(data.profile);
      } catch (_) { /* Manual reopen retries. A future session can show the unacknowledged offer. */ }
      finally { this.ackPending=false; }
    }
  }
  window.KillexPromotionsUI = PromotionsUI;
})();
