/* Startup gate: server profile + runtime + decoded lobby assets, never a fake timer. */
(() => {
  "use strict";
  const root = document.getElementById("gameLoading"), status = document.getElementById("gameLoadingStatus"),
    progress = document.getElementById("gameLoadingProgress"), retry = document.getElementById("gameLoadingRetry");
  const deferred = new Map();
  let active = true, runtime = false, loaded = false, profile = false, portraits = false,
    fatal = false, failed = false, checking = false, portraitVersion = 0, reloadProfile;
  root.removeAttribute("open");
  root.showModal();
  root.addEventListener("cancel", e => e.preventDefault());
  function fail(message, mustReload = false) {
    if (!active) return;
    fatal ||= mustReload;
    failed = true;
    status.textContent = message;
    retry.hidden = false;
    if(mustReload){window.KillexStartupFailure=true;document.dispatchEvent(new CustomEvent('killex:startup-failed'));}
  }
  function update() {
    progress.value = Number(runtime) + Number(profile) + Number(loaded && portraits);
    [...root.querySelectorAll(".boot-steps span")].forEach((node, i) => node.classList.toggle("is-ready", [runtime, profile, loaded && portraits][i]));
    if (!failed) status.textContent = !profile ? "Знакомимся с твоим героем…" : "Готовим мир к твоему появлению…";
  }
  async function complete() {
    update();
    if (!active || checking || fatal || window.KillexMaintenance?.blocked || !runtime || !profile || !loaded || !portraits) return;
    checking = true;
    const version = portraitVersion;
    try {
      await document.fonts.ready;
      const sheets = [...document.querySelectorAll('link[rel="stylesheet"]')];
      if (sheets.some(link => !link.sheet)) throw Error("stylesheet");
      // Hidden catalogues and audio are intentionally loaded on demand.
      const visible = [...document.querySelectorAll('#lobby img[src]')].filter(img => img.getClientRects().length && !img.hidden && getComputedStyle(img).display !== "none");
      await Promise.all(visible.map(img => img.decode()));
      if (!active || fatal || window.KillexMaintenance?.blocked || version !== portraitVersion || !portraits) return;
      active = false;
      clearTimeout(watchdog);
      document.documentElement.classList.remove("game-booting");
      root.close();
      root.remove();
      document.dispatchEvent(new CustomEvent("killex:boot-ready"));
      for (const open of deferred.values()) open();
      deferred.clear();
    } catch (_) {
      fail("Не удалось загрузить оформление игры. Попробуй ещё раз.", true);
    } finally {
      checking = false;
      if (active && !fatal && version !== portraitVersion) complete();
    }
  }
  retry.onclick = () => {
    if (fatal || !reloadProfile || !runtime || !loaded) { location.reload(); return; }
    failed = false; retry.hidden = true; update(); reloadProfile();
  };
  window.addEventListener("error", e => {
    if (!active) return;
    if (e.target instanceof HTMLScriptElement || e.target instanceof HTMLLinkElement || e instanceof ErrorEvent)
      fail("Не удалось запустить игру. Попробуй загрузить её снова.", true);
  }, true);
  window.addEventListener("load", () => { loaded = true; complete(); }, { once: true });
  const watchdog = setTimeout(() => {
    if (active) fail("Загрузка занимает больше времени. Проверь соединение или попробуй снова.");
  }, 20000);
  window.KillexBoot = Object.freeze({
    get active() { return active; },
    defer(dialog, open) { deferred.set(dialog, open); },
    runtimeReady() { runtime = true; complete(); },
    setRetry(action) { reloadProfile = action; },
    profileReady(value) {
      if (!active) return;
      if (!value?.id || !value.wallet || !Number.isFinite(value.revision)) { fail("Не удалось получить данные героя."); return; }
      profile = true; if (!fatal) { failed = false; retry.hidden = true; } complete();
    },
    profileFailed() { if (!profile) fail("Не удалось получить данные героя. Проверь соединение и попробуй снова."); },
    portraits(promise) {
      if (!active) return;
      const version = ++portraitVersion;
      portraits = false;
      promise.then(results => {
        if (!active || version !== portraitVersion) return;
        portraits = results.every(Boolean);
        if (!portraits) fail("Не удалось загрузить портрет героя. Попробуй ещё раз.", true);
        else complete();
      }, () => fail("Не удалось загрузить портрет героя. Попробуй ещё раз.", true));
    },
  });
})();
