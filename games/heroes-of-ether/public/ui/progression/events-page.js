/* Каталог событий: кольцо вокруг Удачной недели, доступ определяется текущим запуском. */
"use strict";
(() => {
  const el = (tag, className, text) => {
    const node = document.createElement(tag);
    node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };
  const svg = (tag, attributes) => {
    const node = document.createElementNS("http://www.w3.org/2000/svg", tag);
    for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, value);
    return node;
  };
  class EventsPage {
    constructor(owner) {
      this.owner = owner;
      this.easter = new window.KillexEasterPage(owner, () => this.open());
      this.album = new window.KillexEventAlbum(owner, () => this.open());
      this.blackFriday = new window.KillexBlackFriday(owner);
      this.alchemy = new window.KillexAlchemyUI(owner);
      this.profile = owner.getProfile();
      this.page = 0;
      this.trigger = document.getElementById("eventsSection");
      this.dialog = el("dialog", "events-page");
      this.dialog.id = "eventsDialog";
      this.dialog.dataset.layout = "fullscreen";
      this.dialog.dataset.animate = "false";
      this.dialog.setAttribute("aria-labelledby", "eventsTitle");
      const atmosphere = el("div", "events-atmosphere");
      atmosphere.setAttribute("aria-hidden", "true");
      atmosphere.append(el("div", "events-mist"), el("div", "events-orbit"));
      for (let i = 0; i < 24; i++) {
        const spark = el("span", "events-spark");
        spark.style.setProperty("--spark-x", 3 + ((i * 37) % 94) + "%");
        spark.style.setProperty("--spark-y", 9 + ((i * 29) % 85) + "%");
        spark.style.setProperty("--spark-drift", (i % 2 ? 18 : -14) + "px");
        spark.style.setProperty("--spark-period", 9 + (i % 7) + "s");
        spark.style.setProperty("--spark-delay", -i * 1.7 + "s");
        atmosphere.append(spark);
      }
      this.trigger.setAttribute("aria-haspopup", "dialog");
      this.trigger.setAttribute("aria-controls", this.dialog.id);
      const header = el("header", "events-heading"),
        title = el("h1", "", "События"),
        close = el("button", "sf-button sf-tertiary events-close", "В лобби");
      title.id = "eventsTitle";
      close.type = "button";
      close.onclick = () => this.dialog.close();
      const actions = el("div", "events-heading-actions"),
        album = el("button", "sf-button sf-tertiary", "Альбом");
      album.id = "eventAlbumButton";
      album.type = "button";
      album.onclick = () => {
        this.dialog.close();
        this.album.open();
      };
      actions.append(album, close);
      header.append(title, actions);
      this.stage = el("section", "events-stage");
      this.stage.setAttribute("aria-label", "Круг событий");
      this.map = el("div", "events-map");
      this.lines = svg("svg", { class: "events-connections", "aria-hidden": "true" });
      this.map.append(this.lines);
      this.cards = Array.from({ length: 8 }, (_, index) => this.card(index));
      this.map.append(...this.cards);
      this.pages = el("nav", "events-pagination");
      this.pages.setAttribute("aria-label", "Страницы событий");
      this.previous = el("button", "sf-button sf-tertiary", "‹");
      this.next = el("button", "sf-button sf-tertiary", "›");
      this.previous.type = this.next.type = "button";
      this.previous.setAttribute("aria-label", "Предыдущие события");
      this.next.setAttribute("aria-label", "Следующие события");
      this.position = el("span", "events-page-position");
      this.position.setAttribute("aria-live", "polite");
      this.previous.onclick = () => {
        this.page--;
        this.layout();
      };
      this.next.onclick = () => {
        this.page++;
        this.layout();
      };
      this.pages.append(this.previous, this.position, this.next);
      this.pages.hidden = true;
      this.stage.append(this.map, this.pages);
      this.dialog.append(atmosphere, header, this.stage);
      document.body.append(this.dialog);
      this.trigger.onclick = () => this.open();
      this.dialog.addEventListener("close", () => {
        this.syncMotion();
        this.clock?.();
        cancelAnimationFrame(this.frame);
        this.trigger.focus({ preventScroll: true });
      });
      this.resize = new ResizeObserver(() => this.scheduleLayout());
      this.resize.observe(this.stage);
      window.addEventListener("resize", () => this.scheduleLayout());
      document.addEventListener("killex:profile", (event) => {
        this.profile = event.detail;
        if (this.dialog.open) this.update();
      });
      document.addEventListener("visibilitychange", () => {
        this.syncMotion();
        if (!document.hidden && this.dialog.open) {
          this.update();
          this.owner.loadProfile();
        }
      });
    }
    card(index) {
      const card = el("button", "event-card");
      card.type = "button";
      card.dataset.eventIndex = index;
      card.style.setProperty("--event-phase", -index * 0.8 + "s");
      const number = el("span", "event-card-number", String(index === 4 ? 0 : index < 4 ? index + 1 : index).padStart(2, "0")),
        image = el("img", index ? "event-card-lock" : "event-card-banner"),
        title = el(
          "strong",
          "event-card-title",
          index ? "Событие " + (index < 4 ? index + 1 : index) : "Удачная неделя",
        ),
        status = el("span", "event-card-status", index ? "Недоступно" : "Ожидает начала");
      image.alt = "";
      image.draggable = false;
      image.src = index
        ? "assets/ui/svg/identity/access-lock.svg?art=20261122d"
        : "assets/events/lucky-week/card-banner.webp?art=20261122d";
      card.append(number, image, title, status);
      if (index === 2) {
        image.className = "event-card-banner";
        image.src = "assets/events/easter-hunt/card-banner.webp?art=20261122-zaya";
        title.textContent = "Пасхальная охота";
        this.easterStatus = status;
        this.related = el("span", "event-card-related", "Удачная неделя");
        this.related.hidden = true;
        card.append(this.related);
        card.append(el("span", "event-card-action", "Коллекция и награды"));
        card.onclick = () => {
          this.update();
          if (card.disabled) return;
          this.dialog.close();
          this.easter.open();
        };
      } else if (index === 1) {
        image.className = "event-card-banner";
        image.src = "assets/events/black-friday/card-banner.webp?art=20261122d";
        title.textContent = "Чёрная пятница";
        this.blackFridayStatus = status;
        card.append(el("span", "event-card-action", "Лавка Мани"));
        card.onclick = () => {
          this.update();
          if (card.disabled) return;
          this.dialog.close();
          this.blackFriday.open();
        };
      } else if (index === 3) {
        image.className = "event-card-banner"; image.src = "assets/events/ether-alchemy/v1/card-banner.webp?art=20261122d";
        title.textContent = "Эфирная алхимия"; this.alchemyStatus = status;
        card.append(el("span", "event-card-action", "Лаборатория"));
        card.onclick = () => { this.update(); if (!card.disabled) { this.dialog.close(); this.alchemy.open(); } };
      } else if (index === 4) {
        image.className='event-card-banner';image.src='assets/events/clans/quests.webp';
        this.clanSeasonImage=image;this.clanSeasonTitle=title;this.clanSeasonStatus=status;
        card.append(el('span','event-card-action','К клану'));
        card.onclick=()=>{this.dialog.close();document.getElementById('clanSection')?.click();};
      } else if (index) {
        window.KillexControls.state(card, true);
        card.setAttribute("aria-label", "Событие " + (index < 4 ? index + 1 : index) + ": недоступно");
      } else {
        this.status = status;
        this.action = el("span", "event-card-action", "Рулетка, Lite и достижения");
        card.append(this.action);
        card.onclick = () => {
          this.update();
          if (card.disabled) return;
          this.dialog.close();
          document.getElementById("rouletteButton")?.click();
        };
      }
      // Every illustrated event uses the same edge-to-edge banner layout.
      card.classList.toggle("event-card-lucky", image.classList.contains("event-card-banner"));
      return card;
    }
    open() {
      if (!this.owner.isLobby()) return;
      this.page = 0;
      this.update();
      window.KillexWindows.open(this.dialog);
      this.syncMotion();
      this.layout();
      this.owner.loadProfile();
      this.clock?.();
      let ticks = 0;
      this.clock = window.KillexActivity.every(() => {
        if (document.hidden) return;
        this.update();
        if (++ticks % 30 === 0) this.owner.loadProfile();
      }, 1000, () => this.dialog.open);
    }
    syncMotion() {
      this.dialog.dataset.animate = String(this.dialog.open && !document.hidden);
    }
    update() {
      const now = window.KillexAppearance?.now?.() ?? Date.now(),
        event = this.profile?.event,
        available = !!(
          event &&
          event.startsAt <= now &&
          event.endsAt > now &&
          event.features?.roulette &&
          this.profile?.roulette?.available
        );
      const calendar=window.KillexClanCalendar,season=this.profile?.clanCalendar?.find(s=>s.start<=now&&now<s.end)||calendar.season(now),seasonArt='assets/events/clans/'+season.mode+'.webp';
      this.clanSeasonTitle.textContent=season.name;
      if(this.clanSeasonImage.getAttribute('src')!==seasonArt)this.clanSeasonImage.src=seasonArt;
      this.clanSeasonStatus.textContent='До конца: '+calendar.countdown(season.end,now);
      this.cards[4].dataset.available='true';window.KillexControls.state(this.cards[4],false);
      const card = this.cards[0];
      const shopActive = !!(
        this.profile?.blackFriday?.active && this.profile.blackFriday.endsAt > now
      );
      window.KillexControls.state(this.cards[1], !shopActive);
      this.cards[1].dataset.available = String(shopActive);
      this.blackFridayStatus.textContent = shopActive ? "До конца: "+calendar.countdown(this.profile.blackFriday.endsAt,now) : "Ожидает начала";
      const hunt = this.profile?.easter;
      const huntActive = !!(hunt?.active && hunt.endsAt > now);
      const linked =
        (shopActive || huntActive) &&
        available &&
        event.linkedEvents?.some((e) => e.id === "lucky-week");
      this.related.hidden = !linked;
      this.related.title = "Одновременно проходит Удачная неделя: рулетка, Lite и достижения";
      const source = shopActive ? 1 : 2;
      if (this.linked !== !!linked || this.linkSource !== source) {
        this.linked = !!linked;
        this.linkSource = source;
        this.scheduleLayout();
      }
      window.KillexControls.state(this.cards[2], !huntActive);
      this.cards[2].dataset.available = String(huntActive);
      this.easterStatus.textContent = huntActive
        ? "До конца: "+calendar.countdown(hunt.endsAt,now)
        : "Ожидает начала";
      const alchemyActive = !!this.profile?.alchemy?.active && this.profile.alchemy.endsAt > now;
      window.KillexControls.state(this.cards[3], !alchemyActive);
      this.cards[3].dataset.available = String(alchemyActive);
      this.alchemyStatus.textContent = alchemyActive ? "До конца: "+calendar.countdown(this.profile.alchemy.endsAt,now) : "Ожидает начала";
      window.KillexControls.state(card, !available);
      card.dataset.available = String(available);
      if (available) {
        const seconds = Math.max(0, Math.ceil((event.endsAt - now) / 1000)),
          days = Math.floor(seconds / 86400),
          hours = String(Math.floor(seconds / 3600) % 24).padStart(2, "0"),
          minutes = String(Math.floor(seconds / 60) % 60).padStart(2, "0");
        this.status.textContent = "До конца: " + (days ? days + " д " : "") + hours + ":" + minutes;
        this.action.textContent = "К рулетке";
      } else {
        this.status.textContent = "Ожидает начала";
        this.action.textContent = "Рулетка, Lite и достижения";
      }
    }
    scheduleLayout() {
      cancelAnimationFrame(this.frame);
      if (this.dialog.open) this.frame = requestAnimationFrame(() => this.layout());
    }
    layout() {
      if (!this.dialog.open) return;
      const style = getComputedStyle(this.stage),
        width =
          this.stage.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight),
        height =
          this.stage.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom),
        ringWidth = Math.min(250, Math.floor((width - 72) / 3)),
        ringHeight = Math.min(218, Math.floor((height - 32) / 3.5)),
        fullRing = ringWidth >= 190 && ringHeight >= 158,
        pageSize = fullRing ? 6 : 2,
        pageCount = Math.ceil(6 / pageSize),
        gap = 18,
        cardWidth = fullRing ? ringWidth : Math.min(240, Math.floor((width - gap) / 2)),
        cardHeight = fullRing ? ringHeight : Math.min(180, Math.floor((height - 50 - gap) / 2)),
        mapWidth = fullRing ? width : cardWidth * 2 + gap,
        mapHeight = fullRing ? height : cardHeight * 2 + gap;
      this.page = Math.max(0, Math.min(this.page, pageCount - 1));
      this.pages.hidden = fullRing;
      window.KillexControls.state(this.previous, this.page === 0);
      window.KillexControls.state(this.next, this.page === pageCount - 1);
      this.position.textContent = this.page + 1 + " / " + pageCount;
      this.map.dataset.compact = String(cardHeight < 210 || cardWidth < 210);
      this.map.dataset.mini = String(cardHeight < 150);
      this.map.dataset.layout = fullRing ? "ring" : "paged-ring";
      this.map.style.width = mapWidth + "px";
      this.map.style.height = mapHeight + "px";
      const cx = mapWidth / 2,
        cy = mapHeight / 2,
        rx = (mapWidth - cardWidth) / 2,
        ry = (mapHeight - cardHeight) / 2;
      const place = (card, x, y) => {
        card.hidden = false;
        Object.assign(card.style, {
          width: cardWidth + "px",
          height: cardHeight + "px",
          left: x - cardWidth / 2 + "px",
          top: y - cardHeight / 2 + "px",
        });
      };
      // The season is an additional central card, alongside Lucky Week.
      const centerY = fullRing ? cy : cardHeight / 2;
      place(this.cards[0], fullRing ? cx : cardWidth * 1.5 + gap, centerY);
      place(this.cards[4], fullRing ? cx - cardWidth - gap : cardWidth / 2, centerY);
      const outer = [];
      this.cards.slice(1).filter(card => card !== this.cards[4]).forEach((card, index) => {
        const local = index - this.page * pageSize;
        card.hidden = local < 0 || local >= pageSize;
        if (card.hidden) return;
        if (fullRing) {
          const angle = -Math.PI + ((index + 1) * Math.PI * 2) / 7;
          place(card, cx + rx * Math.cos(angle), cy + ry * Math.sin(angle));
        } else {
          place(card, cardWidth / 2 + local * (cardWidth + gap), cardHeight * 1.5 + gap);
        }
        outer.push(card);
      });
      this.drawLines(outer, fullRing ? { cx, cy, rx, ry } : null);
    }
    drawLines(cards, ring) {
      const origin = this.map.getBoundingClientRect();
      this.lines.setAttribute("viewBox", "0 0 " + origin.width + " " + origin.height);
      this.lines.replaceChildren();
      if (ring) {
        for (const cls of ["events-line-base", "events-line-flow"])
          this.lines.append(svg("ellipse", { ...ring, class: cls }));
      }
      if (!this.linked || !cards.includes(this.cards[this.linkSource])) return;
      const from = this.cards[this.linkSource].getBoundingClientRect(),
        to = this.cards[0].getBoundingClientRect();
      // Stop the connection at the card edges, never over its banner or text.
      const edge = (a, b) => {
        const x = a.left + a.width / 2,
          y = a.top + a.height / 2,
          dx = b.left + b.width / 2 - x,
          dy = b.top + b.height / 2 - y,
          ratio = Math.min(a.width / 2 / Math.abs(dx), a.height / 2 / Math.abs(dy));
        return [x + dx * ratio - origin.left, y + dy * ratio - origin.top];
      };
      const a = edge(from, to),
        b = edge(to, from),
        d = "M" + a.join(" ") + " L" + b.join(" ");
      this.lines.append(
        svg("path", { d, class: "events-activity-base" }),
        svg("path", {
          d,
          class: "events-line-flow events-activity-flow",
          "data-from": this.linkSource === 1 ? "black-friday" : "easter-hunt",
          "data-to": "lucky-week",
        }),
      );
    }
  }
  window.KillexEventsPage = EventsPage;
})();
