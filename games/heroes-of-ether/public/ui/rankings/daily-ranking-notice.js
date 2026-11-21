"use strict";
(() => {
  const rules = window.KillexDailyRankings;
  const el = (tag, cls, text) => {
    const node = document.createElement(tag);
    node.className = cls;
    if (text !== undefined) node.textContent = text;
    return node;
  };
  const dialog = el("dialog", "daily-ranking-notice");
  dialog.id = "dailyRankingNotice";
  dialog.setAttribute("aria-labelledby", "dailyRankingNoticeTitle");
  const header = el("header", "clan-heading");
  const title = el("h2", "", "Награды дневного топа");
  title.id = "dailyRankingNoticeTitle";
  const close = el("button", "booster-close", "×");
  close.type = "button";
  close.setAttribute("aria-label", "Закрыть уведомление о наградах топа");
  header.append(title, close);
  const date = el("p", "daily-ranking-notice-date");
  const list = el("div", "daily-ranking-notice-list");
  const note = el(
    "p",
    "daily-ranking-notice-note",
    "Все награды уже зачислены. Регалии добавлены в витрину профиля.",
  );
  const status = el("p", "daily-ranking-notice-error");
  status.setAttribute("role", "alert");
  const done = el("button", "sf-button sf-primary", "Отлично!");
  done.type = "button";
  dialog.append(header, date, list, note, status, done);
  document.body.append(dialog);
  const formatter = new Intl.DateTimeFormat("ru-RU", {
    timeZone: "UTC",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
  let profile = null,
    shown = [],
    rendered = "",
    busy = false,
    request = null,
    scheduled = false;
  function render() {
    scheduled = false;
    if (busy) return;
    const pending = [...(profile?.dailyRankingRewards || [])].sort((a, b) => a.day - b.day);
    const next = pending.filter((n) => n.day === pending[0]?.day);
    const key = `${profile?.id}:${next.map((n) => n.id).join(",")}`;
    if (
      dialog.open &&
      (document.body.dataset.screen !== "lobby" || !next.length || key !== rendered)
    )
      dialog.close();
    if (
      !next.length ||
      document.body.dataset.screen !== "lobby" ||
      (!dialog.open && document.querySelector("dialog[open]"))
    )
      return;
    if (dialog.open && key === rendered) return;
    shown = next;
    rendered = key;
    request = null;
    status.textContent = "";
    date.textContent = "Итоги за " + formatter.format(next[0].day * 86400000);
    list.replaceChildren();
    for (const n of next) {
      const medal = rules.medals.find((m) => m.id === n.medalId);
      const board = rules.boards.find((b) => b.id === medal.board);
      const row = el("article", "daily-ranking-notice-prize");
      row.dataset.rewardId = n.id;
      const icon = el("img", "daily-ranking-notice-medal");
      icon.src = medal.image;
      icon.alt = medal.name;
      icon.width = icon.height = 64;
      const copy = el("div", "daily-ranking-notice-copy");
      copy.append(
        el("strong", "daily-ranking-notice-place", `${medal.place} место`),
        el("h3", "", board.name),
        el("p", "daily-ranking-notice-regalia", "Регалия «" + board.title + "»"),
      );
      const rewards = el("div", "daily-ranking-notice-rewards");
      for (const [amount, label] of [
        [n.prize.coins, "монет"],
        [n.prize.crystals, "кристаллов"],
        [n.prize.greatness, "величия"],
      ])
        rewards.append(el("span", "", `+${amount} ${label}`));
      copy.append(rewards);
      if (n.prize.tickets)
        rewards.append(
          el(
            "span",
            "",
            `+${n.prize.tickets} ${n.prize.tickets === 1 ? "билет" : "билета"} в рулетку`,
          ),
        );
      row.append(icon, copy);
      list.append(row);
    }
    window.KillexUITheme?.inherit(dialog, document.body);
    window.KillexWindows.open(dialog);
    done.focus();
  }
  const schedule = () => {
    if (scheduled) return;
    scheduled = true;
    queueMicrotask(render);
  };
  async function dismiss() {
    if (busy || !shown.length) return;
    busy = true;
    window.KillexControls.state(close, window.KillexControls.state(done, true, false), false);
    status.textContent = "";
    try {
      request ||= { requestId: window.KillexRequestIds.create(), ids: shown.map((n) => n.id) };
      const response = await fetch("/api/profile/daily-ranking-rewards/dismiss", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(request),
        signal: AbortSignal.timeout(8000),
      });
      const value = await response.json();
      if (!response.ok) throw Error(value.error || "Не удалось сохранить прочтение.");
      document.dispatchEvent(new CustomEvent("killex:profile", { detail: value.profile }));
      request = null;
      dialog.close();
    } catch (_) {
      status.textContent =
        "Не удалось сохранить прочтение. Награды уже у тебя. Нажми ещё раз, чтобы повторить.";
    } finally {
      busy = false;
      window.KillexControls.state(close, window.KillexControls.state(done, false));
      schedule();
    }
  }
  close.onclick = done.onclick = dismiss;
  dialog.addEventListener("cancel", (event) => {
    event.preventDefault();
    dismiss();
  });
  document.addEventListener("killex:profile", ({ detail }) => {
    if (!detail?.id || (profile?.id === detail.id && profile.revision > detail.revision)) return;
    profile = detail;
    schedule();
  });
  new MutationObserver(schedule).observe(document.body, {
    subtree: true,
    attributes: true,
    attributeFilter: ["data-screen", "open"],
  });
})();
