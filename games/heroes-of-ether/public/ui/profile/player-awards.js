/* Личная витрина: постоянные кубки, регалии и листание без переноса строк. */
"use strict";
(() => {
  const el = (tag, cls, text) => {
    const node = document.createElement(tag);
    node.className = cls;
    if (text !== undefined) node.textContent = text;
    return node;
  };
  const number = (value) => value.toLocaleString("ru-RU");
  function create(player) {
    const shelf = el("section", "public-player-shelf"),
      track = el("div", "public-shelf-track"),
      previous = el("button", "sf-button sf-tertiary public-shelf-arrow", "‹"),
      next = el("button", "sf-button sf-tertiary public-shelf-arrow", "›"),
      entries = [],
      rules = window.KillexClanRules;
    shelf.setAttribute("aria-label", "Витрина наград");
    shelf.setAttribute("aria-roledescription", "карусель");
    track.id = "publicAwardsTrack";
    for (const [button, name] of [
      [previous, "Предыдущие награды"],
      [next, "Следующие награды"],
    ]) {
      button.type = "button";
      button.setAttribute("aria-label", name);
      button.setAttribute("aria-controls", track.id);
      button.hidden = true;
    }
    const add = (node, at = 0, order = 0, count = 1) => entries.push({ node, at, order, count });
    for (const league of rules.LEAGUES) {
      const history = (player.seasonTrophies || [])
        .filter((cup) => cup.league === league.index)
        .sort((a, b) => b.awardedAt - a.awardedAt || b.number - a.number);
      if (!history.length) continue;
      const item = el("button", "public-trophy personal-season-trophy"),
        img = el("img", ""),
        name = `Кубок сезона: ${league.name}`,
        usage = `Получено: ${number(history.length)}.\n${history.map(rules.trophyLabel).join("\n")}`;
      item.type = "button";
      item.dataset.league = league.id;
      item.setAttribute("aria-label", name + ". " + usage);
      img.src = `assets/season-trophies/128/${league.id}.webp`;
      img.alt = "";
      item.append(img);
      if (history.length > 1) item.append(el("b", "regalia-count", number(history.length)));
      window.KillexBoosterTooltip.attach(item, { name, usage, scrollable: true });
      add(item, history[0].awardedAt, history[0].number);
    }
    const rankingRules = window.KillexDailyRankings;
    for (const earned of player.eventRegalia || []) {
      const item = el("div", "public-trophy"),
        img = el("img", "");
      img.src = earned.image;
      img.alt = earned.name;
      item.append(img);
      item.dataset.regalia = earned.id;
      window.KillexBoosterTooltip.attach(item, {
        name: earned.name,
        usage:
          earned.description + "\nПолучена: " + new Date(earned.awardedAt).toLocaleString("ru-RU"),
      });
      add(item, earned.awardedAt);
    }
    for (const trophy of player.easter?.trophies || []) {
      const item = el("div", "public-trophy"),
        img = el("img", "");
      img.src = "assets/events/easter-hunt/golden-egg.webp";
      img.alt = "Золотое яйцо";
      item.append(img);
      item.dataset.regalia = "golden_egg";
      window.KillexBoosterTooltip.attach(item, {
        name: "Золотое яйцо",
        usage: "Собрана полная пасхальная коллекция. Кроличьи ушки получены навсегда.",
      });
      add(item, trophy.at);
    }
    for (const earned of player.regalia || []) {
      const medal = rankingRules.medals.find((m) => m.id === earned.id);
      if (!medal) continue;
      const item = el("div", "public-trophy daily-regalia"),
        img = el("img", "");
      item.dataset.regalia = medal.id;
      img.src = medal.image;
      img.alt = medal.name;
      item.append(img);
      if (earned.count > 1) item.append(el("span", "regalia-count", "×" + number(earned.count)));
      const usage = medal.description;
      item.setAttribute("aria-label", medal.name + ". " + usage);
      window.KillexBoosterTooltip.attach(item, { name: medal.name, usage });
      add(item, (earned.lastDay + 1) * 86400000 - rules.MSK);
    }
    const giftItem = (info, received, effectUntil = 0) => {
      const item = el("button", "public-trophy public-gift"),
        img = el("img", "");
      item.type = "button";
      img.src = info.icon;
      img.alt = info.name;
      item.append(img);
      const usage =
        info.description +
        (info.stat
          ? effectUntil > Date.now()
            ? `\nЭффект до ${new Date(effectUntil).toLocaleString("ru-RU")}`
            : "\nЭффект завершён"
          : "") +
        (received
          ? `\n${received.anonymous ? "Анонимно" : "От " + received.fromName}, ${new Date(received.at).toLocaleDateString("ru-RU")}`
          : "");
      item.setAttribute("aria-label", info.name + ". " + usage);
      window.KillexBoosterTooltip.attach(item, { name: info.name, usage, scrollable: true });
      return item;
    };
    for (const gift of player.social?.gifts || []) {
      const info = gift.info || window.KillexSocial?.gift(gift.id);
      if (!info || !Number.isSafeInteger(gift.count) || gift.count < 1) continue;
      const history = (gift.history || [])
        .slice(0, gift.count)
        .filter((received) => received.expiresAt > Date.now());
      if (gift.historyMore) {
        const item = giftItem(info, null, gift.effectUntil);
        item.append(el("b", "regalia-count", "×" + number(gift.count)));
        item.setAttribute("aria-label", info.name + ": " + number(gift.count) + ". Открыть историю подарков");
        item.onclick = () => window.KillexGiftHistory.open(player, { ...gift, info });
        add(item, gift.latestAt);
        continue;
      }
      for (const received of history)
        add(() => giftItem(info, received, gift.effectUntil), received.at);
    }
    const titles = player.titleMedals || (player.title ? [player.title] : []);
    for (const earned of titles) {
      const medal = window.KillexIdentity.createMedal({ title: earned });
      if (!medal) continue;
      const item = el("div", "public-trophy title-trophy");
      item.dataset.titleMedal = earned.id;
      medal.removeAttribute("title");
      if (medal.tagName === "IMG") {
        // Visible bounds of the 256px artwork; transparent padding must not
        // make the first medal tiny or break the title size progression.
        const extent =
          {
            novice: 90,
            experienced: 190,
            expert: 197,
            sage: 203,
            master: 209,
            pro: 215,
            prince: 221,
            king: 233,
            emperor: 227,
            boss: 240,
          }[earned.id] || 256;
        const degree = Math.max(1, Math.min(10, earned.degree || 1));
        // The upright novice shield needs less height than the wide winged
        // medals; matching their longest side would make it visually dominant.
        const visibleSize = earned.id === "novice" ? 30 : 56 + ((degree - 1) * 16) / 9;
        medal.src = window.KillexProgressionArt.rank(earned.id, 256);
        medal.style.setProperty("--shelf-medal-scale", String(((visibleSize / 64) * 256) / extent));
      }
      item.append(medal);
      const name = "Медаль за титул «" + earned.name + "»";
      const usage =
        earned.awardedAt !== null && Number.isFinite(earned.awardedAt)
          ? "Получена: " + new Date(earned.awardedAt).toLocaleString("ru-RU")
          : "Получена ранее. Точная дата не сохранена.";
      item.setAttribute("aria-label", name + ". " + usage);
      window.KillexBoosterTooltip.attach(item, { name, usage });
      add(item, earned.awardedAt || 0, earned.degree);
    }
    if (player.clanFrame === "champion") {
      const item = el("div", "public-trophy"),
        img = el("img", "");
      img.src = "assets/clan-roles/head.png";
      img.alt = "";
      item.append(img, el("small", "", "Клан чемпионов"));
      add(item);
    }
    entries.sort((a, b) => b.at - a.at || b.order - a.order);
    let entryIndex = 0,
      copyIndex = 0;
    const hasMore = () => entryIndex < entries.length;
    const appendBatch = () => {
      const fragment = document.createDocumentFragment();
      // Длинную витрину достраиваем при листании, не создавая сразу тысячи кнопок.
      for (let added = 0; added < 40 && hasMore(); added++) {
        const entry = entries[entryIndex];
        fragment.append(typeof entry.node === "function" ? entry.node() : entry.node);
        if (++copyIndex === entry.count) {
          entryIndex++;
          copyIndex = 0;
        }
      }
      track.append(fragment);
    };
    const fillNext = () => {
      if (hasMore() && track.scrollLeft + track.clientWidth * 2 >= track.scrollWidth) appendBatch();
    };
    appendBatch();
    if (!entries.length)
      track.append(el("p", "clan-muted", "Здесь появятся медали, кубки и регалии."));
    shelf.append(previous, track, next);
    const scroll = (direction) => {
      if (direction > 0) fillNext();
      track.scrollBy({
        left: direction * Math.max(80, track.clientWidth * 0.8),
        behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth",
      });
    };
    previous.onclick = () => scroll(-1);
    next.onclick = () => scroll(1);
    const update = () => {
      // Measure against the full shelf so arrows disappear again after widening.
      const overflow = hasMore() || track.scrollWidth > shelf.clientWidth - 24 + 2;
      previous.hidden = next.hidden = !overflow;
      shelf.classList.toggle("has-overflow", overflow);
      window.KillexControls.state(previous, track.scrollLeft <= 2);
      window.KillexControls.state(
        next,
        !hasMore() && track.scrollLeft + track.clientWidth >= track.scrollWidth - 2,
      );
    };
    track.addEventListener(
      "scroll",
      () => {
        fillNext();
        update();
      },
      { passive: true },
    );
    track.addEventListener("keydown", (event) => {
      if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
      const items = [...track.querySelectorAll("button,[tabindex='0']")],
        index = items.indexOf(document.activeElement);
      if (index < 0) return;
      const target =
        event.key === "Home"
          ? 0
          : event.key === "End"
            ? items.length - 1
            : Math.max(
                0,
                Math.min(items.length - 1, index + (event.key === "ArrowRight" ? 1 : -1)),
              );
      event.preventDefault();
      items[target].focus();
      items[target].scrollIntoView({ block: "nearest", inline: "nearest" });
    });
    const observer = new ResizeObserver(update);
    observer.observe(shelf);
    const frame = requestAnimationFrame(update);
    return {
      element: shelf,
      destroy() {
        observer.disconnect();
        cancelAnimationFrame(frame);
      },
    };
  }
  window.KillexPlayerAwards = { create };
})();
