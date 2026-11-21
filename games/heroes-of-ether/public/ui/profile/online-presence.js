/* Обновляем присутствие открытого клиента, не записывая его в профиль на диске. */
"use strict";
(() => {
  let ready = false,
    pending = false,
    eventVersion,
    profileRevision, newsRevision, promotionVersion;
  async function heartbeat() {
    if (!ready || pending || document.hidden || document.body.dataset.screen !== 'lobby') return;
    pending = true;
    try {
      const response = await fetch("/api/presence", {
        cache: "no-store",
        signal: AbortSignal.timeout(8000),
      });
      // Дочитываем тело, чтобы браузер завершил запрос до истечения тайм-аута.
      const value = await response.json();
      if(response.ok&&value.newsRevision!==undefined&&value.newsRevision!==newsRevision){newsRevision=value.newsRevision;document.dispatchEvent(new CustomEvent('killex:news-changed',{detail:newsRevision}));}
      if (response.ok && value.menuNotifications)
        document.dispatchEvent(
          new CustomEvent("killex:menu-notifications", { detail: value }),
        );
      if (
        response.ok &&
        ((value.promotionVersion !== undefined && value.promotionVersion !== promotionVersion) ||
          (value.eventVersion !== undefined && value.eventVersion !== eventVersion) ||
          (value.profileRevision !== undefined &&
            value.profileRevision !== profileRevision &&
            document.body.dataset.screen === "lobby"))
      )
        document.dispatchEvent(new CustomEvent("killex:events-changed"));
    } catch (_) {
      // После восстановления сети следующий запрос восстановит индикатор.
    } finally {
      pending = false;
    }
  }
  document.addEventListener("killex:profile", (event) => {
    promotionVersion = event.detail?.profile?.promotionVersion ?? event.detail?.promotionVersion ?? promotionVersion;
    profileRevision = event.detail?.profile?.revision ?? event.detail?.revision ?? profileRevision;
    eventVersion =
      event.detail?.profile?.eventVersion ?? event.detail?.eventVersion ?? eventVersion;
    if (ready) return;
    ready = true;
    heartbeat();
  });
  window.KillexActivity.every(heartbeat, 20000, () => ready && document.body.dataset.screen === 'lobby');
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) heartbeat();
  });
})();
