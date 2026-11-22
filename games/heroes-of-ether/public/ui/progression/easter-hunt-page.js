/* Альбом и обмен Пасхальной охоты. Все награды подтверждает сервер. */
"use strict";
(() => {
  const rules = window.KillexEaster;
  const el = (tag, cls, text) => {
    const n = document.createElement(tag);
    n.className = cls || "";
    if (text !== undefined) n.textContent = text;
    return n;
  };
  const image = (name, cls) => {
    const n = el("img", cls);
    n.src = rules.asset(name);
    n.alt = "";
    n.draggable = false;
    return n;
  };
  class EasterPage {
    constructor(owner, back) {
      this.owner = owner;
      this.requests = {};
      this.busy = false;
      this.dialog = el("dialog", "easter-page");
      this.dialog.id = "easterDialog";
      this.dialog.dataset.layout = "fullscreen";
      this.dialog.setAttribute("aria-label", "Пасхальная охота");
      const header = el("header", "easter-heading"),
        heading = el("div");
      const title = el("h1", "easter-title");
      title.append(image("egg-ruby", "easter-heading-icon"), el("span", "", "Пасхальная охота"));
      heading.append(title);
      this.deadline = el("small");
      heading.append(this.deadline);
      const close = el("button", "sf-button sf-tertiary", "К событиям");
      close.onclick = () => {
        this.dialog.close();
        back();
      };
      const actions = el("div", "easter-header-actions");
      this.topButton = el("button", "sf-button sf-tertiary", "Топ искателей");
      this.topButton.id = "easterTopButton";
      this.topButton.onclick = () => {
        this.dialog.close();
        document.dispatchEvent(new CustomEvent("killex:open-event-top"));
      };
      actions.append(this.topButton, close);
      header.append(heading, actions);
      this.tabs = el("nav", "easter-tabs");
      ["Коллекция", "Награды и обмен"].forEach((name, i) => {
        const b = el("button", "sf-button sf-tertiary", name);
        b.onclick = () => this.select(i);
        this.tabs.append(b);
      });
      this.content = el("div", "easter-content");
      this.collection = el("section", "easter-collection");
      this.collectionGrid = el("div", "easter-collection-grid");
      this.collectionCards = rules.collections.map((collection) => {
        const card = el("article", "easter-panel easter-collection-card"),
          album = el("div", "easter-album"),
          progress = el("strong", "easter-card-progress"),
          exchange = el("button", "sf-button sf-tertiary easter-fragment-exchange", "1 ");
        const fragmentIcon = el("span", "easter-exchange-fragment-icon");
        fragmentIcon.setAttribute("aria-hidden", "true");
        exchange.append(
          fragmentIcon,
          document.createTextNode(" = 10 "),
          image("egg-sky", "easter-exchange-egg-icon"),
        );
        exchange.type = "button";
        exchange.onclick = () => this.act("fragments-all", collection.id);
        card.dataset.collectionId = collection.id;
        card.append(el("h2", "easter-collection-name", collection.name));
        album.setAttribute("aria-label", collection.name + ": фрагменты коллекции");
        for (let i = 0; i < rules.fragmentsPerCollection; i++) {
          const piece = el("div", "easter-fragment");
          piece.style.backgroundImage = `url("${collection.image}")`;
          piece.style.backgroundPosition = `${(i % 3) * 50}% ${(Math.floor(i / 3) * 100) / 3}%`;
          album.append(piece);
        }
        card.append(album, progress, exchange);
        this.collectionGrid.append(card);
        return { card, album, progress, exchange };
      });
      this.exchangePanel = el("section", "easter-panel easter-collection-exchange");
      this.progress = el("strong", "easter-progress");
      this.counters = el("div", "easter-counters");
      for (const egg of rules.eggs) {
        const row = el("div", "easter-counter");
        const icon = el("img");
        icon.src = egg.image;
        icon.alt = egg.name;
        row.append(icon, el("strong", "", "0"));
        this.counters.append(row);
      }
      this.exchange = el("button", "sf-button easter-exchange", "Обменять набор на сундук");
      this.exchange.onclick = () => this.act("exchange");
      const exchangeActions = el("div", "easter-exchange-actions"),
        help = el("button", "sf-button sf-tertiary easter-exchange-help", "?");
      help.type = "button";
      help.setAttribute("aria-label", "Состав набора для обмена");
      window.KillexBoosterTooltip.attach(help, {
        name: "Набор на один сундук",
        usage: "Нужно по 10 яиц каждого из четырёх видов.",
        recipe: rules.eggs.map((egg) => ({ ...egg, count: rules.eggsPerType })),
      });
      exchangeActions.append(this.exchange, help);
      this.exchangePanel.append(
        this.progress,
        this.counters,
        exchangeActions,
        el("small", "easter-note", "Яйца сохраняются после выхода и гибели на арене."),
      );
      const multiplierPanel = el("div", "easter-multiplier-panel");
      this.multiplier = el("button", "sf-button sf-tertiary", "Множитель x3 ");
      this.multiplier.id = "easterMultiplier";
      this.multiplier.append(image("egg-leaf", "easter-exchange-egg-icon"));
      this.multiplier.onclick = () => this.act("multiplier");
      this.multiplierInfo = el("span", "easter-multiplier-info");
      multiplierPanel.append(this.multiplier, this.multiplierInfo);
      this.exchangePanel.append(multiplierPanel);
      this.collection.append(this.collectionGrid, this.exchangePanel);
      this.rewards = el("section", "easter-panel easter-rewards");
      this.rewards.append(el("h2", "", "Пасхальный сундук"));
      const chest = el("div", "easter-chest-summary");
      this.chestContents = el("p");
      chest.append(image("chest", "easter-chest-art"), this.chestContents);
      this.rewards.append(chest);
      const booster = el("div", "easter-booster");
      booster.append(
        image("egg-sun"),
        el(
          "p",
          "",
          "Бустер даёт каждой части игрока +50 массы каждые 2 секунды в течение 10 секунд. Хранится два месяца с получения, до полуночи по Москве.",
        ),
      );
      this.rewards.append(booster);
      const prizes = el("div", "easter-prizes");
      for (const [src, name] of [
        ["golden-egg", "Регалия «Золотое яйцо»"],
        ["rabbit-ears", "Шапка «Кроличьи ушки»"],
        ["carrot-bow", "Морковная бабочка"],
      ]) {
        const p = el("div");
        p.append(image(src), el("strong", "", name));
        prizes.append(p);
      }
      this.rewards.append(el("h3", "", "За четыре коллекции по 12 фрагментов"), prizes);
      this.ether = el("button", "sf-button easter-ether-exchange", "100 ");
      this.ether.setAttribute("aria-label", "Обменять 100 яиц на 5 эфира");
      this.ether.append(
        image("egg-sky", "easter-exchange-egg-icon"),
        document.createTextNode(" = 5 "),
      );
      const etherIcon = el("img", "easter-ether-icon");
      etherIcon.src = "assets/menu-icons/128/currency_bucks.webp?art=20261122b";
      etherIcon.alt = "эфира";
      this.ether.append(etherIcon);
      this.ether.onclick = () => this.act("ether");
      this.etherLimit = el("small", "easter-note");
      this.rewards.append(this.ether, this.etherLimit);
      this.content.append(this.collection, this.rewards);
      this.message = el("p", "easter-message");
      this.message.setAttribute("role", "status");
      this.treasury = el("button", "sf-button sf-tertiary", "В сокровищницу");
      this.treasury.onclick = () => {
        this.dialog.close();
        document.dispatchEvent(
          new CustomEvent("killex:open-chests", { detail: { category: "treasury" } }),
        );
      };
      const footer = el("footer", "easter-footer");
      footer.append(this.message, this.treasury);
      this.dialog.append(header, this.tabs, this.content, footer);
      document.body.append(this.dialog);
      this.select(0);
      document.addEventListener("killex:profile", () => {
        this.updateHud();
        if (this.dialog.open && !document.hidden) this.render();
      });
      this.dialog.addEventListener("close", () => this.clock?.());
      document.addEventListener("visibilitychange", () => {
        if (!document.hidden && this.dialog.open) {
          this.render();
          this.owner.loadProfile();
        }
      });
      document.addEventListener("killex:arena-profile", () => this.updateHud());
      this.hud = el("div", "easter-hud");
      this.hud.id = "easterCounters";
      this.hud.hidden = true;
      for (const egg of rules.eggs) {
        const row = el("span");
        const icon = el("img");
        icon.src = egg.image;
        icon.alt = egg.name;
        row.setAttribute("aria-label", egg.name + ": собрано за эту жизнь");
        row.append(icon, el("b", "", "0"));
        this.hud.append(row);
      }
      document.getElementById("massPanel")?.append(this.hud);
      this.updateHud();
    }
    select(i) {
      this.dialog.dataset.page = String(i);
      [...this.tabs.children].forEach((b, n) => b.setAttribute("aria-pressed", String(n === i)));
    }
    state() {
      return (
        this.owner.getProfile()?.easter || {
          active: false,
          eggs: [0, 0, 0, 0],
          fragments: 0,
          chests: [],
        }
      );
    }
    active(s) {
      return s.active && s.endsAt > (window.KillexAppearance?.now?.() ?? Date.now());
    }
    updateHud() {
      const s = this.state();
      this.hud.hidden = !this.active(s);
      [...this.hud.children].forEach(
        (n, i) => (n.lastChild.textContent = (s.lifeEggs?.[i] || 0).toLocaleString("ru-RU")),
      );
    }
    open() {
      if (!this.owner.isLobby()) return;
      this.message.textContent = "";
      this.select(0);
      this.render();
      window.KillexWindows.open(this.dialog);
      this.owner.loadProfile();
      this.clock?.();
      let ticks = 0;
      this.clock = window.KillexActivity.every(() => {
        if (document.hidden) return;
        this.render();
        if (++ticks % 30 === 0) this.owner.loadProfile();
      }, 1000, () => this.dialog.open);
    }
    render() {
      const s = this.state(),
        active = this.active(s);
      const contents = s.chestContents;
      this.chestContents.textContent = contents
        ? `${contents.coins.join("–")} монет, ${contents.crystals.join("–")} кристаллов, ${contents.greatness} величия, ${contents.boosterCount} бустеров «Пасхальное яйцо» и случайный фрагмент. Возможны повторы.${contents.tickets ? " +1 билет рулетки с Lite." : ""}`
        : "";
      this.updateHud();
      this.deadline.textContent = active
        ? "До " +
          new Date(s.endsAt).toLocaleString("ru-RU", {
            day: "2-digit",
            month: "2-digit",
            hour: "2-digit",
            minute: "2-digit",
          })
        : "Событие завершено";
      const multiplierActive =
        active && s.multiplier?.expiresAt > (window.KillexAppearance?.now?.() ?? Date.now());
      window.KillexControls.state(
        this.multiplier,
        this.busy ||
          !active ||
          multiplierActive ||
          (this.owner.getProfile()?.wallet?.bucks || 0) < 250,
        !active || multiplierActive || (this.owner.getProfile()?.wallet?.bucks || 0) < 250,
      );
      this.multiplier.setAttribute(
        "aria-label",
        multiplierActive ? "Множитель x3 активен" : "Множитель x3 на 3 часа за 250 эфира",
      );
      this.multiplier.setAttribute("aria-pressed", String(multiplierActive));
      this.multiplier.title =
        "Каждое подобранное яйцо даёт 3 яйца в запас. В топе считается один подбор. Действует только в текущем событии.";
      this.multiplierInfo.replaceChildren();
      if (multiplierActive) {
        const seconds = Math.max(
          0,
          Math.ceil(
            (Math.min(s.endsAt, s.multiplier.expiresAt) -
              (window.KillexAppearance?.now?.() ?? Date.now())) /
              1000,
          ),
        );
        this.multiplierInfo.textContent =
          "Осталось " + window.KillexIdentity.formatDuration(seconds);
      } else {
        this.multiplierInfo.append(document.createTextNode("3 часа - 250 "));
        const ether = el("img", "easter-ether-icon");
        ether.src = "assets/menu-icons/128/currency_bucks.webp?art=20261122b";
        ether.alt = "эфира";
        this.multiplierInfo.append(ether);
      }
      this.progress.textContent = `Всего фрагментов: ${s.fragments} / ${rules.fragments}`;
      this.collectionCards.forEach(({ card, album, progress, exchange }, index) => {
        const offset = index * rules.fragmentsPerCollection;
        let collected = 0,
          spares = 0;
        [...album.children].forEach((piece, i) => {
          const count = s.fragmentCounts?.[offset + i] ?? (offset + i < s.fragments ? 1 : 0);
          if (count > 0) collected++;
          spares += Math.max(0, count - 1);
          piece.dataset.found = String(count > 0);
          piece.textContent = count > 1 ? `×${count}` : "";
          piece.setAttribute(
            "aria-label",
            `Фрагмент ${i + 1}: ${count ? `собран, ${count} шт.` : "не найден"}`,
          );
        });
        progress.textContent = `${collected} / ${rules.fragmentsPerCollection} фрагментов`;
        card.dataset.complete = String(collected === rules.fragmentsPerCollection);
        window.KillexControls.state(
          exchange,
          this.busy || !active || collected < rules.fragmentsPerCollection || !spares,
          !active || collected < rules.fragmentsPerCollection || !spares,
        );
        exchange.title =
          collected < rules.fragmentsPerCollection
            ? "Обмен откроется после сборки этого изображения."
            : `Обменять все лишние фрагменты: ${spares}. Получишь ${spares * 10} случайных яиц.`;
        exchange.firstChild.textContent = `${spares || 1} `;
        exchange.childNodes[2].textContent = ` = ${(spares || 1) * 10} `;
        exchange.setAttribute(
          "aria-label",
          `Обменять все лишние фрагменты: ${rules.collections[index].name}, ${spares} фрагментов на ${spares * 10} яиц`,
        );
      });
      [...this.counters.children].forEach(
        (n, i) => (n.lastChild.textContent = s.eggs[i].toLocaleString("ru-RU")),
      );
      window.KillexControls.state(
        this.exchange,
        this.busy || !active || !rules.eggs.every((_, i) => s.eggs[i] >= rules.eggsPerType),
        !active || !rules.eggs.every((_, i) => s.eggs[i] >= rules.eggsPerType),
      );
      this.exchange.textContent = "Обменять набор на сундук";
      const limit = s.etherExchange?.limit ?? rules.etherDailyLimit,
        used = Date.now() < (s.etherExchange?.resetsAt || 0) ? s.etherExchange.used : 0;
      this.etherLimit.textContent =
        s.fragments < rules.fragments
          ? `После четырёх коллекций - до ${limit} обменов в день.`
          : `Осталось обменов сегодня: ${Math.max(0, limit - used)} / ${limit}.`;
      window.KillexControls.state(
        this.ether,
        this.busy ||
          !active ||
          used >= limit ||
          s.fragments < rules.fragments ||
          s.eggs.reduce((a, b) => a + b, 0) < 100,
        !active ||
          used >= limit ||
          s.fragments < rules.fragments ||
          s.eggs.reduce((a, b) => a + b, 0) < 100,
      );
      this.treasury.textContent = `В сокровищницу${s.chests.length ? " (" + s.chests.length + ")" : ""}`;
    }
    async act(action, collectionId) {
      if (this.busy) return;
      const s = this.state(),
        key = action + ":" + s.runId + (collectionId ? ":" + collectionId : "");
      const request = (this.requests[key] ||= {
        action,
        runId: s.runId,
        requestId: window.KillexRequestIds.create(),
        ...(collectionId ? { collectionId } : {}),
      });
      this.busy = true;
      this.render();
      this.message.textContent = "";
      try {
        const response = await fetch("/api/easter/action", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(request),
          signal: AbortSignal.timeout(8000),
        });
        const result = await response.json();
        if (!response.ok) throw Error(result.error || "Не удалось выполнить обмен.");
        this.owner.updateProfile(result.profile);
        delete this.requests[key];
        this.message.textContent =
          action === "multiplier"
            ? "Множитель x3 включён на 3 часа."
            : action === "fragments-all"
              ? "Все лишние фрагменты этой картины обменены на яйца."
              : action === "ether"
                ? "Получено 5 эфира."
                : result.profile.easter.chests.some((c) => !c.stored)
                  ? "Сундук получен и ожидает свободного места в сокровищнице."
                  : "Пасхальный сундук добавлен в сокровищницу.";
      } catch (error) {
        this.message.textContent = error.message + " Можно повторить без двойного списания.";
      } finally {
        this.busy = false;
        this.render();
      }
    }
  }
  window.KillexEasterPage = EasterPage;
})();
