/* Окно рейтингов игроков и кланов. */
"use strict";
(() => {
  const el = (tag, cls, text) => {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined) node.textContent = text;
    return node;
  };
  const button = (text, action, cls = "sf-tab") => {
    const node = el("button", cls, text);
    node.type = "button";
    node.onclick = action;
    return node;
  };
  const number = (value) => value.toLocaleString("ru-RU");
  class TopsUI {
    constructor(owner) {
      this.owner = owner;
      this.section = "players";
      this.playerOrder = "greatness";
      this.playerPage = 1;
      this.clanOrder = "greatness";
      this.page = 1;
      this.search = "";
      this.playerSearch = "";
      this.dialog = el("dialog", "clan-dialog tops-dialog");
      this.dialog.id = "topsDialog";
      this.dialog.setAttribute("aria-labelledby", "topsTitle");
      const heading = el("header", "clan-heading"),
        title = el("h2", "", "Топы");
      title.id = "topsTitle";
      const close = button("×", () => this.dialog.close(), "booster-close");
      close.setAttribute("aria-label", "Закрыть топы");
      heading.append(title, close);
      this.nav = el("nav", "clan-nav tops-nav");
      this.nav.setAttribute("aria-label", "Разделы топов");
      this.content = el("div", "tops-content");
      this.status = el("p", "clan-status");
      this.status.setAttribute("role", "status");
      this.dialog.append(heading, this.nav, this.content, this.status);
      document.body.append(this.dialog);
      document
        .getElementById("rankingsButton")
        .addEventListener("click", () => this.open("players"));
      document.addEventListener("killex:open-event-top", () => {
        this.playerPage = 1;
        this.open("event");
      });
    }
    query() {
      return new URLSearchParams({
        search: this.search,
        page: this.page,
        players: this.playerOrder,
        playerPage: this.playerPage,
        playerSearch: this.playerSearch,
        clans: this.clanOrder,
      });
    }
    async open(section = "players", loaded = false) {
      if (!this.owner.game.isLobby()) return;
      const fresh = !this.dialog.open;
      const visit = this.visit = (this.visit || 0) + 1;
      if (fresh) {
        this.playerOrder = this.clanOrder = "greatness";
        this.playerPage = this.page = 1;
        this.search = this.playerSearch = "";
        this.owner.invalidate?.();
        this.content.replaceChildren(); this.nav.replaceChildren();
      }
      this.section = section;
      this.status.textContent = "";
      window.KillexWindows.open(this.dialog);
      if (!fresh) this.render();
      if (loaded && !fresh) return;
      this.opening = true;
      this.lock();
      this.status.textContent = "";
      try {
        await this.owner.game.beforeOpen();
        if (!this.dialog.open || visit !== this.visit) return;
        await this.owner.load();
      } catch (error) {
        this.status.textContent = error.message || "Не удалось загрузить топы.";
      } finally {
        this.opening = false;
        this.lock();
      }
    }
    lock() {
      this.dialog.querySelectorAll("[data-busy]").forEach((node) => {
        window.KillexControls.state(
          node,
          this.owner.isBusy() || node.dataset.unavailable === "true",
          node.dataset.unavailable === "true",
        );
      });
    }
    confirmJoin(clan) {
      if (this.joinDialog?.open || this.owner.isBusy()) return;
      const dialog = el("dialog", "social-dialog clan-join-dialog"),
        heading = el("header", "personal-heading"),
        title = el("h2", "", clan.privacy === "open" ? "Вступление в клан" : "Заявка в клан"),
        close = button("×", () => dialog.close(), "booster-close"),
        body = el("div", "clan-join-content"),
        status = el("p", "clan-status"),
        actions = el("div", "social-actions");
      title.id = "clanJoinTitle";
      dialog.setAttribute("aria-labelledby", title.id);
      close.setAttribute("aria-label", "Закрыть подтверждение");
      status.setAttribute("role", "status");
      const cancel = button("Отмена", () => dialog.close(), "sf-button sf-tertiary"),
        confirm = button(
          clan.privacy === "open" ? "Вступить" : "Подать заявку",
          async () => {
            if (pending) return;
            pending = true;
            window.KillexControls.state(
              confirm,
              window.KillexControls.state(
                cancel,
                window.KillexControls.state(close, true, false),
                false,
              ),
              false,
            );
            status.textContent = "";
            try {
              if (await this.owner.action("apply", { clanId: clan.id })) dialog.close();
              else status.textContent = this.owner.actionError?.() || "Не удалось вступить в клан.";
            } finally {
              pending = false;
              window.KillexControls.state(
                confirm,
                window.KillexControls.state(cancel, window.KillexControls.state(close, false)),
              );
            }
          },
          "sf-button",
        );
      let pending = false;
      dialog.addEventListener("cancel", (event) => {
        if (pending) event.preventDefault();
      });
      heading.append(title, close);
      body.append(
        el("strong", "", `[${clan.prefix}] ${clan.name}`),
        el(
          "p",
          "",
          `${clan.privacy === "open" ? "Вступление в клан" : "Заявка на вступление в клан"} стоит ${number(this.owner.getData().rules.applicationCost)} монет.`,
        ),
      );
      actions.append(confirm, cancel);
      body.append(actions, status);
      dialog.append(heading, body);
      this.joinDialog = dialog;
      document.body.append(dialog);
      dialog.addEventListener("close", () => dialog.remove(), { once: true });
      window.KillexWindows.open(dialog);
    }
    render() {
      if (!this.dialog.open) return;
      const data = this.owner.getData();
      if (!data?.playerLeaders || data.page !== this.page ||
        (data.playerSearch || "") !== this.playerSearch ||
        (this.section !== "event" && data.playerPage !== this.playerPage)) return;
      this.page = data.page;
      this.playerPage = this.section === "event" ? data.eventRanking?.page || 1 : data.playerPage;
      if (this.section === "event" && !data.eventRanking) this.section = "players";
      this.nav.replaceChildren();
      for (const [id, label] of [
        ["players", "Топ игроков"],
        ["clans", "Топ кланов"],
        ["event", data.eventRanking?.title || "Топ событий"],
      ]) {
        const control = button(label, () => {
          this.section = id;
          this.render();
        });
        control.setAttribute("aria-pressed", String(this.section === id));
        control.dataset.busy = "true";
        control.dataset.unavailable = String(id === "event" && !data.eventRanking);
        if (id === "event" && !data.eventRanking)
          control.title = "Сейчас нет события с активным топом";
        this.nav.append(control);
      }
      if (this.section === "clans" && !data.mine) {
        const create = button("Создать клан", () => this.owner.create());
        create.dataset.busy = "true";
        this.nav.append(create);
      }
      this.content.replaceChildren();
      if (this.section === "players") this.players(data);
      else if (this.section === "event") this.event(data);
      else this.clans(data);
      const panel = this.content.querySelector(".ranking-board");
      if (panel) {
        const footer = el("footer", "ranking-footer");
        footer.append(
          ...panel.querySelectorAll(
            ":scope > .clan-pager, :scope > .clan-my-rank, :scope > .event-ranking-received",
          ),
        );
        panel.append(footer);
      }
      this.lock();
    }
    tabs(orders, current, change) {
      const nav = el("nav", "clan-nav tops-sort");
      for (const [id, label] of orders) {
        const control = button(label, () => {
          change(id);
          this.owner.load();
        });
        control.setAttribute("aria-pressed", String(id === current));
        control.setAttribute("aria-label", label);
        control.dataset.busy = "true";
        nav.append(control);
      }
      return nav;
    }
    pager(current, pages, label, change) {
      const nav = el("nav", "clan-pager");
      for (const [text, delta, disabled, name] of [
        ["←", -1, current <= 1, "Предыдущая"],
        ["→", 1, current >= pages, "Следующая"],
      ]) {
        const control = button(
          text,
          () => {
            change(current + delta);
            this.owner.load();
          },
          "sf-button sf-tertiary",
        );
        control.setAttribute("aria-label", name + " страница " + label);
        control.dataset.busy = "true";
        control.dataset.unavailable = String(disabled);
        if (delta === 1) nav.append(el("span", "", current + " / " + pages));
        nav.append(control);
      }
      return nav;
    }
    players(data) {
      const panel = el("section", "clan-panel ranking-board");
      const daily = this.playerOrder.startsWith("daily");
      panel.classList.toggle("daily-ranking-board", daily);
      this.dialog.classList.toggle("has-daily-ranking", daily);
      panel.append(
        this.tabs(
          [
            ["greatness", "Величие"],
            ["level", "Уровень"],
            ["dailyKills", "Киллы за день"],
            ["dailyTime", "Время за день"],
            ["dailyGreatness", "Величие за день"],
          ],
          this.playerOrder,
          (id) => {
            this.playerOrder = id;
            this.playerPage = 1;
          },
        ),
      );
      const search = el("form", "clan-search player-ranking-search"), input = el("input");
      input.type = "search"; input.maxLength = 64; input.value = this.playerSearch;
      input.placeholder = "Ник игрока"; input.setAttribute("aria-label", "Поиск игрока по нику");
      const find = el("button", "sf-button sf-tertiary", "Найти");
      find.type = "submit"; find.dataset.busy = input.dataset.busy = "true";
      search.append(input, find);
      search.onsubmit = event => {
        event.preventDefault(); this.playerSearch = input.value.trim().slice(0, 64);
        this.playerPage = 1; this.owner.load();
      };
      if (this.playerSearch) {
        const reset = button("Сбросить", () => { this.playerSearch = ""; this.playerPage = 1; this.owner.load(); }, "sf-button sf-tertiary");
        reset.dataset.busy = "true"; search.append(reset);
      }
      panel.append(search);
      if (daily) {
        const rules = window.KillexDailyRankings;
        const prizes = el("aside", "daily-ranking-prizes");
        prizes.setAttribute("aria-label", "Награды дневного топа");
        for (const [index, prize] of rules.prizes.entries()) {
          const card = el("div", "event-ranking-prize daily-ranking-prize");
          const medal = rules.medals.find(
            (m) => m.board === this.playerOrder && m.place === index + 1,
          );
          const heading = el("strong", "daily-prize-heading");
          const image = el("img");
          image.src = medal.image;
          image.alt = "Регалия «" + medal.name + "»";
          heading.append(image, document.createTextNode(`${index + 1} место`));
          const rewards = el("span", "event-ranking-reward");
          for (const [key, value] of Object.entries({
            coins: prize.coins,
            crystals: prize.crystals,
            greatness: prize.greatness,
            ...(data.dailyPrizeTickets ? { tickets: rules.eventTickets[index] } : {}),
          })) {
            const item = el("span");
            if (key === "greatness") item.append(window.KillexGreatnessUI.value(value));
            else {
              const icon = el("img");
              icon.src =
                key === "tickets"
                  ? "assets/roulette/ticket-v2.webp"
                  : `assets/menu-icons/128/currency_${key}.webp`;
              icon.alt = { coins: "монет", crystals: "кристаллов", tickets: "билетов" }[key];
              item.append(document.createTextNode(number(value) + " "), icon);
            }
            rewards.append(item);
          }
          card.append(heading, rewards);
          prizes.append(card);
        }
        panel.append(prizes);
      }
      const rows = el("div", "ranking-table ranking-players-table");
      if (!data.playerLeaders.length) rows.append(el("p", "clan-muted", "Игроков не найдено."));
      for (const player of data.playerLeaders) {
        const row = el("button", "clan-ranking-player");
        row.type = "button";
        row.dataset.playerId = player.id;
        row.onclick = () => window.KillexPlayerProfile.open(player.id);
        row.setAttribute("aria-label", "Открыть профиль: " + player.name);
        if (player.id === data.profile.id) row.classList.add("clan-ranking-self");
        const name = el("span", "clan-rank-name", window.KillexIdentity.label(player));
        name.classList.toggle("name-premium", !!player.account?.premium);
        name.classList.toggle("name-vip", !player.account?.premium && !!player.account?.vip);
        const score = daily
          ? this.playerOrder === "dailyTime"
            ? window.KillexIdentity.formatDuration(player.dailyScore)
            : number(player.dailyScore)
          : this.playerOrder === "level"
            ? number(player.level)
            : number(player.greatness);
        const scoreNode = el("strong", "ranking-score");
        const rankNode = el("span", "clan-rank", player.rank);
        if (daily && player.rank <= 3 && player.dailyScore > 0) {
          const rules = window.KillexDailyRankings;
          const medal = rules.medals.find(
            (m) => m.board === this.playerOrder && m.place === player.rank,
          );
          row.dataset.podium = player.rank;
          rankNode.classList.add("daily-rank-medal");
          const image = el("img");
          image.src = medal.image;
          image.alt = player.rank + " место";
          rankNode.replaceChildren(image);
          window.KillexBoosterTooltip.attach(rankNode, {
            name: medal.name,
            usage: medal.description,
          });
          rankNode.tabIndex = -1;
        }
        scoreNode.append(
          ["greatness", "dailyGreatness"].includes(this.playerOrder)
            ? window.KillexGreatnessUI.value(score)
            : document.createTextNode(score),
        );
        row.append(rankNode, window.KillexPlayerProfile.avatar(player), name, scoreNode);
        rows.append(row);
      }
      panel.append(
        rows,
        this.pager(this.playerPage, data.playerPages, "игроков", (page) => {
          this.playerPage = page;
        }),
        el(
          "p",
          "clan-my-rank",
          "Твоё место: " + number(data.myRank) + " из " + number(data.playerTotal),
        ),
      );
      this.content.append(panel);
    }
    event(data) {
      this.dialog.classList.remove("has-daily-ranking");
      const board = data.eventRanking;
      if (!board) {
        this.content.append(el("p", "", "Сейчас нет событийного топа."));
        return;
      }
      const panel = el("section", "clan-panel ranking-board event-ranking-board");
      const lucky = board.unit === "билетов";
      const friday = board.unit === "жетонов";
      const deadline = new Date(board.endsAt).toLocaleString("ru-RU", {
        day: "2-digit",
        month: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      });
      panel.append(
        el(
          "p",
          "event-ranking-intro",
          board.settled
            ? `Итоги за ${board.dateLabel}. Призы начислены.`
            : lucky
              ? `Топ за ${board.dateLabel}. Итоги в 00:00 по Москве. Считаются использованные за день билеты.`
              : friday
                ? `Топ за ${board.dateLabel}. Итоги в 00:00 по Москве. Считаются полученные за день жетоны, включая обмены.`
                : `Топ за ${board.dateLabel}. Итоги ${deadline}. Считаются подобранные яйца без множителя.`,
        ),
      );
      const icons = {
        greatness: ["assets/menu-icons/128/nav_achievements.webp", "величия"],
        bucks: ["assets/menu-icons/128/currency_bucks.webp", "эфира"],
        coins: ["assets/menu-icons/128/currency_coins.webp", "монет"],
        crystals: ["assets/menu-icons/128/currency_crystals.webp", "кристаллов"],
        tickets: ["assets/roulette/ticket-v2.webp", "билетов"],
      };
      const rewards = (prize) => {
        const list = el("span", "event-ranking-reward");
        for (const key of ["greatness", "bucks", "tickets", "coins", "crystals"]) {
          if (!prize[key]) continue;
          const item = el("span"),
            icon = el("img");
          icon.src = icons[key][0];
          icon.alt = icons[key][1];
          item.append(document.createTextNode(number(prize[key]) + " "), icon);
          list.append(item);
        }
        return list;
      };
      const prizeList = el("aside", "event-ranking-prizes");
      prizeList.setAttribute("aria-label", "Награды топа событий");
      for (const prize of board.prizes) {
        const card = el("div", "event-ranking-prize");
        const place = el("strong", "event-prize-place");
        place.textContent = `${prize.from}-${prize.to} места`;
        card.append(place, rewards(prize));
        prizeList.append(card);
      }
      panel.append(prizeList);
      const rows = el("div", "ranking-table ranking-players-table");
      for (const player of board.rows) {
        const row = el("button", "clan-ranking-player");
        row.type = "button";
        row.dataset.playerId = player.id;
        row.onclick = () => window.KillexPlayerProfile.open(player.id);
        row.classList.toggle("clan-ranking-self", player.id === data.profile.id);
        const name = el("span", "clan-rank-name", window.KillexIdentity.label(player));
        name.classList.toggle("name-premium", !!player.account?.premium);
        name.classList.toggle("name-vip", !player.account?.premium && !!player.account?.vip);
        row.append(
          el("span", "clan-rank", player.rank),
          window.KillexPlayerProfile.avatar(player),
          name,
          el("strong", "ranking-score", number(player.score)),
        );
        rows.append(row);
      }
      if (!board.rows.length)
        rows.append(
          el(
            "p",
            "",
            lucky
              ? "Используй билет в рулетке и открой Топ счастливчиков."
              : friday
                ? "Получи жетоны в Лавке Мани и открой Топ исполнителей."
                : "Первым найди яйцо и открой топ искателей.",
          ),
        );
      const own = board.mine;
      panel.append(
        rows,
        this.pager(
          board.page,
          board.pages,
          lucky ? "счастливчиков" : friday ? "исполнителей" : "искателей",
          (page) => {
            this.playerPage = page;
          },
        ),
        el(
          "p",
          "clan-my-rank",
          own
            ? `Твоё место: ${own.rank}. ${lucky ? "Использовано билетов" : "Собрано"}: ${number(own.score)}`
            : lucky
              ? "Ты пока не использовал билеты сегодня."
              : friday
                ? "Ты пока не получал жетоны сегодня."
                : "Ты пока не собирал яйца на арене.",
        ),
      );
      if (board.settled && own?.reward) {
        const received = el("p", "event-ranking-received", "Тебе начислено: ");
        received.append(rewards(own.reward));
        panel.append(received);
      }
      this.content.append(panel);
    }
    clans(data) {
      this.dialog.classList.remove("has-daily-ranking");
      const panel = el("section", "clan-panel ranking-board");
      panel.append(
        this.tabs(
          [
            ["greatness", "Величие"],
            ["level", "Уровень"],
            ["treasury", "Казна"],
          ],
          this.clanOrder,
          (id) => {
            this.clanOrder = id;
            this.page = 1;
          },
        ),
      );
      const search = el("form", "clan-search"),
        input = el("input");
      input.type = "search";
      input.value = this.search;
      input.placeholder = "Название или префикс";
      input.setAttribute("aria-label", "Поиск клана");
      const find = el("button", "sf-button sf-tertiary", "Найти");
      find.type = "submit";
      find.dataset.busy = "true";
      search.append(input, find);
      search.onsubmit = (event) => {
        event.preventDefault();
        this.search = input.value;
        this.page = 1;
        this.owner.load();
      };
      panel.append(search);
      if (!data.clans.length) panel.append(el("p", "", "Кланов не найдено."));
      const rows = el("div", "ranking-table ranking-clans-table");
      for (const clan of data.clans) {
        const row = el("article", "clan-ranking-row");
        row.dataset.clanId = clan.id;
        const crest = el("img", "clan-crest");
        window.KillexClanCrests.paintImage(crest, clan.crest, clan.emblem);
        crest.alt = "";
        const name = el("strong", "clan-rank-name", "[" + clan.prefix + "] " + clan.name);
        name.classList.toggle("clan-champion-name", clan.frame === "champion");
        const score = el(
          "strong",
          "ranking-score",
          this.clanOrder === "level"
            ? number(clan.progress.level)
            : number(this.clanOrder === "treasury" ? clan.treasury : clan.greatness),
        );
        if (this.clanOrder === "treasury") {
          const icon = el("img");
          icon.src = "assets/menu-icons/64/currency_bucks.webp";
          icon.alt = "эфира";
          score.append(icon);
        }
        if (this.clanOrder === "greatness")
          score.append(window.KillexGreatnessUI.icon(20, "величия"));
        row.append(el("span", "clan-rank", clan.rank), crest, name, score);
        if (!data.mine) {
          const requested = data.applications.some((item) => item.id === clan.id);
          const action = button(
            requested ? "Отозвать заявку" : clan.privacy === "open" ? "Вступить" : "Подать заявку",
            () =>
              requested ? this.owner.action("cancel", { clanId: clan.id }) : this.confirmJoin(clan),
            "sf-button clan-join",
          );
          const reason =
            clan.count >= clan.capacity
              ? "Все места заняты"
              : data.profile.level < data.rules.minLevel
                ? "Нужен 12 уровень"
                : data.profile.wallet.coins < data.rules.applicationCost
                  ? "Недостаточно монет"
                  : "";
          action.dataset.busy = "true";
          action.dataset.unavailable = String(!requested && !!reason);
          action.title = requested ? "При отмене плата возвращается" : reason;
          row.append(action);
        }
        rows.append(row);
        window.KillexClanPreview.link(row, clan, (id) => this.owner.openClan(id));
      }
      panel.append(
        rows,
        this.pager(this.page, data.pages, "кланов", (page) => {
          this.page = page;
        }),
      );
      this.content.append(panel);
    }
  }
  window.KillexTopsUI = TopsUI;
})();
