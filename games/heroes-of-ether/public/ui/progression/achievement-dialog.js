/* Коллекция достижений, фильтры, детали и Карьера. */
"use strict";
(() => {
  const el = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  };
  const number = (n) => Number(n || 0).toLocaleString("ru-RU");
  const stateOf = (a) =>
    a.available === false
      ? "planned"
      : a.claimed >= a.thresholds.length
        ? "complete"
        : a.value > 0 || a.claimed > 0
          ? "started"
          : "new";
  const nextGoal = (a) => a.thresholds[Math.min(a.claimed, a.thresholds.length - 1)];
  const image = (src, cls, size = 48) => {
    const n = el("img", cls);
    n.src = window.KillexArtRevision.url(src);
    n.alt = "";
    n.width = size;
    n.height = size;
    return n;
  };
  function art(id, cls = "achievement-emblem") {
    return window.KillexAchievementBadge.create(id, cls, 80);
  }
  function meter(value, max, label) {
    const track = el("div", "honor-track");
    track.setAttribute("role", "progressbar");
    track.setAttribute("aria-label", label);
    track.setAttribute("aria-valuemin", "0");
    track.setAttribute("aria-valuemax", String(max));
    track.setAttribute("aria-valuenow", String(Math.min(value, max)));
    track.setAttribute("aria-valuetext", `${number(value)} из ${number(max)}`);
    const fill = el("span");
    fill.style.width = `${Math.min(100, (value / max) * 100)}%`;
    track.append(fill);
    return track;
  }
  class AchievementUI {
    constructor() {
      this.profile = null;
      this.selected = null;
      this.filters = new Set(["new", "started", "complete", "planned"]);
      this.page = 0;
      this.pageSize = 1;
      this.columns = 1;
      this.rows = 1;
      this.root = el("div", "achievements-layout");
      this.root.dataset.panel = "showcase";
      document.addEventListener("killex:window-reset", event => {
        if (!event.target.contains(this.root)) return;
        this.selected = null; this.page = this.milestonePage = 0;
        this.filters = new Set(["new", "started", "complete", "planned"]);
        this.root.querySelectorAll('.achievement-filters input[type="checkbox"]').forEach(input => { input.checked = true; });
        this.showPanel("showcase");
        if (this.profile) this.renderGrid();
      }, true);
      this.panelTabs = el("nav", "achievement-panel-tabs");
      this.panelTabs.setAttribute("aria-label", "Разделы достижений");
      for (const [panel, label] of [
        ["showcase", "Достижения"],
        ["detail", "Прогресс"],
        ["honor", "Титул"],
      ]) {
        const tab = el("button", "sf-tab", label);
        tab.type = "button";
        tab.dataset.panel = panel;
        tab.setAttribute("aria-pressed", String(panel === "showcase"));
        tab.onclick = () => this.showPanel(panel);
        this.panelTabs.append(tab);
      }
      this.sidebar = el("aside", "honor-sidebar");
      this.sidebar.setAttribute("aria-label", "Титул и награды");
      this.showcase = el("section", "achievement-showcase");
      this.showcase.setAttribute("aria-label", "Витрина достижений");
      const toolbar = el("div", "achievement-toolbar"),
        filters = el("fieldset", "achievement-filters");
      filters.append(el("legend", "sr-only", "Состояние достижения"));
      for (const [key, label] of [
        ["new", "Не начаты"],
        ["started", "В процессе"],
        ["complete", "Выполнены"],
      ]) {
        const wrap = el("label"),
          input = el("input");
        input.type = "checkbox";
        input.checked = true;
        input.value = key;
        input.addEventListener("change", () => {
          if (input.checked) this.filters.add(key);
          else this.filters.delete(key);
          this.page = 0;
          this.renderGrid();
        });
        wrap.append(input, el("span", "", label));
        filters.append(wrap);
      }
      toolbar.append(filters);
      this.grid = el("div", "achievement-grid");
      this.grid.setAttribute("role", "group");
      this.grid.setAttribute("aria-label", "Выбрать достижение");
      this.detail = el("section", "achievement-detail");
      this.detail.id = "achievementDetail";
      this.detail.setAttribute("aria-label", "Прогресс достижения");
      this.pages = el("nav", "achievement-pages");
      this.pages.setAttribute("aria-label", "Страницы достижений");
      this.showcase.append(toolbar, this.grid, this.pages, this.detail);
      this.root.append(this.panelTabs, this.sidebar, this.showcase);
      const resize = () => {
        if (!this.grid.clientWidth) return;
        const style = getComputedStyle(this.grid);
        const cardWidth = parseFloat(style.getPropertyValue("--achievement-card-width"));
        const gap = parseFloat(style.gap);
        const inset = parseFloat(style.paddingLeft) + parseFloat(style.paddingRight) + 2;
        const columns = Math.max(
          1,
          Math.floor((this.grid.clientWidth - inset + gap) / (cardWidth + gap)),
        );
        // Four stable rows; shorter windows scroll the content instead of reshuffling cards.
        const rows = Math.max(1, Math.min(4, Math.ceil(this.entries().length / columns) || 1));
        if (this.columns === columns && this.rows === rows) return;
        this.columns = columns;
        this.rows = rows;
        this.pageSize = columns * rows;
        this.grid.style.setProperty("--achievement-columns", columns);
        this.grid.style.setProperty("--achievement-rows", rows);
        if (this.profile) this.renderGrid(true);
      };
      let resizeFrame = 0;
      const scheduleResize = () => {
        cancelAnimationFrame(resizeFrame);
        resizeFrame = requestAnimationFrame(resize);
      };
      const observer = new ResizeObserver(scheduleResize);
      observer.observe(this.grid);
      observer.observe(this.detail);
      observer.observe(this.showcase);
      addEventListener("resize", () => {
        if (this.profile) this.renderDetail();
        scheduleResize();
      });
      resize();
    }
    showPanel(panel) {
      this.root.dataset.panel = panel;
      for (const tab of this.panelTabs.children)
        tab.setAttribute("aria-pressed", String(tab.dataset.panel === panel));
    }
    entries() {
      const p = this.profile;
      if (!p) return [];
      const list = [...p.progress.achievements];
      return list;
    }
    render(profile) {
      this.profile = profile;
      const key = JSON.stringify([profile.id, profile.honors, profile.greatness, profile.progress.achievements]);
      if (key === this.profileRenderKey) return;
      this.profileRenderKey = key;
      this.renderHonor();
      this.renderGrid();
    }
    select(id) {
      if (this.selected !== id) this.milestonePage = 0;
      this.selected = id;
      for (const card of this.grid.querySelectorAll(".achievement-card"))
        card.setAttribute("aria-pressed", String(card.dataset.achievement === id));
      this.renderDetail();
    }
    renderGrid(revealSelected = false) {
      const focused = this.grid.contains(document.activeElement)
        ? document.activeElement.dataset.achievement
        : null;
      const list = this.entries().filter((a) => this.filters.has(stateOf(a)));
      const totalPages = Math.ceil(list.length / this.pageSize);
      if (revealSelected)
        this.page = Math.max(
          0,
          Math.floor(list.findIndex((a) => a.id === this.selected) / this.pageSize),
        );
      this.page = Math.min(this.page, Math.max(0, totalPages - 1));
      const visible = list.slice(this.page * this.pageSize, (this.page + 1) * this.pageSize);
      if (!visible.some((a) => a.id === this.selected)) {
        this.selected = visible[0]?.id || null;
        this.milestonePage = 0;
      }
      this.grid.replaceChildren();
      this.pages.replaceChildren();
      this.pages.hidden = totalPages <= 1;
      const label = el("span", "", `${this.page + 1} / ${Math.max(1, totalPages)}`);
      label.setAttribute("aria-live", "polite");
      for (const [delta, text, name] of [
        [-1, "‹", "Предыдущая страница"],
        [1, "›", "Следующая страница"],
      ]) {
        const control = el("button", "", text);
        control.type = "button";
        control.setAttribute("aria-label", name);
        window.KillexControls.state(
          control,
          this.page + delta < 0 || this.page + delta >= totalPages,
        );
        control.onclick = () => {
          this.page += delta;
          this.renderGrid();
          const controls = [...this.pages.querySelectorAll("button")];
          (
            controls.find(
              (button) => button.getAttribute("aria-label") === name && !button.disabled,
            ) || controls.find((button) => !button.disabled)
          )?.focus({ preventScroll: true });
        };
        if (delta === 1) this.pages.append(label);
        this.pages.append(control);
      }
      for (const a of visible) {
        const card = el("button", "achievement-card");
        card.type = "button";
        card.dataset.achievement = a.id;
        card.dataset.state = stateOf(a);
        card.dataset.earned = String(a.claimed > 0);
        card.setAttribute("aria-controls", this.detail.id);
        card.setAttribute(
          "aria-label",
          `${a.name}. Степеней: ${a.claimed} из ${a.thresholds.length}. Прогресс: ${number(a.value)}.`,
        );
        const stars = el("span", "achievement-stars");
        stars.setAttribute("aria-hidden", "true");
        for (let i = 0; i < a.thresholds.length; i++)
          stars.append(el("span", i < a.claimed ? "achievement-earned" : "", "★"));
        card.append(art(a.id), el("strong", "achievement-name", a.name), stars);
        card.addEventListener("pointerenter", (event) => {
          if (event.pointerType === "mouse") this.select(a.id);
        });
        card.addEventListener("focus", () => this.select(a.id));
        card.addEventListener("click", () => {
          this.select(a.id);
          if (matchMedia("(max-width: 700px)").matches) this.showPanel("detail");
        });
        this.grid.append(card);
      }
      if (!list.length)
        this.grid.append(el("p", "achievement-empty", "Нет достижений для выбранных фильтров."));
      this.select(this.selected);
      if (focused)
        [...this.grid.children]
          .find((c) => c.dataset.achievement === focused)
          ?.focus({ preventScroll: true });
    }
    renderDetail() {
      const a = this.entries().find((a) => a.id === this.selected);
      this.detail.replaceChildren();
      if (!a) {
        this.detail.append(
          el("p", "achievement-empty", "Включите фильтры, чтобы выбрать достижение."),
        );
        return;
      }
      this.detail.dataset.achievementDetail = a.id;
      const complete = stateOf(a) === "complete",
        goal = nextGoal(a),
        head = el("div", "achievement-detail-heading");
      head.append(el("h3", "", a.name));
      const progress = el("div", "achievement-detail-progress"),
        value = el("strong", "achievement-value", `${number(a.value)} / ${number(goal)}`);
      if (a.id === "career") value.append(window.KillexGreatnessUI.icon(20, "величия"));
      const remaining = el(
        "span",
        "achievement-remaining",
        complete ? "Выполнено" : `До следующей степени: ${number(Math.max(0, goal - a.value))}`,
      );
      if (a.id === "career" && !complete)
        remaining.append(window.KillexGreatnessUI.icon(20, "величия"));
      progress.append(value, remaining);
      head.append(
        window.KillexGreatnessUI.label(el("p", "achievement-description", a.description)),
      );
      this.detail.append(head, progress, meter(a.value, goal, a.name));
      if (a.unit && a.id !== "career")
        (complete ? value : remaining).append(
          window.KillexGreatnessUI.label(el("span", "achievement-unit", a.unit)),
        );
      const tiers = el("ol", "achievement-milestones");
      tiers.style.setProperty("--achievement-degree-columns", Math.min(5, a.thresholds.length));
      if (a.titles) tiers.classList.add("career-milestones");
      const compact = matchMedia("(max-width: 700px)").matches;
      const start = compact ? (this.milestonePage || 0) * 4 : 0;
      a.thresholds.forEach((threshold, i) => {
        if (compact && (i < start || i >= start + 4)) return;
        const row = el("li", i < a.claimed ? "achievement-earned" : "");
        row.dataset.degree = String(i + 1);
        const reward = el("small", "milestone-reward");
        reward.append(window.KillexGreatnessUI.value(`+${number(a.rewards[i])}`));
        if (a.titles) {
          const chest = image(
            window.KillexProgressionArt.chest(a.titles[i].id, 128),
            "milestone-chest-art",
            16,
          );
          chest.alt = "Сундук за титул";
          chest.title = a.titles[i].chestName;
          reward.append(chest);
        }
        if (a.titles)
          row.append(
            image(window.KillexProgressionArt.rank(a.titles[i].id, 128), "career-rank-art", 48),
          );
        row.append(
          el(
            "strong",
            "",
            a.titles?.[i]?.name || `Степень ${["I", "II", "III", "IV", "V", "VI"][i] || i + 1}`,
          ),
          a.titles
            ? window.KillexGreatnessUI.value(number(threshold))
            : el("span", "", number(threshold)),
          reward,
          el(
            "small",
            "milestone-state",
            i < a.claimed ? "✓ Получено" : i === a.claimed ? "Следующая" : "Впереди",
          ),
        );
        tiers.append(row);
      });
      this.detail.append(tiers);
      if (compact && a.thresholds.length > 4) {
        const pages = el("nav", "achievement-pages milestone-pages");
        pages.setAttribute("aria-label", "Степени достижения");
        for (let i = 0; i < Math.ceil(a.thresholds.length / 4); i++) {
          const tab = el("button", "", `${i * 4 + 1}–${Math.min(a.thresholds.length, i * 4 + 4)}`);
          tab.type = "button";
          if (i === (this.milestonePage || 0)) tab.setAttribute("aria-current", "page");
          tab.onclick = () => {
            this.milestonePage = i;
            this.renderDetail();
          };
          pages.append(tab);
        }
        this.detail.append(pages);
      }
    }
    openTitles() {
      if (!this.titlesDialog) {
        this.titlesDialog = el("dialog", "titles-catalog-dialog");
        this.titlesDialog.setAttribute("aria-label", "Все титулы и награды");
        document.body.append(this.titlesDialog);
      }
      window.KillexTitlesCatalog.open(this.titlesDialog, this.profile);
    }
    renderHonor() {
      const p = this.profile,
        h = p.honors;
      this.sidebar.replaceChildren();
      if (!h) return;
      const current = h.tiers[h.claimed - 1],
        next = h.tiers[h.claimed],
        reward = current || next;
      const hero = el("div", "honor-hero"),
        trophy = el("div", "honor-trophy");
      trophy.dataset.degree = String(h.claimed);
      trophy.append(
        image(window.KillexProgressionArt.rank(reward.id, 256), "honor-trophy-art", 196),
      );
      const copy = el("div", "honor-copy");
      copy.append(
        el("span", "honor-eyebrow", "Твой титул"),
        el("h3", "honor-name", current?.name || "Без титула"),
        el("p", "honor-degree", `Степень ${h.claimed} / ${h.tiers.length}`),
      );
      hero.append(copy, trophy);
      this.sidebar.append(hero);
      const advancement = el("div", "honor-advancement");
      advancement.append(
        el("strong", "", next ? `Следующий: ${next.name}` : "Высший титул получен"),
        meter(p.greatness, next?.threshold || current.threshold, "Величие до следующего титула"),
        window.KillexGreatnessUI.label(
          el(
            "span",
            "honor-greatness",
            next
              ? `${number(p.greatness)} / ${number(next.threshold)} величия`
              : `${number(p.greatness)} величия`,
          ),
        ),
      );
      const career = el("button", "honor-career-link", "Все титулы");
      career.type = "button";
      career.addEventListener("click", () => this.openTitles());
      advancement.append(career);
      this.sidebar.append(advancement);
      if (!reward) return;
      const rewards = el("section", "honor-rewards");
      rewards.append(
        el("h4", "", current ? "Награды за титул" : "За первый титул"),
        el("p", "honor-reward-title", reward.name),
      );
      const chest = el("div", "honor-gift");
      const chestIcon = image(window.KillexProgressionArt.chest(reward.id, 128), "chest-art", 48);
      chest.append(chestIcon, el("strong", "", reward.chestName));
      rewards.append(chest, el("p", "", "Постоянная медаль и рамка этого титула"));
      if (current?.id === "boss")
        rewards.append(el("p", "", "Героическая тема интерфейса и фон лобби навсегда"), el("p", "", "Специальный подарок от игры"));
      const chestState =
        reward.state === "opened"
          ? "Сундук открыт - награды получены"
          : reward.state === "unearned"
            ? "Будет получен вместе с титулом"
            : reward.reason
              ? "Сундук получен - открытие пока закрыто"
              : "Сундук получен - можно открыть";
      rewards.append(el("p", "honor-chest-state", chestState));
      const contents = el("details", "honor-chest-preview");
      contents.append(el("summary", "", "Состав сундука"));
      const wallet = el("ul", "honor-currencies");
      for (const [key, name] of [
        ["coins", "монет"],
        ["crystals", "кристаллов"],
        ["bucks", "эфира"],
      ]) {
        const li = el("li");
        li.append(
          image(`assets/menu-icons/64/currency_${key}.webp?art=20261122b`, "", 28),
          el("span", "", `${number(reward[key])} ${name}`),
        );
        wallet.append(li);
      }
      contents.append(
        wallet,
        el(
          "p",
          "",
          `${number(reward.boosters)} бустеров - ${reward.contents.replace(/\s*[\u00b7\u2022]\s*/gu, ", ")}`,
        ),
      );
      if (reward.accountDays)
        contents.append(
          el(
            "p",
            "",
            Object.entries(reward.accountDays)
              .map(([kind, days]) => `${kind === "vip" ? "VIP" : "Premium"}: ${days} дней`)
              .join(", "),
          ),
        );
      if (reward.tickets)
        contents.append(el("p", "", `+${number(reward.tickets)} билет рулетки с Lite`));
      if (reward.reason) contents.append(el("p", "", reward.reason));
      const chestButton = el("button", "sf-button sf-tertiary honor-chests-button", "К сундукам");
      chestButton.type = "button";
      chestButton.addEventListener("click", () => {
        document.dispatchEvent(new CustomEvent("killex:open-chests"));
      });
      rewards.append(contents, chestButton);
      this.sidebar.append(rewards);
    }
  }
  window.KillexAchievementUI = AchievementUI;
})();
