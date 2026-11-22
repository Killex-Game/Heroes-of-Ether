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
      img.src = `assets/season-trophies/128/${league.id}.webp?art=20261122b`;
      img.alt = "";
      item.append(img);
      if (history.length > 1) item.append(el("b", "regalia-count", number(history.length)));
      window.KillexBoosterTooltip.attach(item, { name, usage, scrollable: true });
      add(item, history[0].awardedAt, history[0].number);
    }
    for (const medal of player.clanQuestMedals || []) {
      const prize=window.KillexClanCalendar.questPrize(medal.place);if(!prize)continue;
      const item=el('div','public-trophy'),img=el('img','');img.src=window.KillexProgressionArt.leagueMedal(medal.tier,128);img.alt=prize.name+' медаль';item.append(img);item.dataset.questSeason=medal.seasonId;
      window.KillexBoosterTooltip.attach(item,{name:prize.name+' медаль за клановые задания',usage:'Место '+medal.place+'. Выполнено заданий: '+medal.completed+'. Получена '+new Date(medal.awardedAt).toLocaleDateString('ru-RU')});add(item,medal.awardedAt,medal.number);
    }
    const rankingRules = window.KillexDailyRankings;
    for (const earned of player.eventRegalia || []) {
      const item = el("div", "public-trophy"),
        img = el("img", "");
      img.src = window.KillexArtRevision.url(earned.image);
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
      img.src = "assets/events/easter-hunt/golden-egg.webp?art=20261122b";
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
      img.src = window.KillexArtRevision.url(medal.image);
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
      img.src = window.KillexArtRevision.url(info.icon);
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
        // The DTO is compact, but every received gift has its own shelf slot.
        // Details outside the DTO remain available through bounded history pages.
        add((index) => {
          const item = giftItem(info, history[index], gift.effectUntil);
          item.onclick = () => window.KillexGiftHistory.open(player, { ...gift, info });
          return item;
        }, gift.latestAt, 0, gift.count);
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
        // Measured opaque bounds of the current 256px rank artwork. Use the
        // visible height: the novice shield is upright, later medals are wide.
        const [width, height] = window.KillexProgressionArt.rankBounds(earned.id) || [256, 256];
        const degree = Math.max(1, Math.min(10, earned.degree || 1));
        const visibleHeight = earned.id === "novice" ? 28 : 28 + (degree - 1) * 4;
        const scale = Math.min(visibleHeight / height, 72 / width) * 4;
        medal.src = window.KillexProgressionArt.rank(earned.id, 256);
        medal.style.setProperty("--shelf-medal-scale", String(scale));
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
      img.src = "assets/clan-roles/head.png?art=20261122b";
      img.alt = "";
      item.append(img, el("small", "", "Клан чемпионов"));
      add(item);
    }
    entries.sort((a, b) => b.at - a.at || b.order - a.order);
    let total = 0;
    for (const entry of entries) {
      entry.start = total;
      total += entry.count;
    }
    // A stable full-width rail keeps native scrolling independent of mounted items.
    // Updating the visible window must never shrink or replace the scroll container.
    track.dataset.total = String(total);
    track.style.overflowAnchor = "none";
    track.style.scrollSnapType = "none";
    const content = el("div", "public-shelf-content");
    track.append(content);
    let step = 80, gap = 4, first = -1, end = -1;
    const mounted = new Map();
    const renderWindow = (focusIndex = null, force = false) => {
      if (!total) return;
      content.style.width = Math.max(0, total * step - gap) + "px";
      const visible = Math.max(1, Math.ceil(track.clientWidth / step));
      const start = total <= 40 ? 0 : Math.max(0, Math.min(total - 1,
        focusIndex ?? Math.floor(track.scrollLeft / step)) - 10);
      const stop = Math.min(total, start + Math.max(40, visible + 20));
      if (!force && start === first && stop === end) return;
      first = start; end = stop;
      for (const [index,node] of mounted) if (index < start || index >= stop) { node.remove(); mounted.delete(index); }
      let entryIndex = 0;
      while (entries[entryIndex].start + entries[entryIndex].count <= start) entryIndex++;
      for (let index = start; index < stop; index++) {
        while (index >= entries[entryIndex].start + entries[entryIndex].count) entryIndex++;
        const entry = entries[entryIndex];
        let node = mounted.get(index);
        if (!node) {
          node = typeof entry.node === "function" ? entry.node(index - entry.start) : entry.node;
          node.dataset.awardIndex = String(index);
          mounted.set(index, node);
          const successor = Array.from(content.children).find(child => Number(child.dataset.awardIndex) > index);
          content.insertBefore(node, successor || null);
        }
        node.style.left = index * step + "px";
      }
    };
    renderWindow();
    if (!entries.length)
      track.append(el("p", "clan-muted", "Здесь появятся медали, кубки и регалии."));
    shelf.append(previous, track, next);
    const scroll = (direction) => {
      track.scrollBy({
        left: direction * Math.max(80, track.clientWidth * 0.8),
        behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth",
      });
    };
    previous.onclick = () => scroll(-1);
    next.onclick = () => scroll(1);
    const update = () => {
      const sample = track.querySelector(".public-trophy");
      const width = sample?.getBoundingClientRect().width;
      const measuredGap = parseFloat(getComputedStyle(track).columnGap) || 0;
      if (width && (step !== width + measuredGap || gap !== measuredGap)) {
        step = width + measuredGap; gap = measuredGap;
        renderWindow(null, true);
      } else renderWindow();
      // Measure against the full shelf so arrows disappear again after widening.
      const overflow = track.scrollWidth > shelf.clientWidth - 24 + 2;
      previous.hidden = next.hidden = !overflow;
      shelf.classList.toggle("has-overflow", overflow);
      window.KillexControls.state(previous, track.scrollLeft <= 2);
      window.KillexControls.state(
        next,
        track.scrollLeft + track.clientWidth >= track.scrollWidth - 2,
      );
    };
    track.addEventListener(
      "scroll",
      () => {
        update();
      },
      { passive: true },
    );
    track.addEventListener("keydown", (event) => {
      if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
      const active = document.activeElement;
      if (!track.contains(active) || !active.matches("button,[tabindex='0']")) return;
      const index = Number(active.dataset.awardIndex);
      if (!Number.isInteger(index)) return;
      const target =
        event.key === "Home"
          ? 0
          : event.key === "End"
            ? total - 1
            : Math.max(
                0,
                Math.min(total - 1, index + (event.key === "ArrowRight" ? 1 : -1)),
              );
      event.preventDefault();
      if (!mounted.has(target)) {
        track.scrollLeft = target * step;
        renderWindow(target);
      }
      const item = mounted.get(target);
      if (!item.matches("button,[tabindex='0']")) item.tabIndex = 0;
      item.focus({ preventScroll: true });
      item.scrollIntoView({ block: "nearest", inline: "nearest" });
    });
    const observer = new ResizeObserver(update);
    observer.observe(shelf);
    const frame = requestAnimationFrame(update);
    return {
      element: shelf,
      position() {
        const active = document.activeElement;
        return { left: track.scrollLeft,
          focus: active === previous ? "previous" : active === next ? "next" :
            track.contains(active) ? active.dataset.awardIndex : null };
      },
      restore(position) {
        update();
        track.scrollLeft = position.left;
        update();
        const focus = position.focus === "previous" ? previous :
          position.focus === "next" ? next : mounted.get(Number(position.focus));
        if (position.focus != null && focus) focus.focus({ preventScroll: true });
      },
      destroy() {
        observer.disconnect();
        cancelAnimationFrame(frame);
      },
    };
  }
  window.KillexPlayerAwards = { create };
})();
