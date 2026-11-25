/* Редактор герба: выбор формы, цвета и символа. */
"use strict";
(() => {
  const kit = window.KillexClanCrests;
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
      this.colorLayer = "color";
      this.root = el("section", "clan-crest-builder");
      this.root.crestBuilder = this;
      this.root.setAttribute("aria-label", "Конструктор герба");
      this.render();
    }
    selectTab(tab) {
      this.tab = tab;
      for (const panel of this.root.querySelectorAll(".clan-crest-category")) {
        const active = panel.dataset.category === tab;
        panel.classList.toggle("is-active", active);
        panel.setAttribute("aria-hidden", String(!active));
      }
      for (const button of this.root.querySelectorAll(".clan-crest-tabs button"))
        button.setAttribute("aria-pressed", String(button.dataset.category === tab));
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
      const grid = el("div", "clan-crest-choices");
      grid.dataset.category = tab;
      const values = kit.choicesForLevel(tab, this.clanLevel);
      for (const item of values) {
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
      return controls;
    }
    render() {
      this.root.dataset.layout = "tabs";
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
        b.dataset.category = id;
        b.onclick = () => this.selectTab(id);
        tabs.append(b);
      }
      const panels = el("div", "clan-crest-panels");
      for (const tab of ["frames", "metals", "patterns", "colors", "symbols"])
        panels.append(this.category(tab, c));
      controls.append(tabs, panels);
      this.root.replaceChildren(preview, controls);
      if (this.heading) this.root.prepend(el("h3", "clan-generator-title", this.heading));
      this.selectTab(this.tab);
    }
  }
  window.KillexCrestBuilder = CrestBuilder;
})();
