/* Seven fixed pedestals. Live portraits and lightweight, visibility-bound lighting. */
"use strict";
(() => {
  const el = (tag, cls = "", text) => {
    const n = document.createElement(tag);
    n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  };
  const button = (text, action, cls = "sf-button sf-tertiary") => {
    const n = el("button", cls, text);
    n.type = "button";
    n.onclick = action;
    return n;
  };
  const number = (n) => Number(n || 0).toLocaleString("ru-RU");
  const PLACES = [
    [50, 24, 12.3, 37.1, 16, 4.1, 50, 45.4, 18],
    [31.3, 38, 8.3, 48.4, 12.8, 3.4, 32.5, 54.2, 10.8],
    [68.8, 38, 8.3, 48.4, 12.8, 3.4, 67.5, 54.2, 10.8],
    [22.4, 49.9, 9, 60, 14.1, 4, 23.5, 66, 9.4],
    [77.7, 49.9, 9, 60, 14.1, 4, 76.3, 66, 9.4],
    [13.3, 65, 10.1, 75.7, 17, 4.9, 13.3, 85, 21],
    [86.2, 65, 10.1, 75.7, 17, 4.9, 86.2, 85, 21],
  ];
  // Painted inner rims, measured in the 1672 x 941 background coordinate system.
  // Portrait positions are independent of the platform geometry.
  const FLOORS = {
    heroic: [
      [836, 350, 112, 15],
      [524, 456, 94, 14],
      [1149, 456, 94, 14],
      [375, 566, 110, 20],
      [1297, 566, 110, 20],
      [226, 714, 128, 25],
      [1446, 714, 141, 27],
    ],
    default: [
      [836, 348, 112, 15],
      [524, 456, 94, 14],
      [1149, 456, 94, 14],
      [375, 564, 110, 20],
      [1297, 564, 110, 20],
      [226, 714, 128, 25],
      [1446, 714, 141, 27],
    ],
    visual: [
      [836, 349, 116, 15],
      [523, 456, 94, 14],
      [1149, 456, 94, 14],
      [374, 565, 112, 20],
      [1297, 565, 112, 20],
      [225, 716, 131, 27],
      [1447, 716, 141, 27],
    ],
    prism: [
      [836, 344, 110, 16],
      [523, 458, 91, 15],
      [1150, 458, 91, 15],
      [375, 565, 106, 20],
      [1297, 565, 106, 20],
      [225, 715, 126, 27],
      [1447, 715, 137, 28],
    ],
    glass: [
      [836, 344, 110, 15],
      [521, 457, 91, 14],
      [1151, 457, 91, 14],
      [375, 565, 105, 19],
      [1298, 565, 105, 19],
      [225, 714, 118, 25],
      [1447, 714, 119, 25],
    ],
  };
  class HallOfFame {
    constructor(owner) {
      this.owner = owner;
      this.page = 1;
      this.compactPage = 0;
      this.request = 0;
      this.modalObserver = new MutationObserver(() => this.syncMotion());
      this.reduced = matchMedia("(prefers-reduced-motion: reduce)");
      this.dialog = el("dialog", "hall-page");
      this.dialog.id = "hallOfFameDialog";
      this.dialog.dataset.layout = "fullscreen";
      this.dialog.dataset.animate = "false";
      this.dialog.setAttribute("aria-labelledby", "hallOfFameTitle");
      const header = el("header", "hall-heading");
      const title = el("h1", "", "Зал славы");
      title.id = "hallOfFameTitle";
      const caption = el("p", "", "Семь мест для великих героев");
      const heading = el("div", "hall-heading-copy");
      heading.append(title, caption);
      const actions = el("nav", "hall-actions");
      actions.setAttribute("aria-label", "Действия зала славы");
      actions.append(
        button("Все герои", () => this.openList()),
        button("Правила", () => this.openRules()),
        button("В лобби", () => this.dialog.close()),
      );
      header.append(heading, actions);
      this.viewport = el("div", "hall-stage-viewport");
      this.stage = el("section", "hall-stage");
      this.stage.setAttribute("aria-label", "Семь пьедесталов");
      this.background = el("img", "hall-background");
      this.background.alt = "";
      this.background.draggable = false;
      this.stage.append(this.background);
      this.slots = PLACES.map((place, i) => this.makePlace(place, i));
      this.viewport.append(this.stage);
      this.compact = el("section", "hall-compact");
      this.compact.setAttribute("aria-label", "Герои на пьедесталах");
      this.footer = el("footer", "hall-footer");
      this.status = el("p", "hall-status", "");
      this.status.setAttribute("role", "status");
      this.count = el("span", "hall-count");
      this.retry = button("Повторить", () => this.refresh());
      this.retry.hidden = true;
      this.footer.append(this.status, this.retry, this.count);
      this.dialog.append(header, this.viewport, this.compact, this.footer);
      document.body.append(this.dialog);
      this.trigger = document.getElementById("hallOfFameSection");
      this.trigger.setAttribute("aria-controls", this.dialog.id);
      this.trigger.onclick = () => this.open();
      this.dialog.addEventListener("close", () => {
        if (this.dialog.open) return;
        this.stop();
        this.modalObserver.disconnect();
        this.list?.close();
        this.rules?.close();
        this.syncMotion();
      });
      this.resize = new ResizeObserver(() => this.layout());
      this.resize.observe(this.viewport);
      document.addEventListener("killex:profile", (event) => {
        if (this.dialog.open) this.theme(event.detail);
      });
      document.addEventListener("visibilitychange", () => {
        this.syncMotion();
        if (document.hidden) this.stop();
        else if (this.dialog.open) this.refresh();
      });
      this.reduced.addEventListener("change", () => this.syncMotion());
    }
    makePlace(p, i) {
      const [x, y, size, floorY, glowWidth, glowHeight, plateX, plateY, plateWidth] = p;
      const light = el("div", "hall-light");
      light.dataset.rank = i + 1;
      light.setAttribute("aria-hidden", "true");
      Object.assign(light.style, { left: x + "%", top: floorY + "%", width: glowWidth + "%" });
      light.style.setProperty("--phase", -i * 0.79 + "s");
      // The floor is fixed at (160, 250); its ellipse matches the painted platform.
      // Gradients stay static. Only a few local layers change opacity/transform.
      const depth = ((glowHeight / glowWidth) * 941 * 160) / 1672;
      const id = "hall-light-" + i;
      light.innerHTML = `<svg class="hall-light-art" viewBox="0 0 320 280" aria-hidden="true" focusable="false">
        <defs>
          <linearGradient id="${id}-rise" x1="0" y1="1" x2="0" y2="0">
            <stop stop-color="currentColor" stop-opacity=".95"/>
            <stop offset=".18" stop-color="currentColor" stop-opacity=".82"/>
            <stop offset=".58" stop-color="currentColor" stop-opacity=".43"/>
            <stop offset="1" stop-color="currentColor" stop-opacity="0"/>
          </linearGradient>
          <linearGradient id="${id}-feather">
            <stop stop-color="white" stop-opacity="0"/><stop offset=".14" stop-color="white"/>
            <stop offset=".86" stop-color="white"/><stop offset="1" stop-color="white" stop-opacity="0"/>
          </linearGradient>
          <mask id="${id}-soft" maskUnits="userSpaceOnUse" x="-80" y="0" width="480" height="280">
            <rect x="-80" width="480" height="280" fill="url(#${id}-feather)"/>
          </mask>
          <radialGradient id="${id}-aura">
            <stop stop-color="currentColor" stop-opacity=".6"/>
            <stop offset=".52" stop-color="currentColor" stop-opacity=".24"/>
            <stop offset="1" stop-color="currentColor" stop-opacity="0"/>
          </radialGradient>
          <radialGradient id="${id}-floor">
            <stop stop-color="white" stop-opacity=".18"/>
            <stop offset=".65" stop-color="currentColor" stop-opacity=".22"/>
            <stop offset=".84" stop-color="currentColor" stop-opacity=".72"/>
            <stop offset=".91" stop-color="white" stop-opacity=".9"/>
            <stop offset="1" stop-color="currentColor" stop-opacity="0"/>
          </radialGradient>
        </defs>
        <g class="hall-volume" mask="url(#${id}-soft)">
          <ellipse cx="160" cy="180" rx="205" ry="120" fill="url(#${id}-aura)" opacity=".5"/>
          <path d="M-70 18H390L302 250A142 ${depth} 0 0 1 18 250Z" fill="url(#${id}-rise)"/>
          <g class="hall-shafts" fill="url(#${id}-rise)">
            <path d="M-35 18H30L112 248Q92 256 65 250Z" opacity=".66"/>
            <path d="M143 68H165L184 251Q160 260 142 250Z" opacity=".8"/>
            <path d="M282 18H354L257 249Q235 256 218 250Z" opacity=".62"/>
          </g>
        </g>
        <g class="hall-floor-light">
          <ellipse cx="160" cy="252" rx="159" ry="${depth * 1.75}" fill="url(#${id}-aura)"/>
          <ellipse cx="160" cy="250" rx="145" ry="${depth}" fill="url(#${id}-floor)"/>
          <ellipse cx="160" cy="250" rx="129" ry="${depth * 0.81}" fill="none" stroke="currentColor" stroke-width="1.2" opacity=".65"/>
          <path d="M18 250A142 ${depth} 0 0 0 302 250" fill="none" stroke="currentColor" stroke-width="1.5" opacity=".55"/>
          <path d="M18 250A142 ${depth} 0 0 0 302 250" transform="rotate(180 160 250)" fill="none" stroke="#fff8ed" stroke-width="1.6" opacity=".85"/>
        </g>
        ${[55, 87, 118, 160, 203, 234, 267]
          .map(
            (
              x,
              k,
            ) => `<g class="hall-mote" style="--mote-delay:${-i * 0.53 - k * 0.47}s;--mote-drift:${k % 2 ? 18 : -20}px">
          <circle cx="${x}" cy="${247 + (k % 2) * 3}" r="8" fill="url(#${id}-aura)"/>
          <circle cx="${x}" cy="${247 + (k % 2) * 3}" r="1.7" fill="#fff9e9"/>
        </g>`,
          )
          .join("")}
      </svg>`;
      const orb = button(
        "",
        () => {
          if (orb.hero) window.KillexPlayerProfile?.open(orb.hero.id);
        },
        "hall-orb",
      );
      Object.assign(orb.style, { left: x + "%", top: y + "%", width: size + "%" });
      const portrait = el("span", "hall-portrait");
      orb.append(portrait);
      const plate = el("div", "hall-plate");
      plate.dataset.rank = i + 1;
      Object.assign(plate.style, {
        left: plateX + "%",
        top: plateY + "%",
        width: plateWidth + "%",
      });
      this.stage.append(light, orb, plate);
      return { light, orb, portrait, plate };
    }
    skin(hero, cls = "") {
      const disc = el("span", "hall-avatar " + cls);
      const img = el("img");
      const identity = window.KillexIdentity;
      const skin = identity.allSkins.find((s) => s.id === hero.skinId) || identity.skins[0];
      if (skin.variants) identity.setSkinImage(img, skin, 512);
      else img.src = skin.arena;
      img.alt = "";
      img.draggable = false;
      disc.append(img);
      return disc;
    }
    theme(profile = this.owner.getProfile()) {
      const id = profile?.appearance?.uiTheme;
      const theme = ["visual", "prism", "glass", "heroic"].includes(id) ? id : "default";
      if (this.dialog.dataset.hallTheme === theme) return;
      this.dialog.dataset.hallTheme = theme;
      this.slots.forEach(({ light }, i) => {
        const [x, y, rx, ry] = FLOORS[theme][i];
        const depth = (ry * 142) / rx;
        Object.assign(light.style, {
          left: (x / 1672) * 100 + "%",
          top: (y / 941) * 100 + "%",
          width: ((rx * 320) / 142 / 1672) * 100 + "%",
        });
        const ellipses = light.querySelectorAll(".hall-floor-light ellipse");
        [1.75, 1, 0.81].forEach((scale, k) => ellipses[k].setAttribute("ry", depth * scale));
        for (const arc of light.querySelectorAll(".hall-floor-light path"))
          arc.setAttribute("d", `M18 250A142 ${depth} 0 0 0 302 250`);
        light
          .querySelector(".hall-volume > path")
          .setAttribute("d", `M-70 18H390L302 250A142 ${depth} 0 0 1 18 250Z`);
      });
      this.background.src = "assets/hall-of-fame/v1/" + theme + "-1672.webp?art=20261123-interface-art";
      this.background.srcset =
        "assets/hall-of-fame/v1/" +
        theme +
        "-960.webp?art=20261123-interface-art 960w, assets/hall-of-fame/v1/" +
        theme +
        "-1672.webp?art=20261123-interface-art 1672w";
      this.background.sizes = "100vw";
    }
    open() {
      if (!this.owner.isLobby()) return;
      this.page = 1; this.compactPage = 0;
      this.theme();
      window.KillexWindows.open(this.dialog);
      this.modalObserver.observe(document.body, {
        subtree: true,
        attributes: true,
        attributeFilter: ["open", "data-screen"],
      });
      this.layout();
      this.syncMotion();
      this.refresh();
    }
    stop() {
      clearTimeout(this.timer);
      this.abort?.abort();
      this.request++;
    }
    async refresh() {
      if (!this.dialog.open || document.hidden || !this.owner.isLobby()) return;
      this.stop();
      const request = this.request;
      this.abort = new AbortController();
      this.retry.hidden = true;
      try {
        const response = await fetch("/api/hall-of-fame?page=" + this.page, {
          signal: this.abort.signal,
          cache: "no-store",
        });
        const data = await response.json();
        if (!response.ok) throw Error(data.error || "Не удалось загрузить Зал славы.");
        if (request !== this.request || !this.dialog.open) return;
        this.data = data;
        this.page = data.page;
        this.render();
      } catch (error) {
        if (request !== this.request || error.name === "AbortError") return;
        this.status.textContent = this.data
          ? "Связь потеряна. Показаны последние полученные данные."
          : "Не удалось загрузить героев. Проверь соединение.";
        this.retry.hidden = false;
      } finally {
        if (request === this.request && this.dialog.open && !document.hidden)
          this.timer = setTimeout(() => this.refresh(), 20000);
      }
    }
    render() {
      const data = this.data;
      this.slots.forEach((slot, i) => {
        const hero = data.top[i];
        const signature = JSON.stringify(hero || null);
        if (slot.signature === signature) return;
        const previous = slot.orb.hero?.id;
        slot.signature = signature;
        slot.orb.hero = hero;
        window.KillexControls.state(slot.orb, !hero);
        slot.light.dataset.occupied = String(!!hero);
        slot.orb.dataset.empty = String(!hero);
        slot.orb.setAttribute(
          "aria-label",
          hero
            ? "Место " +
                hero.rank +
                ": " +
                hero.name +
                ", величие " +
                number(hero.greatness) +
                ". Открыть профиль"
            : "Место " + (i + 1) + " ждёт Героя",
        );
        const portraitKey = hero ? hero.skinId : "empty";
        if (slot.portraitKey !== portraitKey) {
          slot.portraitKey = portraitKey;
          slot.portrait.replaceChildren(...(hero ? [this.skin(hero)] : [el("span", "hall-empty-mark", "✧")]));
        }
        slot.plate.replaceChildren();
        slot.plate.title = hero
          ? hero.name + ": " + number(hero.greatness) + " величия"
          : "Место ждёт Героя";
        if (!i && hero) slot.plate.append(el("span", "hall-leader-label", "Лидер по величию"));
        slot.plate.append(
          el("strong", "hall-name", hero ? i + 1 + ". " + hero.name : "Место ждёт Героя"),
        );
        const score = el("span", "hall-score", hero ? number(hero.greatness) : "№ " + (i + 1));
        if (hero) score.append(window.KillexGreatnessUI.icon(14, "величия"));
        slot.plate.append(score);
        if (previous && previous !== hero?.id && this.dialog.dataset.animate === "true") {
          slot.orb.getAnimations().forEach((a) => a.cancel());
          slot.orb.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 550, easing: "ease-out" });
        }
      });
      this.status.textContent = data.total
        ? "Центр занимает герой с наибольшим величием."
        : "Первый Герой займёт центральное место.";
      this.count.textContent = "Героев: " + number(data.total);
      this.renderCompact();
      if (this.list?.open) this.renderList();
    }
    heroRow(hero) {
      const row = button("", () => window.KillexPlayerProfile?.open(hero.id), "hall-hero-row");
      row.append(
        el("span", "hall-row-rank", String(hero.rank)),
        this.skin(hero, "hall-row-avatar"),
      );
      const copy = el("span", "hall-row-copy");
      copy.append(
        el("strong", "", (hero.clanPrefix ? "[" + hero.clanPrefix + "] " : "") + hero.name),
      );
      copy.append(
        el(
          "small",
          "",
          hero.awardedAt == null
            ? "Титул «Герой»"
            : "Герой с " + new Date(hero.awardedAt).toLocaleDateString("ru-RU"),
        ),
      );
      const score = el("span", "hall-row-value", number(hero.greatness));
      score.setAttribute("aria-label", "Величие: " + number(hero.greatness));
      row.append(copy, score);
      return row;
    }
    renderCompact() {
      if (!this.data) return;
      const compactKey = JSON.stringify([this.data.top, this.compactPage, innerHeight < 700]);
      if (compactKey === this.compactKey) return;
      this.compactKey = compactKey;
      this.compact.replaceChildren();
      const size = innerHeight < 700 ? 2 : 4;
      const pages = Math.ceil(this.data.top.length / size);
      this.compactPage = Math.max(0, Math.min(this.compactPage, pages - 1));
      const rows = this.data.top.slice(this.compactPage * size, (this.compactPage + 1) * size);
      if (!rows.length)
        this.compact.append(
          el("p", "hall-empty-note", "Достигни титула «Герой», чтобы войти в Зал славы."),
        );
      rows.forEach((hero) => this.compact.append(this.heroRow(hero)));
      if (pages > 1)
        this.compact.append(
          this.pager(this.compactPage + 1, pages, (page) => {
            this.compactPage = page - 1;
            this.renderCompact();
          }),
        );
    }
    pager(page, pages, change) {
      const nav = el("nav", "hall-pager");
      const prev = button("‹", () => change(page - 1));
      const next = button("›", () => change(page + 1));
      prev.setAttribute("aria-label", "Предыдущая страница");
      next.setAttribute("aria-label", "Следующая страница");
      window.KillexControls.state(prev, page <= 1);
      window.KillexControls.state(next, page >= pages);
      nav.append(prev, el("span", "", page + " / " + pages), next);
      return nav;
    }
    makeDialog(id, name) {
      const dialog = el("dialog", "hall-detail-dialog");
      dialog.id = id;
      dialog.setAttribute("aria-labelledby", id + "Title");
      const header = el("header", "clan-heading");
      const title = el("h2", "", name);
      title.id = id + "Title";
      const close = button("×", () => dialog.close(), "booster-close");
      close.setAttribute("aria-label", "Закрыть " + name.toLowerCase());
      header.append(title, close);
      dialog.append(header);
      document.body.append(dialog);
      dialog.addEventListener("close", () => {
        if (!dialog.open) this.syncMotion();
      });
      return dialog;
    }
    openList() {
      if (!this.list?.open) this.page = 1;
      if (!this.list) {
        this.list = this.makeDialog("hallHeroesDialog", "Все герои");
        this.listBody = el("div", "hall-list-body");
        this.list.append(this.listBody);
      }
      window.KillexWindows.open(this.list);
      this.syncMotion();
      this.renderList();
      this.refresh();
    }
    renderList() {
      const listKey = JSON.stringify([this.data?.heroes, this.data?.page, this.data?.pages, this.data?.total]);
      if (listKey === this.listKey) return;
      this.listKey = listKey;
      this.listBody.replaceChildren();
      if (!this.data) {
        this.listBody.append(el("p", "", ""));
        return;
      }
      if (!this.data.total) {
        this.listBody.append(el("p", "hall-empty-note", "В зале пока нет героев."));
        return;
      }
      const rows = el("div", "hall-hero-rows");
      this.data.heroes.forEach((hero) => rows.append(this.heroRow(hero)));
      this.listBody.append(
        rows,
        this.pager(this.data.page, this.data.pages, (page) => {
          this.page = page;
          this.refresh();
        }),
      );
    }
    openRules() {
      if (!this.rules) {
        this.rules = this.makeDialog("hallRulesDialog", "Правила Зала славы");
        const body = el("div", "hall-rules-body");
        [
          "В зал входят игроки, получившие титул «Герой». Для этого нужно набрать " +
            number(this.data?.threshold || 2000000) +
            " величия.",
          "Семь героев с наибольшим текущим величием занимают пьедесталы. Лидер стоит в центре, следующие места - попарно слева и справа.",
          "При равном величии выше тот, кто раньше получил титул.",
          "Полный список доступен по кнопке «Все герои». Нажми на портрет, чтобы открыть профиль.",
        ].forEach((text) => body.append(el("p", "", text)));
        this.rules.append(body);
      }
      window.KillexWindows.open(this.rules);
      this.syncMotion();
    }
    layout() {
      if (!this.dialog.open) return;
      const w = this.viewport.clientWidth,
        h = this.viewport.clientHeight;
      const width = Math.min(w, (h * 1672) / 941);
      this.stage.style.width = width + "px";
      this.stage.style.height = (width * 941) / 1672 + "px";
      this.stage.style.setProperty("--stage-height", (width * 941) / 1672 + "px");
      this.renderCompact();
    }
    syncMotion() {
      const enabled =
        this.dialog.open &&
        document.body.dataset.screen === "lobby" &&
        this.owner.isLobby() &&
        !document.hidden &&
        !this.reduced.matches &&
        window.KillexWindows.top() === this.dialog;
      this.dialog.dataset.animate = String(enabled);
    }
  }
  window.KillexHallOfFame = HallOfFame;
})();
