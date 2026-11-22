/* Шкалы опыта, уведомление о новом уровне и итоги жизни. */
"use strict";
(() => {
  const $ = (id) => document.getElementById(id),
    number = (n) => n.toLocaleString("ru-RU");
  const el = (tag, cls, text) => {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined) node.textContent = text;
    return node;
  };
  let current = null;
  const toast = el("div", "level-toast", "Уровень повышен!");
  toast.id = "levelToast";
  toast.setAttribute("role", "status");
  toast.setAttribute("aria-live", "polite");
  toast.setAttribute("popover", "manual");
  toast.hidden = true;
  document.body.append(toast);
  let toastTimer = null,
    toastVersion = 0;
  function positionLevelToast() {
    if (toast.hidden) return;
    const leaders = document.querySelector(".leaderboard");
    const belowHud = innerWidth <= 760 && document.body.dataset.screen === "arena" && leaders;
    toast.style.top = `${belowHud ? leaders.getBoundingClientRect().bottom + 12 : 18}px`;
  }
  new ResizeObserver(positionLevelToast).observe(document.querySelector(".leaderboard"));
  window.addEventListener("resize", positionLevelToast);
  function hideLevelToast() {
    if (toast.hidePopover && toast.matches(":popover-open")) toast.hidePopover();
    toast.hidden = true;
  }
  function notifyLevel(reward, profile) {
    toast.replaceChildren(el("strong", "", "Уровень повышен!"));
    if (reward?.levels > 0) {
      const line = el("div", "level-reward");
      const rewards = [
        ["coins", reward.coins, "монет"],
        ["crystals", reward.crystals, "кристаллов"],
      ];
      if (profile.roulette?.available && (!profile.event || profile.event.endsAt > Date.now()))
        rewards.push(["tickets", reward.levels, "билет в рулетку"]);
      if (reward.fridayTokens > 0) rewards.push(["fridayTokens", reward.fridayTokens, "жетонов"]);
      for (const [currency, count, label] of rewards) {
        const image = el("img");
        image.src =
          currency === "fridayTokens"
            ? "assets/events/black-friday/token-v2.webp?art=20261122b"
            : currency === "tickets"
            ? "assets/roulette/ticket-v2.webp?art=20261122b"
            : "assets/menu-icons/128/currency_" + currency + ".webp";
        image.alt = label;
        image.setAttribute("aria-label", label);
        line.append(el("b", "", "+" + number(count)), image);
      }
      toast.append(line);
    }
    const version = ++toastVersion;
    clearTimeout(toastTimer);
    // Показываем поверх уже открывшегося итога, без перехвата фокуса и ввода.
    setTimeout(() => {
      if (version !== toastVersion) return;
      toast.hidden = false;
      positionLevelToast();
      if (toast.showPopover && !toast.matches(":popover-open")) toast.showPopover();
      toastTimer = setTimeout(hideLevelToast, 10000);
    }, 0);
  }
  const dialog = el("dialog", "clan-dialog achievements-dialog");
  dialog.id = "achievementsDialog";
  dialog.setAttribute("aria-labelledby", "achievementsTitle");
  const header = el("header", "clan-heading"),
    title = el("h2", "", "Достижения");
  title.id = "achievementsTitle";
  const close = el("button", "booster-close", "×");
  close.type = "button";
  close.setAttribute("aria-label", "Закрыть достижения");
  close.addEventListener("click", () => dialog.close());
  header.append(title, close);
  const status = el("p", "clan-status");
  status.setAttribute("role", "status");
  const achievements = new window.KillexAchievementUI();
  dialog.append(header, achievements.root, status);
  document.body.append(dialog);
  function render(profile) {
    if (!profile?.progress || (current?.id === profile.id && current.revision > profile.revision))
      return;
    if (current?.id === profile.id && profile.level > current.level)
      notifyLevel(profile.progress.lastLife?.levelReward, profile);
    else if (current?.id !== profile.id) {
      toastVersion++;
      clearTimeout(toastTimer);
      hideLevelToast();
    }
    current = profile;
    window.KillexAchievementNoticeUI.update(profile);
    window.KillexEventAnnouncement?.update(profile);
    renderArena(profile);
    const p = profile.progress;
    renderLobby(profile, p);
  }
  // Live counters must update even while the hidden lobby is suspended.
  function renderArena(profile) {
    const p = profile?.progress;
    if (!p) return;
    $("arenaXp").textContent = p.arenaXpMax ? "макс" : number(p.arenaXp || 0);
    $("arenaXp").setAttribute("aria-label", p.arenaXpMax
      ? "Достигнут порог следующего уровня. Чтобы снова получать опыт, выйдите в лобби и нажмите «Играть»."
      : "Опыт будет зачислен при завершении жизни.");
  }
  function renderLobby(profile, p) {
    $("progressLevel").textContent = `Уровень ${number(profile.level)}`;
    $("progressXp").textContent = `${number(p.levelXp)} / ${number(p.nextLevelXp)} опыта`;
    const greatness = window.KillexGreatnessUI.value(number(profile.greatness));
    greatness.querySelectorAll("[title]").forEach((node) => node.removeAttribute("title"));
    $("progressGreatness").replaceChildren(greatness);
    $("profileTitle").textContent = profile.title?.name || "Без титула";
    const badge = window.KillexIdentity.createMedal(profile);
    badge?.removeAttribute("title");
    if (badge) {
      // Normalize visible artwork, not its transparent export canvas.
      const [width, height] = window.KillexProgressionArt.rankBounds(profile.title.id) || [256, 256];
      const degree = Math.max(1, Math.min(10, profile.title.degree || 1));
      const visibleHeight = profile.title.id === "novice" ? 34 : 40 + (degree - 2) * 2;
      const scale = Math.min(visibleHeight / height, 60 / width) * 256 / 60;
      badge.style.setProperty("--lobby-medal-scale", String(scale));
      badge.src = window.KillexProgressionArt.rank(profile.title.id, 256);
    }
    $("profileMedal").replaceChildren(...(badge ? [badge] : []));
    $("xpBar").setAttribute("aria-valuemax", p.nextLevelXp);
    $("xpBar").setAttribute("aria-valuenow", p.levelXp);
    $("xpBar").setAttribute(
      "aria-valuetext",
      `${number(p.levelXp)} из ${number(p.nextLevelXp)} опыта до уровня ${number(profile.level + 1)}`,
    );
    $("xpFill").style.width = `${(p.levelXp / p.nextLevelXp) * 100}%`;
    if (dialog.open) achievements.render(profile);
  }
  document.addEventListener("killex:profile", (event) => render(event.detail));
  document.addEventListener("killex:arena-profile", (event) => renderArena(event.detail));
  $("achievementsButton").addEventListener("click", async () => {
    if (document.body.dataset.screen !== "lobby") return;
    window.KillexWindows.open(dialog);
    if (current) achievements.render(current);
    status.textContent = "";
    try {
      const response = await fetch("/api/profile", {
        cache: "no-store",
        signal: AbortSignal.timeout(8000),
      });
      if (!response.ok) throw Error();
      render((await response.json()).profile);
      status.textContent = "";
    } catch (_) {
      status.textContent = "Не удалось обновить прогресс. Закрой окно и попробуй ещё раз.";
    }
  });
})();
