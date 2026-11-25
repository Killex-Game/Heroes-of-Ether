/* Окно клана: навигация, участники, управление и запросы к API. */
"use strict";
(() => {
  const el = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  };
  const button = (text, action, cls = "sf-button sf-tertiary") => {
    const b = el("button", cls, text);
    b.type = "button";
    b.addEventListener("click", action);
    return b;
  };
  const number = (value) => value.toLocaleString("ru-RU");
  const roles = {
    head: "Глава",
    manager: "Управляющий",
    officer: "Офицер",
    member: "Участник",
    recruit: "Новобранец",
  };
  const uuid = () => window.KillexRequestIds.create();
  async function json(url, options = {}) {
    const controller = new AbortController(),
      timer = setTimeout(() => controller.abort(), 8000);
    try {
      const response = await fetch(url, {
        ...options,
        signal: controller.signal,
        cache: "no-store",
      });
      const data = await response.json();
      if (!response.ok) throw Object.assign(Error(data.error), { server: true });
      return data;
    } finally {
      clearTimeout(timer);
    }
  }
  const crest = (clan) => {
    const img = el("img", "clan-crest");
    window.KillexClanCrests.paintImage(
      img,
      clan?.crest,
      typeof clan === "string" ? clan : clan?.emblem,
    );
    img.alt = "";
    return img;
  };
  class ClanUI {
    constructor(game) {
      this.game = game;
      this.mode = "welcome";
      this.polledAt = { battle: 0, league: 0, members: 0, rankings: 0 };
      this.updateVersions = {};
      this.battles = new window.KillexClanBattleUI(this);
      this.dialog = el("dialog", "clan-dialog");
      this.dialog.id = "clanDialog";
      this.dialog.dataset.uiTheme = "default";
      this.dialog.setAttribute("aria-labelledby", "clanTitle");
      const heading = el("header", "clan-heading");
      const title = el("h2", "", "Мой клан");
      title.id = "clanTitle";
      const close = button("×", () => this.dialog.close(), "booster-close");
      close.setAttribute("aria-label", "Закрыть кланы");
      heading.append(title, close);
      this.nav = el("nav", "clan-nav");
      this.nav.setAttribute("aria-label", "Разделы кланов");
      this.status = el("p", "clan-status");
      this.status.setAttribute("role", "status");
      this.content = el("div", "clan-content");
      this.confirmation = el("section", "clan-confirm");
      this.confirmation.hidden = true;
      this.dialog.append(heading, this.nav, this.status, this.confirmation, this.content);
      document.body.append(this.dialog);
      this.chat = new window.KillexChat.ClanChat(this);
      this.preview = new window.KillexClanPreview(this);
      this.memberDialog = el("dialog", "clan-dialog clan-member-dialog");
      this.memberDialog.setAttribute("aria-labelledby", "clanMemberTitle");
      document.body.append(this.memberDialog);
      this.toast = el("div", "clan-deposit-toast");
      this.toast.setAttribute("popover", "manual");
      this.toast.setAttribute("role", "status");
      document.body.append(this.toast);
      this.tops = new window.KillexTopsUI({
        game,
        getData: () => this.data,
        load: () => this.load(false, "rankings"),
        invalidate: () => { this.readVersion = (this.readVersion || 0) + 1; },
        isBusy: () => !!this.busy,
        action: (action, fields) => this.action(action, fields),
        actionError: () => this.status.textContent,
        openClan: (id) => this.openClan(id),
        create: () => {
          window.KillexWindows.open(this.dialog);
          this.go("create");
        },
      });
      this.dialog.addEventListener("close", () => {
        // A queued close event may arrive after the window has reopened.
        if(!this.dialog.open){this.viewRequest=(this.viewRequest||0)+1;this.memberDialog.close();this.questRankingCleanup?.();}
      });
      document.getElementById("clanSection").addEventListener("click", () => this.open());
      window.KillexActivity.every(() => {
        if (this.dialog.open && !document.hidden) this.expireBackground();
        const top = window.KillexWindows.top();
        const active = top === this.tops.dialog || top === this.dialog ? top : null;
        if (
          active &&
          !this.memberDialog.open &&
          !document.hidden &&
          !this.busy &&
          !this.loading &&
          (active === this.tops.dialog || !["create", "edit"].includes(this.mode)) &&
          !active.contains(document.activeElement?.closest("input,textarea,select"))
        )
          this.poll(active);
      }, 1000, () => this.dialog.open || this.tops.dialog.open);
    }
    openClan(id) {
      return this.preview.open(id);
    }
    message(text = "Оформление клана обновлено.", error = false) {
      const status =
        window.KillexWindows.top() === this.tops.dialog ? this.tops.status : this.status;
      status.textContent = error ? text : "";
      status.dataset.error = String(error);
    }
    async open() {
      if (!this.game.isLobby() || this.busy) return;
      if (!this.dialog.open) this.questRankingPage = 1;
      if (!this.dialog.open) window.KillexAudio?.play?.("clan");
      this.busy = true;
      try {
        await this.game.beforeOpen();
        if (!(await this.load(false, "clan"))) {
          window.KillexWindows.open(this.dialog);
          return;
        }
        if (this.data.mine) {
          this.mode = "home";
          window.KillexWindows.open(this.dialog);
          this.render();
        } else await this.tops.open("clans");
      } catch (error) {
        window.KillexWindows.open(this.dialog);
        this.message(error.message || "Нет связи с сервером.", true);
      } finally {
        this.busy = false;
        this.lockControls();
      }
    }
    async load(
      silent = false,
      scope = [this.tops.dialog, this.tops.joinDialog].includes(window.KillexWindows.top())
        ? "rankings"
        : "clan",
    ) {
      // Coalesce rapid navigation; only the latest requested page may be shown.
      const version = (this.readVersion = (this.readVersion || 0) + 1);
      if (this.readPromise) await this.readPromise;
      if (version !== this.readVersion) return false;
      const request = this.fetchData(silent, scope, version);
      this.readPromise = request;
      try {
        return await request;
      } finally {
        if (this.readPromise === request) this.readPromise = null;
      }
    }
    async fetchData(silent, scope, version) {
      this.loading = true;
      try {
        const query = this.tops.query();
        query.set("scope", scope);
        const incoming = await json("/api/clans?" + query);
        await window.KillexClanCrests.prepare?.(incoming.mine?.crest);
        if (version !== this.readVersion) return false;
        const data = { ...this.data, ...incoming };
        if (scope === "rankings" && this.data?.mine && incoming.mine?.id === this.data.mine.id)
          data.mine = this.data.mine;
        const changedClan = this.data && this.data.profile.clanId !== data.profile.clanId;
        const changed = JSON.stringify(data) !== JSON.stringify(this.data);
        this.data = data;
        const at = performance.now();
        if (scope === "rankings") this.polledAt.rankings = at;
        else {
          this.polledAt.battle = this.polledAt.league = this.polledAt.members = at;
          this.updateVersions = {};
        }
        this.game.updateProfile(data.profile);
        if (changedClan) this.mode = data.mine ? "home" : "welcome";
        if (changedClan && !data.mine) {
          this.dialog.close();
          this.memberDialog.close();
          this.battles.dialog.close();
        }
        if (changed || !silent) {
          if (scope === "clan") this.render();
          if (scope === "rankings") this.tops.render();
        }
        if (!silent) this.message("");
        return true;
      } catch (error) {
        this.message(error.message || "Не удалось обновить кланы.", true);
      } finally {
        this.loading = false;
        this.lockControls();
      }
    }
    async poll(active) {
      if (active === this.dialog && this.mode === "chat") return;
      const at = performance.now();
      if (active === this.tops.dialog) {
        if (at - this.polledAt.rankings >= 30000) {
          this.polledAt.rankings = at;
          await this.load(true, "rankings");
        }
        return;
      }
      const parts = [];
      if (this.mode === "home" && this.data?.mine) {
        if (at - this.polledAt.battle >= 5000) parts.push("battle");
        if (at - this.polledAt.league >= 15000) parts.push("league");
      }
      if (at - this.polledAt.members >= 15000) parts.push("members");
      if (!parts.length || !this.data) return;
      for (const part of parts) this.polledAt[part] = at;
      const version = this.readVersion || 0;
      const request = this.fetchUpdates(parts, version);
      this.readPromise = request;
      let membershipChanged;
      try {
        membershipChanged = await request;
      } finally {
        if (this.readPromise === request) this.readPromise = null;
      }
      if (membershipChanged) await this.load(true, "clan");
    }
    async fetchUpdates(parts, version) {
      this.loading = true;
      let membershipChanged = false;
      try {
        const query = new URLSearchParams({
          parts: parts.join(","),
          known: JSON.stringify(this.updateVersions),
        });
        const update = await json("/api/clans/updates?" + query);
        if (version !== (this.readVersion || 0)) return false;
        membershipChanged = update.clanId !== this.data.profile.clanId;
        if (!membershipChanged) {
          for (const block of Object.values(update.changes))
            for (const [key, value] of Object.entries(block))
              this.data[key] =
                ["mine", "competition"].includes(key) && value
                  ? { ...this.data[key], ...value }
                  : value;
          Object.assign(this.updateVersions, update.versions);
          if (update.changes.profile) this.game.updateProfile(this.data.profile);
          if (
            Object.keys(update.changes).length &&
            this.dialog.open &&
            window.KillexWindows.top() === this.dialog
          )
            this.render();
        }
      } catch (error) {
        this.message(error.message || "Не удалось обновить клан.", true);
      } finally {
        this.loading = false;
        this.lockControls();
      }
      return membershipChanged;
    }
    async go(mode) {
      const version = this.viewRequest = (this.viewRequest || 0) + 1;
      if (["edit", "create"].includes(mode)) {
        try { await window.KillexClanCrests.prepareEditor?.(this.data?.mine?.crest); }
        catch { this.message("Не удалось открыть оформление клана. Попробуй ещё раз.", true); return; }
        if (version !== this.viewRequest) return;
      }
      this.mode = mode;
      this.confirmation.hidden = true;
      this.message("");
      this.render();
    }
    async claimBattleChest(chestId) {
      if (this.busy || !this.game.isLobby()) return;
      this.busy = true;
      this.readVersion = (this.readVersion || 0) + 1;
      this.lockControls();
      this.message("");
      const request = { action: "claim", chestId, requestId: uuid() };
      try {
        if (this.readPromise) await this.readPromise;
        const result = await json("/api/clan-chests/action", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(request),
        });
        this.data.profile = result.profile;
        this.game.updateProfile(result.profile);
        this.render();
        this.message(
          result.profile.clanChests.items.find((c) => c.id === chestId)?.stored
            ? "Сундук зачислен в Сокровищницу."
            : "Сундук получен и ожидает свободного места.",
        );
      } catch (error) {
        this.message(error.message || "Не удалось получить сундук. Попробуй ещё раз.", true);
      } finally {
        this.busy = false;
        this.lockControls();
      }
    }
    lockControls() {
      [this.dialog, this.memberDialog].forEach((dialog) =>
        dialog.querySelectorAll("[data-busy]").forEach((b) => {
          window.KillexControls.state(
            b,
            (!!this.busy && !b.matches(".sf-tab")) || b.dataset.unavailable === "true",
            b.dataset.unavailable === "true",
          );
        }),
      );
      this.tops.lock();
    }
    actionButton(label, action, fields, cls) {
      const b = button(label, () => this.action(action, fields), cls);
      b.dataset.busy = "true";
      return b;
    }
    async action(action, fields = {}) {
      if (this.busy || !this.game.isLobby()) return;
      const draft =
        action === "background" ? this.content.querySelector("#clanForm")?.readDraft() : null;
      this.busy = true;
      this.readVersion = (this.readVersion || 0) + 1;
      this.lockControls();
      this.message("");
      const operation = { action, ...fields, requestId: uuid() };
      try {
        if (this.readPromise) await this.readPromise;
        let result;
        for (let attempt = 0; attempt < 2; attempt++) {
          try {
            result = await json("/api/clans/action", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(operation),
            });
            break;
          } catch (error) {
            if (attempt || error.server) throw error;
          }
        }
        this.game.updateProfile(result.profile);
        this.confirmation.hidden = true;
        if (["leave", "disband"].includes(action) && !result.profile.clanId) {
          this.dialog.close();
          this.memberDialog.close();
          this.battles.dialog.close();
        }
        if (["create", "edit"].includes(action)) this.mode = "home";
        await this.load();
        if (draft && this.data.mine?.id === fields.clanId)
          this.content.querySelector("#clanForm")?.restoreDraft(draft);
        this.message(
          {
            deposit: "Взнос поступил в казну.",
            buyBooster: "Каждому текущему участнику выдано 10 бустеров.",
            create: "Клан создан. Списано 1500 монет.",
            edit: "Клан обновлён.",
            background: "Фон клана сохранён.",
            apply: result.profile.clanId
              ? "Ты вступил в клан. Списано 50 монет."
              : "Заявка отправлена. При отмене или отказе 50 монет вернутся.",
            cancel: "Заявка отозвана. Внесённая плата возвращена.",
            accept: "Игрок принят в клан.",
            reject: "Заявка отклонена. Внесённая плата возвращена игроку.",
            leave: "Ты вышел из клана.",
            kick: "Игрок исключён.",
            role: "Роль участника изменена.",
            transfer: "Полномочия главы переданы.",
            disband: "Клан распущен.",
          }[action],
        );
        return true;
      } catch (error) {
        if (action === "deposit" && error.message === "Недостаточно эфира") {
          this.message("");
          this.showDepositToast();
        } else
          this.message(error.message || "Нет связи с сервером. Обнови кланы перед повтором.", true);
        return false;
      } finally {
        this.busy = false;
        this.lockControls();
      }
    }
    confirm(text, action, fields) {
      const actions = el("div", "clan-confirm-actions");
      actions.append(
        this.actionButton("Подтвердить", action, fields, "sf-button sf-danger"),
        button("Отмена", () => {
          this.confirmation.hidden = true;
        }),
      );
      this.confirmation.replaceChildren(el("p", "", text), actions);
      this.confirmation.hidden = false;
    }
    render() {
      if (!this.data) return;
      const keepPosition = this.dialog.open && this.dialog.dataset.view === this.mode,
        scroll = keepPosition ? [this.content, ...this.content.querySelectorAll("*")]
          .filter(node => node.scrollTop || node.scrollLeft)
          .map(node => ({ key: node.className, top: node.scrollTop, left: node.scrollLeft })) : [];
      this.questRankingCleanup?.();
      this.questRankingCleanup=null;
      const d = this.data;
      window.KillexAppearance.paintBackground(this.dialog, d.mine?.appearance?.background, "clan");
      for (const portal of [this.memberDialog, this.battles.dialog, this.toast])
        window.KillexUITheme.inherit(portal, this.dialog);
      this.dialog.classList.toggle("clan-editor-open", ["create", "edit"].includes(this.mode));
      this.dialog.dataset.view = this.mode;
      this.dialog.querySelector("#clanTitle").textContent =
        this.mode === "edit"
          ? "Настройки клана"
          : this.mode === "create"
            ? "Создание клана"
            : "Мой клан";
      const tabs = [
        [d.mine ? "home" : "welcome", "Мой клан"],
        ...(d.mine
          ? [
              ["armory", "Казна и склад"],
              ["chat", "Чат"],
            ]
          : [["create", "Создать клан"]]),
        ...(d.mine?.permissions.edit ? [["edit", "Настройки"]] : []),
      ];
      const navKey = JSON.stringify(tabs);
      if (this.navKey !== navKey) {
        this.navKey = navKey;
        this.nav.replaceChildren(
          ...tabs.map(([mode, label]) => {
            const b = button(label, () => this.go(mode), "sf-tab");
            b.dataset.mode = mode;
            b.dataset.busy = "true";
            return b;
          }),
        );
      }
      for (const b of this.nav.children)
        b.setAttribute("aria-pressed", String(this.mode === b.dataset.mode));
      // Keep the already painted portrait and rim across data-only refreshes.
      this.previousMemberRows = new Map(
        [...this.content.querySelectorAll(".clan-member[data-member-id]")].map(row =>
          [row.dataset.memberId, row]),
      );
      this.content.replaceChildren();
      const toolbar = this.dialog.querySelector(".interface-toolbar");
      if (toolbar) toolbar.hidden = !!d.mine;
      if (d.mine) this.content.append(this.banner(d.mine));
      else if (toolbar) toolbar.append(this.nav);
      else this.content.before(this.nav);
      if (this.mode === "create" || this.mode === "edit")
        this.form(this.mode === "edit" ? d.mine : null);
      else if (d.mine && this.mode === "armory") this.treasury(d.mine, d.mine.permissions.buy);
      else if (d.mine && this.mode === "chat") this.chat.mount(d.mine.id);
      else if (d.mine && this.mode === "applications" && d.mine.permissions.recruit)
        this.applications();
      else if (d.mine) this.home();
      else this.welcome();
      for (const position of scroll) {
        const node = [this.content, ...this.content.querySelectorAll("*")].find(node => node.className === position.key);
        if (node) { node.scrollTop = position.top; node.scrollLeft = position.left; }
      }
      this.previousMemberRows = null;
      this.lockControls();
    }
    expireBackground() {
      const appearance = this.data?.mine?.appearance;
      if (!appearance || appearance.testBackgrounds) return;
      const at = window.KillexAppearance.now(),
        expired = appearance.unlocked.filter(
          (id) =>
            Number.isFinite(appearance.availableUntil[id]) && appearance.availableUntil[id] <= at,
        );
      if (!expired.length) return;
      appearance.unlocked = appearance.unlocked.filter((id) => !expired.includes(id));
      for (const id of expired) delete appearance.availableUntil[id];
      if (expired.includes(appearance.background)) {
        appearance.background = "default";
        window.KillexAppearance.paintBackground(this.dialog, "default", "clan");
      }
      // Обновляем только витрину: черновик названия и герба остаётся нетронутым.
      const previous = this.content.querySelector(".clan-backgrounds");
      if (previous) {
        const scroll = previous.querySelector(".appearance-grid").scrollTop,
          focused = previous.contains(document.activeElement),
          replacement = this.backgrounds();
        previous.replaceWith(replacement);
        const grid = replacement.querySelector(".appearance-grid");
        grid.scrollTop = scroll;
        if (focused) grid.focus({ preventScroll: true });
        this.lockControls();
      }
    }
    backgrounds() {
      const clan = this.data.mine,
        appearance = clan.appearance,
        catalog = window.KillexLeagueAppearance;
      const collection = el("section", "clan-backgrounds"),
        grid = el("div", "appearance-grid");
      grid.tabIndex = 0;
      grid.setAttribute("role", "region");
      grid.setAttribute("aria-label", "Фоны клана");
      collection.append(el("h3", "", "Фоны клана"));
      for (const theme of [
        { id: "default", name: "По умолчанию", title: "Классическое оформление" },
        ...catalog.themes,
      ]) {
        const available = appearance.testBackgrounds || appearance.unlocked.includes(theme.id),
          selected = appearance.background === theme.id;
        const card = el("article", "appearance-card"),
          preview = el("div", "appearance-preview appearance-clan-preview");
        card.dataset.themeId = theme.id;
        card.dataset.selected = String(selected);
        card.dataset.locked = String(!available);
        window.KillexAppearance.paintBackground(preview, theme.id, "clan");
        const panels = el("div", "appearance-clan-panels");
        panels.setAttribute("aria-hidden", "true");
        for (let i = 0; i < 4; i++) panels.append(el("span"));
        preview.append(panels);
        const choose = this.actionButton(
          selected ? "Выбрано" : available ? "Выбрать" : "Недоступно",
          "background",
          { clanId: clan.id, themeId: theme.id },
        );
        choose.dataset.unavailable = String(selected || !available);
        choose.setAttribute("aria-label", "Фон клана: " + theme.name);
        choose.setAttribute("aria-pressed", String(selected));
        card.append(preview, el("strong", "", theme.name), el("small", "", theme.title), choose);
        window.KillexAppearance.accessBadge(card, {
          available,
          until: appearance.availableUntil[theme.id],
          testing: appearance.testBackgrounds,
        });
        grid.append(card);
      }
      collection.append(grid);
      return collection;
    }
    welcome() {
      const panel = el("section", "clan-welcome clan-panel");
      panel.append(
        crest("astral"),
        el("h3", "", "Твой путь в клан"),
        el(
          "p",
          "",
          "Создание и вступление доступны с 12 уровня. В открытый клан вступают сразу, в закрытый - после одобрения заявки.",
        ),
      );
      const actions = el("div", "clan-actions");
      actions.append(
        button("Создать за 1500 монет", () => this.go("create"), "sf-button"),
        button(
          "Найти клан",
          () => {
            this.tops.open("clans");
          },
          "sf-button sf-secondary",
        ),
      );
      panel.append(actions);
      this.content.append(panel);
      if (this.data.applications.length) {
        const requests = el("section", "clan-panel");
        requests.append(el("h3", "", "Мои заявки"));
        for (const c of this.data.applications) {
          const row = el("div", "clan-request");
          row.append(
            el("span", "", `[${c.prefix}] ${c.name}`),
            this.actionButton("Отозвать", "cancel", { clanId: c.id }),
          );
          requests.append(row);
        }
        this.content.append(requests);
      }
    }
    form(clan) {
      const form = el("form", "clan-form clan-panel");
      form.id = "clanForm";
      form.append(el("h3", "", clan ? "Настройки клана" : "Создание клана"));
      const fields = {},
        details = el("div", "clan-form-fields"),
        layout = el("div", "clan-form-layout");
      const field = (id, title, value, max, help) => {
        const label = el("label", "clan-field", title),
          input = el("input");
        input.id = "clan-" + id;
        input.name = id;
        input.value = value || "";
        input.maxLength = max;
        input.required = id !== "description";
        input.autocomplete = "off";
        label.append(input);
        if (help) label.append(el("small", "", help));
        details.append(label);
        fields[id] = input;
      };
      field("name", "Название", clan?.name, 64, "2–32 символа.");
      field("prefix", "Уникальный префикс", clan?.prefix, 8, "1–4 знака без пробелов и скобок.");
      field("description", "Описание", clan?.description, 360, "До 180 символов.");
      if (clan && !clan.permissions.editBasics) {
        fields.name.readOnly = true;
        fields.prefix.readOnly = true;
      }
      const privacyLabel = el("label", "clan-field", "Приватность"),
        privacy = el("select");
      privacy.id = "clan-privacy";
      privacy.name = "privacy";
      for (const [value, title] of [
        ["open", "Открытый"],
        ["closed", "Закрытый"],
      ]) {
        const option = el("option", "", title);
        option.value = value;
        privacy.append(option);
      }
      privacy.value = clan?.privacy || "closed";
      const privacyHelp = el("small");
      const describePrivacy = () => {
        privacyHelp.textContent =
          privacy.value === "open" ? "Вступление сразу." : "После одобрения заявки.";
      };
      privacy.addEventListener("change", describePrivacy);
      describePrivacy();
      privacyLabel.append(privacy, privacyHelp);
      details.append(privacyLabel);
      const cost = clan ? 0 : this.data.rules.createCost;
      const price = el("p", "clan-form-cost");
      const submit = el(
        "button",
        "sf-button",
        clan ? "Сохранить изменения" : "Создать за 1500 монет",
      );
      submit.type = "submit";
      submit.dataset.busy = "true";
      const validation = el("p", "clan-form-error");
      validation.setAttribute("role", "status");
      const kit = window.KillexClanCrests;
      const crystal = () => {
        const img = el("img", "clan-cost-crystal");
        img.src = "assets/menu-icons/64/currency_crystals.webp?art=20261123-interface-art";
        img.alt = "кристаллов";
        return img;
      };
      const updateCost = () => {
        const renamed =
          !!clan &&
          ["name", "prefix"].some(
            (key) => fields[key].value.normalize("NFKC").trim() !== clan[key],
          );
        const editCost = clan
          ? (!kit.equal(builder.value, clan.crest) ? kit.EDIT_COST : 0) +
            (renamed ? this.data.rules.renameCost : 0)
          : 0;
        const paid = editCost > 0;
        const lowFunds = this.data.profile.wallet.crystals < editCost;
        submit.replaceChildren(
          document.createTextNode(
            clan
              ? paid
                ? `Сохранить за ${editCost} `
                : "Сохранить изменения"
              : "Создать за 1500 монет",
          ),
        );
        if (paid) submit.append(crystal());
        if (!clan)
          price.textContent = "Герб включён в создание клана. Вместимость - 15 участников.";
        submit.dataset.unavailable = String(
          lowFunds ||
            this.data.profile.wallet.coins < cost ||
            (!clan && this.data.profile.level < this.data.rules.minLevel),
        );
        validation.textContent = lowFunds
          ? "Для сохранения изменений не хватает кристаллов."
          : !clan && this.data.profile.level < this.data.rules.minLevel
            ? "Создание клана доступно с 12 уровня."
            : this.data.profile.wallet.coins < cost
              ? "Недостаточно монет для создания клана."
              : "";
        this.lockControls();
      };
      const builder = new window.KillexCrestBuilder({
        heading: clan?.permissions.editBasics ? "Генератор герба" : "",
        clanLevel: clan?.progress?.level || 1,
        testAccess: this.data.rules.testCrests === true,
        initial: clan ? clan.crest : kit.DEFAULT,
        legacy: clan?.emblem,
        disabled: !!clan && !clan.permissions.editBasics,
        onChange: updateCost,
      });
      fields.name.addEventListener("input", updateCost);
      fields.prefix.addEventListener("input", updateCost);
      layout.append(details, builder.root);
      const footer = el("footer", "clan-form-footer"),
        actions = el("div", "clan-form-actions");
      if (!clan) actions.append(button("Назад", () => this.go("welcome")));
      actions.append(submit);
      if (!clan) footer.append(price);
      footer.append(validation, actions);
      form.append(layout, footer);
      form.addEventListener("submit", (event) => {
        event.preventDefault();
        const prefix = fields.prefix.value.normalize("NFKC").trim();
        if (
          Array.from(prefix).length < 1 ||
          Array.from(prefix).length > 4 ||
          /[\s\[\]\p{C}\p{M}]/u.test(prefix)
        ) {
          validation.textContent =
            "Префикс: от 1 до 4 символов, без пробелов, скобок и скрытых знаков.";
          fields.prefix.focus();
          return;
        }
        validation.textContent = "";
        this.action(clan ? "edit" : "create", {
          clanId: clan?.id,
          name: fields.name.value,
          prefix,
          description: fields.description.value,
          emblem: clan?.emblem || "astral",
          crest: builder.value,
          privacy: privacy.value,
        });
      });
      this.content.append(form);
      form.readDraft = () => ({
        values: Object.fromEntries(new FormData(form)),
        crest: builder.value,
      });
      form.restoreDraft = (draft) => {
        for (const [name, value] of Object.entries(draft.values)) {
          const input = form.elements.namedItem(name);
          if (input && "value" in input) input.value = value;
        }
        builder.value = draft.crest;
        describePrivacy();
        builder.render();
        updateCost();
      };
      layout.classList.add("clan-settings-layout");
      if (clan) {
        form.classList.add("clan-unified-appearance");
        const heading = form.firstElementChild;
        heading.className = "clan-settings-title";
        details.prepend(heading);
        if (clan.permissions.editBasics) layout.append(this.backgrounds());
      }
      updateCost();
    }
    banner(clan) {
      const banner = el("header", "clan-banner clan-panel");
      const copy = el("div", "clan-banner-copy"),
        name = el("div", "clan-name-line");
      name.append(
        el("h3", "", `[${clan.prefix}] ${clan.name}`),
        el("span", "clan-privacy", clan.privacy === "open" ? "Открытый" : "Закрытый"),
      );
      copy.append(
        name,
        el("p", "clan-description", clan.description || "У этого клана пока нет описания."),
        window.KillexGreatnessUI.label(
          el(
            "p",
            "clan-meta",
            `${clan.count} / ${clan.capacity} участников - ${number(clan.greatness)} величия`,
          ),
        ),
      );
      const progress = clan.progress,
        level = el("div", "clan-level");
      level.append(el("strong", "", `Уровень клана: ${progress.level}`));
      if (progress.nextLevelXp !== null) {
        const bar = el("div", "clan-xp-track"),
          fill = el("span", "clan-xp-fill");
        bar.setAttribute("role", "progressbar");
        bar.setAttribute("aria-valuemin", "0");
        bar.setAttribute("aria-valuemax", String(progress.nextLevelXp));
        bar.setAttribute("aria-valuenow", String(progress.levelXp));
        bar.setAttribute("aria-label", "Опыт до следующего уровня клана");
        fill.style.width = Math.min(100, (100 * progress.levelXp) / progress.nextLevelXp) + "%";
        // Server refreshes rebuild the banner. Keep the animation at its global phase.
        fill.style.setProperty("--flow-phase", -performance.now() / 1000 + "s");
        bar.append(fill);
        bar.title = `${number(progress.levelXp)} / ${number(progress.nextLevelXp)} опыта`;
        bar.setAttribute("aria-valuetext", bar.title);
        level.append(bar);
      } else level.append(el("small", "", "Максимальный уровень: 15"));
      copy.append(level);
      if (clan.frame === "champion") copy.querySelector("h3").classList.add("clan-champion-name");
      const actions = el("div", "clan-banner-actions");
      actions.append(this.nav);
      if (clan.permissions?.recruit) {
        const applications = button(
          "Заявки",
          () => this.go("applications"),
          "sf-button sf-tertiary",
        );
        applications.dataset.busy = "true";
        applications.classList.add("clan-applications-button");
        if (clan.applications.length) {
          const badge = el("span", "clan-application-badge", clan.applications.length);
          badge.title = "Заявок в клан: " + clan.applications.length;
          badge.setAttribute("aria-label", badge.title);
          applications.append(badge);
        }
        actions.append(applications);
      }
      if (clan.ownerId === this.data.profile.id) {
        const disband = button(
          "Распустить клан",
          () =>
            this.confirm(
              `Распустить клан «${clan.name}»? Все ${clan.count} участников останутся без клана. Казна и клановые награды будут удалены, название и префикс освободятся. Личные вещи и полученные игроками награды сохранятся. Плата за ожидающие заявки вернётся заявителям. Отменить роспуск нельзя.`,
              "disband",
              { clanId: clan.id },
            ),
          "sf-button sf-tertiary clan-disband-button",
        );
        disband.dataset.busy = "true";
        actions.append(disband);
        actions.classList.add("clan-banner-actions-with-exit");
      }
      if (clan.ownerId !== this.data.profile.id) {
        const leave = button(
          "Выйти из клана",
          () =>
            this.confirm("Выйти из клана? Скин и личные бустеры сохранятся.", "leave", {
              clanId: clan.id,
            }),
          "sf-button sf-tertiary clan-leave-button",
        );
        leave.dataset.busy = "true";
        if (actions.childElementCount) actions.classList.add("clan-banner-actions-with-exit");
        actions.append(leave);
      }
      const identity = el("div", "clan-banner-identity");
      identity.append(crest(clan), copy);
      const showcases = el("div", "clan-award-showcases");
      showcases.append(this.medalShelf(), this.trophyShelf());
      banner.append(identity, showcases, actions);
      return banner;
    }
    medalShelf(competition = this.data.competition, { earnedOnly = false } = {}) {
      const shelf = el("section", "clan-medal-shelf"),
        medals = el("div", "clan-medals");
      shelf.setAttribute("aria-label", "Медали клана за лиги");
      const counts = competition?.medals || {};
      for (const league of window.KillexClanRules.LEAGUES) {
        const count = counts[league.id] || 0;
        if (earnedOnly && !count) continue;
        const item = el("div", "clan-league-medal"),
          img = el("img");
        item.dataset.league = league.id;
        item.dataset.earned = String(count > 0);
        item.title =
          league.name + ": " + (count ? "получено " + number(count) : "пока не получена");
        img.src = window.KillexProgressionArt.leagueMedal(league.id, 128);
        img.alt = item.title;
        item.append(img);
        if (count > 1) item.append(el("b", "clan-medal-count", number(count)));
        medals.append(item);
      }
      for(const medal of competition?.questSeasonMedals||[]){
        const prize=window.KillexClanCalendar.questPrize(medal.place);if(!prize)continue;
        const item=el('div','clan-league-medal'),img=el('img');item.dataset.earned='true';item.title=prize.name+' медаль за сезон клановых заданий. Место '+medal.place;img.src=window.KillexProgressionArt.leagueMedal(medal.tier,128);img.alt=item.title;item.append(img);medals.append(item);
      }
      shelf.append(el("small", "", "Медали клана"), medals);
      return shelf;
    }
    trophyShelf(competition = this.data.competition, { earnedOnly = false } = {}) {
      const shelf = el("section", "clan-medal-shelf clan-trophy-shelf"),
        items = el("div", "clan-medals"),
        rules = window.KillexClanRules,
        trophies = competition?.trophies || [];
      shelf.setAttribute("aria-label", "Кубки сезона");
      for (const league of rules.LEAGUES) {
        const owned = trophies
            .filter((t) => t.league === league.index)
            .sort((a, b) => b.awardedAt - a.awardedAt);
        if (earnedOnly && !owned.length) continue;
        const prize = rules.SEASON_PRIZES[league.index],
          item = el("button", "clan-league-medal clan-season-trophy"),
          img = el("img");
        item.type = "button";
        item.dataset.league = league.id;
        item.dataset.earned = String(owned.length > 0);
        const name = owned.length ? rules.trophyLabel(owned[0]) : `Кубок сезона: ${league.name}`,
          history = owned.slice(1).map(rules.trophyLabel).join(". "),
          usage = `${history ? history + ". " : ""}Выдаётся за максимальную лигу сезона. Каждому участнику разово: ${number(prize.reward.coins)} монет, ${number(prize.reward.crystals)} кристаллов, ${number(prize.reward.bucks)} эфира. Скидка ${prize.discount}% на клановые бустеры и личные покупки скинов, бабочек и шапок. Действует лучший из кубков, полученных за последние 30 дней; личная скидка доступна участникам клана.`;
        item.setAttribute("aria-label", name);
        img.src = `assets/season-trophies/128/${league.id}.webp?art=20261123-interface-art`;
        img.alt = "";
        item.append(img);
        if (owned.length > 1) item.append(el("b", "clan-medal-count", number(owned.length)));
        window.KillexBoosterTooltip.attach(item, { name, usage });
        items.append(item);
      }
      shelf.append(el("small", "", "Кубки сезона"), items);
      if (competition?.season) {
        const peak = rules.LEAGUES[competition.seasonPeak]?.name || "Бронзовая";
        shelf.title = `Сезон ${competition.season.number}: максимум - ${peak}. Завершение ${window.KillexClanCalendar.seasonRange(competition.season).split(" - ")[1]}.`;
      }
      return shelf;
    }
    memberRow(p, clan, { readOnly = false, competitionMode = this.data.competition?.mode, retainedRow = null } = {}) {
      const battle = readOnly ? { kills: p.kills } : this.data.competition?.personal?.[p.id],
        reward = !readOnly && window.KillexClanBattleUI.previewTier(this.data.competition, p.id),
        canJoin = !readOnly && p.canJoinArena && this.game.isLobby(),
        previousRow = retainedRow || (readOnly ? null : this.previousMemberRows?.get(p.id)),
        contentKey = JSON.stringify([p, readOnly, competitionMode, battle?.kills ?? 0, reward, canJoin]);
      if (previousRow?.memberContentKey === contentKey) return previousRow;
      const signature = JSON.stringify([p.skinId, p.appearance?.avatarFrame,
        !!p.account?.premium, !!p.account?.vip, p.role, p.giftAppearance]);
      const previous = previousRow?.querySelector(".clan-member-avatar");
      const row = el("div", "clan-member"),
        avatar = previous?.dataset.memberAppearance === signature ? previous
          : window.KillexPlayerProfile.avatar(p, "clan-member-avatar");
      avatar.dataset.memberAppearance = signature;
      const presence = avatar.querySelector(".player-online-indicator");
      if (presence) {
        presence.dataset.online = String(p.online === true);
        presence.title = p.online ? "В сети" : "Не в сети";
        presence.setAttribute("aria-label", presence.title);
      }
      row.dataset.memberId = p.id;
      row.memberContentKey = contentKey;
      const profileButton = button(
        "",
        () => window.KillexPlayerProfile.open(p.id),
        "clan-member-profile",
      );
      profileButton.setAttribute("aria-label", `Открыть профиль: ${p.name}`);
      row.append(profileButton);
      const info = el("div", "clan-member-info");
      info.append(
        el("strong", "", window.KillexIdentity.label(p)),
        window.KillexGreatnessUI.label(
          el("small", "", `${roles[p.role]} - ${number(p.greatness)} величия`),
        ),
      );
      const badge = window.KillexIdentity.createMedal(p);
      info.firstElementChild.classList.toggle("name-premium", !!p.account?.premium);
      info.firstElementChild.classList.toggle("name-vip", !p.account?.premium && !!p.account?.vip);
      if (badge) info.firstElementChild.prepend(badge);
      row.append(avatar, info);
      if (["head", "manager", "officer"].includes(p.role) && !avatar.querySelector(".clan-role-icon")) {
        const roleIcon = el("img", "clan-role-icon");
        roleIcon.src = "assets/clan-roles/" + p.role + ".png?art=20261123-interface-art";
        roleIcon.alt = roles[p.role];
        roleIcon.title = roles[p.role];
        avatar.append(roleIcon);
      }
      if (canJoin) {
        const join = previousRow?.querySelector(".clan-member-join") || button("Присоединиться", () => {
          if (!this.game.isLobby() || join.disabled) return;
          join.disabled = true;
          this.dialog.close();
          this.game.joinClanMember?.(p.id);
        }, "sf-button sf-secondary clan-member-join");
        join.setAttribute("aria-label", "Присоединиться к " + p.name);
        row.append(join);
      }
      if (reward) row.dataset.reward = reward;
      const kills = el("span", "clan-member-kills", number(battle?.kills ?? 0));
      kills.setAttribute("aria-label", `Киллы за текущую битву: ${number(battle?.kills ?? 0)}`);
      if(competitionMode!=='quests') row.append(kills);
      if (!readOnly && (p.canKick || p.canTransfer || p.assignableRoles?.length)) {
        const gear = button(
          "⚙",
          () => this.memberSettings(p, clan),
          "sf-button sf-tertiary clan-member-gear",
        );
        gear.setAttribute("aria-label", `Управление участником ${p.name}`);
        gear.dataset.busy = "true";
        row.append(gear);
      }
      return row;
    }
    memberSettings(p, clan) {
      const dialog = this.memberDialog,
        heading = el("header", "clan-heading"),
        title = el("h2", "", "Управление участником");
      title.id = "clanMemberTitle";
      const close = button("×", () => dialog.close(), "booster-close");
      close.setAttribute("aria-label", "Закрыть управление участником");
      heading.append(title, close);
      const content = el("div", "clan-member-settings"),
        status = el("p", "clan-status");
      status.setAttribute("role", "status");
      const name = el("strong", "clan-member-name", p.name);
      name.title = p.name;
      const identity = el("div", "clan-member-identity");
      identity.append(name, el("span", "clan-member-role", `Текущая роль: ${roles[p.role]}`));
      content.append(identity);
      const run = async (action, extra = {}) => {
        status.textContent = "";
        if (await this.action(action, { clanId: clan.id, memberId: p.id, ...extra }))
          dialog.close();
        else status.textContent = this.status.textContent;
      };
      if (p.assignableRoles?.length) {
        const actions = el("div", "clan-role-actions");
        for (const [role, label] of [
          ["manager", "Назначить управляющим"],
          ["officer", "Назначить офицером"],
          ["member", "Разжаловать"],
        ]) {
          if (!p.assignableRoles.includes(role)) continue;
          const action = button(label, () => run("role", { role }), "sf-button");
          action.dataset.busy = "true";
          action.dataset.unavailable = String(p.role === role);
          window.KillexControls.state(action, p.role === role);
          actions.append(action);
        }
        content.append(actions);
      }
      const confirm = (text, action) => {
        const box = el("section", "clan-confirm"),
          yes = button("Подтвердить", () => run(action), "sf-button sf-danger");
        yes.dataset.busy = "true";
        box.append(
          el("p", "", text),
          yes,
          button("Отмена", () => box.remove()),
        );
        content.querySelector(".clan-confirm")?.remove();
        content.append(box);
      };
      if (p.canTransfer)
        content.append(
          button("Передать главу", () =>
            confirm(`Передать главу игроку ${p.name}? Ты станешь участником.`, "transfer"),
          ),
        );
      if (p.canKick)
        content.append(
          button(
            "Исключить",
            () => confirm(`Исключить ${p.name} из клана?`, "kick"),
            "sf-button sf-danger",
          ),
        );
      dialog.replaceChildren(heading, content, status);
      window.KillexWindows.open(dialog);
    }
    home() {
      const clan = this.data.mine;
      const layout = el("div", "clan-home-grid clan-battle-layout"),
        members = el("section", "clan-panel clan-battle-members");
      members.append(el("h3", "", "Участники"));
      const memberList = el("div", "clan-battle-member-list");
      const standings = this.data.competition?.personal || {};
      for (const p of [...clan.members].sort(
        (a, b) =>
          (standings[a.id]?.place || Number.MAX_SAFE_INTEGER) -
            (standings[b.id]?.place || Number.MAX_SAFE_INTEGER) ||
          (standings[b.id]?.kills || 0) - (standings[a.id]?.kills || 0),
      ))
        memberList.append(this.memberRow(p, clan));
      members.append(memberList);
      const competition = this.data.competition;
      layout.append(members);
      if(competition?.mode==='quests') {
        this.battles.countdown=null;
        layout.append(window.KillexClanDailyQuests.panel(competition),window.KillexClanDailyQuests.ranking(competition,clan,this));
      } else if (competition)
        layout.append(
          this.battles.battle(competition, clan),
          this.battles.leagues(competition, clan),
        );
      this.content.append(layout);
    }
    applications() {
      const clan = this.data.mine,
        panel = el("section", "clan-panel clan-applications");
      panel.append(el("h3", "", "Заявки в клан: " + clan.applications.length));
      const list = el("div", "clan-applications-list");
      if (!clan.applications.length) list.append(el("p", "clan-muted", "Новых заявок пока нет."));
      for (const p of clan.applications) {
        const row = el("div", "clan-application");
        row.dataset.applicant = p.id;
        row.append(
          el("strong", "", window.KillexIdentity.label(p)),
          this.actionButton("Принять", "accept", { clanId: clan.id, memberId: p.id }, "sf-button"),
          this.actionButton("Отклонить", "reject", { clanId: clan.id, memberId: p.id }),
        );
        list.append(row);
      }
      panel.append(
        list,
        button("Назад к клану", () => this.go("home")),
      );
      this.content.append(panel);
    }
    treasury(clan, owner) {
      const panel = el("section", "clan-panel clan-armory"),
        deposits = el("div", "clan-deposit");
      panel.append(
        el("h3", "", `Казна: ${number(clan.treasury || 0)} эфира`),
        el(
          "p",
          "clan-muted",
          "Взносы не возвращаются. Купленные бустеры сохраняются после выхода из клана.",
        ),
      );
      panel.append(
        el(
          "p",
          "clan-deposit-balance",
          `На балансе: ${number(this.data.profile.wallet.bucks)} эфира`,
        ),
      );
      deposits.setAttribute("role", "group");
      deposits.setAttribute("aria-label", "Пополнить казну");
      for (const amount of [1, 5, 10, 50, 100]) {
        const control = button(
          amount + (amount === 1 ? " эфир" : " эфира"),
          () => {
            if (this.busy) return;
            if (this.data.profile.wallet.bucks < amount) {
              this.showDepositToast();
              return;
            }
            this.action("deposit", { clanId: clan.id, amount });
          },
          "sf-button",
        );
        control.dataset.busy = "true";
        control.dataset.deposit = String(amount);
        deposits.append(control);
      }
      panel.append(
        deposits,
        el("h3", "", "Магазин клана"),
        el(
          "p",
          "clan-muted",
          "Глава и управляющий покупают наборы за эфир из казны. По 10 предметов получают все текущие участники, включая тех, кто не в сети.",
        ),
      );
      const grid = el("div", "clan-shop-grid");
      for (const item of this.data.shop || []) {
        const card = el("article", "clan-shop-item"),
          icon = el("img");
        icon.src = window.KillexArtRevision.url(item.icon);
        icon.alt = "";
        icon.width = 64;
        icon.height = 64;
        const buy = this.actionButton(
          owner ? `Купить за ${item.price.amount} эфира` : "Глава или управляющий",
          "buyBooster",
          { clanId: clan.id, boosterId: item.id },
          "sf-button",
        );
        buy.dataset.unavailable = String(!owner || clan.treasury < item.price.amount);
        card.append(icon, el("h4", "", item.name), buy);
        if (item.discount)
          card.append(
            el(
              "small",
              "clan-shop-discount",
              `Скидка кубка ${item.discount}% - обычная цена ${number(item.basePrice)} эфира`,
            ),
          );
        window.KillexBoosterTooltip.attach(card, item);
        grid.append(card);
      }
      panel.append(grid);
      this.content.append(panel);
    }
    showDepositToast() {
      clearTimeout(this.toastTimer);
      this.toast.textContent = "Недостаточно эфира";
      this.toast.classList.remove("is-visible");
      if (this.toast.showPopover) {
        if (!this.toast.matches(":popover-open")) this.toast.showPopover();
      } else {
        this.dialog.append(this.toast);
        this.toast.hidden = false;
      }
      void this.toast.offsetWidth;
      this.toast.classList.add("is-visible");
      this.toastTimer = setTimeout(() => {
        this.toast.classList.remove("is-visible");
        if (this.toast.hidePopover) this.toast.hidePopover();
        else this.toast.hidden = true;
      }, 3000);
    }
  }
  window.KillexClanUI = ClanUI;
})();
