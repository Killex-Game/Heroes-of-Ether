/* Скины, гардероб, аксессуары и наборы аккаунтов. */
"use strict";
(() => {
  const el = (tag, cls, text) => {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined) node.textContent = text;
    return node;
  };
  const button = (cls, text, action) => {
    const node = el("button", cls, text);
    node.type = "button";
    if (action) node.addEventListener("click", action);
    return node;
  };
  const setSkinImage = window.KillexIdentity.setSkinImage;
  function accessorySummary(item) {
    const b = item.bonus || {};
    if (b.xp) return `+${b.xp}% опыта`;
    if (b.massXp) return `+${b.massXp}% опыта за массу`;
    if (b.lightSpeed) return `+${b.lightSpeed}% скорости до 5 000 массы`;
    if (b.freezeReduction) return `Заморозка короче на ${b.freezeReduction}%`;
    if (b.foodRadius) return `+${b.foodRadius}% к радиусу сбора эфира`;
    if (b.decayReduction) return `Потеря массы медленнее на ${b.decayReduction}%`;
    if (b.feedSpeed) return `После W: +${b.feedSpeed}% скорости на 3 с`;
    if (b.petTime) return `+${b.petTime}% времени питомца`;
    if (b.shieldSpeed) return `При потере щита: +${b.shieldSpeed}% скорости`;
    if (b.killXp) return `+${b.killXp}% опыта за поглощения`;
    if (b.food) return `+${b.food}% массы от эфира`;
    if (item.titleDegree)
      return "За титул «" + window.KillexAccessories.titleSets[item.titleDegree - 1].name + "»";
    if (item.eventReward) return "Награда события";
    return "Декоративный аксессуар";
  }
  function accessoryDetails(item) {
    const details = el("div", "accessory-details");
    if (item.ability) {
      const ability = item.ability;
      const key = el("kbd", "accessory-key", "E");
      key.setAttribute("aria-hidden", "true");
      const line = el("span", "accessory-charge");
      line.setAttribute("aria-label", `Клавиша E: ${ability.name}, ${ability.count} за жизнь`);
      const icon = el("img", "accessory-booster-icon");
      icon.src = ability.icon;
      icon.alt = "";
      icon.width = 30;
      icon.height = 30;
      line.append(key, el("span", "", ":"), el("strong", "", `×${ability.count}`), icon);
      details.append(line);
    } else details.append(el("span", "accessory-summary", accessorySummary(item)));
    // Shared popover supports hover, keyboard focus and touch focus. Keep the
    // full rules here instead of truncating them or repeating them in the card.
    const full = [
      item.ability
        ? `Клавиша E: ${item.ability.name}, ${item.ability.count} применения за жизнь.`
        : item.id !== "novice_hat"
          ? item.bonusLabel || item.description
          : "",
      item.id !== "novice_hat" && item.description !== item.bonusLabel ? item.description : "",
    ].filter(Boolean);
    if (full.length) {
      details.dataset.boosterHintName = item.name;
      details.dataset.boosterHint = [...new Set(full)].join(" ");
      details.tabIndex = 0;
      details.classList.add("has-details");
    }
    return details;
  }
  function dialog(id, title, closeLabel, returnTo) {
    const root = el("dialog", "clan-dialog cosmetics-dialog");
    root.id = id;
    const heading = el("header", "clan-heading");
    const name = el("h2", "", title);
    name.id = id + "Title";
    root.setAttribute("aria-labelledby", name.id);
    const close = button("booster-close", "×", () => root.close());
    close.setAttribute("aria-label", closeLabel);
    heading.append(name, close);
    root.append(heading);
    document.body.append(root);
    root.addEventListener("close", () => {
      if (!document.querySelector("dialog[open]") && document.body.dataset.screen === "lobby")
        document.getElementById(returnTo)?.focus({ preventScroll: true });
    });
    return root;
  }
  function emptyMark() {
    const mark = el("span", "skin-silhouette");
    mark.setAttribute("aria-hidden", "true");
    mark.append(el("span", "", "✦"));
    return mark;
  }
  function discountNote() {
    const node = el("p", "cosmetics-season-discount");
    node.hidden = true;
    return node;
  }
  function updateDiscounts(profile) {
    const discount = profile?.seasonBenefits?.discount || 0;
    for (const note of document.querySelectorAll(".cosmetics-season-discount")) {
      note.hidden = !discount;
      note.textContent = discount
        ? `Кубок клана: скидка ${discount}% на покупки скинов, бабочек и шапок.`
        : "";
    }
  }
  class CosmeticsUI {
    constructor(owner) {
      this.owner = owner;
      this.filter = "sets";
      this.pending = null;
      this.category = "bow";
      this.profile = owner.getProfile();
      this.appearance = new window.KillexAppearance.AppearanceUI(owner);
      this.buildSkins();
      this.buildWardrobe();
      document
        .getElementById("wardrobeSection")
        .addEventListener("click", () => this.openWardrobe());
      document.addEventListener("killex:skin-selected", () => this.renderSelection());
      document.addEventListener("killex:profile", (event) => {
        this.profile = event.detail;
        if (this.owner.isLobby()) {
          updateDiscounts(this.profile);
          this.renderWardrobe();
        }
      });
      this.renderSelection();
      this.renderWardrobe();
      updateDiscounts(this.profile);
    }
    buildSkins() {
      this.skins = dialog("skinsDialog", "Гардероб", "Закрыть гардероб", "wardrobeSection");
      const layout = el("div", "skin-collection-layout");
      const preview = el("aside", "cosmetics-preview");
      this.preview = preview;
      preview.append(el("span", "cosmetics-eyebrow", "Выбранный скин"));
      this.selectedName = el("h3", "collection-selection");
      preview.append(
        this.selectedName,
        el("p", "cosmetics-muted", "Этот облик виден другим игрокам на арене."),
      );
      const library = el("div", "skin-library");
      this.library = library;
      const tabs = el("div", "cosmetics-tabs");
      tabs.setAttribute("aria-label", "Разделы гардероба");
      this.filters = new Map();
      for (const [id, name] of [
        ["sets", "Скины"],
        ["hat", "Шапки"],
        ["bow", "Бабочки"],
        ["leagueSets", "Тема оформления"],
        ["frames", "Рамки профиля"],
      ]) {
        const control = button("sf-tab", name, () => {
          this.filter = id;
          this.renderFilter();
        });
        this.filters.set(id, control);
        tabs.append(control);
      }
      this.defaults = el("section", "skin-defaults");
      this.defaults.append(
        el("h3", "", "Доступны всем"),
        el(
          "p",
          "cosmetics-muted",
          "Текущие скины по умолчанию. Нажми на понравившийся, чтобы выбрать.",
        ),
      );
      this.defaults.append(document.getElementById("skinList"));
      this.sets = el("section", "skin-owned-sets");
      this.emptySets = el(
        "p",
        "cosmetics-muted",
        "Наборы открываются после покупки в магазине, с VIP, Premium или покупкой темы интерфейса. В каждом наборе 5 аватарок.",
      );
      this.sets.append(el("h3", "", "Мои наборы"), this.emptySets);
      this.accountSets = el("div", "account-skin-sets");
      this.sets.append(this.accountSets);
      this.frames = this.appearance.gallery("frames");
      this.leagueSets = this.appearance.gallery("set");
      library.append(this.defaults, this.sets, this.leagueSets, this.frames);
      layout.append(preview, library);
      const actions = el("footer", "cosmetics-actions");
      actions.append(
        button("sf-button sf-secondary", "Купить скины", () => {
          this.owner.openShop();
        }),
        button("sf-button", "Готово", () => this.skins.close()),
      );
      this.skins.append(tabs, discountNote(), layout, actions);
      this.skins.addEventListener("close", () => this.appearance.previewArena(false));
      this.renderFilter();
    }
    renderFilter() {
      const frames = ["frames", "leagueSets"].includes(this.filter);
      const accessories = ["hat", "bow"].includes(this.filter);
      this.skins.classList.toggle("show-frames", frames);
      for (const [id, tab] of this.filters)
        tab.setAttribute("aria-pressed", String(id === this.filter));
      this.defaults.hidden = this.filter !== "sets";
      this.sets.hidden = this.filter !== "sets";
      this.frames.hidden = this.filter !== "frames";
      this.leagueSets.hidden = this.filter !== "leagueSets";
      if (this.accessoryContent) {
        this.accessoryContent.hidden = !accessories;
        if (accessories) {
          this.category = this.filter;
          this.renderWardrobe();
          this.accessoryList.scrollTop = 0;
        }
      }
    }
    renderSelection() {
      const skin = window.KillexIdentity.allSkins.find((s) => s.id === this.owner.getSkin());
      if (!skin) return;
      this.selectedName.textContent = skin.name;
      if (this.wardrobeImage) setSkinImage(this.wardrobeImage, skin, 512);
      for (const control of this.accountSets.querySelectorAll("[data-skin-id]"))
        control.setAttribute("aria-pressed", String(control.dataset.skinId === skin.id));
    }
    openSkins() {
      if (!this.owner.isLobby()) return;
      this.filter = "sets";
      this.renderFilter();
      this.appearance.refresh();
      this.owner.loadProfile();
      this.renderSelection();
      window.KillexWindows.open(this.skins);
      this.appearance.previewArena(this.filter === "arenaFrames");
      this.skins.scrollTop = 0;
    }
    buildWardrobe() {
      // One window owns skins, appearance and accessories, including all old entry points.
      this.wardrobe = this.skins;
      const preview = this.preview;
      preview.classList.add("wardrobe-preview");
      preview.replaceChildren(el("span", "cosmetics-eyebrow", "Твой образ"));
      const avatar = el("div", "outfit-avatar");
      this.wardrobeImage = el("img", "outfit-skin");
      this.wardrobeImage.alt = "";
      const disc = el("span", "avatar-disc");
      disc.append(this.wardrobeImage);
      avatar.append(disc);
      preview.append(avatar, this.selectedName);
      this.wornSummary = el("div", "wardrobe-summary");
      preview.append(this.wornSummary);
      const content = el("section", "wardrobe-content");
      this.accessoryContent = content;
      content.hidden = true;
      this.accessoryCards = new Map();
      this.accessoryButtons = new Map();
      this.accessoryList = el("div", "accessory-list");
      this.accessoryList.tabIndex = 0;
      this.accessoryList.setAttribute("role", "region");
      this.accessoryList.setAttribute("aria-label", "Аксессуары гардероба");
      content.append(this.accessoryList);
      for (const item of window.KillexAccessories.items) {
        const card = el("article", "accessory-card");
        card.dataset.accessoryId = item.id;
        const image = el("img", "accessory-art");
        image.src = item.icon;
        image.alt = "";
        image.width = 140;
        image.height = 104;
        const info = el("div", "accessory-copy");
        info.append(el("h3", "", item.name), accessoryDetails(item));
        const action = button("sf-button sf-secondary", "Надеть", () => this.toggleAccessory(item));
        info.append(action);
        const lock = el("img", "accessory-lock");
        lock.src = "assets/ui/svg/identity/access-lock-small.svg";
        lock.alt = "Недоступно";
        lock.width = 32;
        lock.height = 36;
        lock.hidden = true;
        card.append(image, info, lock);
        this.accessoryList.append(card);
        this.accessoryCards.set(item.id, card);
        this.accessoryButtons.set(item.id, action);
      }
      this.wardrobeStatus = el("p", "wardrobe-status");
      this.wardrobeStatus.setAttribute("role", "status");
      content.append(this.wardrobeStatus);
      this.library.append(content);
      this.outfitHosts = [avatar, document.getElementById("skinPreview")].map((host) => {
        const images = new Map();
        for (const slot of ["hat", "bow"]) {
          const image = el("img", "outfit-accessory accessory-" + slot);
          image.alt = "";
          image.hidden = true;
          host.append(image);
          images.set(slot, image);
        }
        return images;
      });
      this.lobbySlots = new Map();
      for (const [slot, label] of [
        ["hat", "Шапка"],
        ["bow", "Бабочка"],
      ]) {
        const control = button("lobby-accessory-slot", "", () => {
          this.openWardrobe(slot);
        });
        control.dataset.accessorySlot = slot;
        const icon = el("img");
        icon.alt = "";
        icon.src = window.KillexAccessories.items.find(
          (item) => item.slot === slot && !item.eventReward,
        ).icon;
        const copy = el("span", ""),
          name = el("strong", "", label),
          state = el("small", "", "Надеть +");
        copy.append(name, state);
        control.append(icon, copy);
        document.getElementById("lobbyAccessorySlots").append(control);
        this.lobbySlots.set(slot, { control, state, icon });
      }
    }
    openWardrobe(slot = "sets") {
      if (!this.owner.isLobby()) return;
      if (!this.wardrobe.open) window.KillexAudio?.play?.("wardrobe");
      this.filter = slot;
      this.renderFilter();
      this.appearance.refresh();
      this.renderSelection();
      this.renderWardrobe();
      this.owner.loadProfile();
      window.KillexWindows.open(this.wardrobe);
      this.wardrobe.scrollTop = 0;
      this.accessoryList.scrollTop = 0;
    }
    renderWardrobe() {
      const identity = window.KillexIdentity;
      const sets = [
        ...["vip", "premium"]
          .filter((tier) => this.profile?.account?.[tier])
          .map((tier) => ({
            id: tier,
            name: tier === "vip" ? "Золотой набор аватаров" : "Премиальный набор аватаров",
            skins: identity.accountSkins.filter((skin) => skin.tier === tier),
          })),
        ...identity.themeSkinSets
          .filter((set) => this.profile?.appearance?.unlocked?.includes(set.id))
          .map((set) => ({
            ...set,
            skins: identity.themeSkins.filter((skin) => skin.set === set.id),
          })),
      ];
      sets.push(
        ...window.KillexSkinCollections.collections
          .filter((c) => this.profile?.purchasedSkinCollections?.includes(c.id))
          .map((c) => ({
            ...c,
            skins: identity.collectionSkins.filter((s) => s.collection === c.id),
          })),
      );
      const inSets = new Set(sets.flatMap(set => set.skins.map(s => s.id)));
      const granted = identity.allSkins.filter(s => this.profile?.grantedSkins?.includes(s.id) && !inSets.has(s.id));
      if (granted.length) sets.push({ id: "gifts", name: "Подарочные аватары", skins: granted });
      this.emptySets.hidden = sets.length > 0;
      this.accountSets.replaceChildren();
      for (const set of sets) {
        const showcase = el("section", "avatar-set-showcase");
        showcase.dataset.setId = set.id;
        showcase.append(el("h4", "", set.name));
        const grid = el("div", "account-avatar-grid");
        grid.style.setProperty("--avatar-count", set.skins.length);
        for (const skin of set.skins) {
          const control = button("account-avatar", "", () => {
            document.dispatchEvent(new CustomEvent("killex:choose-skin", { detail: skin.id }));
          });
          control.dataset.skinId = skin.id;
          control.setAttribute("aria-pressed", String(this.owner.getSkin() === skin.id));
          const img = el("img");
          setSkinImage(img, skin, 128);
          img.alt = "";
          control.append(img, el("span", "", skin.name));
          grid.append(control);
        }
        showcase.append(grid);
        this.accountSets.append(showcase);
      }
      const api = window.KillexAccessories,
        worn = api.outfit(this.profile?.wardrobe?.equipped);
      this.accessoryList.dataset.collectionKey = this.category;
      const ownedIds = new Set(this.profile?.wardrobe?.owned || []),
        priority = (item) => (ownedIds.has(item.id) ? 0 : item.eventReward ? 2 : 1),
        sorted = [...api.items].sort((a, b) => priority(a) - priority(b)),
        order = sorted.map((item) => item.id).join(",");
      // Reorder only when availability changes, preserving focus and scroll on updates.
      if (order !== this.accessoryOrder) {
        this.accessoryList.append(...sorted.map((item) => this.accessoryCards.get(item.id)));
        this.accessoryOrder = order;
      }
      for (const item of api.items) {
        const equipped = worn[item.slot] === item.id,
          owned = ownedIds.has(item.id),
          control = this.accessoryButtons.get(item.id),
          card = this.accessoryCards.get(item.id);
        card.hidden = item.slot !== this.category;
        card.dataset.equipped = String(equipped);
        card.dataset.newItem = String(
          owned && !this.profile?.wardrobe?.seen?.includes("accessory:" + item.id),
        );
        card.dataset.locked = String(!owned);
        card.querySelector(".accessory-lock").hidden = owned;
        control.textContent = !owned
          ? item.eventReward
            ? "Награда события"
            : "Пока недоступно"
          : equipped
            ? "Снять"
            : "Надеть";
        control.setAttribute("aria-label", (equipped ? "Снять " : "Надеть ") + item.name);
        window.KillexControls.state(
          control,
          !!this.pending || !owned || this.owner.isProfileOnArena(),
          !owned || this.owner.isProfileOnArena(),
        );
      }
      for (const images of this.outfitHosts)
        for (const [slot, image] of images) {
          const item = api.item(worn[slot]);
          image.hidden = !item;
          if (item) {
            image.alt = item.name;
            window.KillexAccessoryView.portrait(image, item.id);
          } else {
            delete image.dataset.accessoryId;
          }
        }
      for (const [slot, { control, state, icon }] of this.lobbySlots) {
        const item = api.item(worn[slot]);
        icon.hidden = !item;
        if (item) {
          icon.src = item.icon;
          icon.alt = item.name;
        } else {
          icon.removeAttribute("src");
          icon.alt = "";
        }
        control.dataset.equipped = String(!!item);
        state.textContent = item ? "Надета" : "Надеть +";
        control.title = item ? item.name : "Свободное место для аксессуара";
        control.setAttribute(
          "aria-label",
          (item ? "Изменить " : "Выбрать ") + (slot === "hat" ? "шапку" : "бабочку"),
        );
      }
      this.wornSummary.replaceChildren();
      for (const [slot, label] of [
        ["bow", "Бабочка"],
        ["hat", "Шапка"],
      ]) {
        const item = api.item(worn[slot]),
          row = el("p");
        row.append(el("span", "", label), el("strong", "", item ? item.name : "Не надета"));
        this.wornSummary.append(row);
      }
      if (this.owner.isProfileOnArena())
        this.wardrobeStatus.textContent =
          "Профиль сейчас на арене. Вернись в лобби в игровой вкладке, чтобы сменить аксессуар.";
    }
    toggleAccessory(item) {
      if (this.pending || !this.owner.isLobby() || this.owner.isProfileOnArena()) return;
      const equipped = this.profile?.wardrobe?.equipped[item.slot] === item.id;
      const operation = {
        slot: item.slot,
        accessoryId: equipped ? null : item.id,
        requestId: window.KillexRequestIds.create(),
      };
      this.wardrobeStatus.textContent = "";
      this.pending = (async () => {
        const controller = new AbortController(),
          timer = setTimeout(() => controller.abort(), 8000);
        try {
          const response = await fetch("/api/profile/accessory", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(operation),
            signal: controller.signal,
          });
          const data = await response.json();
          if (!response.ok) throw Error(data.error || "Не удалось сохранить аксессуар.");
          this.owner.updateProfile(data.profile);
          this.wardrobeStatus.textContent = equipped
            ? "Аксессуар снят."
            : item.eventReward || item.price
              ? item.name + ": аксессуар надет."
              : item.name + ": бонус действует, пока аксессуар надет.";
        } catch (error) {
          this.wardrobeStatus.textContent =
            error.name === "AbortError"
              ? "Ответ задержался. Обновляем сохранённый выбор."
              : error.message;
          await this.owner.loadProfile();
        } finally {
          clearTimeout(timer);
          this.pending = null;
          this.renderWardrobe();
        }
      })();
      this.renderWardrobe();
    }
    static createShop(onCollection, onBuy) {
      const root = el("section", "skin-shop");
      root.setAttribute("aria-label", "Магазин скинов");
      const header = el("div", "skin-shop-header"),
        copy = el("div");
      copy.append(
        el("span", "cosmetics-eyebrow", "Коллекции обликов"),
        el("h3", "", "Наборы скинов"),
        el("p", "cosmetics-muted", "Десять новых коллекций. В каждом наборе пять персонажей."),
      );
      header.append(copy, button("sf-button", "В гардероб", onCollection));
      root.append(header);
      const controls = [];
      for (const collection of window.KillexSkinCollections.collections) {
        const card = el("article", "skin-set-preview skin-collection-preview");
        card.dataset.collectionId = collection.id;
        const heading = el("div", "skin-collection-heading");
        heading.append(el("h3", "", collection.name), el("span", "skin-pack-count", "5 скинов"));
        const stage = el("div", "skin-collection-portraits");
        for (const member of collection.members) {
          const portrait = el("figure", "skin-collection-portrait"),
            img = el("img");
          setSkinImage(img, member.id, 512);
          img.alt = member.name;
          img.width = 160;
          img.height = 160;
          img.loading = "lazy";
          img.decoding = "async";
          img.draggable = false;
          const disc = el("span", "skin-shop-avatar-disc");
          disc.append(img);
          portrait.append(disc, el("figcaption", "", member.name));
          stage.append(portrait);
        }
        const footer = el("footer", "skin-collection-purchase"),
          note = el("span", "cosmetics-muted", "");
        let owned = false;
        const action = button("sf-button", "", () => (owned ? onCollection() : onBuy(collection)));
        const text = el("span"),
          icon = el("img", "booster-price-icon");
        icon.src = "assets/menu-icons/64/currency_" + collection.currency + ".webp";
        icon.alt = { coins: "монет", crystals: "кристаллов", bucks: "эфира" }[collection.currency];
        action.append(text, icon);
        footer.append(note, action);
        controls.push((profile, pending, blocked) => {
          owned = !!profile?.purchasedSkinCollections?.includes(collection.id);
          text.textContent = owned
            ? "В гардероб"
            : "Купить " + collection.price.toLocaleString("ru-RU");
          icon.hidden = owned;
          note.textContent = owned ? "Куплено навсегда" : "";
          window.KillexControls.state(
            action,
            blocked ||
              (!owned &&
                (!!pending || !profile || profile.wallet[collection.currency] < collection.price)),
            blocked ||
              (!owned && (!profile || profile.wallet[collection.currency] < collection.price)),
          );
        });
        card.append(heading, stage, footer);
        root.append(card);
      }
      root.update = (profile, pending, blocked) =>
        controls.forEach((update) => update(profile, pending, blocked));
      return root;
    }
  }
  window.KillexCosmeticsUI = CosmeticsUI;
})();
