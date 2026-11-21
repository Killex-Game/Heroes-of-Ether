/* Редактор герба: выбор формы, цвета и символа. */
"use strict";
(() => {
  const kit = window.KillexClanCrests;
  const compact = matchMedia("(max-width: 760px)");
  compact.addEventListener("change", () => {
    for (const root of document.querySelectorAll(".clan-crest-builder")) {
      root.crestBuilder.page = 0;
      root.crestBuilder.render();
    }
  });
  const el = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  };
  class CrestBuilder {
    constructor({
      initial = null,
      legacy = "astral",
      clanLevel = 1,
      testAccess = false,
      disabled = false,
      heading = "",
      onChange = () => {},
    } = {}) {
      this.initial = kit.normalize(initial);
      this.value = this.initial;
      this.legacy = legacy;
      this.disabled = disabled;
      this.heading = heading;
      this.clanLevel = clanLevel;
      this.testAccess = testAccess;
      this.onChange = onChange;
      this.tab = "frames";
      this.page = 0;
      this.colorLayer = "color";
      this.columns = 6;
      this.pageSize = 12;
      this.pages = {};
      this.pageSizes = {};
      this.overview = false;
      this.compact = compact;
      this.root = el("section", "clan-crest-builder");
      this.root.crestBuilder = this;
      this.root.setAttribute("aria-label", "Конструктор герба");
      this.render();
      this.resize = new ResizeObserver(() => {
        if (!this.root.isConnected) {
          this.resize.disconnect();
          return;
        }
        this.fitChoices();
      });
      this.resize.observe(this.root);
    }
    fitChoices() {
      if (!this.root.isConnected) return;
      const controls = this.root.querySelector(".clan-crest-controls"),
        available =
          this.root.getBoundingClientRect().bottom -
          controls.getBoundingClientRect().top -
          (parseFloat(getComputedStyle(this.root).paddingBottom) || 0);
      const overview =
        !!this.root.closest(".clan-unified-appearance") &&
        controls.clientWidth >= 620 &&
        available >= 340;
      if (overview !== this.overview) {
        this.overview = overview;
        this.render();
        return;
      }
      if (overview) return this.fitOverview(available);
      const grid = this.root.querySelector(".clan-crest-choices"),
        style = getComputedStyle(grid);
      const columns = Math.max(1, style.gridTemplateColumns.split(" ").length);
      const cell = grid.firstElementChild?.getBoundingClientRect().height || 64;
      const gap = parseFloat(style.rowGap) || 0;
      let rows = 2;
      if (this.root.closest(".clan-unified-appearance")) {
        const trailing = [...grid.parentElement.children]
          .filter(
            (n) => n.classList.contains("clan-muted") || n.classList.contains("clan-crest-presets"),
          )
          .reduce((sum, n) => {
            const s = getComputedStyle(n);
            return (
              sum +
              n.getBoundingClientRect().height +
              (parseFloat(s.marginTop) || 0) +
              (parseFloat(s.marginBottom) || 0)
            );
          }, 0);
        const room =
          this.root.getBoundingClientRect().bottom -
          grid.getBoundingClientRect().top -
          (parseFloat(getComputedStyle(this.root).paddingBottom) || 0) -
          trailing -
          36;
        rows = Math.max(1, Math.floor((room + gap) / (cell + gap)));
      }
      const capacity = columns * rows;
      if (capacity !== this.pageSize) {
        this.columns = columns;
        this.pageSize = capacity;
        this.render();
      }
    }
    fitOverview(available) {
      let changed = false;
      for (const column of this.root.querySelectorAll(".clan-crest-column")) {
        const panels = [...column.children].map((panel) => {
          const tab = panel.dataset.category,
            grid = panel.querySelector(".clan-crest-choices"),
            style = getComputedStyle(grid),
            columns = Math.max(1, style.gridTemplateColumns.split(" ").length),
            cell = grid.firstElementChild.getBoundingClientRect().height,
            gap = parseFloat(style.rowGap) || 0,
            count = kit[tab].length,
            presets = panel.querySelector(".clan-crest-presets");
          return {
            tab,
            columns,
            cell,
            gap,
            count,
            rows: 1,
            desired: Math.ceil(count / columns),
            overhead:
              grid.getBoundingClientRect().top -
              panel.getBoundingClientRect().top +
              (presets ? presets.getBoundingClientRect().height + 10 : 0),
          };
        });
        const height = () =>
          panels.reduce(
            (sum, p) =>
              sum + p.overhead + p.rows * (p.cell + p.gap) - p.gap + (p.rows < p.desired ? 30 : 0),
            0,
          ) +
          (panels.length - 1) * 10;
        while (true) {
          const next = panels
            .filter(
              (p) =>
                p.rows < p.desired &&
                height() + p.cell + p.gap - (p.rows + 1 === p.desired ? 30 : 0) <= available,
            )
            .sort((a, b) => b.desired / b.rows - a.desired / a.rows)[0];
          if (!next) break;
          next.rows++;
        }
        for (const p of panels) {
          const size = Math.min(p.count, p.columns * p.rows);
          if (this.pageSizes[p.tab] !== size) {
            this.pageSizes[p.tab] = size;
            changed = true;
          }
        }
      }
      if (changed) this.render();
    }
    change(key, value) {
      if (this.disabled || (!this.testAccess && kit.requiredLevel(value) > this.clanLevel)) return;
      this.value = { ...(this.value || kit.DEFAULT), [key]: value };
      this.render();
      this.onChange(this.value);
    }
    category(tab, c) {
      const controls = el("section", "clan-crest-category");
      controls.dataset.category = tab;
      const label = {
        frames: "Форма",
        metals: "Рамка",
        patterns: "Поле",
        colors: "Цвета",
        symbols: "Символ",
      }[tab];
      controls.setAttribute("aria-label", label);
      if (this.overview) controls.append(el("h4", "clan-crest-category-title", label));
      const grid = el("div", "clan-crest-choices");
      grid.dataset.category = tab;
      const values = kit.choicesForLevel(tab, this.clanLevel);
      const pageSize = this.overview ? this.pageSizes[tab] || 1 : this.pageSize;
      const pageCount = Math.ceil(values.length / pageSize);
      const page = Math.min(this.overview ? this.pages[tab] || 0 : this.page, pageCount - 1);
      for (const item of values.slice(page * pageSize, (page + 1) * pageSize)) {
        const key = {
            frames: "frame",
            colors: this.colorLayer,
            symbols: "symbol",
            patterns: "pattern",
            metals: "metal",
          }[tab],
          b = el("button", "clan-crest-choice");
        b.type = "button";
        const locked = !this.testAccess && kit.requiredLevel(item.id) > this.clanLevel;
        window.KillexControls.state(b, this.disabled || locked);
        b.classList.toggle("clan-crest-locked", locked);
        const level = kit.requiredLevel(item.id);
        b.title = item.name + (locked ? ` - Доступно с ${level} уровня клана` : "");
        if (locked) b.append(el("span", "clan-crest-level-lock", `${level} ур.`));
        b.setAttribute("aria-label", item.name);
        b.setAttribute(
          "aria-pressed",
          String(
            (c[key] || { pattern: "solid", metal: "gold", secondary: "c18_ivory" }[key]) ===
              item.id && this.value !== null,
          ),
        );
        b.dataset.choice = String(item.id);
        if (tab === "colors") {
          const swatch = el("span", "clan-crest-swatch");
          swatch.style.background = item.hex;
          b.append(swatch);
        } else {
          const image = el("img");
          image.alt = "";
          if (tab === "frames" || tab === "metals") kit.paintImage(image, { ...c, [key]: item.id });
          else if (tab === "patterns") {
            const value = {
              ...kit.DEFAULT,
              frame: "f11_french",
              color: "c23_navy",
              secondary: "c21_snow",
              pattern: item.id,
            };
            const field = kit
              .fieldSvg(value)
              .replace(
                "</svg>",
                '<path d="M64 62H448V450H64Z" fill="none" stroke="#ce9c38" stroke-width="9"/></svg>',
              );
            image.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(field);
          } else image.src = kit.symbolSource(item.id, 128);
          b.append(image);
        }
        b.onclick = () => this.change(key, item.id);
        grid.append(b);
      }

      if (tab === "colors") {
        const layers = el("div", "clan-crest-color-layers");
        for (const [key, label] of [
          ["color", "Основной цвет"],
          ["secondary", "Второй цвет"],
        ]) {
          const button = el("button", "sf-tab", label);
          button.type = "button";
          button.setAttribute("aria-pressed", String(this.colorLayer === key));
          button.onclick = () => {
            this.colorLayer = key;
            this.render();
          };
          layers.append(button);
        }
        controls.append(layers);
      }
      controls.append(
        grid,
        el(
          "p",
          "clan-muted",
          {
            frames: `${kit.frames.length} форм щита`,
            colors: `${kit.colors.length} оттенка эмали. Второй цвет используется в рисунке поля.`,
            symbols: `${kit.symbols.length} золотых символов`,
            patterns: "Рисунок двухцветного поля",
            metals: "Металл рамки. Символ остаётся золотым.",
          }[tab],
        ),
      );
      if (tab === "patterns") {
        const presets = el("div", "clan-crest-presets");
        presets.setAttribute("aria-label", "Сочетания цветов");
        for (const preset of kit.presets) {
          const button = el("button", "clan-crest-preset");
          button.type = "button";
          button.title = preset.name;
          button.setAttribute("aria-label", preset.name);
          window.KillexControls.state(button, this.disabled);
          const a = kit.colors.find((x) => x.id === preset.color).hex;
          const b = kit.colors.find((x) => x.id === preset.secondary).hex;
          button.style.background = `linear-gradient(135deg,${a} 48%,${b} 52%)`;
          button.onclick = () => {
            this.value = {
              ...c,
              color: preset.color,
              secondary: preset.secondary,
              pattern: preset.pattern,
            };
            this.render();
            this.onChange(this.value);
          };
          presets.append(button);
        }
        controls.append(presets);
      }
      if (pageCount > 1) {
        const pages = el("nav", "clan-symbol-pages");
        pages.setAttribute("aria-label", "Страницы вариантов герба");
        for (const [step, label] of [
          [-1, "‹"],
          [1, "›"],
        ]) {
          const b = el("button", "sf-button", label);
          b.type = "button";
          b.setAttribute(
            "aria-label",
            step < 0 ? "Предыдущие варианты герба" : "Следующие варианты герба",
          );
          window.KillexControls.state(b, step < 0 ? page === 0 : page === pageCount - 1);
          b.onclick = () => {
            if (this.overview) this.pages[tab] = page + step;
            else this.page = page + step;
            this.render();
          };
          pages.append(b);
          if (step < 0) pages.append(el("span", "", `${page + 1} / ${pageCount}`));
        }
        controls.append(pages);
      }
      return controls;
    }
    render() {
      this.root.dataset.layout = this.overview ? "overview" : "tabs";
      const preview = el("div", "clan-crest-preview"),
        img = el("img");
      kit.paintImage(img, this.value, this.legacy);
      img.alt = "Предпросмотр герба";
      preview.append(img);
      const c = this.value || kit.DEFAULT;
      preview.append(
        el("strong", "", "Герб клана"),
        el(
          "small",
          "",
          this.value ? kit.frames.find((f) => f.id === c.frame).name : "Текущий герб",
        ),
      );
      const reset = el("button", "sf-button sf-tertiary", "Вернуть исходный");
      reset.type = "button";
      window.KillexControls.state(reset, this.disabled || kit.equal(this.value, this.initial));
      reset.onclick = () => {
        this.value = this.initial;
        this.render();
        this.onChange(this.value);
      };
      preview.append(reset);
      const controls = el("div", "clan-crest-controls"),
        tabs = el("nav", "clan-crest-tabs");
      for (const [id, label] of [
        ["frames", "Форма"],
        ["metals", "Рамка"],
        ["patterns", "Поле"],
        ["colors", "Цвета"],
        ["symbols", "Символ"],
      ]) {
        const b = el("button", "sf-tab", label);
        b.type = "button";
        b.setAttribute("aria-pressed", String(this.tab === id));
        b.onclick = () => {
          this.tab = id;
          this.page = 0;
          this.render();
        };
        tabs.append(b);
      }
      if (this.overview) {
        for (const group of [
          ["frames", "metals", "patterns"],
          ["colors", "symbols"],
        ]) {
          const column = el("div", "clan-crest-column");
          for (const tab of group) column.append(this.category(tab, c));
          controls.append(column);
        }
      } else controls.append(tabs, this.category(this.tab, c));
      this.root.replaceChildren(preview, controls);
      if (this.heading) this.root.prepend(el("h3", "clan-generator-title", this.heading));
      requestAnimationFrame(() => this.fitChoices());
    }
  }
  window.KillexCrestBuilder = CrestBuilder;
})();
