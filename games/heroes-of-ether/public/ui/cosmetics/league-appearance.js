/* Независимый выбор фона лобби, рамки и мини-фона с серверным сохранением. */
"use strict";
(() => {
  const catalog = window.KillexLeagueAppearance;
  // Temporary lobby decoration only. Saved appearance and theme previews stay unchanged.
  // Future event packs can opt in here with a matching event-lobby.css background.
  const eventLobbyBackgrounds = new Map([
    ["easter-hunt-v1", "easter"],
    ["black-friday-v1", "black-friday"],
  ]);
  const currencyNames = { coins: "монет", crystals: "кристаллов", bucks: "эфира" };
  const priceText = (pack) =>
    `${pack.price.toLocaleString("ru-RU")} ${currencyNames[pack.currency]}`;
  const sceneImages = new Map();
  let sceneFrame;
  function scheduleSceneAlignment() {
    cancelAnimationFrame(sceneFrame);
    sceneFrame = requestAnimationFrame(() => {
      const lobby = document.getElementById("lobby"),
        avatar = document.getElementById("skinPreview");
      const theme = lobby?.dataset.leagueBackground;
      if (!lobby || !avatar) return;
      if (!["visual", "prism", "heroic"].includes(theme)) {
        lobby.style.removeProperty("--pack-scene-size");
        lobby.style.removeProperty("--pack-scene-position");
        lobby.dispatchEvent(new Event("lobby:scene-aligned"));
        return;
      }
      let scene = sceneImages.get(theme);
      if (!scene) {
        scene = new Image();
        sceneImages.set(theme, scene);
        scene.onload = scheduleSceneAlignment;
        scene.src = catalog.source(theme, "lobby");
      }
      if (!scene.naturalWidth) {
        return;
      }
      const bounds = lobby.getBoundingClientRect(),
        orb = avatar.getBoundingClientRect();
      if (!bounds.width || !bounds.height || !orb.width) return;
      const center = orb.left + orb.width / 2 - bounds.left;
      // Cover both edges even when the two side columns have different widths.
      const scale = Math.max(
        (2 * Math.max(center, bounds.width - center)) / scene.naturalWidth,
        bounds.height / scene.naturalHeight,
      );
      const width = scene.naturalWidth * scale,
        height = scene.naturalHeight * scale;
      lobby.style.setProperty("--pack-scene-size", `${width}px ${height}px`);
      lobby.style.setProperty(
        "--pack-scene-position",
        `${center - width / 2}px ${(bounds.height - height) / 2}px`,
      );
      const effect = lobby.querySelector(".heroic-scene");
      if (effect)
        Object.assign(effect.style, {
          width: width + "px",
          height: height + "px",
          left: center - width / 2 + "px",
          top: (bounds.height - height) / 2 + "px",
        });
      lobby.dispatchEvent(new Event("lobby:scene-aligned"));
    });
  }
  // A handful of composited particles, paused while hidden or on the arena.
  const magic = document.createElement("div");
  magic.className = "heroic-magic";
  magic.setAttribute("aria-hidden", "true");
  for (let i = 0; i < 12; i++) {
    const mote = document.createElement("i");
    mote.style.cssText =
      "--x:" +
      (7 + ((i * 19) % 89)) +
      "%;--delay:" +
      -i * 1.9 +
      "s;--duration:" +
      (9 + (i % 5)) +
      "s";
    magic.append(mote);
  }
  document.getElementById("lobby")?.prepend(magic);
  const visibility = () =>
    (document.documentElement.dataset.pageVisible = String(!document.hidden));
  visibility();
  document.addEventListener("visibilitychange", visibility);
  const menuArtwork = new WeakMap();
  function paintMenu(id) {
    const pack = catalog.interfaceTheme(id);
    for (const [buttonId, icon] of Object.entries(window.KillexLobbyMenuArt.buttons)) {
      const control = document.getElementById(buttonId);
      if (!control) continue;
      let image = control.querySelector("img.menu-icon");
      if (!image && pack) {
        image = document.createElement("img");
        image.className = "menu-icon";
        image.width = image.height = 36;
        image.alt = "";
        control.prepend(image);
      }
      if (!image) continue;
      if (!menuArtwork.has(image))
        menuArtwork.set(image, {
          src: image.getAttribute("src"),
          srcset: image.getAttribute("srcset"),
        });
      const original = menuArtwork.get(image);
      const themed = window.KillexLobbyMenuArt.source(pack?.id || "default", icon);
      const src = themed || original.src;
      const srcset = themed ? null : original.srcset;
      image.hidden = !src;
      for (const [attribute, value] of Object.entries({ src, srcset })) {
        if (value === null) image.removeAttribute(attribute);
        else if (image.getAttribute(attribute) !== value) image.setAttribute(attribute, value);
      }
    }
  }
  const el = (tag, cls, text) => {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined) node.textContent = text;
    return node;
  };
  const labels = {
    theme: "Тема интерфейса",
    frames: "Рамки профиля",
    lobbyBackground: "Фон лобби",
    avatarFrame: "Рамки",
    profileBackground: "Фон мини-профиля",
    arenaFrame: "Рамки арены",
    set: "Тема оформления",
  };
  let badgeClock = Date.now(),
    badgeReceivedAt = performance.now();
  document.addEventListener("killex:server-time", (event) => {
    if (Number.isFinite(event.detail)) {
      badgeClock = event.detail;
      badgeReceivedAt = performance.now();
    }
  });
  const badgeNow = () => badgeClock + performance.now() - badgeReceivedAt;
  function tickAccessBadge(badge) {
    const until = Number(badge.dataset.expires),
      remaining = Math.max(0, Math.ceil((until - badgeNow()) / 1000));
    let text;
    if (badge.dataset.permanent === "true") text = "Бессрочно";
    else if (remaining > 0 && until > 0) {
      const days = Math.floor(remaining / 86400),
        clock = [Math.floor(remaining / 3600) % 24, Math.floor(remaining / 60) % 60, remaining % 60]
          .map((n) => String(n).padStart(2, "0"))
          .join(":");
      text = (days ? days + " д " : "") + clock;
    } else text = badge.dataset.testing === "true" ? "Тестовый доступ" : "Срок истёк";
    if (badge.textContent !== text) badge.textContent = text;
  }
  function accessBadge(card, { available, until, testing = false }) {
    let badge = card.querySelector(":scope > .appearance-access-time");
    if (!badge) {
      badge = el("span", "appearance-access-time");
      card.append(badge);
    }
    badge.hidden = !available;
    badge.dataset.expires = Number.isFinite(until) ? String(until) : "0";
    badge.dataset.permanent = String(until === null);
    badge.dataset.testing = String(testing);
    badge.title =
      until === null
        ? "Доступно бессрочно"
        : Number.isFinite(until)
          ? "Доступно до " +
            new Date(until).toLocaleString("ru-RU")
          : "Временный тестовый доступ - срок пока не назначен";
    tickAccessBadge(badge);
    return badge;
  }
  window.KillexActivity.every(() => {
    if (document.hidden) return;
    for (const badge of document.querySelectorAll(".appearance-access-time:not([hidden])"))
      if (badge.getClientRects().length) tickAccessBadge(badge);
  }, 1000, () => [...document.querySelectorAll(".appearance-access-time:not([hidden])")].some(window.KillexActivity.visible));
  // Один цикл для видимых ободков интерфейса; рисунок совпадает с ареной.
  const rims = new Map(),
    reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
  let rimAnimation;
  const requestRims = () => {
    if (!rimAnimation && !document.hidden) rimAnimation = requestAnimationFrame(drawRims);
  };
  const rimVisibility = new IntersectionObserver((entries) => {
    for (const entry of entries)
      if (rims.has(entry.target)) rims.get(entry.target).visible = entry.isIntersecting;
    requestRims();
  });
  const rimSize = new ResizeObserver((entries) => {
    for (const { target } of entries) {
      const rim = rims.get(target);
      if (!rim) continue;
      rim.width = target.clientWidth + 16;
      rim.height = target.clientHeight + 16;
      const dpr = Math.min(devicePixelRatio || 1, 2);
      if (rim.canvas.width === Math.round(rim.width * dpr) &&
          rim.canvas.height === Math.round(rim.height * dpr)) continue;
      rim.canvas.width = Math.round(rim.width * dpr);
      rim.canvas.height = Math.round(rim.height * dpr);
      rim.canvas.getContext("2d").setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    requestRims();
  });
  function removeRim(host) {
    rims.get(host)?.canvas.remove();
    rims.delete(host);
    rimVisibility.unobserve(host);
    rimSize.unobserve(host);
  }
  function drawRims(time) {
    rimAnimation = null;
    let visible = false;
    for (const [host, rim] of rims) {
      if (!host.isConnected) {
        removeRim(host);
        continue;
      }
      if (!rim.visible || !rim.width || document.hidden) continue;
      visible ||= !!catalog.interfaceTheme(rim.id);
      const ctx = rim.canvas.getContext("2d");
      ctx.clearRect(0, 0, rim.width, rim.height);
      window.KillexArenaArt.selectedFrame(
        ctx,
        rim.id,
        null,
        rim.width / 2,
        rim.height / 2,
        (Math.min(rim.width, rim.height) - 16) / 2,
        1,
        time,
      );
    }
    if (visible && !reducedMotion.matches) requestRims();
  }
  function setRim(host, id) {
    if (id === "default") {
      removeRim(host);
      return;
    }
    if (rims.has(host)) {
      if (rims.get(host).id === id) return;
      rims.get(host).id = id;
      requestRims();
      return;
    }
    const canvas = el("canvas", "appearance-rim-canvas");
    canvas.setAttribute("aria-hidden", "true");
    host.append(canvas);
    rims.set(host, { canvas, id, visible: false });
    rimVisibility.observe(host);
    rimSize.observe(host);
  }
  document.addEventListener("killex:frame-loaded", requestRims);
  reducedMotion.addEventListener("change", requestRims);
  document.addEventListener("visibilitychange", requestRims);
  function paintArenaFrame(host, id, account) {
    if (!host) return;
    const resolved = catalog.resolveFrame(id, account);
    host.dataset.arenaFrame = resolved;

    host.querySelector(":scope > .league-avatar-frame")?.remove();
    setRim(host, resolved);
  }
  function paintFrame(host, id, account) {
    if (!host) return;
    let image = host.querySelector(":scope > .league-avatar-frame");
    const titleFrame = catalog.titleProfileFrame(id);
    const source = titleFrame?.source || (catalog.interfaceTheme(id) ? catalog.source(id, "frame") : null);
    if (!source) {
      image?.remove();
      const resolved = catalog.resolveFrame(id, account);
      host.dataset.avatarFrame = resolved;
      setRim(host, resolved);
      return;
    }
    removeRim(host);
    host.dataset.avatarFrame = id;
    if (!image) {
      image = el("img", "league-avatar-frame");
      image.alt = "";
      host.append(image);
    }
    const fit = titleFrame?.fit || catalog.frameTheme(id)?.fit;
    for (const property of ["top", "left", "right", "bottom", "width", "height"])
      image.style.removeProperty(property);
    if (fit) {
      const size = 100 / (2 * fit[2] * 0.98);
      for (const [key, value] of Object.entries({
        left: 50 - fit[0] * size + "%",
        top: 50 - fit[1] * size + "%",
        right: "auto",
        bottom: "auto",
        width: size + "%",
        height: size + "%",
      }))
        image.style.setProperty(key, value, "important");
    }
    if (image.getAttribute("src") !== source) image.src = source;
  }
  function paintBackground(host, id, kind) {
    if (kind === "clan" && host.id === "clanDialog")
      host.dataset.uiTheme = catalog.theme(id) ? id : "default";
    const source = catalog.source(id, kind);
    host.classList.toggle("has-league-background", !!source);
    host.classList.toggle("has-scene-background", !!source && !!catalog.interfaceTheme(id));
    if (source) {
      host.style.setProperty(
        "--league-background",
        `url("${new URL(source, document.baseURI).href}")`,
      );
      host.style.setProperty(
        "--league-background-still",
        `url("${new URL(source, document.baseURI).href}#still")`,
      );
      host.dataset.leagueBackground = id;
      host.dataset.leagueBackgroundKind = kind;
    } else {
      host.style.removeProperty("--league-background");
      host.style.removeProperty("--league-background-still");
      delete host.dataset.leagueBackground;
      delete host.dataset.leagueBackgroundKind;
    }
  }
  let instance;
  class AppearanceUI {
    constructor(owner) {
      instance = this;
      this.owner = owner;
      this.sceneObserver = new ResizeObserver(scheduleSceneAlignment);
      for (const selector of ["#lobby", "#skinPreview", "#lobby .skin-stage"])
        this.sceneObserver.observe(document.querySelector(selector));
      window.addEventListener("resize", scheduleSceneAlignment);
      this.profile = owner.getProfile();
      this.receivedAt = performance.now();
      this.clock = Date.now();
      document.addEventListener("killex:server-time", (event) => {
        if (!Number.isFinite(event.detail)) return;
        this.clock = event.detail;
        this.receivedAt = performance.now();
        this.refresh();
        this.scheduleExpiry();
      });
      this.galleries = new Map();
      this.dialog = el("dialog", "clan-dialog appearance-dialog");
      this.dialog.id = "appearanceDialog";
      const heading = el("header", "clan-heading");
      this.title = el("h2", "", "Оформление");
      this.title.id = "appearanceTitle";
      this.dialog.setAttribute("aria-labelledby", this.title.id);
      const close = el("button", "booster-close", "×");
      close.type = "button";
      close.autofocus = true;
      close.setAttribute("aria-label", "Закрыть выбор оформления");
      close.onclick = () => this.dialog.close();
      heading.append(this.title, close);
      this.content = el("div", "appearance-picker-content");
      this.status = el("p", "wardrobe-status appearance-status");
      this.status.setAttribute("role", "status");
      this.dialog.append(heading, this.content, this.status);
      document.body.append(this.dialog);
      const control = el("button", "sf-button sf-tertiary", "Тема интерфейса");
      control.id = "lobbyAppearanceButton";
      control.type = "button";
      control.setAttribute("aria-haspopup", "dialog");
      control.onclick = () => {
        document.getElementById("closeSettings").click();
        this.open("theme");
      };
      const settingsRow = el("div", "setting-row settings-appearance-row");
      settingsRow.append(control);
      document.querySelector("#settingsMenu .settings-feedback-row, #settingsMenu .future-chat").before(settingsRow);
      document.getElementById("openSelfProfile").onclick = () => {
        if (this.owner.isLobby() && this.profile?.id)
          window.KillexPlayerProfile.open(this.profile.id);
      };
      document.addEventListener("killex:profile", (event) => {
        this.profile = event.detail;
        this.refresh();
        this.scheduleExpiry();
      });
      this.dialog.addEventListener("close", () => {
        if (this.returnFocus?.isConnected) this.returnFocus.focus({ preventScroll: true });
        else
          document
            .querySelector("#playerProfileDialog[open] .public-background-edit")
            ?.focus({ preventScroll: true });
      });
      this.refresh();
    }
    gallery(slot) {
      if (this.galleries.has(slot)) return this.galleries.get(slot).root;
      const root = el("section", "appearance-collection");
      root.dataset.appearanceSlot = slot;
      root.setAttribute("aria-label", labels[slot]);
      root.append(
        el(
          "p",
          "appearance-intro",
          "Купленная тема открывает весь комплект навсегда. Оформление лиг выдаётся за медали на 30 дней, Чемпионское доступно навсегда.",
        ),
      );
      if (slot === "set") {
        const contents = el(
          "p",
          "appearance-set-contents",
          "В наборе: оформление всего интерфейса, фон лобби, мини-фон, рамка профиля и рамка арены. Фоны и рамки можно менять отдельно. Окно клана использует оформление главы.",
        );
        root.append(contents);
      }
      if (slot === "frames")
        root.append(
          el(
            "p",
            "appearance-set-contents",
            "Один выбор меняет рамку профиля и мини-профиля, а на арене - ободок того же качества.",
          ),
        );
      const grid = el("div", "appearance-grid"),
        cards = [];
      const choices = [
        { id: "default", name: "По умолчанию", title: "Классическое оформление" },
        ...catalog.interfaceThemes,
        ...(catalog.frameSlot(slot) || slot === "frames"
          ? [...catalog.accountFrames, ...catalog.rankFrames]
          : []),
        ...catalog.themes,
      ];
      for (const original of choices) {
        const id = catalog.frameForSlot(original.id, slot);
        const theme = { ...original, id, title: slot === "arenaFrame" ? "Ободок шара" : slot === "avatarFrame" ? "Рамка профиля" : original.title };
        const card = el("article", "appearance-card");
        card.dataset.themeId = theme.id;
        const preview = el("div", "appearance-preview");
        if (slot === "set") {
          preview.classList.add("appearance-set-preview");
          paintBackground(preview, theme.id, "lobby");
          const mini = el("span", "appearance-set-mini"),
            avatar = el("span", "appearance-avatar"),
            image = el("img", "appearance-skin"),
            arena = el("span", "appearance-set-arena"),
            arenaImage = el("img", "appearance-skin");
          paintBackground(mini, theme.id, "profile");
          for (const img of [image, arenaImage]) {
            img.alt = "";
            window.KillexIdentity.setSkinImage(img, this.owner.getSkin(), 128);
          }
          avatar.append(image);
          paintFrame(avatar, theme.id);
          mini.append(avatar);
          arena.append(arenaImage);
          paintArenaFrame(arena, theme.id);
          preview.append(mini, arena);
        } else if (slot === "arenaFrame") {
          const canvas = el("canvas", "appearance-arena-canvas"),
            skin = el("img", "appearance-arena-skin");
          canvas.width = canvas.height = 160;
          canvas.setAttribute("aria-label", `Рамка арены: ${theme.name}`);
          skin.hidden = true;
          skin.alt = "";
          window.KillexIdentity.setSkinImage(skin, this.owner.getSkin(), 128);
          preview.append(canvas, skin);
        } else if (slot === "avatarFrame" || slot === "frames") {
          const avatar = el("span", "appearance-avatar"),
            image = el("img", "appearance-skin");
          image.alt = "";
          window.KillexIdentity.setSkinImage(image, this.owner.getSkin(), 128);
          avatar.append(image);
          paintFrame(avatar, theme.id);
          preview.append(avatar);
        } else {
          paintBackground(
            preview,
            theme.id,
            ["lobbyBackground", "theme"].includes(slot) ? "lobby" : "profile",
          );
          if (slot === "profileBackground") {
            const image = el("img", "appearance-mini-avatar");
            image.alt = "";
            window.KillexIdentity.setSkinImage(image, this.owner.getSkin(), 128);
            const disc = el("span", "appearance-mini-disc");
            disc.append(image);
            preview.append(disc);
          }
        }
        const name = el("strong", "", theme.name),
          subtitle = el("small", "", theme.title);
        const availability = el("small", "appearance-availability");
        const action = el("button", "sf-button sf-tertiary", "Выбрать");
        action.type = "button";
        action.setAttribute("aria-label", `${labels[slot]}: ${theme.name}`);
        action.onclick = () =>
          this.save(
            slot,
            theme.id,
            theme.price && card.dataset.locked === "true" ? "buy" : undefined,
          );
        card.append(preview, name, subtitle, availability, action);
        grid.append(card);
        cards.push({ card, action, availability, id: theme.id });
      }
      root.append(grid);
      this.galleries.set(slot, { root, cards });
      this.refresh();
      return root;
    }
    refresh() {
      // Arena identities come from authoritative snapshots. Do not rebuild
      // closed cosmetic galleries on every progress or booster receipt.
      if (!this.owner.isLobby()) return;
      const profile = this.profile,
        appearance = profile?.appearance,
        now = this.serverNow(),
        testing = (slot) =>
          (slot === "set" && appearance?.testBackgrounds && appearance?.testFrames) ||
          (appearance?.testBackgrounds &&
            ["lobbyBackground", "profileBackground", "uiTheme", "theme"].includes(slot)) ||
          (appearance?.testFrames && ["avatarFrame", "arenaFrame", "frames"].includes(slot)),
        unlocked = (id, slot) =>
          (!catalog.interfaceTheme(id) &&
            !catalog.accountFrame(id) &&
            !catalog.rankFrame(id) &&
            testing(slot)) ||
          id === "default" ||
          (appearance?.unlocked?.includes(id) &&
            (appearance.availableUntil[id] === null || appearance.availableUntil[id] > now)),
        activePart = (slot) =>
          unlocked(appearance?.[slot], slot) && appearance?.[slot] ? appearance[slot] : "default",
        active = (slot) =>
          slot === "set"
            ? catalog.slots.every((part) => activePart(part) === activePart(catalog.slots[0]))
              ? activePart(catalog.slots[0])
              : "custom"
            : slot === "theme"
              ? activePart("uiTheme")
              : slot === "frames"
                ? activePart("avatarFrame") === activePart("arenaFrame")
                  ? activePart("avatarFrame")
                  : "custom"
                : activePart(slot);
      window.KillexControls.state(document.getElementById("openSelfProfile"), !profile);
      window.KillexUITheme.apply(active("uiTheme"));
      paintMenu(active("uiTheme"));
      window.KillexControls.state(document.getElementById("lobbyAppearanceButton"), !profile);
      const lobby = document.getElementById("lobby"),
        lobbyBackground = active("lobbyBackground"),
        event = profile?.event,
        eventBackground =
          lobbyBackground === "default" && event?.startsAt <= now && now < event.endsAt
            ? eventLobbyBackgrounds.get(event.contentPack)
            : null;
      paintBackground(lobby, lobbyBackground, "lobby");
      if (eventBackground) lobby.dataset.eventBackground = eventBackground;
      else delete lobby.dataset.eventBackground;
      scheduleSceneAlignment();
      paintFrame(
        document.getElementById("openSelfProfile"),
        active("avatarFrame"),
        profile?.account,
      );
      paintArenaFrame(
        document.getElementById("skinPreview"),
        active("arenaFrame"),
        profile?.account,
      );
      for (const [slot, { cards }] of this.galleries)
        for (const { card, action, availability, id } of cards) {
          const allowed = unlocked(id, slot),
            selected = active(slot) === id,
            until = appearance?.availableUntil?.[id],
            pack = catalog.interfaceTheme(id),
            purchasing = !!pack?.price && !allowed && ["theme", "set"].includes(slot),
            affordable = !purchasing || (profile?.wallet?.[pack.currency] || 0) >= pack.price;
          const testAccess =
            appearance?.testAll === true ||
            (!catalog.accountFrame(id) && !catalog.rankFrame(id) && !!testing(slot));
          accessBadge(card, { available: allowed, until, testing: testAccess });
          card.dataset.locked = String(!allowed);
          card.dataset.selected = String(selected);
          const badgeSlot =
            slot === "frames" ? "avatarFrame" : ["theme", "set"].includes(slot) ? "uiTheme" : slot;
          card.dataset.newItem = String(
            id !== "default" &&
              allowed &&
              !testAccess &&
              !profile?.wardrobe?.seen?.includes(badgeSlot + ":" + id),
          );
          window.KillexControls.state(
            action,
            !!this.pending ||
              !profile ||
              (!allowed && !purchasing) ||
              !affordable ||
              selected ||
              this.owner.isProfileOnArena(),
            !profile ||
              (!allowed && !purchasing) ||
              !affordable ||
              selected ||
              this.owner.isProfileOnArena(),
          );
          action.textContent = selected
            ? slot === "set"
              ? "Набор выбран"
              : "Выбрано"
            : purchasing
              ? "Купить"
              : !allowed
                ? "Недоступно"
                : slot === "set"
                  ? "Применить набор"
                  : "Выбрать";
          action.setAttribute("aria-pressed", String(selected));
          action.title =
            purchasing && !affordable ? "Недостаточно " + currencyNames[pack.currency] : "";
          action.setAttribute(
            "aria-label",
            purchasing
              ? `Купить тему «${pack.name}» за ${priceText(pack)}`
              : `${labels[slot]}: ${pack?.name || catalog.variantFrame(id)?.name || catalog.theme(id)?.name || catalog.accountFrame(id)?.name || catalog.rankFrame(id)?.name || "По умолчанию"}`,
          );
          availability.textContent =
            testAccess && id !== "default"
              ? "Тестовый доступ"
              : pack
                ? pack.earnedTitle
                  ? allowed
                    ? "Награда за титул «Герой» - навсегда"
                    : "Достигни титула «Герой»"
                  : allowed
                    ? "Тема куплена навсегда"
                    : priceText(pack)
                : id === "default"
                  ? "Всегда доступно"
                  : catalog.rankFrame(id)
                    ? "За титул «" + catalog.rankFrame(id).name + "» - навсегда"
                    : catalog.accountFrame(id)
                      ? (allowed ? "Пока активен " : "Нужен ") + catalog.accountFrame(id).name
                      : !allowed
                        ? catalog.baseFrame(id) === "champions"
                          ? "За медаль Чемпионской лиги - навсегда"
                          : catalog.baseFrame(id) === "bronze"
                            ? "За медаль Бронзовой лиги - 30 дней"
                            : "За медаль этой лиги - 30 дней"
                        : until === null
                          ? "Навсегда"
                          : "Осталось " + Math.ceil((until - now) / 86400000) + " дн.";
          availability.title =
            until && !testAccess
              ? "Доступно до " +
                new Date(until).toLocaleString("ru-RU")
              : "";
          for (const image of card.querySelectorAll(
            ".appearance-skin,.appearance-mini-avatar,.appearance-arena-skin",
          ))
            window.KillexIdentity.setSkinImage(image, this.owner.getSkin(), 128);
        }
      for (const [slot, { root }] of this.galleries) {
        root.querySelector(".appearance-intro").textContent = testing(slot)
          ? (slot === "set"
              ? "Все наборы лиг временно открыты"
              : ["avatarFrame", "arenaFrame", "frames"].includes(slot)
                ? "Все рамки временно открыты"
                : slot === "theme"
                  ? "Все темы интерфейса временно открыты"
                  : "Все фоны временно открыты") +
            " для тестирования. Награды и сроки лиг сохраняются."
          : slot === "set"
            ? "Полный комплект: интерфейс, фоны и рамки. Купленные темы и Героическая доступны навсегда; оформление лиг действует до указанного срока."
            : slot === "frames"
              ? "Одна лига для рамки профиля и ободка на арене. VIP и Premium также выбираются здесь."
              : slot === "theme"
                ? "Цвета всех окон, кнопок и элементов интерфейса вместе с фоном лобби. Клан использует оформление главы."
                : slot === "arenaFrame"
                  ? "Ободок шара с блеском. По умолчанию - без рамки. VIP и Premium выбираются отдельно; рамки лиг - за медали клана."
                  : catalog.frameSlot(slot)
                    ? "Рамка профиля выбирается отдельно от рамки арены. VIP и Premium доступны при активном статусе; рамки лиг - по достижениям клана."
                    : "Оформление выдаётся за медаль соответствующей лиги на 30 дней. Чемпионское - навсегда.";
        if (slot === "set") root.dataset.selection = active(slot);
      }
    }
    previewArena(enabled) {
      cancelAnimationFrame(this.previewFrame);
      const draw = (time) => {
        const gallery = this.galleries.get("arenaFrame");
        if (!gallery || gallery.root.hidden || !document.getElementById("skinsDialog")?.open)
          return;
        for (const { card, id } of gallery.cards) {
          const canvas = card.querySelector("canvas"),
            image = card.querySelector("img"),
            ctx = canvas.getContext("2d");
          ctx.clearRect(0, 0, 160, 160);
          ctx.fillStyle = "#201931";
          ctx.fillRect(0, 0, 160, 160);
          ctx.save();
          ctx.beginPath();
          ctx.arc(80, 80, 52, 0, Math.PI * 2);
          ctx.clip();
          if (image.complete && image.naturalWidth)
            window.KillexIdentity.drawSkin(ctx, image, image.dataset.skinId, 28, 28, 104);
          ctx.restore();
          window.KillexArenaArt.selectedFrame(ctx, id, this.profile?.account, 80, 80, 52, 1, time);
        }
        this.previewFrame = requestAnimationFrame(draw);
      };
      if (enabled) this.previewFrame = requestAnimationFrame(draw);
    }
    serverNow() {
      return this.clock + performance.now() - this.receivedAt;
    }
    scheduleExpiry() {
      clearTimeout(this.expiryTimer);
      const now = this.serverNow(),
        expiries = [
          ...Object.values(this.profile?.appearance?.availableUntil || {}),
          this.profile?.event?.endsAt,
          this.profile?.scheduledEvent?.startsAt,
        ].filter((at) => at > now);
      if (!expiries.length) return;
      this.expiryTimer = setTimeout(
        () => {
          this.refresh();
          if (this.owner.isLobby()) this.owner.loadProfile();
          this.scheduleExpiry();
        },
        Math.min(86400000, Math.min(...expiries) - now + 50),
      );
    }
    open(slot) {
      if (
        !this.owner.isLobby() ||
        !["lobbyBackground", "profileBackground", "theme"].includes(slot)
      )
        return;
      this.returnFocus = document.activeElement;
      this.title.textContent = labels[slot];
      this.dialog.append(this.status);
      this.status.textContent = "";
      this.content.replaceChildren(this.gallery(slot));
      this.owner.loadProfile();
      window.KillexWindows.open(this.dialog);
      this.content.scrollTop = 0;
    }
    async save(slot, themeId, action) {
      if (this.pending || !this.owner.isLobby() || this.owner.isProfileOnArena()) return;
      if (["avatarFrame", "arenaFrame", "frames", "set"].includes(slot))
        this.galleries.get(slot).root.append(this.status);
      const controller = new AbortController(),
        timeout = setTimeout(() => controller.abort(), 8000);
      this.pending = true;
      this.refresh();
      try {
        const response = await fetch("/api/profile/appearance", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            slot: action === "buy" && slot !== "set" ? "theme" : slot,
            themeId,
            action,
            requestId: window.KillexRequestIds.create(),
          }),
          signal: controller.signal,
        });
        const result = await response.json();
        if (!response.ok) throw Error(result.error || "Не удалось сохранить оформление.");
        this.owner.updateProfile(result.profile);
        this.status.dataset.error = "false";
        this.status.textContent =
          action === "buy"
            ? "Тема куплена навсегда и применена."
            : slot === "set"
              ? "Набор применён."
              : "Оформление сохранено.";
      } catch (error) {
        this.status.dataset.error = "true";
        this.status.textContent =
          error.name === "AbortError"
            ? "Не удалось подтвердить выбор."
            : error.message;
        await this.owner.loadProfile();
      } finally {
        clearTimeout(timeout);
        this.pending = false;
        this.refresh();
      }
    }
  }
  window.KillexAppearance = {
    AppearanceUI,
    now: badgeNow,
    paintFrame,
    paintArenaFrame,
    accessBadge,
    paintBackground,
    open: (slot) => instance?.open(slot),
  };
})();
