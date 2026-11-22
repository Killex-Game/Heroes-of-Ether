/* Награды полной коллекции: один показ с сохранением отметки в профиле. */
"use strict";
(() => {
  const el = (tag, cls, text) => {
    const n = document.createElement(tag);
    n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  };
  const dialog = el("dialog", "title-earned-dialog collection-earned-dialog"),
    header = el("header", "clan-heading"),
    heading = el("h2", "", "Коллекция собрана!"),
    close = el("button", "booster-close", "×"),
    prizes = el("div", "collection-earned-prizes"),
    done = el("button", "sf-button sf-primary", "Отлично");
  dialog.id = "collectionEarnedDialog";
  heading.id = "collectionEarnedHeading";
  dialog.setAttribute("aria-labelledby", heading.id);
  close.setAttribute("aria-label", "Закрыть награды коллекции");
  close.type = done.type = "button";
  for (const [file, kind, name] of [
    ["golden-egg", "Регалия", "Золотое яйцо"],
    ["rabbit-ears", "Шапка", "Кроличьи ушки"],
    ["carrot-bow", "Бабочка", "Морковная бабочка"],
  ]) {
    const card = el("div", "collection-earned-prize"),
      art = el("img", "");
    art.src = `assets/events/easter-hunt/${file}.webp?art=20261122b`;
    art.alt = name;
    card.append(art, el("small", "", kind), el("strong", "", name));
    prizes.append(card);
  }
  header.append(heading, close);
  dialog.append(
    header,
    el("p", "title-earned-reward", "Все четыре картины собраны. Награды твои навсегда!"),
    prizes,
    done,
  );
  document.body.append(dialog);
  let profile,
    seen = new Set(),
    request = null,
    busy = false,
    retryAt = 0;
  const key = (id) => window.KillexPlatform.storageKey(".collection-notice.v1.") + id;
  const eligible = (t) => t.collectionVersion === 2;
  function remember(runId) {
    seen.add(runId);
    try {
      localStorage.setItem(key(profile.id), JSON.stringify([...seen]));
    } catch (_) {}
  }
  async function acknowledge() {
    if (!profile || busy || Date.now() < retryAt || document.body.dataset.screen !== "lobby")
      return;
    const next = profile.easter.trophies.find(
      (t) => eligible(t) && t.notifiedAt === undefined && seen.has(t.runId),
    );
    if (!next) return;
    const owner = profile.id;
    request ||= {
      action: "notice",
      runId: next.runId,
      requestId: window.KillexRequestIds.create(),
    };
    busy = true;
    try {
      const response = await fetch("/api/easter/action", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(request),
        signal: AbortSignal.timeout(8000),
      });
      const value = await response.json();
      if (!response.ok) throw Error(value.error);
      if (profile.id === owner) {
        request = null;
        document.dispatchEvent(new CustomEvent("killex:profile", { detail: value.profile }));
      }
    } catch (_) {
      if (profile.id === owner) retryAt = Date.now() + 15000;
    } finally {
      busy = false;
    }
  }
  function render() {
    if (!profile?.easter) return;
    if (document.body.dataset.screen !== "lobby") {
      if (dialog.open) dialog.close();
      return;
    }
    // Дождаться результата сундука; большие страницы под уведомлением остаются открыты.
    const blocked = [...document.querySelectorAll("dialog[open]")].some(
      (n) => !["boosterDialog", "easterDialog", "eventsDialog"].includes(n.id),
    );
    if (!dialog.open && !blocked) {
      const next = profile.easter.trophies.find(
        (t) => eligible(t) && t.notifiedAt === undefined && !seen.has(t.runId),
      );
      if (next) {
        window.KillexUITheme?.inherit(dialog, document.body);
        window.KillexWindows.open(dialog);
        remember(next.runId);
        window.KillexAudio?.play?.("title");
        done.focus();
      }
    }
    acknowledge();
  }
  close.onclick = done.onclick = () => dialog.close();
  document.addEventListener("killex:profile", ({ detail }) => {
    if (
      !detail?.id ||
      !detail.easter ||
      (profile?.id === detail.id && profile.revision > detail.revision)
    )
      return;
    if (profile?.id !== detail.id) {
      if (dialog.open) dialog.close();
      seen = new Set();
      try {
        const stored = JSON.parse(localStorage.getItem(key(detail.id)) || "[]");
        if (Array.isArray(stored))
          seen = new Set(
            stored.filter((id) =>
              detail.easter.trophies.some((t) => eligible(t) && t.runId === id),
            ),
          );
      } catch (_) {}
      request = null;
      retryAt = 0;
    }
    profile = detail;
    for (const t of detail.easter.trophies) if (t.notifiedAt !== undefined) seen.add(t.runId);
    queueMicrotask(render);
  });
  new MutationObserver(render).observe(document.body, {
    subtree: true,
    attributes: true,
    attributeFilter: ["data-screen", "open"],
  });
  window.addEventListener("online", () => {
    retryAt = 0;
    acknowledge();
  });
})();
