/* Магазин, инвентарь, быстрые слоты и отправка применения бустера. */
"use strict";
(() => {
  const make = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };
  const button = (className, text, action) => {
    const node = make("button", className, text);
    node.type = "button";
    if (action) node.addEventListener("click", action);
    return node;
  };
  const requestId = () => window.KillexRequestIds.create();
  // Unchanged HUD values must not create DOM mutations on every animation frame.
  const setAttribute = (node, name, value) => {
    if (node.getAttribute(name) !== value) node.setAttribute(name, value);
  };
  const setText = (node, value) => {
    if (node.textContent !== value) node.textContent = value;
  };
  const setSweep = (node, value) => {
    if (node.style.getPropertyValue("--cooldown-sweep") !== value)
      node.style.setProperty("--cooldown-sweep", value);
  };
  async function fetchJson(url, options = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    try {
      const response = await fetch(url, { ...options, signal: controller.signal });
      const data = await response.json();
      if (data.code === "ACCOUNT_BANNED") location.assign("/blocked.html");
      if(data.code==='MAINTENANCE'){if(typeof data.maintenance==='boolean')window.KillexMaintenance?.update(data);else window.KillexMaintenance?.check();}
      if (!response.ok)
        throw Object.assign(Error(data.error || "Сервер отклонил операцию."), {
          serverResponse: true,
          code: data.code,
        });
      return data;
    } catch (error) {
      if (error.name === "AbortError") throw Error("Сервер не ответил вовремя.");
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }
  class BoosterUI {
    constructor(game) {
      this.game = game;
      this.ready = false;
      this.serverInArena = false;
      this.profile = null;
      this.catalog = null;
      this.mode = "shop";
      this.shopCategory = "boosters";
      this.accessoryCategory = "hat";
      this.targeting = null;
      this.purchase = null;
      this.activations = new Map();
      this.slots = [];
      this.stateReceivedAt = performance.now();
      this.budgetUntil = 0;
      try {
        const saved = JSON.parse(
          localStorage.getItem(window.KillexPlatform.storageKey(".boosterSlots.v1")) || "[]",
        );
        if (Array.isArray(saved))
          this.slots = saved.slice(0, 7).map((id) => (typeof id === "string" ? id : null));
      } catch (_) {}
      this.build();
      this.donation = new window.KillexDonationUI(this);
      document.getElementById("shopSection").addEventListener("click", () => this.open("shop"));
      document
        .getElementById("inventorySection")
        .addEventListener("click", () => this.open("inventory"));
      document.addEventListener("killex:open-chests", (event) => {
        this.chestCategory = event.detail?.category === "treasury" ? "treasury" : "titles";
        this.open("chests");
      });
      document.addEventListener("visibilitychange", () => {
        if (!document.hidden && !this.game.isArena()) this.load();
      });
      window.addEventListener("focus", () => {
        if (!this.game.isArena()) this.load(true);
      });
      // Другая вкладка того же профиля могла войти или выйти. Сервер всё равно
      // проверяет каждую покупку; опрос лишь обновляет доступность кнопок.
      window.KillexActivity.every(() => {
        if (
          (this.dialog.open || this.donation.dialog.open || this.serverInArena) &&
          !document.hidden &&
          !this.game.isArena()
        )
          this.load(true);
      }, 30000, () => !this.game.isArena() && (this.dialog.open || this.donation.dialog.open || this.serverInArena));
      this.load();
    }
    build() {
      this.dialog = make("dialog", "booster-dialog");
      this.dialog.id = "boosterDialog";
      this.dialog.setAttribute("aria-labelledby", "boosterTitle");
      const heading = make("div", "booster-heading");
      this.title = make("h2", "", "Магазин бустеров");
      this.title.id = "boosterTitle";
      const close = button("booster-close", "×", () => this.dialog.close());
      close.setAttribute("aria-label", "Закрыть бустеры");
      heading.append(this.title, close);
      this.wallet = make("div", "booster-wallet");
      this.note = make(
        "p",
        "booster-note",
        "Профиль хранится на этом сервере. Стартовые 1000 монет и 100 кристаллов выдаются один раз. Это тестовая валюта.",
      );
      const tabs = make("div", "booster-tabs");
      this.shopTab = button("sf-tab", "Магазин", () => this.setMode("shop"));
      this.inventoryTab = button("sf-tab", "Инвентарь", () => this.setMode("inventory"));
      this.chestsTab = button("sf-tab", "Сундуки", () => this.setMode("chests"));
      this.inventoryTab.dataset.noticeGroup = "inventoryItems";
      this.chestsTab.dataset.noticeGroup = "chests";
      tabs.append(this.shopTab, this.inventoryTab, this.chestsTab);
      this.shopCategories = make("div", "cosmetics-tabs shop-categories");
      this.shopCategories.setAttribute("aria-label", "Разделы магазина");
      this.categoryButtons = new Map();
      for (const [id, label] of [
        ["boosters", "Бустеры"],
        ["skins", "Скины"],
        ["accessories", "Аксессуары"],
      ]) {
        const tab = button("sf-tab", label, () => this.setShopCategory(id));
        this.categoryButtons.set(id, tab);
        this.shopCategories.append(tab);
      }
      this.accessoryCategories = make("div", "accessory-shop-tabs");
      this.accessoryCategories.setAttribute("role", "group");
      this.accessoryCategories.setAttribute("aria-label", "Виды аксессуаров");
      this.accessoryCategoryButtons = new Map();
      for (const [id, label] of [
        ["hat", "Шапки"],
        ["bow", "Бабочки"],
      ]) {
        const tab = button("sf-tab", label, () => {
          this.accessoryCategory = id;
          this.render();
        });
        this.accessoryCategoryButtons.set(id, tab);
        this.accessoryCategories.append(tab);
      }
      this.shopCategories.append(this.accessoryCategories);
      this.skinShop = window.KillexCosmeticsUI.createShop(
        () => {
          this.dialog.close();
          document.dispatchEvent(new CustomEvent("killex:open-skins"));
        },
        (item) => this.buySkinCollection(item),
      );
      this.accessoryShop = make("div", "booster-grid accessory-shop");
      this.accessoryShop.id = "accessoryShop";
      this.message = make("p", "booster-message");
      this.message.setAttribute("role", "status");
      this.shopLock = make("p", "booster-shop-lock");
      this.shopLock.setAttribute("role", "status");
      this.shopLock.hidden = true;
      this.grid = make("div", "booster-grid");
      this.grid.id = "boosterGrid";
      this.chests = new window.KillexChestUI(this);
      this.clanChests = new window.KillexClanChestInventory(this);
      this.chestCategory = "titles";
      this.chestCategories = make("nav", "cosmetics-tabs chest-categories");
      this.chestCategories.setAttribute("aria-label", "Разделы сундуков");
      this.chestCategoryButtons = new Map();
      for (const [id, label] of [
        ["titles", "Сундуки титулов"],
        ["treasury", "Сокровищница"],
      ]) {
        const tab = button("sf-tab", label, () => {
          this.chestCategory = id;
          this.setMode("chests");
        });
        tab.dataset.noticeGroup = id === "titles" ? "titleChests" : "treasury";
        this.chestCategories.append(tab);
        this.chestCategoryButtons.set(id, tab);
      }
      this.inventoryRack = make("section", "inventory-loadout lobby-loadout");
      this.inventoryRack.id = "inventoryLoadout";
      this.inventoryRack.hidden = true;
      this.dialog.append(
        heading,
        this.wallet,
        this.note,
        tabs,
        this.inventoryRack,
        this.shopCategories,
        this.shopLock,
        this.message,
        this.chestCategories,
        this.clanChests.root,
        this.grid,
        this.chests.root,
        this.skinShop,
        this.accessoryShop,
      );
      document.body.append(this.dialog);
      this.dialog.addEventListener("close", () => {
        this.game.stop();
      });
      const arena = document.getElementById("arena");
      this.quick = make("div", "booster-quick");
      this.quick.setAttribute("aria-label", "Быстрые бустеры");
      // A secondary finger does not reliably produce click while a joystick touch
      // is held. Resolve touch/pen taps by pointer ID; suppress the later native click.
      const taps = new Map();
      let dispatchingTouch = false;
      this.quick.addEventListener("pointerdown", (event) => {
        event.preventDefault();
        if (event.pointerType !== "touch" && event.pointerType !== "pen") return;
        const control = event.target.closest("button");
        if (!control || control.disabled || !this.quick.contains(control)) return;
        taps.set(event.pointerId, { control, x: event.clientX, y: event.clientY });
        try { this.quick.setPointerCapture(event.pointerId); } catch (_) { /* pointercancel clears the tap. */ }
      });
      this.quick.addEventListener("pointerup", (event) => {
        const tap = taps.get(event.pointerId);
        taps.delete(event.pointerId);
        if (!tap) return;
        event.preventDefault();
        if (this.quick.hasPointerCapture(event.pointerId)) this.quick.releasePointerCapture(event.pointerId);
        const rect = tap.control.getBoundingClientRect();
        if (tap.control.disabled || !tap.control.isConnected ||
          Math.hypot(event.clientX - tap.x, event.clientY - tap.y) > 16 ||
          event.clientX < rect.left || event.clientX > rect.right ||
          event.clientY < rect.top || event.clientY > rect.bottom) return;
        dispatchingTouch = true;
        try { tap.control.click(); } finally { dispatchingTouch = false; }
      });
      for (const type of ["pointercancel", "lostpointercapture"])
        this.quick.addEventListener(type, (event) => taps.delete(event.pointerId));
      window.addEventListener("blur", () => taps.clear());
      document.addEventListener("visibilitychange", () => { if (document.hidden) taps.clear(); });
      this.quick.addEventListener(
        "click",
        (event) => {
          if (dispatchingTouch) return;
          event.preventDefault();
          event.stopImmediatePropagation();
        },
        true,
      );
      this.budget = make("p", "booster-budget");
      this.budget.id = "boosterBudget";
      this.quick.append(this.budget);
      this.slotButtons = Array.from({ length: window.KillexLoadout.keys.length }, (_, i) => {
        const control = button("booster-slot", "", () => this.useSlot(i));
        control.tabIndex = -1;
        control.dataset.slot = String(i + 1);
        this.quick.append(control);
        return control;
      });
      this.turboSequence = 0;
      this.turboPending = null;
      this.turboButton = button("booster-slot turbo-slot", "", () => this.toggleTurbo());
      this.turboButton.tabIndex = -1;
      this.turboButton.id = "turboButton";
      this.turboButton.hidden = true;
      const turboIcon = make("img", "turbo-symbol");
      turboIcon.src = "assets/boosters/turbo-bolt-v1.svg?art=20261123-interface-art"; turboIcon.alt = "";
      turboIcon.width = turboIcon.height = 48;
      this.turboButton.append(
        turboIcon,
        make("span", "booster-slot-key", "T"),
      );
      this.turboOverlay = make("span", "booster-slot-cooldown");
      this.turboOverlay.setAttribute("aria-hidden", "true");
      this.turboSeconds = make("span", "booster-cooldown-seconds", "0");
      this.turboOverlay.append(this.turboSeconds);
      this.turboMode = make("span", "turbo-mode", "Турбо");
      this.turboButton.append(this.turboOverlay, this.turboMode);
      this.quick.append(this.turboButton);
      this.potionButton = button("booster-slot alchemy-slot", "", () => this.usePotion());
      this.potionButton.id = "potionSlotZ";
      this.potionButton.tabIndex = -1;
      this.potionButton.hidden = true;
      this.quick.append(this.potionButton);
      this.arenaInfo = make("div", "booster-arena-info");
      this.effects = make("p", "booster-effects");
      this.arenaMessage = make("p", "booster-arena-message");
      this.arenaMessage.setAttribute("role", "status");
      this.cancel = button("booster-cancel sf-button sf-secondary", "Отменить выбор цели", () =>
        this.cancelTarget(),
      );
      this.cancel.hidden = true;
      this.arenaInfo.append(this.effects, this.arenaMessage, this.cancel);
      arena.append(this.quick, this.arenaInfo);
      this.loadout = new window.KillexLoadoutUI(this);
      this.inventoryLoadout = new window.KillexLoadoutUI(this, this.inventoryRack, true);
    }
    async load(silent = false) {
      if (!["http:", "https:"].includes(location.protocol)) return;
      if (this.loading) {
        this.reloadRequested = true;
        return;
      }
      this.loading = true;
      try {
        const data = await fetchJson("/api/profile", { cache: "no-store",
          ...(this.loadedProfileId ? { headers: { "X-Killex-Profile": this.loadedProfileId } } : {}) });
        // An automatic retry must not create another guest if the browser
        // rejected the session cookie. This ID is not an authentication token.
        this.loadedProfileId = data.profile.id;
        document.dispatchEvent(new CustomEvent("killex:server-time", { detail: data.serverNow }));
        this.catalog = data.catalog;
        document.dispatchEvent(
          new CustomEvent("killex:catalog", {
            detail: {
              profileId: data.profile.id,
              catalog: data.catalog,
            },
          }),
        );
        this.game.catalogChanged?.(this.catalog);
        const arenaChanged = this.serverInArena !== (data.inArena === true);
        this.serverInArena = data.inArena === true;
        this.slots = this.slots.map((id) => (this.item(id)?.ready ? id : null));
        this.ready = true;
        const accountChanged =
          this.profile?.account?.vip !== data.profile.account?.vip ||
          this.profile?.account?.premium !== data.profile.account?.premium ||
          this.profile?.account?.currencyBonusResetAt !==
            data.profile.account?.currencyBonusResetAt;
        if (
          !this.profile ||
          this.profile.id !== data.profile.id ||
          this.profile.revision !== data.profile.revision ||
          this.profile.eventVersion !== data.profile.eventVersion ||
          this.profile.promotionVersion !== data.profile.promotionVersion ||
          JSON.stringify(this.profile.appearance) !== JSON.stringify(data.profile.appearance) ||
          accountChanged
        )
          this.updateProfile(data.profile);
        else if (arenaChanged) this.render(); // Не сбрасываем фокус и прокрутку при тихом опросе.
        this.donation.refreshBonuses();
        if (
          data.profile.dailyLoginReward &&
          data.profile.revision >= (this.profile?.revision || 0) &&
          !data.profile.personal?.introPending &&
          !data.inArena &&
          this.game.isLobby() &&
          !document.hidden
        )
          this.showLoginReward(data.profile.dailyLoginReward);
      } catch (error) {
        window.KillexBoot?.profileFailed();
        this.status(error.message + " Проверь соединение и открой раздел ещё раз.", true);
        if (!this.ready)
          document.getElementById("walletStatus").textContent = "Нет связи с профилем";
      } finally {
        this.loading = false;
        this.loadout.refreshAvailability();
        this.inventoryLoadout.refreshAvailability();
        this.game.readyChanged(this.ready);
        if (this.reloadRequested) {
          this.reloadRequested = false;
          this.load(true);
        }
      }
    }
    item(id) {
      return this.catalog?.items.find((item) => item.id === id);
    }
    slotCapacity() {
      return window.KillexLoadout.count(
        this.game.isArena() ? this.game.getMe()?.account : this.profile?.account,
      );
    }
    slotAvailable(index) {
      const player = this.game.isArena() ? this.game.getMe() : this.profile;
      return window.KillexLoadout.unlocked(index, player?.account, player?.level || 1);
    }
    purchasesBlocked() {
      return this.game.isArena() || this.serverInArena;
    }
    showLoginReward({ date, day, reward }) {
      if (this.loginRewardDialog?.isConnected) return;
      const art = {
        coins: ["Монеты", "menu-icons/128/currency_coins.webp"],
        crystals: ["Кристаллы", "menu-icons/128/currency_crystals.webp"],
        bucks: ["Эфир", "menu-icons/128/currency_bucks.webp"],
        rare: ["Случайные редкие бустеры", "boosters/png/golden_shield.png"],
        advanced: ["Случайные улучшенные бустеры"],
        vipHours: ["VIP", "accounts/vip.png"],
      };
      const dialog = make("dialog", "daily-login-dialog");
      this.loginRewardDialog = dialog;
      dialog.setAttribute("closedby", "none");
      dialog.addEventListener("cancel", (event) => event.preventDefault());
      const heading = make("h2", "", "Ежедневная награда!");
      heading.id = "dailyLoginTitle";
      dialog.setAttribute("aria-labelledby", heading.id);
      const week = make("ol", "daily-login-week");
      window.KillexLoginRewards.forEach((scheduled, index) => {
        const n = index + 1,
          today = n === day;
        const card = make("li", "daily-login-day");
        card.dataset.state = today ? "today" : n < day ? "past" : "future";
        if (today) card.setAttribute("aria-current", "step");
        const prizes = make("div", "daily-login-prizes");
        for (const [kind, count] of Object.entries(today ? reward : scheduled)) {
          const [name, path] = art[kind];
          const line = make("span", "daily-login-prize");
          if (kind === "advanced") {
            line.classList.add("promotion-booster");
            line.dataset.rarity = kind;
            const dot = make("span", "promotion-rarity");
            dot.setAttribute("aria-hidden", "true");
            line.append(dot);
          } else {
            const image = make("img");
            image.src = "assets/" + path;
            image.alt = name;
            line.append(image);
          }
          line.title = name;
          line.append(make("b", "", kind === "vipHours" ? "VIP " + count + " ч" : "+" + count));
          if (kind === "rare" || kind === "advanced")
            line.append(
              make("small", "", kind === "rare" ? "Редкие бустеры" : "Улучшенные бустеры"),
            );
          prizes.append(line);
        }
        card.append(make("strong", "daily-login-day-label", "День " + n), prizes);
        if (n <= day)
          card.append(make("small", "daily-login-state", today ? "Сегодня" : "✓ Получено"));
        week.append(card);
      });
      const status = make("p", "daily-login-status");
      status.setAttribute("role", "status");
      status.hidden = true;
      let claiming = false;
      const done = button("sf-button sf-primary daily-login-done", "Забрать награду", async () => {
        if (claiming) return;
        claiming = true;
        window.KillexControls.state(done, true, false);
        // Keep the reward action label while awaiting its receipt.
        status.hidden = true;
        try {
          const award = await fetchJson("/api/profile/login-reward", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ date }),
          });
          this.updateProfile(award.profile);
          dialog.close();
        } catch (error) {
          status.textContent = error.message;
          status.hidden = false;
        } finally {
          claiming = false;
          window.KillexControls.state(done, false);
          done.textContent = "Забрать награду";
        }
      });
      done.autofocus = true;
      dialog.append(
        heading,
        make("p", "daily-login-subtitle", "Заходи каждый день, чтобы собрать все семь наград."),
        week,
        status,
        done,
      );
      dialog.addEventListener(
        "close",
        () => {
          if (this.loginRewardDialog === dialog) this.loginRewardDialog = null;
          dialog.remove();
        },
        { once: true },
      );
      document.body.append(dialog);
      window.KillexWindows.open(dialog);
    }
    renderWallet(node, wallet) {
      node.replaceChildren();
      for (const [currency, label] of [
        ["coins", " монет"],
        ["crystals", " кристаллов"],
        ["bucks", " эфира"],
      ]) {
        if (currency !== "coins") node.append(make("span", "sr-only", " - "));
        const pill = make("span", "sf-currency sf-currency-" + currency);
        pill.append(
          make("span", "sf-currency-value", wallet[currency].toLocaleString("ru-RU")),
          make("span", "sr-only", label),
        );
        const icon = make("img", "currency-icon");
        icon.alt = "";
        icon.width = 64;
        icon.height = 64;
        icon.src = `assets/menu-icons/64/currency_${currency}.webp?art=20261123-interface-art`;
        icon.srcset = `assets/menu-icons/64/currency_${currency}.webp 1x, assets/menu-icons/128/currency_${currency}.webp 2x`;
        pill.append(icon);
        const group = make("span", "sf-currency-wallet");
        const plus = button(`currency-add ${currency}-add`, "", () =>
          this.donation.open(node, currency),
        );
        const packageLabel =
          currency === "coins" ? "монеток" : currency === "crystals" ? "кристаллов" : "эфира";
        plus.dataset.currency = currency;
        plus.setAttribute("aria-label", `Покупка ${packageLabel}`);
        plus.setAttribute("aria-haspopup", "dialog");
        plus.setAttribute("aria-controls", "donationDialog");
        const account = this.profile.account;
        if (
          ["vip", "premium"].some(
            (kind) =>
              account?.[kind] && account.currencyBonuses?.[kind]?.[currency]?.claimed === false,
          )
        ) {
          const notice = make("span", "menu-notification-dot currency-bonus-dot");
          notice.setAttribute("aria-hidden", "true");
          plus.append(notice);
          plus.setAttribute("aria-label", `Покупка ${packageLabel}. Доступен ежедневный бонус`);
        }
        group.append(pill, plus);
        node.append(group);
      }
    }
    updateProfile(profile) {
      if (!profile || (this.profile?.id === profile.id && profile.revision < this.profile.revision))
        return;
      this.profile = profile;
      if (
        Array.isArray(profile.quickSlots) &&
        (this.slots.length !== profile.quickSlots.length ||
          this.slots.some((id, i) => id !== profile.quickSlots[i]))
      ) {
        this.slots = [...profile.quickSlots];
        this.saveSlots();
      }
      // На арене обновляем данные и HUD, а скрытые витрины - при возвращении.
      if (document.body.dataset.screen !== "arena") this.refreshLobby();
      else document.dispatchEvent(new CustomEvent("killex:arena-profile", { detail: profile }));
      this.updateQuick();
    }
    refreshLobby() {
      const profile = this.profile;
      if (!profile) return;
      document.dispatchEvent(new CustomEvent("killex:profile", { detail: profile }));
      this.renderWallet(document.getElementById("walletStatus"), profile.wallet);
      this.renderWallet(this.wallet, profile.wallet);
      const clanLabel = document.getElementById("profileClan");
      if (clanLabel)
        clanLabel.textContent = profile.clanPrefix
          ? `[${profile.clanPrefix}] - Уровень ${profile.level}`
          : `Без клана - Уровень ${profile.level}`;
      if (clanLabel)
        clanLabel.classList.toggle("clan-champion-name", profile.clanFrame === "champion");
      this.render();
    }
    status(text, error = false) {
      this.message.textContent = text;
      this.message.dataset.error = String(error);
      this.message.hidden = !text;
    }
    open(mode, category) {
      if (this.game.isArena()) return;
      if (mode === "shop" && !this.dialog.open) window.KillexAudio?.play?.("shop");
      if (!this.dialog.open) {
        this.shopCategory = category || "boosters";
        this.accessoryCategory = "hat";
        if (mode !== "chests") this.chestCategory = "titles";
      }
      this.game.stop();
      this.cancelTarget();
      window.KillexControls.state(this.shopTab, this.game.isArena());
      this.shopTab.title = this.game.isArena() ? "Покупки доступны в лобби" : "";
      this.setMode(this.game.isArena() ? "inventory" : mode);
      window.KillexWindows.open(this.dialog);
      this.load(true);
    }
    setMode(mode) {
      if (mode === "shop" && this.game.isArena()) return;
      this.mode = mode;
      this.title.textContent =
        mode === "shop"
          ? "Магазин"
          : mode === "chests"
            ? this.chestCategory === "treasury"
              ? "Сокровищница"
              : "Сундуки титулов"
            : "Инвентарь";
      this.dialog.dataset.mode = mode;
      this.shopTab.setAttribute("aria-pressed", String(mode === "shop"));
      this.inventoryTab.setAttribute("aria-pressed", String(mode === "inventory"));
      this.chestsTab.setAttribute("aria-pressed", String(mode === "chests"));
      this.status("");
      this.render();
    }
    setShopCategory(category) {
      if (!this.categoryButtons.has(category)) return;
      this.shopCategory = category;
      this.setMode("shop");
    }
    openSkinShop() {
      if (this.game.isArena()) return;
      this.shopCategory = "skins";
      this.open("shop", "skins");
    }
    render() {
      // Hidden lobby cards need no rebuilding while life progress arrives.
      // Opening the shop or returning to the lobby renders the current profile.
      if (this.game.isArena() && !this.dialog.open) return;
      this.dialog.dataset.chestCategory = this.chestCategory;
      this.clanChests.root.hidden = this.mode !== "chests" || this.chestCategory !== "treasury";
      if (!this.clanChests.root.hidden) this.clanChests.render();
      this.loadout?.render();
      this.inventoryLoadout?.render();
      this.inventoryRack.hidden = this.mode !== "inventory";
      const chestsMode = this.mode === "chests";
      const skinsMode = this.mode === "shop" && this.shopCategory === "skins";
      const accessoriesMode = this.mode === "shop" && this.shopCategory === "accessories";
      this.accessoryShop.hidden = !accessoriesMode;
      this.accessoryCategories.hidden = !accessoriesMode;
      for (const [id, tab] of this.accessoryCategoryButtons)
        tab.setAttribute("aria-pressed", String(id === this.accessoryCategory));
      this.shopCategories.hidden = this.mode !== "shop";
      this.skinShop.hidden = !skinsMode;
      for (const [id, tab] of this.categoryButtons)
        tab.setAttribute("aria-pressed", String(id === this.shopCategory));
      this.grid.hidden = chestsMode || skinsMode || accessoriesMode;
      this.chests.root.hidden = !chestsMode || this.chestCategory !== "titles";
      this.chestCategories.hidden = !chestsMode;
      for (const [id, tab] of this.chestCategoryButtons)
        tab.setAttribute("aria-pressed", String(id === this.chestCategory));
      this.message.hidden = !this.message.textContent;
      this.note.hidden = skinsMode || accessoriesMode;
      if (chestsMode) this.chests.render();
      if (!this.catalog || !this.profile) {
        this.grid.replaceChildren(make("p", "booster-empty", ""));
        return;
      }
      this.shopLock.hidden = !this.purchasesBlocked();
      this.shopLock.textContent =
        "Покупки, открытие сундуков и смена слотов недоступны, пока профиль на арене. Вернись в лобби в игровой вкладке.";
      this.skinShop.update(this.profile, this.skinCollectionPurchase, this.purchasesBlocked());
      if (accessoriesMode) this.renderAccessories();
      if (chestsMode || skinsMode || accessoriesMode) return;
      const gridKey = JSON.stringify([this.mode, this.catalog, this.profile.inventory, this.profile.level,
        this.profile.wallet, this.profile.account, this.profile.easter?.batches, window.KillexAlchemyRules.equipped(this.profile.alchemy),
        this.slots, this.purchasesBlocked(), !!this.purchase, !!this.slotSaving, !!this.potionSaving]);
      if (gridKey === this.gridKey) return;
      this.gridKey = gridKey;
      const rarity = { common: 0, advanced: 1, rare: 2, clan: 3, event: 4 };
      const items = this.catalog.items
        .filter(
          (item) =>
            (this.mode !== "shop" || (!item.eventOnly && !["clan", "event", "potion"].includes(item.tier))) &&
            (this.mode !== "inventory" || (item.ready && this.profile.inventory[item.id] > 0)),
        )
        .sort(
          (a, b) =>
            (rarity[a.tier] ?? 4) - (rarity[b.tier] ?? 4) || a.name.localeCompare(b.name, "ru"),
        );
      const fragment = document.createDocumentFragment();
      for (const item of items) {
        const card = make("article", "booster-card");
        card.dataset.boosterId = item.id;
        card.dataset.ready = String(item.ready);
        card.style.setProperty("--tier-color", this.catalog.tiers[item.tier].rarity_color);
        const img = make("img");
        img.src = window.KillexArtRevision.url(item.icon);
        img.alt = "";
        img.width = 96;
        img.height = 96;
        img.draggable = false;
        card.draggable =
          this.mode === "inventory" && item.ready && item.tier !== "potion" && !this.purchasesBlocked() && !this.slotSaving;
        card.addEventListener("dragstart", (event) =>
          this.inventoryLoadout.startDrag(event, { itemId: item.id }),
        );
        card.addEventListener("dragend", () => this.inventoryLoadout.endDrag());
        const count = this.profile.inventory[item.id] || 0;
        const slot = make("div", "booster-art-slot");
        slot.dataset.tier = item.tier;
        slot.dataset.locked = String(!item.ready);
        slot.dataset.selected = String(this.mode === "inventory" && this.slots.includes(item.id));
        slot.append(img, make("span", "booster-art-count", String(count)));
        const head = make("div", "booster-card-head");
        head.append(make("span", "booster-tier", this.catalog.tiers[item.tier].name));
        if (this.mode === "shop") {
          const quantity = make("span", "booster-pack", `${item.price.quantity} шт.`);
          quantity.title =
            item.tier === "clan"
              ? "Каждому участнику за одну покупку главы"
              : "Количество за одну покупку";
          head.append(quantity);
        }
        card.append(head, slot, make("h3", "", item.name));
        if (item.id === "easter_egg") {
          const deadline = Math.min(
            ...(this.profile.easter?.batches || []).map((b) => b.expiresAt),
          );
          if (Number.isFinite(deadline))
            card.append(
              make(
                "small",
                "booster-expiry",
                "До " +
                  new Date(deadline).toLocaleString("ru-RU", {
                    day: "2-digit",
                    month: "2-digit",
                    year: "numeric",
                    hour: "2-digit",
                    minute: "2-digit",
                  }),
              ),
            );
        }
        window.KillexBoosterTooltip.attach(card, item);
        if (this.mode === "shop" && (!item.ready || !item.purchasable))
          card.append(make("p", "booster-reason", item.unavailableReason));
        let action;
        if (this.mode === "shop") {
          const levelLocked = this.profile.level < item.purchaseLevel;
          const { amount, currency, quantity } = item.price;
          const price = `${amount} ${currency === "bucks" ? "эфира" : currency === "coins" ? "монет" : amount === 1 ? "кристалл" : "кристаллов"}`;
          action = button(
            "booster-action sf-button",
            levelLocked
              ? `С ${item.purchaseLevel} уровня`
              : item.purchasable
                ? `Купить ${amount}`
                : item.tier === "clan"
                  ? "В магазине клана"
                  : "Пока недоступен",
            () => this.buy(item),
          );
          if (item.purchasable) {
            const currencyIcon = make("img", "booster-price-icon");
            currencyIcon.src = `assets/menu-icons/64/currency_${currency}.webp?art=20261123-interface-art`;
            currencyIcon.alt = "";
            currencyIcon.width = 24;
            currencyIcon.height = 24;
            action.append(currencyIcon);
            action.setAttribute("aria-label", `Купить ${item.name}: ${quantity} шт. за ${price}`);
          }
          window.KillexControls.state(
            action,
            this.purchasesBlocked() ||
              !item.purchasable ||
              levelLocked ||
              !!this.purchase ||
              this.profile.wallet[currency] < amount,
            this.purchasesBlocked() ||
              !item.purchasable ||
              levelLocked ||
              this.profile.wallet[currency] < amount,
          );
          if (item.purchasable && this.profile.wallet[currency] < amount)
            action.title = "Недостаточно валюты";
          if (this.purchasesBlocked()) action.title = "Покупки доступны только вне арены";
        } else if (item.tier === "potion") {
          const rules = window.KillexAlchemyRules, id = rules.get(item.id).id;
          const queue = [...rules.equipped(this.profile.alchemy)], index = queue.indexOf(id);
          action = make("div", "potion-order-controls");
          const choose = button("booster-action sf-button", index < 0 ? "В очередь Z" : `Z: ${index + 1}, Убрать`,
            () => this.savePotionQueue(index < 0 ? [...queue, id] : queue.filter(key => key !== id)));
          choose.disabled = this.purchasesBlocked() || !!this.potionSaving || (index < 0 && queue.length >= rules.MAX_ACTIVE);
          action.append(choose);
          if (index >= 0) for (const [direction, label] of [[-1, "Раньше"], [1, "Позже"]]) {
            const move = button("sf-button sf-secondary", direction < 0 ? "←" : "→", () => {
              const next = [...queue]; [next[index], next[index + direction]] = [next[index + direction], next[index]];
              this.savePotionQueue(next);
            });
            move.setAttribute("aria-label", `${label}: ${item.name}`);
            move.disabled = choose.disabled || index + direction < 0 || index + direction >= queue.length;
            action.append(move);
          }
        } else {
          const index = this.slots.indexOf(item.id);
          const levelLocked = !window.KillexLoadout.itemAllowed(item, this.profile.level);
          const full =
            index < 0 &&
            window.KillexLoadout.emptyIndex(this.slots, this.slotCapacity(), (i) =>
              this.slotAvailable(i),
            ) < 0;
          action = button(
            "booster-action sf-button sf-secondary",
            levelLocked && index < 0
              ? `С ${item.useLevel || 1} уровня`
              : !item.ready
                ? "Пока недоступен"
                : index >= 0
                  ? `Убрать из слота ${window.KillexLoadout.keys[index]}`
                  : full
                    ? "Слоты заняты"
                    : "В быстрые слоты",
            () => this.toggleSlot(item.id),
          );
          window.KillexControls.state(
            action,
            this.purchasesBlocked() ||
              !!this.slotSaving ||
              !item.ready ||
              full ||
              (levelLocked && index < 0) ||
              (count === 0 && index < 0),
            this.purchasesBlocked() ||
              !item.ready ||
              full ||
              (levelLocked && index < 0) ||
              (count === 0 && index < 0),
          );
          if (full) action.title = "Освободи один из доступных слотов, чтобы добавить этот бустер.";
          action.setAttribute("aria-pressed", String(index >= 0));
        }
        action.dataset.action = this.mode;
        card.append(action);
        fragment.append(card);
      }
      if (!items.length)
        fragment.append(
          make(
            "p",
            "booster-empty",
            this.mode === "inventory"
              ? "Здесь пока нет доступных бустеров. Их можно получить в магазине, сундуках или клане."
              : "В этой категории пока нет бустеров.",
          ),
        );
      this.grid.replaceChildren(fragment);
    }
    renderAccessories() {
      const key = JSON.stringify([this.accessoryCategory, this.profile.wardrobe?.owned, this.profile.wallet,
        this.purchasesBlocked(), !!this.accessoryPurchase]);
      if (key === this.accessoryRenderKey) return;
      this.accessoryRenderKey = key;
      const fragment = document.createDocumentFragment();
      for (const item of window.KillexAccessories.items
        .filter((item) => item.price && item.slot === this.accessoryCategory)
        .sort(window.KillexSkinCollections.comparePrice)) {
        const owned = this.profile.wardrobe?.owned?.includes(item.id);
        const card = make("article", "booster-card accessory-card");
        card.dataset.accessoryId = item.id;
        card.dataset.boosterHintName = item.name;
        card.dataset.boosterHint = window.KillexAccessories.descriptionFor(item);
        card.tabIndex = 0;
        const image = make("img", "accessory-shop-art");
        image.src = window.KillexArtRevision.url(item.icon);
        image.alt = item.name;
        image.width = image.height = 112;
        const action = button(
          "booster-action",
          owned ? "В Гардероб" : "Купить " + item.price.toLocaleString("ru-RU"),
          () => {
            if (owned) {
              this.dialog.close();
              document.getElementById("wardrobeSection").click();
            } else this.buyAccessory(item);
          },
        );
        if (!owned) {
          const icon = make("img", "booster-price-icon");
          icon.src = "assets/menu-icons/64/currency_" + item.currency + ".webp";
          icon.alt = item.currency === "coins" ? "монет" : "кристаллов";
          action.append(icon);
        }
        window.KillexControls.state(
          action,
          this.purchasesBlocked() ||
            !!this.accessoryPurchase ||
            (!owned && this.profile.wallet[item.currency] < item.price),
          this.purchasesBlocked() || (!owned && this.profile.wallet[item.currency] < item.price),
        );
        card.append(
          make("small", "booster-tier", item.slot === "hat" ? "Шапка" : "Бабочка"),
          image,
          make("h3", "", item.name),
          make(
            "p",
            "accessory-shop-note",
            "Наведи чтобы узнать подробнее",
          ),
          action,
        );
        fragment.append(card);
      }
      this.accessoryShop.replaceChildren(fragment);
    }
    async buySkinCollection(item) {
      if (this.skinCollectionPurchase || this.purchasesBlocked()) return;
      const operation = { collectionId: item.id, requestId: requestId() };
      this.skinCollectionPurchase = operation;
      this.render();
      this.status("");
      try {
        let data;
        for (let attempt = 0; attempt < 2; attempt++) {
          try {
            data = await fetchJson("/api/profile/skin-collection", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(operation),
            });
            break;
          } catch (error) {
            if (attempt || error.serverResponse) throw error;
          }
        }
        this.updateProfile(data.profile);
      } catch (error) {
        if (error.code === "ARENA_ACTIVE") this.serverInArena = true;
        this.status(error.message, true);
        if (!error.serverResponse) await this.load(true).catch(() => {});
      } finally {
        this.skinCollectionPurchase = null;
        this.render();
      }
    }
    async buyAccessory(item) {
      if (this.accessoryPurchase || this.purchasesBlocked()) return;
      const operation = { action: "buy", accessoryId: item.id, requestId: requestId() };
      this.accessoryPurchase = operation;
      this.render();
      this.status("");
      try {
        let data;
        for (let attempt = 0; attempt < 2; attempt++) {
          try {
            data = await fetchJson("/api/profile/accessory", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(operation),
            });
            break;
          } catch (error) {
            if (attempt || error.serverResponse) throw error;
          }
        }
        this.updateProfile(data.profile);
        this.status("Куплено: " + item.name + ". Аксессуар доступен в Гардеробе.");
      } catch (error) {
        if (error.code === "ARENA_ACTIVE") this.serverInArena = true;
        this.status(error.message, true);
        if (!error.serverResponse) await this.load(true).catch(() => {});
      } finally {
        this.accessoryPurchase = null;
        this.render();
      }
    }
    async buy(item) {
      if (this.purchase || this.purchasesBlocked()) return;
      const operation = { boosterId: item.id, requestId: requestId() };
      this.purchase = operation;
      this.render();
      this.status("");
      try {
        // Повтор при потере ответа использует тот же ID: второй оплаты не будет.
        let data;
        for (let attempt = 0; attempt < 2; attempt++) {
          try {
            data = await fetchJson("/api/shop/buy", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(operation),
            });
            break;
          } catch (error) {
            if (attempt || error.serverResponse) throw error;
          }
        }
        this.updateProfile(data.profile);
        this.status(`Куплено: ${item.name}, ${item.price.quantity} шт. Предметы в инвентаре.`);
      } catch (error) {
        if (error.code === "ARENA_ACTIVE") this.serverInArena = true;
        this.status(
          error.message +
            (error.serverResponse
              ? ""
              : " Если связь прервалась, обнови инвентарь перед новой покупкой."),
          true,
        );
      } finally {
        this.purchase = null;
        this.render();
      }
    }
    saveSlots() {
      try {
        localStorage.setItem(
          window.KillexPlatform.storageKey(".boosterSlots.v1"),
          JSON.stringify(this.slots),
        );
      } catch (_) {}
    }
    async saveLoadout(slots = this.slots) {
      const operation = {
        ...this.game.getAppearance(),
        quickSlots: [...slots],
        requestId: requestId(),
      };
      let result;
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          result = await fetchJson("/api/profile/loadout", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(operation),
          });
          break;
        } catch (error) {
          if (attempt || error.serverResponse) throw error;
        }
      }
      this.updateProfile(result.profile);
      return result.profile;
    }
    async prepareArena() {
      await this.game.waitForCosmetics?.();
      if (this.slotSaving) await this.slotSaving;
      return this.saveLoadout();
    }
    async toggleSlot(id) {
      if (this.purchasesBlocked() || this.slotSaving) return;
      let next = [...this.slots];
      if (next.includes(id)) next = next.map((value) => (value === id ? null : value));
      else {
        if (!window.KillexLoadout.itemAllowed(this.item(id), this.profile?.level)) return false;
        const empty = window.KillexLoadout.emptyIndex(next, this.slotCapacity(), (i) =>
          this.slotAvailable(i),
        );
        if (empty < 0) {
          this.status("Все доступные слоты заняты. Освободи слот в витрине бустеров.", true);
          return;
        }
        while (next.length <= empty) next.push(null);
        next[empty] = id;
      }
      return this.changeSlots(next);
    }
    async changeSlots(next) {
      if (this.purchasesBlocked() || this.slotSaving) return false;
      if (
        next.some(
          (id) => id && !window.KillexLoadout.itemAllowed(this.item(id), this.profile?.level),
        )
      )
        return false;
      this.slotSaving = this.saveLoadout(next);
      this.render();
      try {
        await this.slotSaving;
        this.status("");
        return true;
      } catch (error) {
        this.status(error.message, true);
        return false;
      } finally {
        this.slotSaving = null;
        this.render();
        this.updateQuick();
      }
    }
    slotCount(item, me) {
      return item && me
        ? Math.max(
            0,
            Math.min(
              this.profile?.inventory[item.id] || 0,
              me.boosterLimit - (me.boosterUses?.[item.id] || 0),
            ),
          )
        : 0;
    }
    slotBlocked(item, me) {
      if (!item || !me) return true;
      if (me.level < item.useLevel) return true;
      if (item.kind === "mass" &&
          (me.parts?.find((part) => part.id === me.mainPartId)?.mass ?? me.mass) >= me.massLimit)
        return true;
      return this.cooldown(item, me).ms > 0;
    }
    cooldown(item, me) {
      const timer = window.KillexBoosterTiming.cooldown(
        item,
        me,
        Math.max(0, performance.now() - (this.stateReceivedAt || 0)),
        this.catalog?.rules,
      );
      const local = this.localCooldowns?.get(item?.id);
      if (local && me && local.serial === me.spawnSerial)
        timer.ms = Math.max(timer.ms, local.until - performance.now());
      return timer;
    }
    showArenaMessage(text, duration = 5000) {
      clearTimeout(this.messageTimer);
      this.arenaMessage.textContent = text;
      if (text && duration)
        this.messageTimer = setTimeout(() => {
          this.arenaMessage.textContent = "";
        }, duration);
    }
    updateQuick() {
      const me = this.game.getMe();
      this.updateTurbo(me);
      this.updatePotion(me);
      const budget =
        me && performance.now() < this.budgetUntil
          ? (this.potionButton.hidden ? `До ${me.boosterLimit} применений каждого слота` : `Слоты: до ${me.boosterLimit} раз, Z: до 3 разных зелий`)
          : "";
      if (this.budget.textContent !== budget) this.budget.textContent = budget;
      this.slotButtons.forEach((control, i) => {
        const petSlot = i === 5 ? this.game.petSlot?.() : null;
        const locked = !petSlot && !this.slotAvailable(i);
        const item = petSlot || this.item(this.slots[i]);
        const count = petSlot ? petSlot.count : this.slotCount(item, me),
          blocked = petSlot ? false : this.slotBlocked(item, me);
        const cooldown = petSlot
          ? { ms: petSlot.cooldownMs, duration: window.KillexPets.ABILITY_COOLDOWN_MS }
          : this.cooldown(item, me);
        const pending = this.activations.has(item?.id);
        const signature = `${item?.id}:${count}:${!!me}:${pending}:${this.targeting?.id}:${blocked}:${locked}`;
        if (control.dataset.state !== signature) {
          control.dataset.state = signature;
          const artworkKey = `${item?.id}:${locked}`;
          if (control.dataset.artwork !== artworkKey) {
            control.dataset.artwork = artworkKey;
            control.replaceChildren();
            control.dataset.tier = item?.tier || "common";
            const key = make("span", "booster-slot-key", window.KillexLoadout.keys[i]);
            if (item) {
              const img = make("img");
              img.src = window.KillexArtRevision.url(item.icon);
              img.alt = "";
              control.append(img, make("span", "booster-slot-count", String(count)), key);
              const overlay = make("span", "booster-slot-cooldown"),
                text = make("span", "booster-cooldown-seconds");
              overlay.setAttribute("aria-hidden", "true");
              overlay.append(text);
              control.append(overlay);
              control.cooldownOverlay = overlay;
              control.cooldownText = text;
              control.setAttribute(
                "aria-label",
                `${window.KillexLoadout.keys[i]}. ${item.name}, доступно за жизнь ${count}`,
              );
            } else {
              control.cooldownOverlay = null;
              control.cooldownText = null;
              control.append(make("span", "", "-"), key);
              control.setAttribute("aria-label", `Пустой слот ${window.KillexLoadout.keys[i]}`);
            }
            control.dataset.locked = String(locked);
            if (locked) {
              const unlock = window.KillexLoadout.unlockLabel(i);
              control.append(
                make("span", "loadout-lock", i === 3 ? "12 ур." : "VIP"),
              );
              const reason = i === 3 ? "Этот слот доступен с 12 уровня." : "Нужен активный " + unlock;
              control.setAttribute("aria-label", key.textContent + ". " + reason);
            }
          }
          if (item) {
            control.querySelector(".booster-slot-count").textContent = String(count);
            if (!locked) control.setAttribute("aria-label", `${window.KillexLoadout.keys[i]}. ${item.name}, доступно за жизнь ${count}`);
          }
          window.KillexControls.state(
            control,
            locked || !me || !item || !count || pending || blocked,
            locked || !me || !item || !count || blocked,
          );
          control.setAttribute("aria-pressed", String(!!item && this.targeting?.id === item.id));
        }
        const cooling = !!item && cooldown.ms > 0;
        setAttribute(control, "data-cooldown", String(cooling));
        if (control.cooldownOverlay) {
          if (control.cooldownOverlay.hidden === cooling) control.cooldownOverlay.hidden = !cooling;
          if (cooling) {
            setSweep(
              control.cooldownOverlay,
              Math.min(1, cooldown.ms / cooldown.duration) * 360 + "deg",
            );
            const text = window.KillexBoosterTiming.label(cooldown.ms);
            if (control.cooldownText.textContent !== text) control.cooldownText.textContent = text;
          }
        }
      });
    }
    nextPotion(me) {
      const rules = window.KillexAlchemyRules, used = rules.activeIds(me?.potion);
      if (used.length >= rules.MAX_ACTIVE) return null;
      return rules.equipped(this.profile?.alchemy).find(id => !used.includes(id) &&
        this.profile?.inventory[rules.get(id).boosterId] > 0) || null;
    }
    async savePotionQueue(queue) {
      if (this.potionSaving || this.purchasesBlocked()) return;
      const key = JSON.stringify(queue);
      const operation = this.potionRetry?.key === key ? this.potionRetry.operation :
        { action: "equip", potionIds: queue, requestId: requestId() };
      this.potionRetry = { key, operation }; this.potionSaving = true; this.render();
      try {
        const result = await fetchJson("/api/alchemy/action", { method: "POST",
          headers: { "Content-Type": "application/json" }, body: JSON.stringify(operation) });
        this.potionRetry = null;
        this.updateProfile(result.profile);
      } catch (error) {
        if (error.serverResponse) this.potionRetry = null;
        this.status(error.message, true);
      } finally { this.potionSaving = false; this.render(); }
    }
    updatePotion(me) {
      const used = window.KillexAlchemyRules.activeIds(me?.potion), next = this.nextPotion(me);
      const id = next || used.at(-1);
      const potion = window.KillexAlchemyRules.get(id);
      const owned = potion ? this.profile?.inventory[potion.boosterId] || 0 : 0;
      const visible = !!potion && (!!owned || !!me?.potion);
      if (this.potionButton.hidden !== !visible) this.potionButton.hidden = !visible;
      if (!visible) return;
      const pending = [...this.activations.keys()].some(id => this.item(id)?.kind === "potion");
      const state = [id, owned, used.join(","), pending].join(":");
      if (state !== this.potionRenderKey) {
        this.potionRenderKey = state;
        const source = window.KillexArtRevision.url(potion.image);
        if (this.potionButton.querySelector("img")?.getAttribute("src") !== source) {
          const image = make("img"); image.src = source; image.alt = "";
          this.potionButton.replaceChildren(image, make("span", "booster-slot-key", "Z"), make("span", "booster-slot-count"));
        }
        this.potionButton.querySelector(".booster-slot-count").textContent = next ? String(owned) : "✓";
        this.potionButton.title = (next ? "Следующее: " + potion.name + ". " + potion.effect + "\n" : "") +
          "Действуют: " + (used.map(id => window.KillexAlchemyRules.get(id).name).join(", ") || "нет");
        this.potionButton.setAttribute("aria-label", next ? potion.name + ", клавиша Z" : "Все выбранные зелья действуют до конца жизни");
      }
      const disabled = !me || !next || !owned || pending || this.game.inputBlocked();
      if (this.potionButton.disabled !== disabled) this.potionButton.disabled = disabled;
    }
    usePotion() {
      if (!this.game.isArena() || this.game.inputBlocked() || this.dialog.open) return;
      const me = this.game.getMe(), potion = window.KillexAlchemyRules.get(this.nextPotion(me));
      if (!me || !potion || [...this.activations.keys()].some(id => this.item(id)?.kind === "potion")) return;
      this.activate(this.item(potion.boosterId));
    }
    useSlot(i) {
      if (i === 5 && this.game.petSlot?.()) {
        this.game.usePetAbility("sixth");
        return;
      }
      if (
        i < 0 ||
        !this.slotAvailable(i) ||
        !this.game.isArena() ||
        this.dialog.open ||
        this.game.inputBlocked()
      )
        return;
      const item = this.item(this.slots[i]);
      if (!item || this.activations.has(item.id)) return;
      const me = this.game.getMe();
      if (!this.slotCount(item, me)) {
        this.showArenaMessage("В этом слоте больше нет применений на эту жизнь.");
        return;
      }
      if (this.slotBlocked(item, me)) return;
      if (item.target === "direction") {
        const aim = this.game.getAim();
        if (aim) {
          this.cancelTarget();
          this.activate(item, null, aim);
        } else {
          this.targeting = item;
          this.cancel.hidden = false;
          this.showArenaMessage(item.name + ": коснись арены, чтобы выбрать направление.", 0);
          this.updateQuick();
        }
      } else if (item.target === "opponent") {
        this.targeting = item;
        this.cancel.hidden = false;
        this.showArenaMessage(
          `${item.name}: нажми на соперника в пределах ${this.catalog.rules.targetRange}. Escape - отмена.`,
          0,
        );
        this.updateQuick();
      } else {
        this.cancelTarget();
        this.activate(item);
      }
    }
    selectTarget(target) {
      if (!this.targeting) return;
      if (!target || target.id === this.game.getMe()?.id) {
        this.showArenaMessage("Нажми на сферу соперника. Предмет ещё не потрачен.", 0);
        return;
      }
      const item = this.targeting;
      this.cancelTarget(false);
      this.activate(item, target);
    }
    selectAim(x, y) {
      if (this.targeting?.target !== "direction") return;
      const item = this.targeting;
      this.cancelTarget(false);
      this.activate(item, null, { x, y });
    }
    activate(item, target, aim) {
      if (item.petAbility) {
        this.game.usePetAbility(item.petAbility, aim);
        return;
      }
      const me = this.game.getMe();
      if (!me || this.activations.has(item.id)) return;
      const operation = {
        type: "useBooster",
        boosterId: item.id,
        requestId: requestId(),
        spawnSerial: me.spawnSerial,
      };
      if (target)
        Object.assign(operation, { targetId: target.id, targetSpawnSerial: target.spawnSerial });
      if (aim) Object.assign(operation, { aimX: aim.x, aimY: aim.y });
      if (!this.game.send(operation)) {
        this.showArenaMessage("Нет связи с сервером. Попробуй после восстановления.");
        return;
      }
      const pending = { operation, timer: null };
      this.activations.set(item.id, pending);
      (this.localCooldowns ||= new Map()).set(item.id, {
        serial: me.spawnSerial,
        until: performance.now() + (item.cooldownMs || this.catalog?.rules.cooldownMs || 500),
      });
      if (item.kind === "mass")
        this.massRepeatReadyAt = performance.now() + (item.cooldownMs || this.catalog?.rules.massRepeatMs || 200);
      this.showArenaMessage("", 0);
      pending.timer = setTimeout(() => {
        if (this.activations.get(item.id) !== pending) return;
        this.game.send(operation); // Тот же ID не расходует второй предмет.
        this.showArenaMessage("", 0);
        pending.timer = setTimeout(() => {
          if (this.activations.get(item.id) !== pending) return;
          this.activations.delete(item.id);
          this.stopMassRepeat();
          this.updateQuick();
          this.load();
          this.showArenaMessage(
            "Связь прервалась. Дождись восстановления количества бустеров перед повторным применением.",
          );
        }, 5000);
      }, 3000);
      this.updateQuick();
    }
    receive(message) {
      if (
        message.type === "turboResult" &&
        message.spawnSerial === this.game.getMe()?.spawnSerial
      ) {
        if (message.turbo.sequence >= this.turboPending?.sequence) this.turboPending = null;
        if (message.notice) this.showArenaMessage("Турбо закончилось!");
        return;
      }
      if (message.type === "profile" || message.type === "boosterResult") {
        if (message.profile) this.updateProfile(message.profile);
        else if (message.profilePatch) {
          const merged = window.KillexArenaWire.mergeProfile(this.profile, message.profilePatch);
          if (merged !== this.profile) this.updateProfile(merged);
        }
        const pending = [...this.activations.values()].find(
          ({ operation }) => operation.requestId === message.requestId,
        );
        if (message.type === "boosterResult" && pending) {
          const id = pending.operation.boosterId;
          if (!message.ok) this.localCooldowns?.delete(id);
          else if (Number.isFinite(message.repeatAfterMs))
            (this.localCooldowns ||= new Map()).set(id, {
              serial: pending.operation.spawnSerial,
              until: performance.now() + message.repeatAfterMs,
            });
          if (this.item(pending.operation.boosterId)?.kind === "mass") {
            if (!message.ok) this.stopMassRepeat();
            else if (this.massRepeatCode && Number.isFinite(message.repeatAfterMs))
              this.massRepeatReadyAt = performance.now() + message.repeatAfterMs;
          }
          clearTimeout(pending.timer);
          this.activations.delete(pending.operation.boosterId);
          this.showArenaMessage(message.ok ? "Бустер применён." : message.message);
          this.updateQuick();
        }
      }
    }
    updateState() {
      this.stateReceivedAt = performance.now();
      const me = this.game.getMe();
      const text = (me?.effects || [])
        .map(
          (effect) =>
            `${this.item(effect.id)?.name || effect.id}: ${Math.ceil(effect.remainingMs / 1000)} с`,
        )
        .join(", ");
      if (this.effects.textContent !== text) this.effects.textContent = text;
      this.updateQuick();
    }
    cancelTarget(clear = true) {
      this.targeting = null;
      this.cancel.hidden = true;
      if (clear) this.showArenaMessage("");
      this.updateQuick();
    }
    respawn() {
      this.stopMassRepeat();
      this.localCooldowns?.clear();
      this.turboPending = null;
      this.cancelTarget();
      this.effects.textContent = "";
      // Подтверждение уже отправленной операции всё ещё может прийти.
    }
    leaveArena() {
      this.stopMassRepeat();
      this.localCooldowns?.clear();
      this.turboPending = null;
      cancelAnimationFrame(this.cooldownFrame);
      this.budgetUntil = 0;
      for (const pending of this.activations.values()) clearTimeout(pending.timer);
      this.activations.clear();
      this.cancelTarget();
      this.effects.textContent = "";
      if (this.dialog.open) this.dialog.close();
    }
    enterArena() {
      this.loadout.clearDrag();
      this.donation.close();
      if (this.dialog.open) this.dialog.close();
      this.stateReceivedAt = performance.now();
      this.budgetUntil = this.stateReceivedAt + 20000;
      cancelAnimationFrame(this.cooldownFrame);
      const animate = () => {
        if (!this.game.isArena()) return;
        this.updateQuick();
        this.cooldownFrame = requestAnimationFrame(animate);
      };
      animate();
    }
    handleKey(event) {
      if (
        event.code === "KeyT" &&
        !event.ctrlKey &&
        !event.altKey &&
        !event.metaKey &&
        !event.target?.closest("input, textarea, select, [contenteditable], dialog")
      ) {
        if (!event.repeat) this.toggleTurbo();
        return this.game.isArena();
      }
      if (event.code === "Escape" && this.targeting) {
        this.cancelTarget();
        return true;
      }
      const i = window.KillexLoadout.keyIndex(event.code);
      if (event.code === "KeyZ" && this.game.isArena() && !event.ctrlKey && !event.altKey && !event.metaKey &&
          !event.target?.closest("input, textarea, select, [contenteditable], dialog")) {
        if (!event.repeat) this.usePotion();
        return true;
      }
      if (
        i >= 0 &&
        this.game.isArena() &&
        !event.ctrlKey &&
        !event.altKey &&
        !event.metaKey &&
        !event.target?.closest("input, textarea, select, [contenteditable], dialog")
      ) {
        if (!event.repeat) {
          this.stopMassRepeat();
          this.useSlot(i);
          const item = this.item(this.slots[i]);
          const me = this.game.getMe();
          if (item?.kind === "mass" && me && !this.game.inputBlocked() && !this.dialog.open) {
            const serial = me.spawnSerial;
            this.massRepeatReadyAt = performance.now() + (item.cooldownMs || this.catalog?.rules.massRepeatMs || 200);
            this.massRepeatCode = event.code;
            this.massRepeatTimer = setInterval(() => {
              const current = this.game.getMe();
              if (
                !this.game.isArena() ||
                !current ||
                current.spawnSerial !== serial ||
                document.hidden ||
                this.game.inputBlocked() ||
                this.dialog.open ||
                document.activeElement?.closest(
                  "input, textarea, select, [contenteditable], dialog",
                ) ||
                this.slots[i] !== item.id ||
                !this.slotAvailable(i) ||
                !this.slotCount(item, current)
              ) {
                this.stopMassRepeat();
                return;
              }
              // One request in flight; slow networks never build a queue of purchases/uses.
              if (!this.activations.has(item.id) && performance.now() >= this.massRepeatReadyAt &&
                  !this.slotBlocked(item, current))
                this.useSlot(i);
            }, 25);
          }
        }
        return true;
      }
      return false;
    }
    handleKeyUp(event) {
      if (event.code === this.massRepeatCode) this.stopMassRepeat();
    }
    stopMassRepeat() {
      clearInterval(this.massRepeatTimer);
      this.massRepeatTimer = null;
      this.massRepeatCode = null;
    }
    toggleTurbo() {
      if (!this.game.isArena() || this.dialog.open || this.game.inputBlocked()) return;
      const me = this.game.getMe();
      if (!me?.turbo || me.turbo.totalMs <= 0) return;
      const active = !(this.turboPending?.active ?? me.turbo.active);
      const operation = {
        type: "setTurbo",
        spawnSerial: me.spawnSerial,
        active,
        sequence: ++this.turboSequence,
      };
      if (this.game.send(operation)) this.turboPending = operation;
    }
    updateTurbo(me) {
      if (!this.turboButton) return;
      const t = me?.turbo,
        ms = window.KillexBoosterTiming.turbo(t, performance.now() - this.stateReceivedAt);
      const hidden = !t || t.totalMs <= 0;
      if (this.turboButton.hidden !== hidden) this.turboButton.hidden = hidden;
      if (this.turboButton.disabled !== hidden)
        window.KillexControls.state(this.turboButton, hidden);
      setAttribute(this.turboButton, "aria-pressed", String(!!t?.active));
      setAttribute(this.turboButton, "data-active", String(!!t?.active));
      setAttribute(this.turboButton, "data-exhausted", String(ms <= 0));
      setSweep(this.turboOverlay, Math.min(1, ms / (t?.totalMs || 60000)) * 360 + "deg");
      setText(this.turboSeconds, String(Math.ceil(ms / 1000)));
      setText(this.turboMode, ms <= 0 ? "Исчерпано" : t?.active ? "Включено" : "Пауза");
      setAttribute(
        this.turboButton,
        "aria-label",
        `Турбо: ${this.turboMode.textContent}, осталось ${Math.ceil(ms / 1000)} с`,
      );
    }
  }
  window.KillexBoosterUI = BoosterUI;
})();
