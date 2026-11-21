"use strict";
(() => {
  const R = window.KillexPets;
  const number = (n) => Number(n || 0).toLocaleString("ru-RU");
  const currency = { coins: "монет", crystals: "кристаллов", bucks: "эфира" };
  const setHidden = (node, hidden) => {
    if (node.hidden !== hidden) node.hidden = hidden;
  };
  const el = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  };
  const img = (src, cls = "") => {
    const n = el("img", cls);
    n.src = src;
    n.alt = "";
    return n;
  };
  const keyDescription = (tag, text) => {
    const node = el(tag);
    const parts = text.split(/\b([QR])\b/g);
    parts.forEach((part, index) =>
      node.append(index % 2 ? el("kbd", "description-key", part) : part),
    );
    return node;
  };
  const button = (text, fn, cls = "sf-button sf-secondary") => {
    const b = el("button", cls, text);
    b.type = "button";
    b.onclick = fn;
    return b;
  };
  const meter = (value, label) => {
    const b = el("progress");
    b.max = 100;
    b.value = value;
    b.setAttribute("aria-label", label);
    return b;
  };
  const clock = (ms) => {
    const s = Math.max(0, Math.ceil(ms / 1000));
    return `${Math.floor(s / 3600)}:${String(Math.floor(s / 60) % 60).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
  };
  class PetsUI {
    constructor(owner) {
      this.owner = owner;
      this.selected = "zaya";
      this.tab = "abilities";
      this.profile = owner.getProfile();
      this.receivedAt = Date.now();
      this.dialog = el("dialog", "pets-dialog");
      this.dialog.id = "petsDialog";
      this.dialog.dataset.layout = "fullscreen";
      this.dialog.setAttribute("aria-labelledby", "petsTitle");
      const header = el("header", "pets-heading"),
        brand = el("div", "pets-brand");
      brand.append(img("assets/pets/paw-v3.webp"));
      const titles = el("div");
      titles.append(el("h1", "", "Питомцы"));
      titles.lastChild.id = "petsTitle";
      brand.append(titles);
      this.wallet = el("div", "pets-wallet");
      const close = button(
        "В лобби",
        () => this.dialog.close(),
        "sf-button sf-tertiary pets-close",
      );
      header.append(brand, this.wallet, close);
      const layout = el("div", "pets-layout");
      this.collection = el("nav", "pets-collection");
      this.collection.setAttribute("aria-label", "Выбор питомца");
      this.hero = el("section", "pet-hero");
      this.details = el("section", "pet-details");
      const tabs = el("nav", "pet-tabs");
      tabs.setAttribute("aria-label", "Информация о питомце");
      this.tabs = [];
      for (const [id, label] of [
        ["abilities", "Способности"],
        ["levels", "Развитие"],
        ["achievements", "Достижения"],
      ]) {
        const b = button(
          label,
          () => {
            this.tab = id;
            this.renderDetails();
          },
          "sf-tab",
        );
        b.dataset.tab = id;
        tabs.append(b);
        this.tabs.push(b);
      }
      this.detailBody = el("div", "pet-detail-body");
      this.details.append(tabs, this.detailBody);
      layout.append(this.collection, this.hero, this.details);
      this.status = el("p", "pets-status");
      this.status.setAttribute("role", "status");
      const foot = el("footer", "pets-footer");
      this.retry = button("Повторить", () => this.submit(this.pending));
      this.retry.hidden = true;
      foot.append(this.status, this.retry);
      this.dialog.append(header, layout, foot);
      document.body.append(this.dialog);
      this.confirm = el("dialog", "pet-confirm");
      this.confirm.setAttribute("aria-labelledby", "petConfirmTitle");
      document.body.append(this.confirm);
      document.getElementById("petsSection").onclick = () => this.open();
      const promo = document.querySelector(".promo-events");
      if (promo) {
        promo.tabIndex = 0;
        promo.setAttribute("role", "button");
        promo.setAttribute("aria-label", "Открыть питомцев");
        promo.onclick = () => this.open();
        promo.onkeydown = (e) => {
          if (e.code === "Enter" || e.code === "Space") {
            e.preventDefault();
            this.open();
          }
        };
      }
      document.addEventListener("killex:profile", (e) => {
        this.profile = e.detail;
        this.receivedAt = Date.now();
        this.restorePending();
        this.updateAccess();
        if (this.dialog.open) this.render();
      });
      this.hud = el("div", "pet-arena-hud");
      this.hud.hidden = true;
      this.hudPortrait = img(R.imageFor("zaya", 0));
      this.hudTitle = el("span");
      this.hudMeter = meter(0, "Живучесть питомца");
      const caption = el("div", "pet-hud-caption");
      caption.append(this.hudTitle, this.hudMeter);
      this.thornCounter = el("div", "pet-thorn-counter");
      this.thornCounter.hidden = true;
      this.thornCount = el("span", "pet-thorn-count");
      this.thornCounter.append(img("assets/arena/thorn-v2.webp"), this.thornCount);
      this.fire = button("", () => this.use("fire"), "booster-slot pet-ability");
      this.fire.dataset.petAbility = "fire";
      this.secondary = button("", () => this.use("secondary"), "booster-slot pet-ability");
      this.secondary.dataset.petAbility = "secondary";
      this.hud.append(this.hudPortrait, caption, this.thornCounter);
      this.fire.hidden = this.secondary.hidden = true;
      this.fire.tabIndex = this.secondary.tabIndex = -1;
      document.querySelector(".booster-quick").prepend(this.fire, this.secondary);
      const supportHud = el("div", "arena-support-hud");
      supportHud.append(this.hud);
      document.querySelector(".arena-status-stack").prepend(supportHud);
      this.images = new Map();
      window.KillexActivity.every(() => {
        if (this.dialog.open && !document.hidden) this.updateClock();
      }, 1000, () => this.dialog.open);
      this.dialog.addEventListener("close", () => {
        this.confirm.close();
      });
      const visibility = () => {
        this.dialog.dataset.pageHidden = String(document.hidden);
      };
      document.addEventListener("visibilitychange", visibility);
      visibility();
      this.updateAccess();
    }
    updateAccess() {
      const available = R.isUnlocked(this.profile?.level),
        label = available ? "Открыть питомцев" : `Питомцы доступны с ${R.UNLOCK_LEVEL} уровня.`,
        menu = document.getElementById("petsSection"),
        promo = document.querySelector(".promo-events");
      window.KillexControls.state(menu, !available);
      for (const node of [menu, promo].filter(Boolean)) {
        node.title = available ? "" : label;
        node.setAttribute("aria-disabled", String(!available));
        node.setAttribute("aria-label", label);
      }
      if (promo) promo.tabIndex = available ? 0 : -1;
      if (!available && this.dialog.open) this.dialog.close();
      return available;
    }
    restorePending() {
      if (!this.profile) return;
      try {
        const saved = JSON.parse(
          sessionStorage.getItem(window.KillexPlatform.storageKey(".petOperation")) || "null",
        );
        this.pending = saved?.profileId === this.profile.id ? saved : null;
      } catch (_) {
        this.pending = null;
      }
    }
    petImage(id, level) {
      const src = R.imageFor(id, level);
      if (!src) return null;
      if (!this.images.has(src)) {
        const art = new Image();
        art.src = src;
        this.images.set(src, art);
      }
      return this.images.get(src);
    }
    async open() {
      if (!this.owner.isLobby()) return;
      this.profile = this.owner.getProfile();
      if (!this.updateAccess()) return;
      this.restorePending();
      if (!this.dialog.open) this.tab = "abilities";
      this.selected = this.profile?.pets?.equipped || "zaya";
      this.render();
      window.KillexWindows.open(this.dialog);
      await this.owner.loadProfile();
      this.profile = this.owner.getProfile();
      this.receivedAt = Date.now();
      if (!this.updateAccess()) return;
      this.render();
    }
    state() {
      return this.profile?.pets;
    }
    price(id) {
      return this.state()?.prices[id] ?? R.get(id).price;
    }
    render() {
      const state = this.state();
      this.wallet.replaceChildren();
      for (const id of ["coins", "crystals", "bucks"])
        this.wallet.append(
          el(
            "span",
            "pet-currency pet-currency-" + id,
            `${number(this.profile?.wallet?.[id])} ${currency[id]}`,
          ),
        );
      this.collection.replaceChildren();
      for (const p of R.pets) {
        const owned = state?.owned[p.id],
          b = button(
            "",
            () => {
              this.selected = p.id;
              this.render();
            },
            "pet-choice",
          );
        b.dataset.pet = p.id;
        b.setAttribute("aria-pressed", String(p.id === this.selected));
        const text = el("span", "pet-choice-text");
        text.append(
          el("strong", "", p.name),
          el(
            "small",
            "",
            owned
              ? owned.level
                ? `Уровень ${owned.level}`
                : "Обучение"
              : `${number(this.price(p.id))} ${currency[p.currency]}`,
          ),
        );
        if (state?.equipped === p.id) text.append(el("span", "pet-equipped-label", "Со мной"));
        b.append(img(R.imageFor(p.id, owned?.level)), text);
        this.collection.append(b);
      }
      this.renderHero();
      this.renderDetails();
      this.retry.hidden = !this.pending || this.busy;
      window.KillexControls.state(this.retry, !!this.busy, false);
      // An uncertain response keeps the original operation ID for a safe retry.
    }
    renderHero() {
      const def = R.get(this.selected),
        state = this.state(),
        owned = state?.owned[this.selected],
        equipped = state?.equipped === def.id,
        minutes = R.capacityMs(def.id, owned?.games || 0) / 60000;
      this.hero.replaceChildren();
      const name = el("header", "pet-name");
      name.append(
        el("p", "pet-eyebrow", def.role),
        el("h2", "", def.name),
        el(
          "span",
          "pet-rank",
          owned
            ? owned.level
              ? `Уровень ${owned.level} из 5`
              : "Обучение"
            : "Новый друг навсегда",
        ),
      );
      const stage = el("div", "pet-stage");
      stage.dataset.pet = def.id;
      stage.append(img(R.imageFor(def.id, owned?.level), "pet-portrait"));
      const desc = el("p", "pet-description", def.description);
      const care = el("div", "pet-care");
      const top = el("div", "pet-care-line");
      this.energyLabel = el(
        "strong",
        "",
        owned ? `Живучесть ${Math.ceil(owned.vitality)}%` : `${minutes} мин на арене`,
      );
      this.energy = meter(owned?.vitality ?? 100, "Живучесть");
      top.append(
        this.energyLabel,
        el("span", "", owned ? `${minutes} мин полного запаса` : "Полный запас живучести"),
      );
      care.append(top, this.energy);
      this.refill = el("p", "pet-refill");
      const actions = el("div", "pet-main-actions");
      const main = button(
        owned
          ? equipped
            ? "Отпустить отдыхать"
            : "Взять с собой"
          : `Приобрести за ${number(this.price(def.id))} ${currency[def.currency]}`,
        () =>
          owned
            ? this.action(equipped ? "unequip" : "equip", def.id)
            : this.askPurchase("buy", def.id),
        "sf-button sf-primary",
      );
      main.dataset.action = owned ? (equipped ? "unequip" : "equip") : "buy";
      const cannotBuy = !owned && (this.profile?.wallet?.[def.currency] || 0) < this.price(def.id);
      window.KillexControls.state(
        main,
        !state || cannotBuy || !!this.busy || !!this.pending || !!this.owner.inArena(),
        !state || cannotBuy || !!this.owner.inArena(),
      );
      actions.append(main);
      const food = el("div", "pet-food");
      food.append(
        img("assets/pets/food.svg"),
        el("span", "", `Порций корма: ${number(state?.food)}`),
      );
      const feed = button("Покормить +10%", () => this.action("feed", def.id));
      feed.dataset.action = "feed";
      window.KillexControls.state(
        feed,
        !owned ||
          !state?.food ||
          owned.vitality >= 100 ||
          !!this.busy ||
          !!this.pending ||
          !!this.owner.inArena(),
        !owned || !state?.food || owned.vitality >= 100 || !!this.owner.inArena(),
      );
      const buyFood = button(
        "1 порция за 100 кристаллов",
        () => this.askPurchase("food", null),
        "sf-button sf-tertiary",
      );
      buyFood.dataset.action = "food";
      const cannotBuyFood = (this.profile?.wallet?.crystals || 0) < 100;
      window.KillexControls.state(
        buyFood,
        !state || cannotBuyFood || !!this.busy || !!this.pending || !!this.owner.inArena(),
        !state || cannotBuyFood || !!this.owner.inArena(),
      );
      const summary = el("div", "pet-care-summary");
      summary.append(food, this.refill);
      actions.append(feed, buyFood);
      care.append(summary, actions);
      this.hero.append(name, stage, desc, care);
      this.updateClock();
    }
    updateClock() {
      const pet = this.state()?.owned[this.selected];
      if (!pet) {
        this.refill.textContent = "Восстановление каждые 4 часа. Корм возвращает 10% живучести.";
        return;
      }
      const remaining = pet.refillAt - Date.now();
      this.refill.textContent =
        remaining > 0
          ? "Полное восстановление через " + clock(remaining)
          : "Живучесть восстановлена";
      if (remaining <= 0) {
        this.energy.value = 100;
        this.energyLabel.textContent = "Живучесть 100%";
      }
    }
    renderDetails() {
      this.tabs.forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.tab === this.tab)));
      const root = this.detailBody;
      root.replaceChildren();
      const def = R.get(this.selected),
        pet = this.state()?.owned[def.id],
        stats = R.stats(def.id, pet?.games || 0);
      if (this.tab === "abilities") {
        root.append(el("h3", "", "Помощь на арене"));
        const rows = [
          [
            R.shields[stats.shieldId].icon,
            "Защита и рост",
            `${R.shields[stats.shieldId].name}${stats.mass ? ` и +${number(stats.mass)} массы` : ""} каждые ${stats.intervalMs / 1000} сек.`,
          ],
        ];
        if (stats.thornMeals)
          rows.push([
            "assets/arena/thorn-v2.webp",
            "Укротитель колючек",
            `Съедает до ${stats.thornMeals} колючек без разделения.` +
              (stats.thornRefillMs
                ? ` Запас восстанавливается за ${stats.thornRefillMs / 1000} сек.`
                : ""),
          ]);
        if (stats.speed)
          rows.push([
            "assets/pets/paw-v3.webp",
            "Лёгкий шаг",
            `Скорость +${stats.speed}%${stats.resistance ? `, получаемый урон −${stats.resistance}%` : ""}.`,
          ]);
        if (stats.start.fire)
          rows.push([
            R.abilities.fire.icon,
            "Клавиша Q: Огонь",
            `${stats.start.fire} на старте. Сжигает ${stats.firePercent}% массы задетой части.`,
          ]);
        if (stats.start.glove)
          rows.push([
            R.abilities.glove.icon,
            "Клавиша R: Боевой запас",
            `${stats.start.claw ? `${stats.start.claw} когтей, затем ` : ""}${stats.start.glove} когтистых перчаток.`,
          ]);
        for (const [src, title, text] of rows) {
          const row = el("article", "pet-feature"),
            copy = el("div");
          copy.append(keyDescription("h4", title), el("p", "", text));
          row.append(img(src), copy);
          root.append(row);
        }
        const premium = el("article", "pet-premium");
        premium.append(
          img("assets/accounts/premium.png"),
          el("h4", "", "Вместе с Premium"),
          keyDescription("p", def.premium),
        );
        root.append(premium);
        if (stats.start.glove)
          root.append(
            el(
              "p",
              "pet-note",
              "Коготь снимает щит. Перчатка снимает обычный щит и делит задетую часть надвое; от кланового щита отскакивает. Запас выдаётся на текущую жизнь.",
            ),
          );
      } else if (this.tab === "levels") {
        root.append(
          el("h3", "", "Растём вместе"),
          el(
            "p",
            "pet-note",
            `Зачтено игр: ${number(pet?.games)}. Игра считается, если питомец помогал дольше одной минуты.`,
          ),
        );
        const list = el("ol", "pet-levels");
        for (let i = 0; i < 5; i++) {
          const s = R.stats(def.id, R.thresholds[i]),
            row = el("li");
          row.dataset.reached = String(!!pet && pet.level >= i + 1);
          const heading = el("strong", "", `${i + 1} уровень`),
            text = el("div");
          text.append(
            heading,
            el("small", "", `${number(R.thresholds[i])} игр`),
            el("small", "", `Живучесть: ${s.capacityMs / 60000} мин`),
            el(
              "p",
              "",
              `${R.shields[s.shieldId].name}${s.mass ? ` +${number(s.mass)} массы` : ""} / ${s.intervalMs / 1000} сек.`,
            ),
          );
          if (s.thornMeals)
            text.append(
              el(
                "small",
                "",
                `До ${s.thornMeals} колючек без разделения.` +
                  (s.thornRefillMs ? ` Восстановление: ${s.thornRefillMs / 1000} сек.` : ""),
              ),
            );
          if (s.speed)
            text.append(
              el(
                "small",
                "",
                `Огонь ${s.firePercent}%, скорость +${s.speed}%${s.resistance ? `, защита ${s.resistance}%` : ""}`,
              ),
            );
          row.append(text);
          list.append(row);
        }
        root.append(
          list,
          el(
            "p",
            "pet-note",
            `До 100 игр - обучение. Живучесть: ${R.capacityMs(def.id, 0) / 60000} мин.`,
          ),
        );
      } else {
        root.append(el("h3", "", "Достижения питомцев"));

        for (const a of (this.profile?.progress?.achievements || []).filter(
          (a) => a.category === "pets",
        )) {
          const { id, name: title, thresholds: goals, rewards, value, unit, claimed } = a;
          const next = Math.min(claimed, goals.length - 1),
            row = el("article", "pet-achievement");
          row.dataset.earned = String(claimed > 0);
          row.append(
            window.KillexAchievementBadge.create(id, "pet-achievement-badge", 42),
            el("h4", "", title),
            el("span", "", `${claimed}/${goals.length} степеней`),
            el(
              "p",
              "",
              `${number(value)} / ${number(goals[next])} ${{ pet_master: "питомцев 5 уровня", pet_exclusive: "питомцев за эфир" }[id] || unit}`,
            ),
            el(
              "small",
              "",
              claimed === goals.length
                ? "Все степени получены"
                : `Следующая награда: +${rewards[next]} величия`,
            ),
          );
          root.append(row);
        }
      }
    }
    askPurchase(action, petId) {
      if (this.pending || this.busy) return;
      const def = R.get(petId),
        cost =
          action === "food"
            ? "100 кристаллов"
            : `${number(this.price(petId))} ${currency[def.currency]}`;
      this.confirm.replaceChildren();
      const title = el(
        "h2",
        "",
        action === "food" ? "Запастись кормом?" : `Пригласить ${def.name}?`,
      );
      title.id = "petConfirmTitle";
      this.confirm.append(
        title,
        el(
          "p",
          "",
          action === "food"
            ? "Одна порция восстанавливает 10% живучести."
            : "Питомец останется с тобой навсегда.",
        ),
        el("strong", "pet-confirm-cost", cost),
      );
      const controls = el("div", "pet-confirm-actions");
      controls.append(
        button("Отмена", () => this.confirm.close(), "sf-button sf-tertiary"),
        button(
          "Купить",
          () => {
            this.confirm.close();
            this.action(action, petId);
          },
          "sf-button sf-primary",
        ),
      );
      this.confirm.append(controls);
      window.KillexWindows.open(this.confirm);
    }
    action(action, petId) {
      if (this.pending || this.busy || !this.updateAccess()) return;
      const operation = {
        profileId: this.profile.id,
        action,
        petId,
        requestId: window.KillexRequestIds.create(),
      };
      this.pending = operation;
      try {
        sessionStorage.setItem(
          window.KillexPlatform.storageKey(".petOperation"),
          JSON.stringify(operation),
        );
      } catch (_) {}
      this.submit(operation);
    }
    async submit(operation) {
      if (!operation || this.busy || !this.updateAccess()) return;
      this.busy = true;
      this.status.textContent = "";
      this.render();
      const controller = new AbortController(),
        timeout = setTimeout(() => controller.abort(), 8000);
      try {
        const response = await fetch("/api/pets/action", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(operation),
          signal: controller.signal,
        });
        const result = await response.json();
        if (!response.ok) {
          if (response.status < 500) {
            this.pending = null;
            try {
              sessionStorage.removeItem(window.KillexPlatform.storageKey(".petOperation"));
            } catch (_) {}
          }
          throw Error(result.error || "Действие не выполнено.");
        }
        this.pending = null;
        try {
          sessionStorage.removeItem(window.KillexPlatform.storageKey(".petOperation"));
        } catch (_) {}
        this.owner.updateProfile(result.profile);
        this.profile = result.profile;
        this.receivedAt = Date.now();
        this.status.textContent = "";
      } catch (error) {
        this.status.textContent =
          error.name === "AbortError"
            ? "Не удалось получить ответ. Попробуй ещё раз."
            : error.message;
      } finally {
        clearTimeout(timeout);
        this.busy = false;
        this.render();
      }
    }
    cooldown(kind) {
      const pet = this.owner.getMe()?.pet;
      if (!pet) return 0;
      if (this.lastArenaPet !== pet) {
        this.lastArenaPet = pet;
        this.arenaReceivedAt = performance.now();
      }
      return Math.max(0, (pet.cooldowns?.[kind] || 0) - (performance.now() - this.arenaReceivedAt));
    }
    updateArena() {
      const me = this.owner.getMe(),
        pet = me?.pet;
      setHidden(this.hud, !pet || !this.owner.isArena() || !!me?.dead);
      if (this.hud.hidden) {
        setHidden(this.fire, true);
        setHidden(this.secondary, true);
        return;
      }
      if (this.lifeKey !== me.spawnSerial + ":" + me.id) {
        this.lifeKey = me.spawnSerial + ":" + me.id;
        this.sequence = pet.sequence;
        this.activation = null;
        clearTimeout(this.activationTimer);
      }
      const def = R.get(pet.id);
      const portrait = R.imageFor(pet.id, pet.level);
      if (this.hudPortrait.getAttribute("src") !== portrait) this.hudPortrait.src = portrait;
      this.petImage(pet.id, pet.level);
      const title = def.name + ` ${Math.ceil(pet.vitality)}%`;
      if (this.hudTitle.textContent !== title) this.hudTitle.textContent = title;
      if (this.hudMeter.value !== pet.vitality) this.hudMeter.value = pet.vitality;
      setHidden(this.thornCounter,
        !["leva", "zaya"].includes(pet.id) || (pet.id === "leva" && pet.level < 1));
      if (!this.thornCounter.hidden) {
        const remaining = String(Math.max(0, Math.floor(pet.thornMeals || 0)));
        if (this.thornCount.textContent !== remaining) {
          this.thornCount.textContent = remaining;
          this.thornCounter.setAttribute(
            "aria-label",
            `Колючек без разделения осталось: ${remaining}`,
          );
        }
        const active = String(pet.active && Number(remaining) > 0);
        if (this.thornCounter.dataset.active !== active) this.thornCounter.dataset.active = active;
      }
      const hint = pet.active
        ? `Следующий щит через ${Math.ceil(pet.nextGiftMs / 1000)} сек.`
        : "Питомец отдыхает до восстановления живучести";
      if (this.hud.getAttribute("aria-label") !== hint) this.hud.setAttribute("aria-label", hint);
      const update = (b, kind, key) => {
        const count = pet.stock[kind],
          sig = kind + count + !!this.activation;
        if (b.dataset.state !== sig) {
          b.dataset.state = sig;
          b.replaceChildren(
            img(R.abilities[kind].icon),
            el("span", "booster-slot-key", key),
            el("span", "booster-slot-count", String(count)),
          );
          b.setAttribute("aria-label", `${key}. ${R.abilities[kind].name}, ${count}`);
          b.cooldownOverlay = el("span", "booster-slot-cooldown");
          b.cooldownText = el("span");
          b.cooldownOverlay.append(b.cooldownText);
          b.append(b.cooldownOverlay);
        }
        const remaining = this.cooldown(kind);
        window.KillexControls.state(b, !count || !!this.activation, !count);
        const cooling = String(remaining > 0);
        if (b.dataset.cooldown !== cooling) b.dataset.cooldown = cooling;
        setHidden(b.cooldownOverlay, remaining <= 0);
        if (remaining > 0) {
          const sweep = Math.min(1, remaining / R.ABILITY_COOLDOWN_MS) * 360 + "deg";
          if (b.cooldownOverlay.style.getPropertyValue("--cooldown-sweep") !== sweep)
            b.cooldownOverlay.style.setProperty("--cooldown-sweep", sweep);
          const label = window.KillexBoosterTiming.label(remaining);
          if (b.cooldownText.textContent !== label) b.cooldownText.textContent = label;
        }
      };
      update(this.fire, "fire", "Q");
      update(
        this.secondary,
        pet.id === "zaya" ? "carrot" : pet.stock.claw > 0 ? "claw" : "glove",
        "R",
      );
      setHidden(this.fire, !["drakosha", "manya"].includes(pet.id));
      setHidden(this.secondary, false);
    }
    handleKey(event) {
      if (
        !["KeyQ", "KeyR"].includes(event.code) ||
        !this.owner.isArena() ||
        this.owner.inputBlocked() ||
        event.ctrlKey ||
        event.altKey ||
        event.metaKey ||
        event.target?.closest("input,textarea,select,[contenteditable],dialog")
      )
        return false;
      if (!event.repeat) this.use(event.code === "KeyQ" ? "fire" : "secondary");
      return true;
    }
    use(ability, aim) {
      const me = this.owner.getMe(),
        pet = me?.pet;
      if (!pet || this.activation || !this.owner.isArena() || this.owner.inputBlocked()) return;
      const carrot = ability !== "fire" && pet.id === "zaya";
      const kind =
        ability === "fire" ? "fire" : carrot ? "carrot" : pet.stock.claw > 0 ? "claw" : "glove";
      if (this.cooldown(kind) > 0) return;
      if (!carrot && !aim) {
        aim = this.owner.getAim();
        if (!aim) {
          this.owner.targetPet(ability);
          return;
        }
      }
      const message = {
        type: "usePetBooster",
        requestId: window.KillexRequestIds.create(),
        sequence: Math.max(this.sequence || 0, pet.sequence) + 1,
        spawnSerial: me.spawnSerial,
        ability,
      };
      if (aim) Object.assign(message, { aimX: aim.x, aimY: aim.y });
      if (!this.owner.send(message)) return;
      this.sequence = message.sequence;
      this.activation = message;
      this.updateArena();
      this.activationTimer = setTimeout(() => {
        if (this.activation === message) {
          this.owner.send(message);
          this.activationTimer = setTimeout(() => {
            this.activation = null;
            this.updateArena();
          }, 5000);
        }
      }, 2000);
    }
    receive(message) {
      if (message.requestId !== this.activation?.requestId) return;
      clearTimeout(this.activationTimer);
      this.activation = null;
      if (!message.ok) this.owner.notice(message.message);
      this.updateArena();
    }
    draw(ctx, p, part, d) {
      if (!p.pet?.active || part.id !== p.mainPartId) return;
      const art = this.petImage(p.pet.id, p.pet.level);
      if (!art?.complete || !art.naturalWidth) return;
      const size = Math.min(70, Math.max(24, d.radius * 0.65)),
        ratio = art.naturalWidth / art.naturalHeight;
      ctx.drawImage(art, d.x + d.radius * 0.55, d.y + d.radius * 0.55, size * ratio, size);
    }
  }
  window.KillexPetsUI = PetsUI;
})();
