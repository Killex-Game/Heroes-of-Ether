"use strict";
(() => {
  const $ = (id) => document.getElementById(id);
  async function check() {
    window.KillexControls.state($("check"), true, false);
    try {
      const response = await fetch("/api/access", {
        cache: "no-store",
        signal: AbortSignal.timeout(8000),
      });
      if (!response.ok) throw Error();
      const data = await response.json();
      if (!data.blocked) {
        location.replace("/");
        return;
      }
      $("title").textContent = "Аккаунт заблокирован";
      $("banId").textContent = "ID бана: " + data.banId;
      $("banId").hidden = false;
      $("reason").textContent = "Причина: " + data.reason;
      $("moderator").textContent = "Модератор: " + data.moderatorName;
      $("moderator").hidden = false;
      $("until").textContent = data.until
        ? "До " + new Date(data.until).toLocaleString("ru-RU")
        : "Блокировка без срока окончания.";
      $("status").textContent =
        "Доступ к игре восстановится после окончания срока или снятия блокировки.";
    } catch (_) {
      $("status").textContent = "Не удалось связаться с сервером. Попробуй позже.";
    } finally {
      window.KillexControls.state($("check"), false);
    }
  }
  $("check").onclick = check;
  check();
})();
