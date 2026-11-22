/* Главный браузерный контроллер: лобби, WebSocket, ввод и цикл рисования арены. */

(() => {
  "use strict";

  const SKINS = window.KillexIdentity.allSkins;
  const skinImages = new Map();
  const skinButtons = new Map();
  const STORAGE_KEY = window.KillexPlatform.storageKey(".preferences.v1");
  const CONNECT_TIMEOUT_MS = 10000;
  const STATE_TIMEOUT_MS = 10000;
  // Do not fill a stalled mobile uplink with obsolete controls. TCP can deliver
  // several seconds of queued input at once and trip the server's flood limit.
  const INPUT_FRESHNESS_MS = 750;
  const TRANSIENT_INPUT = new Set(["move", "stop", "viewport", "split", "feed", "emote"]);
  const $ = (id) => document.getElementById(id);
  const ui = {
    lobby: $("lobby"),
    arena: $("arena"),
    canvas: $("game"),
    form: $("joinForm"),
    previewName: $("previewName"),
    play: $("playButton"),
    cancel: $("cancelJoin"),
    lobbyStatus: $("lobbyStatus"),
    leave: $("leaveButton"),
    online: $("onlineCount"),
    mass: $("mass"),
    massPanel: $("massPanel"),
    leaders: $("leaderList"),
    legacy: $("legacyNote"),
    settingsArea: $("settingsArea"),
    settings: $("settingsMenu"),
    gear: $("settingsButton"),
    closeSettings: $("closeSettings"),
    massToggle: $("massToggle"),
    fullscreen: $("fullscreenToggle"),
    fullscreenHelp: $("fullscreenHelp"),
    feedback: $("settingsFeedback"),
    joystick: $("joystick"),
    stick: $("stick"),
  };
  // The arena paints its entire background; it needs no transparent compositor layer.
  const ctx = ui.canvas.getContext("2d", { alpha: false });
  const bodyArt = new window.KillexBodyArt.Renderer();
  let preferences = {
    showMass: true,
    music: true,
    sound: true,
    musicVolume: 100,
    soundVolume: 100,
    previewSkin: "moon-dragon",
  };
  let storageAvailable = true;
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
    if (saved && typeof saved === "object") {
      if (typeof saved.showMass === "boolean") preferences.showMass = saved.showMass;
      for (const key of ["music", "sound"]) {
        const value = saved[key + "Volume"];
        preferences[key + "Volume"] = typeof value === "number" && Number.isFinite(value)
          ? Math.max(0, Math.min(100, Math.round(value))) : saved[key] === false ? 0 : 100;
        preferences[key] = preferences[key + "Volume"] > 0;
      }
      if (SKINS.some((s) => s.id === saved.previewSkin))
        preferences.previewSkin = saved.previewSkin;
    }
  } catch (_) {
    storageAvailable = false;
  }

  // Лобби не открывает WebSocket. Он создаётся только в joinArena().
  const gameAudio = new window.KillexAudio.Player({
    enabled: preferences.sound,
    volume: preferences.soundVolume / 100,
  });
  window.KillexAudio.play = (id, gain, rate) => gameAudio.play(id, gain, rate);
  window.KillexAudio.stopTrack = id => gameAudio.stopTrack(id);
  const lobbyMusic = new window.KillexAudio.LobbyMusic({
    enabled: preferences.music,
    volume: preferences.musicVolume / 100,
  });
  const arenaAudio = new window.KillexAudio.ArenaEvents((id, gain) => gameAudio.play(id, gain));
  let phase = "lobby";
  let lifeResult = null,
    lifeClock = null;
  let leaveRequestedSerial = null,
    leaveTimer = null;
  let socket = null;
  let closingSocket = null;
  let connectTimer = null;
  let inputTimer = null;
  let frameId = null;
  let lastFrameAt = 0;
  let lastStateAt = 0;
  let deferredStop = false;
  let myId = null;
  let world = { width: 6120, height: 4080 };
  let players = [];
  let roomPlayerCount = 0;
  let ether = [];
  let hazards = [];
  const foodById = new Map();
  let aimPointer = null;
  const projectileView = new window.KillexProjectiles.Renderer();
  const foodView = new window.KillexArenaArt.FoodRenderer();
  const effectsView = new window.KillexEffects.Renderer();
  const backgroundView = new window.KillexArenaBackgrounds.Renderer();
  const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
  let smoothPlayers = new Map();
  const smoothParts = new Map();
  const bodyMotion = new window.KillexArenaMotion.Motion();
  let splitSequence = 0;
  let feedSequence = 0,
    feedHeld = false,
    touchFeedHeld = false,
    nextFeedAt = 0;
  const touchControls = new window.KillexTouchControls({
    root: $("arenaTouchControls"),
    split,
    feed,
    setFeeding: (held) => { touchFeedHeld = held; },
  });
  function bodyKey(player, part) {
    return player.id + ":" + part.id;
  }
  let bodyList = [];
  function visibleBodies() {
    return bodyList;
  }
  function rebuildBodies() {
    bodyList = players.flatMap((player) =>
      (player.parts || [player]).map((part) => ({
        player,
        part,
        key: bodyKey(player, part),
      })),
    );
  }
  let width = innerWidth;
  let height = innerHeight;
  let pixelRatio = 1;
  let camera = { x: 1200, y: 800, scale: 1 };
  let input = { kind: "none", x: 0, y: 0 };
  let touchId = null;
  let stickId = null;
  let stickVector = { x: 0, y: 0 };
  let closingMessage = "";
  let closingError = false;
  let fullscreenBusy = false;
  let fullscreenWasActive = !!document.fullscreenElement,
    lastFullscreenExitAt = -Infinity;
  let lastHudAt = 0;
  let boosterUI = null,
    petsUI = null,
    accessoryAbilityUI = null;
  let arenaChat = null;
  let arenaPicker = null;
  let cosmeticsUI = null;
  let joinGeneration = 0;
  let preparingJoin = false;
  const transition = window.KillexArenaTransition;
  let transitionToken;
  let serverUnavailable = false;
  let recoveryTimer = null;
  let recoveryRequest = null;
  let recoveryDelay = 3000;
  const arenaPortraits = new window.KillexArenaPortraits.Portraits(window.KillexIdentity);
  const accessoryView = new window.KillexAccessoryView.Renderer();
  const emoteView = new window.KillexEmoteView.Renderer();
  let lastEmoteAt = -Infinity;
  const shieldView = new window.KillexShields.Renderer();

  function cleanName(value) {
    return String(value)
      .replace(/[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/g, "")
      .trim()
      .slice(0, 16);
  }
  function persistPreferences() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(preferences));
      storageAvailable = true;
    } catch (_) {
      storageAvailable = false;
    }
  }
  const massFormatter = new Intl.NumberFormat("ru-RU");
  function formatMass(value) {
    return Number.isFinite(value) ? massFormatter.format(Math.floor(value)) : "-";
  }
  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }
  function getMe() {
    return players.find((p) => p.id === myId);
  }
  function setLobbyStatus(text, error = false) {
    if (serverUnavailable && phase === "lobby") {
      text = "Нет связи с ареной.";
      error = true;
    }
    ui.lobbyStatus.textContent = text;
    ui.lobbyStatus.dataset.kind = error ? "error" : "info";
  }
  function refreshJoinControls() {
    lobbyMusic.setActive(phase === "lobby");
    window.KillexControls.state(
      ui.play,
      window.KillexMaintenance?.blocked ||
        serverUnavailable ||
        preparingJoin ||
        phase !== "lobby" ||
        !ctx ||
        window.KillexBoot?.active ||
        !("WebSocket" in window) ||
        !boosterUI?.ready,
      window.KillexMaintenance?.blocked ||
        phase !== "lobby" ||
        !ctx ||
        window.KillexBoot?.active ||
        !("WebSocket" in window) ||
        !boosterUI?.ready,
    );
    ui.play.classList.toggle("connection-pending", serverUnavailable);
    window.KillexControls.state(
      $("arenaPickerButton"),
      ui.play.disabled,
      ui.play.disabled && !ui.play.hasAttribute("data-pending"),
    );
    ui.play.setAttribute("aria-busy", String(serverUnavailable));
    ui.play.textContent = "Играть";
    ui.play.setAttribute(
      "aria-label",
      serverUnavailable ? "Играть - ожидаем восстановления связи" : ui.play.textContent,
    );
    ui.cancel.hidden = phase !== "connecting";
    ui.form.setAttribute(
      "aria-busy",
      String(serverUnavailable || phase === "connecting" || phase === "leaving"),
    );
  }
  function waitForServer() {
    if (!["http:", "https:"].includes(location.protocol)) return;
    serverUnavailable = true;
    refreshJoinControls();
    if (phase === "lobby") setLobbyStatus("");
    if (!recoveryRequest && !recoveryTimer) checkServerAvailability();
  }
  async function checkServerAvailability() {
    if (!serverUnavailable || recoveryRequest) return;
    clearTimeout(recoveryTimer);
    recoveryTimer = null;
    const request = new AbortController();
    recoveryRequest = request;
    const timeout = setTimeout(() => request.abort(), 3000);
    try {
      // Проверка не создаёт профиль, игровую жизнь или новое соединение арены.
      const response = await fetch("/api/arena/availability", {
        cache: "no-store",
        signal: request.signal,
      });
      const status = await response.json();
      if (status.code === "ACCOUNT_BANNED") {
        location.assign("/blocked.html");
        return;
      }
      if (status.closed === true) {
        serverUnavailable = false;
        leaveArena(status.message, true);
        arenaPicker?.showClosed(status.message);
        refreshJoinControls();
        return;
      }
      if (!response.ok || status.ready !== true) throw Error("Arena unavailable");
      if (phase === "lobby" && !boosterUI?.ready) {
        await boosterUI?.load(true);
        if (!boosterUI?.ready) throw Error("Profile unavailable");
      }
      if (request.signal.aborted) throw Error("Readiness check expired");
      serverUnavailable = false;
      recoveryDelay = 3000;
      refreshJoinControls();
      if (phase === "lobby") {
        setLobbyStatus("Связь восстановлена. Можно нажать «Играть».");
        boosterUI?.load(true);
      }
    } catch (_) {
      // Один запрос за раз; при длительном сбое снижаем частоту до раза в 15 секунд.
      recoveryTimer = setTimeout(checkServerAvailability, recoveryDelay);
      recoveryDelay = Math.min(15000, recoveryDelay * 2);
    } finally {
      clearTimeout(timeout);
      recoveryRequest = null;
    }
  }
  function showLobbyScreen() {
    document.body.dataset.screen = "lobby";
    document.title = "Герои Эфира - лобби";
    ui.arena.hidden = true;
    ui.lobby.hidden = false;
    ui.legacy.hidden = true;
    applyMassPreference();
    boosterUI?.refreshLobby();
  }
  function updateLifeClock(now = performance.now()) {
    const seconds = lifeResult
      ? lifeResult.durationSeconds
      : lifeClock
        ? (lifeClock.elapsedMs +
            Math.min(STATE_TIMEOUT_MS, Math.max(0, now - lifeClock.receivedAt))) /
          1000
        : 0;
    const formatted = window.KillexIdentity.formatDuration(seconds);
    if ($("lifeTime").textContent !== formatted) $("lifeTime").textContent = formatted;
  }
  let lifeLobbyTimer = null, lifeLobbyDeadline = 0, lifeLobbyId = null;
  function autoLifeLobby() {
    if (lifeResult?.id === lifeLobbyId && lifeLobbyDeadline && Date.now() >= lifeLobbyDeadline)
      leaveArena("Ты в лобби. Опыт завершённой жизни сохранён.");
  }
  document.addEventListener("visibilitychange", autoLifeLobby);
  function showLifeResult(message) {
    if (
      !message.result ||
      !Number.isSafeInteger(message.result.earnedXp) ||
      !Number.isSafeInteger(message.result.durationSeconds)
    )
      return;
    if (message.profile) boosterUI?.updateProfile(message.profile);
    clearLeaveConfirmation();
    lifeResult = message.result;
    if (lifeLobbyId !== lifeResult.id) {
      clearTimeout(lifeLobbyTimer);
      lifeLobbyId = lifeResult.id;
      lifeLobbyDeadline = Date.now() + 120000;
      lifeLobbyTimer = setTimeout(autoLifeLobby, 120000);
    }
    arenaAudio.lifeEnded(lifeResult);
    resetInput(true);
    boosterUI?.respawn();
    setSettingsOpen(false, false);
    const p = message.profile || boosterUI?.profile,
      progress = p?.progress;
    const voluntary = lifeResult.reason === "left";
    $("lifeResultTitle").textContent = voluntary ? "Выход с арены" : "Вас съели";
    $("lifeKiller").hidden = voluntary;
    $("lifeKiller").textContent = voluntary
      ? ""
      : lifeResult.reason === "burned"
        ? "Вас сожгли"
        : `Тебя поглотил ${window.KillexIdentity.label(lifeResult.killer || { name: "Соперник" })}`;
    if (!voluntary && lifeResult.killer?.id) {
      const link = document.createElement("button");
      link.type = "button";
      link.className = "sf-button sf-secondary life-killer-profile";
      link.textContent = "Профиль соперника";
      const killerId = lifeResult.killer.id;
      link.onclick = () => window.KillexPlayerProfile.open(killerId);
      $("lifeKiller").append(" ", link);
    }
    $("lifeDuration").textContent = window.KillexIdentity.formatDuration(
      lifeResult.durationSeconds,
    );
    $("lifeEarned").textContent = `+${lifeResult.earnedXp.toLocaleString("ru-RU")}`;
    $("lifeKills").textContent = formatMass(lifeResult.kills || 0);
    const collected = lifeResult.eventItems || [];
    $("lifeEventItems").hidden = !collected.length;
    $("lifeEventCounts").replaceChildren(
      ...collected.map((item) => {
        const row = document.createElement("span"),
          icon = document.createElement("img"),
          amount = document.createElement("b");
        icon.src = item.image;
        icon.alt = item.name;
        amount.textContent = item.count.toLocaleString("ru-RU");
        row.title = item.name + ": " + amount.textContent;
        row.append(icon, amount);
        return row;
      }),
    );
    $("lifeLevel").textContent = `Уровень ${p?.level || 1}`;
    // В итогах показываем достигнутый лимит арены, а не пустую шкалу нового уровня.
    // Лобби продолжает показывать реальный прогресс к следующему уровню.
    const xpLimitReached = progress?.arenaXpMax === true;
    const displayedXp = xpLimitReached ? 100 : progress?.levelXp || 0;
    const displayedXpMax = xpLimitReached ? 100 : progress?.nextLevelXp || 500;
    const xpLabel = xpLimitReached
      ? "Лимит опыта достигнут"
      : `${displayedXp} / ${displayedXpMax} опыта`;
    $("lifeXp").textContent = xpLabel;
    $("lifeXpBar").setAttribute("aria-valuenow", displayedXp);
    $("lifeXpBar").setAttribute("aria-valuemax", displayedXpMax);
    $("lifeXpBar").setAttribute("aria-valuetext", xpLabel);
    $("lifeXpFill").style.width = `${(displayedXp / displayedXpMax) * 100}%`;
    $("lifeTotalXp").textContent =
      `Общий опыт: ${(progress?.totalXp || 0).toLocaleString("ru-RU")}`;
    $("lifeResultStatus").textContent = "";
    updateLifeClock();
    if (!$("lifeResultDialog").open) {
      window.KillexWindows.open($("lifeResultDialog"));
      $("lifeResultTitle").focus({ preventScroll: true });
      $("lifeResultDialog").scrollTop = 0;
    }
  }
  $("lifeResultDialog").addEventListener("cancel", (event) => event.preventDefault());
  $("connectionLostDialog").addEventListener("cancel", (event) => event.preventDefault());
  $("connectionLostLobby").addEventListener("click", () =>
    leaveArena("Ты в лобби. Можно снова нажать «Играть»."),
  );
  function showConnectionLost(message) {
    transition?.finish();
    arenaPicker?.cancelPending();
    if (phase === "disconnected" || phase === "leaving") return;
    gameAudio.stop();
    waitForServer();
    arenaChat?.disconnect();
    if (phase !== "arena") {
      leaveArena(message, true);
      return;
    }
    resetInput(true);
    phase = "disconnected";
    clearLeaveConfirmation();
    clearTimeout(connectTimer);
    connectTimer = null;
    clearInterval(inputTimer);
    inputTimer = null;
    if (frameId !== null) cancelAnimationFrame(frameId);
    frameId = null;
    setSettingsOpen(false, false);
    boosterUI?.leaveArena();
    $("lifeResultDialog").close();
    $("connectionLostMessage").textContent = message;
    if(window.KillexMaintenance?.blocked){refreshJoinControls();return;}
    window.KillexWindows.open($("connectionLostDialog"));
    $("connectionLostTitle").focus({ preventScroll: true });
    refreshJoinControls();
    // Сохраняем последний кадр, но завершаем старое соединение. Поздние ответы
    // не возобновляют жизнь; новый вход возможен только после выхода в лобби.
    if (socket && socket.readyState < WebSocket.CLOSING) {
      try {
        socket.close(1000, "Arena interrupted");
      } catch (_) {}
    }
  }
  addEventListener("offline", () => {
    recoveryRequest?.abort();
    // The OS network hint may change during a handover while this socket still
    // works. Socket close/error and the existing state deadline detect real loss.
    if (phase !== "arena" && phase !== "connecting") waitForServer();
  });
  addEventListener("online", () => {
    if (serverUnavailable) checkServerAvailability();
  });
  function clearLeaveConfirmation() {
    clearTimeout(leaveTimer);
    leaveTimer = null;
    leaveRequestedSerial = null;
    $("leaveConfirmDialog").close();
    window.KillexControls.state($("leaveYes"), false);
    window.KillexControls.state($("leaveNo"), false);
  }
  function askToLeave() {
    if (phase !== "arena" || lifeResult || !getMe() || $("leaveConfirmDialog").open) return;
    resetInput(true);
    boosterUI?.cancelTarget();
    setSettingsOpen(false, false);
    $("leaveConfirmStatus").textContent = "";
    window.KillexWindows.open($("leaveConfirmDialog"));
    $("leaveConfirmTitle").focus({ preventScroll: true });
  }
  function cancelLeave() {
    if (leaveRequestedSerial !== null) return;
    clearLeaveConfirmation();
    resetInput(false);
    ui.canvas.focus({ preventScroll: true });
  }
  $("leaveNo").addEventListener("click", cancelLeave);
  $("leaveConfirmDialog").addEventListener("cancel", (event) => {
    event.preventDefault();
    cancelLeave();
  });
  $("leaveYes").addEventListener("click", () => {
    if (phase !== "arena" || lifeResult || $("leaveYes").disabled) return;
    const serial = leaveRequestedSerial ?? getMe()?.spawnSerial;
    if (!Number.isInteger(serial)) return;
    leaveRequestedSerial = serial;
    window.KillexControls.state($("leaveYes"), true, false);
    window.KillexControls.state($("leaveNo"), true, false);
    $("leaveConfirmStatus").textContent = "";
    if (!send({ type: "leaveLife", spawnSerial: serial })) {
      leaveRequestedSerial = null;
      window.KillexControls.state($("leaveYes"), false);
      window.KillexControls.state($("leaveNo"), false);
      $("leaveConfirmStatus").textContent = "Нет связи с сервером. Попробуй ещё раз.";
      return;
    }
    clearTimeout(leaveTimer);
    leaveTimer = setTimeout(() => {
      if (leaveRequestedSerial !== null) {
        window.KillexControls.state($("leaveYes"), false);
        $("leaveConfirmStatus").textContent =
          "Ответ задерживается. Нажми «Да, выйти» ещё раз - опыт сохранится один раз.";
      }
    }, 8000);
  });
  $("lifeLobby").addEventListener("click", () =>
    leaveArena("Ты в лобби. Опыт завершённой жизни сохранён."),
  );
  function clearArena() {
    emoteView.clear();
    lastEmoteAt = -Infinity;
    gameAudio.stop();
    arenaAudio.reset();
    arenaChat?.disconnect();
    clearLeaveConfirmation();
    lifeResult = null;
    clearTimeout(lifeLobbyTimer);
    lifeLobbyTimer = lifeLobbyId = null;
    lifeLobbyDeadline = 0;
    lifeClock = null;
    $("lifeResultDialog").close();
    $("connectionLostDialog").close();
    clearTimeout(connectTimer);
    connectTimer = null;
    clearInterval(inputTimer);
    inputTimer = null;
    if (frameId !== null) cancelAnimationFrame(frameId);
    frameId = null;
    resetInput(false);
    players = [];
    rebuildBodies();
    ether = [];
    foodById.clear();
    foodView.sync([]);
    projectileView.clear();
    aimPointer = null;
    smoothPlayers.clear();
    smoothParts.clear();
    bodyMotion.clear();
    bodyArt.clear();
    window.KillexShields.clearSphereCache();
    myId = null;
    ui.leaders.replaceChildren();
    $("arenaClanList").replaceChildren();
    ui.mass.textContent = "-";
    $("lifeTime").textContent = "00:00:00";
    ui.online.textContent = "0 игроков";
    setSettingsOpen(false, false);
    boosterUI?.leaveArena();
  }
  function finishClosing(attempt) {
    if (closingSocket !== attempt) return;
    closingSocket = null;
    phase = "lobby";
    refreshJoinControls();
    setLobbyStatus(closingMessage, closingError);
    revealLobby();
  }
  async function revealLobby() {
    const token = transitionToken;
    try {
      await boosterUI?.load(true);
    } finally {
      if (phase === "lobby")
        transition?.finish(token, true, () => { if(!arenaPicker?.closedDialog?.open)ui.play.focus({ preventScroll: true }); });
    }
  }
  function leaveArena(message = "Ты в лобби. Следующий вход начнёт новую игру.", error = false) {
    if (phase === "leaving") return;
    transitionToken = transition?.begin("lobby");
    arenaPicker?.cancelPending();
    joinGeneration++;
    resetInput(true);
    const previousSocket = socket;
    socket = null; // Поздние сообщения старого соединения больше не меняют интерфейс.
    clearArena();
    closingMessage = message;
    closingError = error;
    showLobbyScreen();
    if (previousSocket && previousSocket.readyState !== WebSocket.CLOSED) {
      closingSocket = previousSocket;
      phase = "leaving";
      setLobbyStatus("");
      refreshJoinControls();
      try {
        previousSocket.close(1000, "Return to lobby");
      } catch (_) {
        finishClosing(previousSocket);
      }
      // Новый вход запрещён до события close: не создаём двойную сферу.
    } else {
      phase = "lobby";
      refreshJoinControls();
      setLobbyStatus(message, error);
      revealLobby();
    }
  }
  async function joinArena(event, clanMemberId = null) {
    event?.preventDefault();
    if (boosterUI?.profile?.personal?.introPending) {
      document.querySelector("#editProfile")?.click();
      return;
    }
    if (window.KillexMaintenance?.blocked) return;
    if (
      serverUnavailable ||
      preparingJoin ||
      phase !== "lobby" ||
      socket ||
      closingSocket ||
      !ctx ||
      !boosterUI?.ready
    )
      return;
    const generation = ++joinGeneration;
    if (location.protocol !== "http:" && location.protocol !== "https:") {
      setLobbyStatus(
        "Открой игру по её адресу в браузере.",
        true,
      );
      return;
    }
    ui.previewName.textContent = boosterUI.profile.name;
    persistPreferences();
    setSettingsOpen(false, false);
    phase = "connecting";
    transitionToken = transition?.begin("arena", () => ui.cancel.click());
    preparingJoin = true;
    refreshJoinControls();
    setLobbyStatus("");
    let reservation;
    try {
      await boosterUI.prepareArena();
      if (phase !== "connecting" || generation !== joinGeneration) return;
      setLobbyStatus("");
      reservation = await arenaPicker.reserve(clanMemberId);
    } catch (error) {
      if (phase === "connecting" && generation === joinGeneration) {
        phase = "lobby";
        transition?.finish(transitionToken);
        setLobbyStatus(error.message, true);
        if (error.code === "ARENA_TEMPORARILY_CLOSED") arenaPicker?.showClosed(error.message);
        if (!error.serverResponse) waitForServer();
      }
      return;
    } finally {
      preparingJoin = false;
      refreshJoinControls();
    }
    if (phase !== "connecting" || generation !== joinGeneration) return;
    setLobbyStatus("");
    let attempt;
    try {
      const scheme = location.protocol === "https:" ? "wss:" : "ws:";
      arenaChat?.start(boosterUI.profile.id);
      attempt = new WebSocket(`${scheme}//${location.host}${reservation.wsPath}`, [
        window.KillexArenaWire.PROTOCOL,
        window.KillexArenaWire.PRIVATE_STATE_PROTOCOL,
        window.KillexArenaWire.MOTION_PROTOCOL,
        window.KillexPlatform.stateProtocol(1),
        `ticket.${reservation.ticket}`,
      ]);
    } catch (_) {
      arenaPicker.cancelPending();
      phase = "lobby";
      transition?.finish(transitionToken);
      waitForServer();
      refreshJoinControls();
      setLobbyStatus(
        "Браузер не смог открыть соединение. Проверь адрес игры и запущенный сервер.",
        true,
      );
      return;
    }
    socket = attempt;
    connectTimer = setTimeout(() => {
      if (socket === attempt && phase === "connecting") {
        showConnectionLost(
          "Ответ арены задерживается. Вернись в лобби и попробуй подключиться ещё раз.",
        );
      }
    }, CONNECT_TIMEOUT_MS);
    const wireDecoder = new window.KillexArenaWire.Decoder();
    let ackSequence = 0, ackTimer = null, ackFrame = null;
    const acknowledge = () => {
      clearTimeout(ackTimer);
      cancelAnimationFrame(ackFrame);
      ackTimer = ackFrame = null;
      if (socket !== attempt || phase === "disconnected" || attempt.readyState !== WebSocket.OPEN) {
        ackSequence = 0;
        return;
      }
      // ACKs are cumulative. Keep only the latest one, and retry if the browser
      // send buffer was full; dropping it can deadlock the bounded state stream.
      if (!ackSequence || send({ type: "stateAck", sequence: ackSequence })) ackSequence = 0;
      else ackTimer = setTimeout(acknowledge, 250);
    };
    attempt.addEventListener("message", (event) => {
      if (socket !== attempt || phase === "disconnected") return;
      let message;
      try {
        message = JSON.parse(event.data);
      } catch (_) {
        return;
      }
      if (!message || typeof message !== "object") return;
      if (message.type === "maintenance") {
        window.KillexMaintenance?.update(message);
        return;
      }
      if (message.type === "arenaClosed") {
        leaveArena(message.message, true);
        arenaPicker?.showClosed(message.message);
        return;
      }
      if(window.KillexMaintenance?.blocked)return;
      if (message.type === "accountBanned") {
        location.assign("/blocked.html");
        return;
      }
      if (message.type === "emote") {
        emoteView.receive(message, performance.now());
        return;
      }
      if (["chatHistory", "chatMessage", "chatResult"].includes(message.type)) {
        arenaChat?.receive(message);
        return;
      }
      if (message.type === "accessoryBoosterResult") {
        accessoryAbilityUI?.receive(message);
        return;
      }
      if (message.type === "petBoosterResult") {
        petsUI?.receive(message);
        return;
      }
      if (message.type === "welcome" && typeof message.id === "string") {
        arenaPicker.joined();
        myId = message.id;
        acceptWorld(message.world);
        backgroundView.select(message.backgroundId);
      } else if (message.type === "state") {
        message = wireDecoder.decode(message);
        acceptState(message);
        if (Number.isSafeInteger(message.stateSequence)) {
          // Let the browser paint before requesting another snapshot. The
          // fallback also keeps hidden tabs connected when rAF is suspended.
          ackSequence = Math.max(ackSequence, message.stateSequence);
          if (ackTimer === null) ackTimer = setTimeout(acknowledge, 250);
          if (ackFrame === null) ackFrame = requestAnimationFrame(acknowledge);
          if (document.hidden) acknowledge();
        }
      } else if (
        message.type === "profile" ||
        message.type === "boosterResult" ||
        message.type === "turboResult"
      ) {
        boosterUI?.receive(message);
      } else if (message.type === "lifeEnded") {
        showLifeResult(message);
      } else if (message.type === "leaveResult" && message.spawnSerial === leaveRequestedSerial) {
        clearTimeout(leaveTimer);
        window.KillexControls.state($("leaveYes"), false);
        $("leaveConfirmStatus").textContent = message.message;
      }
    });
    attempt.addEventListener("error", () => {
      if (socket === attempt)
        showConnectionLost(
          phase === "arena"
            ? "Соединение с сервером прервалось."
            : "Соединение не удалось. Проверь сервер и выйди с арены в других вкладках этого профиля.",
        );
    });
    attempt.addEventListener("close", () => {
      if (closingSocket === attempt) {
        finishClosing(attempt);
        return;
      }
      if (socket !== attempt) return;
      socket = null;
      showConnectionLost("Соединение с сервером прервалось.");
    });
  }
  function send(message) {
    if (!socket || socket.readyState !== WebSocket.OPEN) return false;
    if (socket.bufferedAmount > 65536 ||
      (TRANSIENT_INPUT.has(message.type) && performance.now() - lastStateAt > INPUT_FRESHNESS_MS)) {
      // A released joystick must still stop the sphere after the next snapshot.
      // Movement is read fresh from the current pointer; actions are never queued.
      if (message.type === "stop") deferredStop = true;
      return false;
    }
    try {
      if (
        ["move", "stop", "split", "feed"].includes(message.type) &&
        Number.isInteger(getMe()?.spawnSerial)
      )
        message.spawnSerial = getMe().spawnSerial;
      socket.send(JSON.stringify(message));
      if (message.type === "move" || message.type === "stop") deferredStop = false;
      return true;
    } catch (_) {
      return false;
    }
  }
  function acceptWorld(value) {
    if (
      value &&
      Number.isFinite(value.width) &&
      Number.isFinite(value.height) &&
      value.width > 0 &&
      value.height > 0 &&
      value.width <= 1000000 &&
      value.height <= 1000000
    ) {
      world = { width: value.width, height: value.height };
    }
  }
  function acceptState(message) {
    if (!Array.isArray(message.players)) return;
    roomPlayerCount = Number.isSafeInteger(message.playerCount)
      ? message.playerCount
      : message.players.filter((p) => !p.departure).length;
    acceptWorld(message.world);
    backgroundView.select(message.backgroundId);
    ui.canvas.dataset.background = backgroundView.theme.id;
    players = message.players.filter(
      (p) =>
        p &&
        typeof p.id === "string" &&
        Number.isFinite(p.x) &&
        Number.isFinite(p.y) &&
        Number.isFinite(p.radius) &&
        p.radius > 0,
    );
    const validFood = (p) =>
      p && typeof p.id === "string" && Number.isFinite(p.x) && Number.isFinite(p.y);
    if (Array.isArray(message.ether)) {
      foodById.clear();
      for (const orb of message.ether) if (validFood(orb)) foodById.set(orb.id, orb);
    } else if (message.etherDelta) {
      for (const id of message.etherDelta.removed || []) foodById.delete(id);
      for (const orb of message.etherDelta.upsert || [])
        if (validFood(orb)) foodById.set(orb.id, orb);
    }
    ether = [...foodById.values()];
    hazards = (Array.isArray(message.hazards) ? message.hazards : message.easterEggs || [])
      .slice(0, 128)
      .filter(
        (p) =>
          p &&
          typeof p.id === "string" &&
          Number.isFinite(p.x) &&
          Number.isFinite(p.y) &&
          Number.isFinite(p.radius) &&
          p.radius > 0 &&
          (p.eggType === null || (Number.isInteger(p.eggType) && p.eggType >= 0 && p.eggType < 4)),
      );
    foodView.sync(
      ether.filter((orb) => !orb.ejected),
      message.tick * bodyMotion.tickMs,
    );
    projectileView.sync(
      Array.isArray(message.projectiles) ? message.projectiles : [],
      performance.now(),
    );
    const me = getMe();
    window.KillexEmoteHotkeys?.update(me?.account);
    lastStateAt = performance.now();
    if (me && !lifeResult)
      lifeClock = {
        elapsedMs: Number.isFinite(me.lifeElapsedMs)
          ? me.lifeElapsedMs
          : (me.lifeSeconds || 0) * 1000,
        receivedAt: lastStateAt,
      };
    const aliveIds = new Set(players.map((p) => p.id));
    for (const id of smoothPlayers.keys()) if (!aliveIds.has(id)) smoothPlayers.delete(id);
    for (const p of players) {
      const previous = smoothPlayers.get(p.id);
      const teleported =
        previous && Number.isInteger(p.spawnSerial) && p.spawnSerial !== previous.spawnSerial;
      if (!previous || teleported) {
        smoothPlayers.set(p.id, {
          x: p.x,
          y: p.y,
          radius: p.radius,
          lastMass: p.mass,
          spawnSerial: p.spawnSerial,
        });
        if (teleported && p.id === myId) {
          resetInput(true);
          boosterUI?.respawn();
          camera.x = p.x;
          camera.y = p.y;
          camera.vx = camera.vy = 0;
          camera.scale = desiredScale(p);
          camera.zoomTarget = camera.scale;
        }
      } else {
        previous.lastMass = p.mass;
        previous.spawnSerial = p.spawnSerial;
      }
    }
    rebuildBodies();
    const bodies = visibleBodies();
    const shots = (message.projectiles || []).map((part) => ({
      key: "projectile:" + part.id,
      player: { spawnSerial: 0 },
      part,
      kind: "projectile",
    }));
    const endings = [
      ...(message.visualEvents || []).filter((e) => e.type === "hazardContact"),
      ...(message.visualEvents || []).filter(
        (e) => e.type === "partRemoved" && e.reason === "fire",
      ),
      ...(message.events || [])
        .filter((e) => e.type === "absorbed")
        .map((e) => ({
          key: e.victimId + ":" + e.victimPartId,
          tick: e.tick,
          x: e.victimX,
          y: e.victimY,
        })),
      ...(message.visualEvents || [])
        .filter((e) => e.type === "projectileContact")
        .map((e) => ({
          key: "projectile:" + e.shot.id,
          tick: e.tick,
          x: e.shot.x,
          y: e.shot.y,
          hold: e.hold,
        })),
    ];
    const contacts = (message.visualEvents || [])
      .filter((e) => e.type === "projectileContact")
      .flatMap((e) => (e.targets || []).map((target) => ({ ...target, tick: e.tick })));
    const movingFood = ether
      .filter((orb) => orb.ejected)
      .map((part) => ({
        key: "food:" + part.id,
        player: { id: "food", spawnSerial: 0 },
        part,
        kind: "food",
      }));
    bodyMotion.sync(
      [
        ...bodies,
        ...shots,
        ...movingFood,
        ...hazards.map((part) => ({
          key: "hazard:" + part.id,
          player: { id: "hazards", spawnSerial: 0 },
          part,
          kind: "hazard",
        })),
      ],
      message.tick,
      lastStateAt,
      endings,
      contacts,
    );
    for (const key of smoothParts.keys()) if (!bodyMotion.tracks.has(key)) smoothParts.delete(key);
    for (const { player, part, key } of bodies) {
      const old = smoothParts.get(key);
      if (!old || old.spawnSerial !== player.spawnSerial)
        smoothParts.set(key, { ...part, spawnSerial: player.spawnSerial });
    }
    if (phase === "connecting" && me) enterArena(me);
    if (phase !== "arena") return;
    arenaAudio.state(message, myId);
    boosterUI?.updateState();
    petsUI?.updateArena();
    accessoryAbilityUI?.updateArena();
    const legacyHidden = !!lifeResult || !!(me && Number.isFinite(me.mass));
    if (ui.legacy.hidden !== legacyHidden) ui.legacy.hidden = legacyHidden;
    if (
      Array.isArray(message.leaderboard) ||
      (Array.isArray(message.events) && message.events.length) ||
      lastStateAt - lastHudAt >= 150
    ) {
      updateHud(message.leaderboard, message.clanLeaderboard);
      lastHudAt = lastStateAt;
    }
  }
  function enterArena(me) {
    clearTimeout(connectTimer);
    connectTimer = null;
    phase = "arena";
    arenaChat?.connect();
    ui.lobby.hidden = true;
    ui.arena.hidden = false;
    document.body.dataset.screen = "arena";
    document.title = "Герои Эфира - арена";
    refreshJoinControls();
    resizeCanvas();
    camera = { x: me.x, y: me.y, scale: desiredScale(me) };
    resetInput(false);
    applyMassPreference();
    updateHud();
    boosterUI?.enterArena();
    ui.canvas.focus({ preventScroll: true });
    lastFrameAt = performance.now();
    deferredStop = false;
    frameId = requestAnimationFrame(frame);
    transition?.finish(transitionToken, true, () => ui.canvas.focus({ preventScroll: true }));
    inputTimer = setInterval(() => {
      if (phase !== "arena") return;
      if (performance.now() - lastStateAt > STATE_TIMEOUT_MS) {
        showConnectionLost("Сервер перестал обновлять арену.");
        return;
      }
      if (deferredStop) send({ type: "stop" });
      sendMovement();
      if (feedHeld || touchFeedHeld) feed();
    }, 50);
  }
  function updateHud(serverLeaderboard, clanLeaderboard) {
    const me = getMe();
    touchControls.update(!lifeResult && me?.canSplit, !lifeResult && me?.canFeed);
    if (!lifeResult) ui.mass.textContent = formatMass(me?.mass);
    ui.mass.setAttribute(
      "aria-label",
      me
        ? `Общая масса: ${formatMass(me.mass)} - Лимит одного шара: ${formatMass(me.massLimit)} - Частей: ${me.parts?.length || 1}`
        : "",
    );
    $("arenaKills").textContent = formatMass(
      lifeResult
        ? (lifeResult.visualKills ?? lifeResult.kills ?? 0)
        : boosterUI?.profile?.progress?.arenaKills || 0,
    );
    $("arenaKills").parentElement.setAttribute(
      "aria-label",
      "Киллы за жизнь: после «макс» счётчик растёт только визуально. Зачтено: " +
        formatMass(lifeResult?.kills ?? boosterUI?.profile?.progress?.arenaCreditedKills ?? 0),
    );
    updateLifeClock();
    const count = roomPlayerCount,
      last = count % 10,
      teen = count % 100;
    ui.online.textContent = `${count} ${teen >= 11 && teen <= 14 ? "игроков" : last === 1 ? "игрок" : last >= 2 && last <= 4 ? "игрока" : "игроков"}`;
    // Rankings arrive once a second; movement-only snapshots keep the current rows.
    if (!Array.isArray(serverLeaderboard) || !Array.isArray(clanLeaderboard)) return;
    const list = Array.isArray(serverLeaderboard)
      ? serverLeaderboard.filter((p) => p && typeof p.id === "string").slice(0, 10)
      : [...players].sort((a, b) => (b.mass || 0) - (a.mass || 0)).slice(0, 10);
    const fragment = document.createDocumentFragment();
    list.forEach((entry, i) => {
      const row = document.createElement("div");
      row.className = "leader-row" + (entry.id === myId ? " leader-self" : "");
      const name = document.createElement("span");
      name.className =
        "leader-name" +
        (entry.account?.premium ? " name-premium" : entry.account?.vip ? " name-vip" : "");
      name.textContent = window.KillexIdentity.label(entry);
      name.setAttribute("aria-label", name.textContent);
      const rank = document.createElement("span");
      rank.className = "leader-rank";
      rank.textContent = String(i + 1);
      const mass = document.createElement("span");
      mass.className = "leader-mass";
      mass.textContent = formatMass(entry.mass);
      row.append(rank, name, mass);
      fragment.append(row);
    });
    ui.leaders.replaceChildren(fragment);
    const clans = document.createDocumentFragment();
    for (const entry of (Array.isArray(clanLeaderboard) ? clanLeaderboard : []).slice(0, 10)) {
      const row = document.createElement("div");
      row.className = "arena-clan-row";
      row.dataset.clanId = entry.id;
      if (entry.id === me?.clanId) row.classList.add("arena-clan-self");
      const name = document.createElement("span");
      name.className = "leader-name";
      name.classList.toggle("clan-champion-name", entry.frame === "champion");
      name.textContent = `[${entry.prefix}]`;
      name.setAttribute("aria-label", `${name.textContent} - Игроков на арене: ${entry.count}`);
      const rank = document.createElement("span");
      rank.textContent = entry.rank;
      row.append(rank, name);
      clans.append(row);
    }
    if (!clans.childNodes.length) {
      const empty = document.createElement("small");
      empty.textContent = "На арене пока нет кланов";
      clans.append(empty);
    }
    $("arenaClanList").replaceChildren(clans);
  }

  // Управление отправляет только цель. Масса и поглощение вычисляются сервером.
  function stopMovement() {
    const me = getMe();
    if (phase === "arena" && me) send({ type: "stop" });
  }
  function resetInput(sendStop = true, preserveActions = false) {
    boosterUI?.stopMassRepeat();
    feedHeld = false;
    if (!preserveActions) touchControls.reset();
    input.kind = "none";
    touchId = null;
    stickId = null;
    stickVector = { x: 0, y: 0 };
    ui.stick.style.transform = "translate(0px, 0px)";
    if (sendStop) stopMovement();
  }
  function retainMovement() {
    const previous = { ...input };
    resetInput(false); // Отпускаем W/бустеры и касания, не сбрасывая направление мыши.
    if (previous.kind === "retained") {
      input = previous;
      return;
    }
    const me = getMe();
    if (
      previous.kind !== "mouse" ||
      phase !== "arena" ||
      !me ||
      lifeResult ||
      $("leaveConfirmDialog").open
    ) {
      stopMovement();
      return;
    }
    input = { ...previous, kind: "retained" };
    const { x, y } = window.KillexArenaView.movementTarget(me, previous, camera, width, height, world);
    if (Math.hypot(x - me.x, y - me.y) < 2) stopMovement();
    else
      send({
        type: "move",
        x: clamp(x, 0, world.width),
        y: clamp(y, 0, world.height),
        keepDirection: true,
      });
  }
  function sendMovement() {
    if (lifeResult || $("leaveConfirmDialog").open) return;
    if (phase !== "arena" || document.hidden || !ui.settings.hidden || boosterUI?.dialog.open)
      return;
    const me = getMe();
    if (!me) return;
    const vector = stickId !== null ? stickVector : null;
    if (vector) {
      if (Math.hypot(vector.x, vector.y) < 0.1) {
        stopMovement();
        return;
      }
      send({
        type: "move",
        x: clamp(me.x + vector.x * 220, 0, world.width),
        y: clamp(me.y + vector.y * 220, 0, world.height),
        keepDirection: true,
      });
    } else if (input.kind === "mouse" || input.kind === "touch") {
      const target = window.KillexArenaView.movementTarget(me, input, camera, width, height, world);
      const targetX = target.x, targetY = target.y;
      // Допуск в координатах арены, а не экрана. Прежние 9 px при
      // отдалении камеры останавливали шар до 95% покрытия соперника.
      if (Math.hypot(targetX - me.x, targetY - me.y) < 2) {
        stopMovement();
        return;
      }
      send({
        type: "move",
        x: clamp(targetX, 0, world.width),
        y: clamp(targetY, 0, world.height),
        keepDirection: target.keepDirection,
      });
    }
  }
  // Мышь отслеживается и поверх HUD: наведение на плашки/кнопки не сбрасывает цель.
  ui.arena.addEventListener(
    "pointerdown",
    (event) => {
      if (event.pointerType !== "mouse") aimPointer = null;
    },
    true,
  );
  ui.arena.addEventListener(
    "pointermove",
    (event) => {
      if (lifeResult || $("leaveConfirmDialog").open) return;
      // Чат сохраняет последнюю цель движения; указатель над ним не меняет курс.
      if (arenaChat?.root.contains(event.target)) return;
      if (boosterUI?.dialog.open) return;
      if (phase !== "arena" || !ui.settings.hidden) return;
      if (event.pointerType === "touch" && event.pointerId !== touchId) return;
      // HUD overlays must update the same aim as the canvas. Otherwise movement
      // follows the cursor while keyboard boosters keep the last canvas position.
      aimPointer = event.pointerType === "mouse" ? { x: event.clientX, y: event.clientY } : null;
      input = {
        kind: event.pointerType === "touch" ? "touch" : "mouse",
        x: event.clientX,
        y: event.clientY,
      };
    },
    true,
  );
  ui.canvas.addEventListener("pointerdown", (event) => {
    if (lifeResult || $("leaveConfirmDialog").open) return;
    if (phase !== "arena" || !ui.settings.hidden) return;
    aimPointer = event.pointerType === "mouse" ? { x: event.clientX, y: event.clientY } : null;
    if (boosterUI?.targeting) {
      const x = camera.x + (event.clientX - width / 2) / camera.scale;
      const y = camera.y + (event.clientY - height / 2) / camera.scale;
      if (boosterUI.targeting.target === "direction") {
        boosterUI.selectAim(x, y);
        return;
      }
      const targets = visibleBodies()
        .filter(({ player }) => player.id !== myId)
        .map(({ player, part, key }) => ({
          p: player,
          d: smoothParts.get(key) || part,
        }))
        .filter(({ d }) => Math.hypot(d.x - x, d.y - y) <= Math.max(d.radius, 22 / camera.scale))
        .sort((a, b) => Math.hypot(a.d.x - x, a.d.y - y) - Math.hypot(b.d.x - x, b.d.y - y));
      boosterUI.selectTarget(targets[0]?.p);
      return;
    }
    if (event.pointerType === "touch") {
      if (touchId !== null || stickId !== null) return;
      touchId = event.pointerId;
      try {
        ui.canvas.setPointerCapture(event.pointerId);
      } catch (_) {
        /* Некоторые браузеры не дают захват. */
      }
    }
    input = {
      kind: event.pointerType === "touch" ? "touch" : "mouse",
      x: event.clientX,
      y: event.clientY,
    };
    ui.canvas.focus({ preventScroll: true });
    sendMovement();
  });
  function endCanvasTouch(event) {
    if (event.pointerId === touchId) resetInput(true, true);
  }
  ui.canvas.addEventListener("pointerup", endCanvasTouch);
  ui.canvas.addEventListener("pointercancel", endCanvasTouch);
  ui.canvas.addEventListener("lostpointercapture", endCanvasTouch);
  function split() {
    if (
      phase !== "arena" ||
      lifeResult ||
      $("leaveConfirmDialog").open ||
      !ui.settings.hidden ||
      boosterUI?.dialog.open ||
      boosterUI?.targeting ||
      !getMe()?.canSplit
    )
      return;
    sendMovement();
    send({ type: "split", sequence: ++splitSequence });
  }
  function feed() {
    if (
      phase !== "arena" ||
      document.hidden ||
      lifeResult ||
      document.querySelector("dialog[open]") ||
      !ui.settings.hidden ||
      boosterUI?.targeting ||
      document.activeElement?.closest("input, textarea, select, [contenteditable]")
    ) {
      feedHeld = false;
      touchControls.reset();
      return;
    }
    const me = getMe(),
      now = performance.now();
    if (!me?.canFeed || now < nextFeedAt) return;
    const point = input.kind !== "none" ? input : aimPointer;
    const stick = stickId !== null && Math.hypot(stickVector.x, stickVector.y) >= 0.1
      ? stickVector : null;
    const x = stick ? me.x + stick.x * 220 : point ? camera.x + (point.x - width / 2) / camera.scale : me.x + 220;
    const y = stick ? me.y + stick.y * 220 : point ? camera.y + (point.y - height / 2) / camera.scale : me.y;
    if (
      send({
        type: "feed",
        sequence: ++feedSequence,
        x: clamp(x, 0, world.width),
        y: clamp(y, 0, world.height),
      })
    )
      nextFeedAt = now + 200;
  }
  addEventListener("keydown", (event) => {
    if (event.isComposing) return;
    if (arenaChat?.root.contains(event.target)) return;
    if (event.code === "Escape") {
      // Один Escape сначала выходит из fullscreen, включая браузеры, которые
      // успевают прислать fullscreenchange перед самим событием клавиатуры.
      if (document.fullscreenElement || fullscreenWasActive) {
        event.preventDefault();
        if (!event.repeat) document.exitFullscreen?.().catch(() => {});
        return;
      }
      if (performance.now() - lastFullscreenExitAt < 150 || event.repeat) {
        event.preventDefault();
        return;
      }
      if (lifeResult || $("leaveConfirmDialog").open || document.querySelector("dialog[open]"))
        return;
      event.preventDefault();
      if (phase === "arena") askToLeave();
      else if (!ui.settings.hidden) setSettingsOpen(false, true);
      return;
    }
    if (lifeResult || $("leaveConfirmDialog").open) return;
    const emoteIndex = window.KillexEmotes.key(event);
    if (emoteIndex && phase === "arena" && !document.hidden && ui.settings.hidden &&
        !document.querySelector("dialog[open]") &&
        !event.target?.closest("input, textarea, select, [contenteditable], button, a, [role='button']")) {
      const me = getMe(), at = performance.now();
      if (!me || me.dead || me.departure || !Number.isSafeInteger(me.spawnSerial)) return;
      event.preventDefault();
      if (at - lastEmoteAt >= window.KillexEmotes.COOLDOWN_MS &&
          send({ type: "emote", index: emoteIndex, spawnSerial: me.spawnSerial })) lastEmoteAt = at;
      return;
    }
    if (event.key === "Enter" && phase === "arena" && !event.defaultPrevented &&
        !event.repeat && !event.ctrlKey && !event.altKey && !event.metaKey && !event.shiftKey &&
        !document.querySelector("dialog[open]") && ui.settings.hidden &&
        !event.target?.closest("input, textarea, select, [contenteditable], button, a, [role='button']") &&
        arenaChat?.panel.root.hidden) {
      event.preventDefault();
      arenaChat.expand(true);
      arenaChat.panel.input.focus();
      return;
    }
    if (
      event.code === "KeyW" &&
      phase === "arena" &&
      !event.ctrlKey &&
      !event.altKey &&
      !event.metaKey &&
      !event.target?.closest("input, textarea, select, [contenteditable], dialog")
    ) {
      event.preventDefault();
      if (!event.repeat) {
        feedHeld = true;
        feed();
      }
      return;
    }
    if (
      event.code === "Space" &&
      phase === "arena" &&
      !event.ctrlKey &&
      !event.altKey &&
      !event.metaKey &&
      !event.target?.closest("input, textarea, select, [contenteditable], dialog")
    ) {
      event.preventDefault();
      if (!event.repeat) split();
      return;
    }
    if (accessoryAbilityUI?.handleKey(event)) {
      event.preventDefault();
      return;
    }
    if (petsUI?.handleKey(event)) {
      event.preventDefault();
      return;
    }
    if (boosterUI?.handleKey(event)) {
      event.preventDefault();
      return;
    }
  });
  addEventListener("keyup", (event) => {
    boosterUI?.handleKeyUp(event);
    if (event.code === "KeyW") feedHeld = false;
  });
  function updateStick(event) {
    const rect = ui.joystick.getBoundingClientRect();
    const max = rect.width / 2 - 23;
    let x = event.clientX - rect.left - rect.width / 2;
    let y = event.clientY - rect.top - rect.height / 2;
    const distance = Math.hypot(x, y);
    if (distance > max) {
      x = (x / distance) * max;
      y = (y / distance) * max;
    }
    stickVector = { x: x / max, y: y / max };
    ui.stick.style.transform = `translate(${x}px, ${y}px)`;
  }
  ui.joystick.addEventListener("pointerdown", (event) => {
    if (lifeResult || $("leaveConfirmDialog").open) return;
    if (
      phase !== "arena" ||
      !ui.settings.hidden ||
      boosterUI?.dialog.open ||
      boosterUI?.targeting ||
      stickId !== null
    )
      return;
    event.preventDefault();
    resetInput(true, true);
    stickId = event.pointerId;
    try {
      ui.joystick.setPointerCapture(event.pointerId);
    } catch (_) {
      /* Есть обработка pointercancel. */
    }
    updateStick(event);
    sendMovement();
  });
  ui.joystick.addEventListener("pointermove", (event) => {
    if (event.pointerId === stickId) updateStick(event);
  });
  function endStick(event) {
    if (event.pointerId === stickId) resetInput(true, true);
  }
  ui.joystick.addEventListener("pointerup", endStick);
  ui.joystick.addEventListener("pointercancel", endStick);
  ui.joystick.addEventListener("lostpointercapture", endStick);
  addEventListener("blur", retainMovement);
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) retainMovement();
    // При возврате в долгожившую вкладку не оставляем устаревшую картинку.
    else if (phase === "arena") lastFrameAt = performance.now();
  });
  addEventListener("pagehide", () => {
    gameAudio.stop();
    lobbyMusic.setActive(false);
    clearInterval(inputTimer);
    if (socket) {
      try {
        socket.close(1000, "Page hidden");
      } catch (_) {}
    }
  });

  // Настройки. Сохраняется показ массы; fullscreen всегда отражает реальное состояние браузера.
  addEventListener("pageshow", () => lobbyMusic.setActive(phase === "lobby"));
  function applyMassPreference() {
    ui.massPanel.hidden = phase !== "arena";
    ui.massToggle.setAttribute("aria-checked", String(preferences.showMass));
    for (const key of ["music", "sound"]) {
      const value = preferences[key + "Volume"];
      $(key + "Volume").value = value;
      $(key + "Volume").setAttribute("aria-valuetext", value ? value + "%" : "0% — выключено");
      $(key + "VolumeValue").textContent = value + "%";
    }
  }
  function setSettingsOpen(open, returnFocus = false) {
    if (open) {
      retainMovement();
      boosterUI?.cancelTarget();
    }
    ui.settings.hidden = !open;
    ui.gear.setAttribute("aria-expanded", String(open));
    ui.gear.setAttribute("aria-label", open ? "Закрыть настройки" : "Открыть настройки");
    if (open) ui.closeSettings.focus({ preventScroll: true });
    else if (returnFocus) ui.gear.focus({ preventScroll: true });
  }
  ui.gear.addEventListener("click", () => setSettingsOpen(ui.settings.hidden, false));
  for (const key of ["music", "sound"]) {
    const slider = $(key + "Volume");
    slider.addEventListener("input", () => {
      const volume = Math.max(0, Math.min(100, Number(slider.value)));
      preferences[key + "Volume"] = volume;
      preferences[key] = volume > 0;
      const audio = key === "sound" ? gameAudio : lobbyMusic;
      audio.setVolume(volume / 100);
      audio.setEnabled(volume > 0);
      applyMassPreference();
      document.dispatchEvent(
        new CustomEvent("killex:audio-preferences", {
          detail: { music: preferences.music, sound: preferences.sound,
            musicVolume: preferences.musicVolume, soundVolume: preferences.soundVolume },
        }),
      );
    });
    // Persist after a completed adjustment, not for every pointer movement.
    slider.addEventListener("change", persistPreferences);
  }
  ui.closeSettings.addEventListener("click", () => setSettingsOpen(false, true));
  document.addEventListener("pointerdown", (event) => {
    if (!ui.settings.hidden && !ui.settingsArea.contains(event.target))
      setSettingsOpen(false, false);
  });
  ui.massToggle.addEventListener("click", () => {
    preferences.showMass = !preferences.showMass;
    applyMassPreference();
    persistPreferences();
    ui.feedback.textContent = storageAvailable
      ? "Настройка сохранена в этом браузере."
      : "Настройка действует до закрытия страницы: браузер запретил сохранение.";
  });
  function syncFullscreen() {
    const active = !!document.fullscreenElement;
    const supported =
      typeof document.documentElement.requestFullscreen === "function" &&
      typeof document.exitFullscreen === "function" &&
      document.fullscreenEnabled !== false;
    ui.fullscreen.setAttribute("aria-checked", String(active));
    window.KillexControls.state(
      ui.fullscreen,
      fullscreenBusy || (!active && !supported),
      !active && !supported,
    );
    ui.fullscreenHelp.textContent =
      supported || active
        ? "Выключи, чтобы вернуться в окно"
        : "Недоступно в этом браузере или режиме встраивания";
  }
  ui.fullscreen.addEventListener("click", async () => {
    if (fullscreenBusy) return;
    fullscreenBusy = true;
    syncFullscreen();
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen();
      ui.feedback.textContent = "";
    } catch (_) {
      ui.feedback.textContent =
        "Браузер не разрешил изменить режим экрана. Игра продолжит работать в окне.";
    } finally {
      fullscreenBusy = false;
      syncFullscreen();
    }
  });
  document.addEventListener("fullscreenchange", () => {
    if (fullscreenWasActive && !document.fullscreenElement)
      lastFullscreenExitAt = performance.now();
    fullscreenWasActive = !!document.fullscreenElement;
    syncFullscreen();
    resizeCanvas();
  });

  // Отрисовка арены; никакой клиентской симуляции массы.
  function resizeCanvas() {
    // При обрыве сохраняем последний кадр и при повороте экрана.
    if (phase === "disconnected") return;
    const previousWidth = width,
      previousHeight = height;
    width = innerWidth;
    height = innerHeight;
    pixelRatio = Math.min(devicePixelRatio || 1, 2);
    ui.canvas.width = Math.round(width * pixelRatio);
    ui.canvas.height = Math.round(height * pixelRatio);
    if (ctx) ctx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    if (
      phase === "arena" &&
      (input.kind === "mouse" ||
        input.kind === "retained" ||
        arenaChat?.root.contains(document.activeElement))
    ) {
      // Изменение окна не сбрасывает курс; экранная клавиатура также сохраняет цель.
      if (input.kind !== "none") {
        input.x += (width - previousWidth) / 2;
        input.y += (height - previousHeight) / 2;
      }
    } else resetInput(true);
  }
  function desiredScale(player) {
    return window.KillexArenaView.desiredScale(player, width, height, world);
  }
  const validColors = new Map();
  function goodColor(color, fallback) {
    if (typeof color !== "string" || color.length >= 100) return fallback;
    if (!validColors.has(color)) {
      if (validColors.size >= 256) validColors.delete(validColors.keys().next().value);
      validColors.set(color, CSS.supports("color", color));
    }
    return validColors.get(color) ? color : fallback;
  }
  function drawPlayer(player, displayed, part, elapsed) {
    const x = displayed.x,
      y = displayed.y,
      radius = displayed.radius;
    const color = goodColor(player.color, "#b59ee6");
    const skin = arenaPortraits.get(player.skinId, radius * 2 * camera.scale * pixelRatio);
    bodyArt.body(ctx, {
      x,
      y,
      radius,
      scale: camera.scale,
      density: pixelRatio,
      skin,
      skinId: player.skinId,
      color,
      drawSkin: window.KillexIdentity.drawSkin,
    });
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.lineWidth = (player.id === myId ? 2 : 1) / camera.scale;
    ctx.strokeStyle =
      player.shieldMs > 0 ? "#a5e8ff" : player.id === myId ? "#ead6a5" : "#b8add58c";
    ctx.stroke();
    const framed = window.KillexArenaArt.selectedFrame(
      ctx,
      player.arenaFrame,
      player.account,
      x,
      y,
      radius,
      camera.scale,
      performance.now(),
    );
    if (player.effects?.some((effect) => effect.id === "sphere" && effect.remainingMs > elapsed)) {
      window.KillexShields.drawSphere(
        ctx,
        displayed,
        performance.now(),
        camera.scale,
        reducedMotion.matches,
        pixelRatio,
      );
    }
    const shieldRadius = framed
      ? window.KillexArenaArt.frameOuterRadius(radius, camera.scale)
      : radius;
    shieldView.draw(ctx, player, { x, y, radius: shieldRadius }, elapsed);
    if (part.burnMs > elapsed)
      window.KillexEffects.drawBurn(
        ctx,
        displayed,
        performance.now(),
        camera.scale,
        reducedMotion.matches,
        part.burnMs - elapsed,
      );
    accessoryView.draw(ctx, player.outfit, {
      x,
      y,
      radius,
      scale: camera.scale,
    });
  }
  const nameMeasurements = new Map();
  document.fonts?.addEventListener("loadingdone", () => nameMeasurements.clear());
  function bodyNameLayout(player, displayed, x, scale) {
    const name = window.KillexIdentity.label(player);
    const medal = window.KillexIdentity.medalText(player);
    const available = x > 0 && x < width ? Math.max(12, 2 * Math.min(x, width - x) - 8) : Infinity;
    const layout = window.KillexArenaView.nameLayout(
      name,
      medal,
      displayed.radius,
      scale,
      (text, size) => {
        // Measure at one reference size. Camera/radius interpolation otherwise
        // creates hundreds of distinct font measurements each second.
        const font = "700 100px Inter, Arial, sans-serif",
          key = text;
        if (!nameMeasurements.has(key)) {
          ctx.font = font;
          nameMeasurements.set(key, ctx.measureText(text).width);
          if (nameMeasurements.size > 1024)
            nameMeasurements.delete(nameMeasurements.keys().next().value);
        }
        return (nameMeasurements.get(key) * size) / 100;
      },
      available,
    );
    return { name, medal, layout };
  }
  // Подписи и значки принадлежат слою своей части: передний шар перекрывает их.
  function drawBodyLabels(player, part, displayed, now, elapsed) {
    const p = player,
      d = displayed,
      scale = camera.scale;
    const ids = window.KillexEffects.active(p, elapsed);
    const x = (d.x - camera.x) * scale + width / 2;
    const y = (d.y - camera.y) * scale + height / 2;
    ctx.save();
    ctx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    let nameSize = 0;
    {
      const { name, medal, layout } = bodyNameLayout(p, d, x, scale);
      nameSize = layout.size;
      const nameX = x + layout.textOffset;
      const glow = p.account?.premium ? "#ef8cff" : p.account?.vip ? "#ffdb32" : null;
      bodyArt.text(
        ctx,
        name,
        nameX,
        y,
        nameSize,
        layout.textWidth,
        glow || "#fffaee",
        0.2,
        pixelRatio,
      );
      if (medal) {
        const badgeRadius = layout.badgeRadius,
          badgeX = x + layout.badgeOffset;
        const badgeArt = titleImage(p.title?.id);
        if (badgeArt?.complete && badgeArt.naturalWidth) {
          ctx.drawImage(
            badgeArt,
            badgeX - badgeRadius,
            y - badgeRadius,
            badgeRadius * 2,
            badgeRadius * 2,
          );
        } else {
          ctx.save();
          ctx.beginPath();
          ctx.arc(badgeX, y, badgeRadius, 0, Math.PI * 2);
          ctx.fillStyle = "#713b85";
          ctx.fill();
          ctx.strokeStyle = "#e2b75d";
          ctx.lineWidth = 2;
          ctx.stroke();
          ctx.font = `bold ${nameSize * 0.53}px Inter, Arial, sans-serif`;
          ctx.fillStyle = "#fff5dd";
          ctx.fillText(medal, badgeX, y);
          ctx.restore();
        }
      }
    }
    if (ids.length) {
      const effectY = y + nameSize * 0.5 + 4;
      effectsView.draw(ctx, ids, {
        x,
        y: effectY,
        radius: d.radius,
        scale,
        density: pixelRatio,
      });
    }
    ctx.restore();
  }
  function drawBodyMass(player, part, displayed, elapsed) {
    if (player.id !== myId || !preferences.showMass) return;
    const scale = camera.scale,
      x = (displayed.x - camera.x) * scale + width / 2,
      y = (displayed.y - camera.y) * scale + height / 2;
    ctx.save();
    ctx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    const nameSize = bodyNameLayout(player, displayed, x, scale).layout.size;
    const massSize = Math.max(
      8,
      Math.min(22, window.KillexArenaView.nameSize(displayed.radius, scale) * 0.85),
    );
    const effectsHeight = window.KillexEffects.layout(
          window.KillexEffects.active(player, elapsed).length,
          displayed.radius,
          scale,
        ).height;
    const massY = y + nameSize * 0.5 + massSize * 0.65 + 2 + (effectsHeight ? effectsHeight + 6 : 0);
    const text = formatMass(part.mass),
      maxWidth = Math.max(12, displayed.radius * scale * 1.65);
    bodyArt.text(ctx, text, x, massY, massSize, maxWidth, "#fff1c7", 0.18, pixelRatio);
    ctx.restore();
  }
  let lastViewportAt = -Infinity;
  function frame(now) {
    if (phase !== "arena") {
      frameId = null;
      return;
    }
    bodyArt.bodies.beginFrame();
    updateLifeClock(now);
    const dt = Math.min(0.05, Math.max(0, (now - lastFrameAt) / 1000));
    lastFrameAt = now;
    bodyMotion.advance(now);
    foodView.advance(bodyMotion.cursor);
    const presentation = bodyMotion.visible(true);
    const ordered = [],
      movingFood = [],
      projectiles = [],
      ownParts = [];
    const ownerCenters = new Map();
    for (const body of presentation) {
      if (body.kind === "food") {
        movingFood.push(body);
        continue;
      }
      if (body.kind === "projectile") {
        projectiles.push(body);
        continue;
      }
      ordered.push(body);
      if (body.kind) continue;
      const { player, part, key, position } = body;
      const displayed = smoothParts.get(key);
      if (!displayed) continue;
      displayed.frameAt = now;
      displayed.x = position.x;
      displayed.y = position.y;
      window.KillexArenaView.animateRadius(displayed, part.radius, dt);
      if (player.id === myId && !body.retiring)
        ownParts.push({
          id: key,
          x: displayed.x,
          y: displayed.y,
          radius: displayed.radius,
          mass: part.mass,
        });
      const center = ownerCenters.get(player.id) || { x: 0, y: 0, mass: 0 };
      center.x += displayed.x * part.mass;
      center.y += displayed.y * part.mass;
      center.mass += part.mass;
      ownerCenters.set(player.id, center);
    }
    for (const center of ownerCenters.values()) {
      center.x /= center.mass;
      center.y /= center.mass;
    }
    const me = getMe();
    if (me) {
      // Кадр строится по уже анимированным частям. Изменение массы любой
      // части не перескакивает к серверному центру, взвешенному по массе.
      const subject = { ...me, parts: ownParts };
      const view = window.KillexArenaView;
      const group = view.groupFrame(subject);
      view.followCenter(camera, group, dt, me.forcedMovement === true, ownParts);
      view.updateZoom(
        camera,
        view.desiredScale(subject, width, height, world, group),
        dt,
        view.minimumScale(width, height, world),
      );
    }
    ctx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    ctx.fillStyle = backgroundView.theme.outside;
    ctx.fillRect(0, 0, width, height);
    const scale = camera.scale;
    const ox = width / 2 - camera.x * scale;
    const oy = height / 2 - camera.y * scale;
    const left = camera.x - width / 2 / scale;
    const top = camera.y - height / 2 / scale;
    const right = left + width / scale;
    const bottom = top + height / scale;
    if (
      now - lastViewportAt >= 250 &&
      send({
        type: "viewport",
        x: camera.x,
        y: camera.y,
        width: width / scale,
        height: height / scale,
      })
    )
      lastViewportAt = now;
    ctx.save();
    ctx.translate(ox, oy);
    ctx.scale(scale, scale);
    backgroundView.draw(ctx, world, { left, top, right, bottom, scale });
    foodView.drawVisible(ctx, { left, top, right, bottom });
    foodView.drawMoving(ctx, movingFood, { left, top, right, bottom });
    const drawRadius = (body) =>
      body.kind === "hazard"
        ? body.part.radius
        : (smoothParts.get(body.key)?.radius ?? body.part.radius);
    // Колючки и яйца закрывают меньшие шары вместе с подписями и украшениями.
    // Равный или больший шар остаётся поверх колючки.
    ordered.sort(
      (a, b) =>
        drawRadius(a) - drawRadius(b) || Number(b.kind === "hazard") - Number(a.kind === "hazard"),
    );
    const groundShots = [],
      throughShots = [];
    for (const { part, position, age } of projectiles) {
      const shot = {
        ...part,
        x: position.x,
        y: position.y,
        heading: Math.atan2(part.dy || 0, part.dx || 0),
        spinMs: age,
      };
      (part.held || part.boosterId === "fire" || part.boosterId === "pet_fire"
        ? throughShots
        : groundShots
      ).push(shot);
    }
    const projectileOptions = {
      now,
      scale,
      left,
      top,
      right,
      bottom,
      reducedMotion: reducedMotion.matches,
      ownerFor: (ownerId) => ownerCenters.get(ownerId),
      bodyFor: (ownerId, partId) => {
        const body = smoothParts.get(ownerId + ":" + partId);
        return body?.frameAt === now ? body : undefined;
      },
    };
    // Physical contact is server-authoritative. Larger readable sprite fringes
    // must not cover a ball; only penetrating fire is drawn above the players.
    projectileView.draw(ctx, { ...projectileOptions, shots: groundShots });
    for (const { player: p, part, key, elapsed, opacity, kind, position } of ordered) {
      if (kind === "hazard") {
        if (part.alchemyIngredient) {
          window.KillexAlchemyArt.draw(ctx, part, position.x, position.y, position.radius ?? part.radius, now);
          continue;
        }
        window.KillexEasterRenderer.draw(ctx, [{ ...part, ...position }]);
        continue;
      }
      const d = smoothParts.get(key);
      if (
        d &&
        d.x + d.radius >= left &&
        d.x - d.radius <= right &&
        d.y + d.radius * 1.3 >= top &&
        d.y - d.radius * 1.9 <= bottom
      ) {
        ctx.save();
        ctx.globalAlpha *= opacity;
        if (p.departure)
          ctx.globalAlpha *= clamp((p.departure.remainingMs - elapsed) / p.departure.fadeMs, 0, 1);
        drawPlayer(p, d, part, elapsed);
        petsUI?.draw(ctx, p, part, d);
        drawBodyLabels(p, part, d, now, elapsed);
        // Масса — часть рисунка шара: следующие шары закрывают её вместе
        // с аватаром. Не выносим цифры поверх всех частей при слиянии.
        drawBodyMass(p, part, d, elapsed);
        ctx.restore();
      }
    }
    projectileView.draw(ctx, { ...projectileOptions, shots: throughShots });
    if (emoteView.active.size) {
      emoteView.prune(now);
      for (const { player, key, kind, opacity } of ordered) {
        const body = kind !== "hazard" && smoothParts.get(key);
        if (!body || !player || opacity <= 0) continue;
        ctx.save(); ctx.globalAlpha *= opacity;
        emoteView.draw(ctx, player, body, scale, now, { left, right, top, bottom });
        ctx.restore();
      }
    }
    ctx.restore();
    frameId = requestAnimationFrame(frame);
  }

  const titleImages = new Map();
  function titleImage(id) {
    const src = window.KillexProgressionArt.rank(id, 128);
    if (!src) return null;
    if (!titleImages.has(src)) {
      const img = new Image();
      img.src = src;
      titleImages.set(src, img);
    }
    return titleImages.get(src);
  }
  document.addEventListener("killex:maintenance", () => {
    resetInput(true);
    gameAudio.stop();
    transition?.finish();
    clearTimeout(connectTimer);connectTimer=null;
    clearInterval(inputTimer);inputTimer=null;
    if(frameId!==null){cancelAnimationFrame(frameId);frameId=null;}
    $("connectionLostDialog").close();
    refreshJoinControls();
  });
  ui.form.addEventListener("submit", joinArena);
  ui.cancel.addEventListener("click", () =>
    leaveArena("Подключение отменено. Ты остался в лобби."),
  );
  ui.leave.addEventListener("click", askToLeave);
  ui.previewName.textContent = "Путник";
  // Сохраняем ник целиком в одну строку, уменьшая шрифт только при нехватке места.
  const profileNameMeasure = document.createElement("canvas").getContext("2d");
  let profileNameFrame = 0;
  function fitProfileName() {
    cancelAnimationFrame(profileNameFrame);
    profileNameFrame = requestAnimationFrame(() => {
      const node = ui.previewName;
      node.style.fontSize = "";
      const available = node.clientWidth;
      if (!available) return;
      const style = getComputedStyle(node),
        base = parseFloat(style.fontSize);
      profileNameMeasure.font = style.font;
      const natural = profileNameMeasure.measureText(node.textContent).width;
      if (natural > available)
        node.style.fontSize = Math.floor(((base * available) / natural) * 100) / 100 + "px";
    });
  }
  new ResizeObserver(fitProfileName).observe(ui.previewName.parentElement);
  new MutationObserver(fitProfileName).observe(ui.previewName, {
    childList: true,
    characterData: true,
    subtree: true,
  });
  window.addEventListener("resize", fitProfileName);
  document.fonts.ready.then(fitProfileName);
  document.addEventListener("killex:profile", (event) => {
    ui.previewName.textContent = event.detail.name;
  });
  function showSkin(id, save = true) {
    const selected = SKINS.find((s) => s.id === id) || SKINS[0];
    preferences.previewSkin = selected.id;
    for (const s of SKINS)
      skinButtons.get(s.id)?.setAttribute("aria-pressed", String(s.id === selected.id));
    const source = skinImages.get(selected.id);
    if (source && !source.getAttribute("src"))
      window.KillexIdentity.setSkinImage(source, selected, 256);
    const portraitLoads = [];
    for (const target of [$("lobbySkin"), $("profileSkin")]) {
      if (!target.getAttribute("src")) target.hidden = true;
      portraitLoads.push(
        window.KillexIdentity.setSkinImageReady(
          target,
          selected,
          target.id === "profileSkin" ? 128 : 512,
        ).then((ready) => {
          if (ready && target.id === "lobbySkin") $("artEmpty").hidden = true;
          return ready;
        }),
      );
    }
    window.KillexBoot?.portraits(Promise.all(portraitLoads));
    $("artEmpty").hidden = !$("lobbySkin").hidden;
    if (save) persistPreferences();
    document.dispatchEvent(new CustomEvent("killex:skin-selected", { detail: selected.id }));
  }
  for (const s of SKINS) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "skin-option";
    button.setAttribute("aria-label", s.name);
    button.setAttribute("aria-pressed", "false");
    const thumb = document.createElement("span");
    thumb.className = "thumb";
    const missing = document.createElement("span");
    missing.textContent = "PNG";
    const img = new Image();
    img.hidden = true;
    img.alt = "";
    thumb.append(missing, img);
    button.append(thumb, document.createTextNode(s.name));
    button.addEventListener("click", () => showSkin(s.id));
    if (!s.tier && !s.set && !s.collection && !s.ownerGift) $("skinList").append(button);
    skinButtons.set(s.id, button);
    skinImages.set(s.id, img);
    let triedFallback = false;
    img.addEventListener("load", () => {
      img.hidden = false;
      missing.hidden = true;
      showSkin(preferences.previewSkin, false);
    });
    img.addEventListener("error", () => {
      if (!triedFallback) {
        triedFallback = true;
        img.removeAttribute("srcset");
        img.src = window.KillexIdentity.skinSource(SKINS[0], 256);
        return;
      }
      img.hidden = true;
      missing.hidden = false;
      showSkin(preferences.previewSkin, false);
    });
    if (!s.collection && !s.ownerGift) window.KillexIdentity.setSkinImage(img, s, 256);
  }
  function cycleSkin(delta) {
    const available = SKINS.filter((s) =>
      window.KillexIdentity.skinAllowed(
        s.id,
        boosterUI?.profile?.account,
        boosterUI?.profile?.appearance?.unlocked,
        boosterUI?.profile?.purchasedSkinCollections,
        boosterUI?.profile?.grantedSkins,
      ),
    );
    const i = available.findIndex((s) => s.id === preferences.previewSkin);
    showSkin(available[(i + delta + available.length) % available.length].id);
  }
  document.addEventListener("killex:choose-skin", (event) => {
    if (
      window.KillexIdentity.skinAllowed(
        event.detail,
        boosterUI?.profile?.account,
        boosterUI?.profile?.appearance?.unlocked,
        boosterUI?.profile?.purchasedSkinCollections,
        boosterUI?.profile?.grantedSkins,
      )
    )
      showSkin(event.detail);
  });
  document.addEventListener("killex:profile", (event) => {
    if (
      !window.KillexIdentity.skinAllowed(
        preferences.previewSkin,
        event.detail.account,
        event.detail.appearance?.unlocked,
        event.detail.purchasedSkinCollections,
        event.detail.grantedSkins,
      )
    )
      showSkin("moon-dragon");
  });
  $("previousSkin").addEventListener("click", () => cycleSkin(-1));
  $("nextSkin").addEventListener("click", () => cycleSkin(1));
  showSkin(preferences.previewSkin, false);
  document.addEventListener("killex:events-changed", () => boosterUI?.load(true));
  boosterUI = new window.KillexBoosterUI({
    catalogChanged: (catalog) => {
      projectileView.setCatalog([...catalog.items, ...Object.values(window.KillexPets.abilities)]);
      effectsView.setCatalog(catalog.items);
    },
    getMe,
    isArena: () => phase === "arena",
    isLobby: () => phase === "lobby",
    usePetAbility: (ability, aim) => petsUI?.use(ability, aim),
    send,
    stop: () => resetInput(true),
    getAim: () => {
      const me = getMe();
      if (me && stickId !== null && Math.hypot(stickVector.x, stickVector.y) >= 0.1)
        return {
          x: clamp(me.x + stickVector.x * 220, 0, world.width),
          y: clamp(me.y + stickVector.y * 220, 0, world.height),
        };
      const point = input.kind === "touch" ? input : aimPointer;
      return point ? {
        x: camera.x + (point.x - width / 2) / camera.scale,
        y: camera.y + (point.y - height / 2) / camera.scale,
      } : null;
    },
    getAppearance: () => ({ skinId: preferences.previewSkin }),
    waitForCosmetics: () => cosmeticsUI?.pending,
    inputBlocked: () =>
      window.KillexMaintenance?.blocked ||
      !ui.settings.hidden ||
      !!lifeResult ||
      $("leaveConfirmDialog").open ||
      !!arenaChat?.panel.root.contains(document.activeElement),
    readyChanged: (ready) => {
      if (ready) window.KillexBoot?.profileReady(boosterUI.profile);
      refreshJoinControls();
      if (!ready && phase === "lobby") waitForServer();
      else if (
        ready &&
        phase === "lobby" &&
        ui.lobbyStatus.textContent.includes("загрузить профиль")
      )
        setLobbyStatus("Нажми «Играть» или выбери арену для входа.");
    },
  });
  window.KillexBoot?.setRetry(() => boosterUI.load(true));
  document.addEventListener("killex:boot-ready", refreshJoinControls);
  new window.KillexRouletteUI({
    isLobby: () => phase === "lobby",
    inArena: () => boosterUI.serverInArena,
    getProfile: () => boosterUI.profile,
    loadProfile: () => boosterUI.load(true),
    updateProfile: (p) => boosterUI.updateProfile(p),
  });
  new window.KillexEventsPage({
    isLobby: () => phase === "lobby",
    getProfile: () => boosterUI.profile,
    loadProfile: () => boosterUI.load(true),
    updateProfile: (p) => boosterUI.updateProfile(p),
    showBoosterReward: (reward, offer) => boosterUI.chests.showReceived(reward, offer),
  });
  new window.KillexHallOfFame({
    isLobby: () => phase === "lobby",
    getProfile: () => boosterUI.profile,
  });
  petsUI = new window.KillexPetsUI({
    isLobby: () => phase === "lobby",
    isArena: () => phase === "arena",
    inArena: () => boosterUI.serverInArena,
    getProfile: () => boosterUI.profile,
    loadProfile: () => boosterUI.load(true),
    updateProfile: (p) => boosterUI.updateProfile(p),
    getMe,
    send,
    getAim: () => boosterUI.game.getAim(),
    inputBlocked: () => boosterUI.game.inputBlocked() || !!document.querySelector("dialog[open]"),
    notice: (text) => boosterUI.showArenaMessage(text),
    targetPet: (ability) => {
      boosterUI.targeting = {
        id: "pet_target",
        petAbility: ability,
        name: "Бустер питомца",
        target: "direction",
      };
      boosterUI.cancel.hidden = false;
      boosterUI.showArenaMessage("Коснись арены, чтобы направить бустер питомца.", 0);
    },
  });
  accessoryAbilityUI = new window.KillexAccessoryAbilityUI({
    isArena: () => phase === "arena",
    getMe,
    send,
    getAim: () => boosterUI.game.getAim(),
    inputBlocked: () => boosterUI.game.inputBlocked() || !!document.querySelector("dialog[open]"),
    notice: (text) => boosterUI.showArenaMessage(text),
  });
  arenaPicker = new window.KillexArenaPicker({
    join: () => joinArena(),
    isLobby: () => phase === "lobby",
    getProfile: () => boosterUI?.profile,
  });
  arenaChat = new window.KillexChat.ArenaChat(send, () => {
    feedHeld = false;
    boosterUI?.stopMassRepeat();
  });
  cosmeticsUI = new window.KillexCosmeticsUI({
    isLobby: () => phase === "lobby",
    getSkin: () => preferences.previewSkin,
    getProfile: () => boosterUI.profile,
    loadProfile: () => boosterUI.load(true),
    updateProfile: (profile) => boosterUI.updateProfile(profile),
    isProfileOnArena: () => boosterUI.serverInArena,
    openShop: () => boosterUI.openSkinShop(),
  });
  document.addEventListener("killex:open-skins", () => cosmeticsUI.openSkins());
  new window.KillexPersonalUI({
    isLobby: () => phase === "lobby",
    inArena: () => boosterUI.serverInArena,
    getProfile: () => boosterUI.profile,
    loadProfile: () => boosterUI.load(true),
    updateProfile: (p) => boosterUI.updateProfile(p),
  });
  new window.KillexQuestsUI({
    isLobby: () => phase === "lobby",
    inArena: () => boosterUI.serverInArena,
    getProfile: () => boosterUI.profile,
    loadProfile: () => boosterUI.load(true),
    updateProfile: (p) => boosterUI.updateProfile(p),
  });
  new window.KillexAccountsUI({
    isLobby: () => phase === "lobby",
    inArena: () => boosterUI.serverInArena,
    getProfile: () => boosterUI.profile,
    loadProfile: () => boosterUI.load(true),
    updateProfile: (p) => boosterUI.updateProfile(p),
  });
  new window.KillexPromotionsUI({
    isLobby: () => phase === "lobby",
    inArena: () => boosterUI.serverInArena,
    getProfile: () => boosterUI.profile,
    loadProfile: () => boosterUI.load(true),
    updateProfile: (p) => boosterUI.updateProfile(p),
  });
  new window.KillexClanUI({
    joinClanMember: id => joinArena(null, id),
    isLobby: () => phase === "lobby",
    beforeOpen: () => boosterUI.prepareArena(),
    updateProfile: (profile) => boosterUI.updateProfile(profile),
  });
  addEventListener("resize", resizeCanvas);
  applyMassPreference();
  syncFullscreen();
  refreshJoinControls();
  if (!ctx)
    setLobbyStatus("Этот браузер не поддерживает игру. Попробуй другой браузер.", true);
  else if (!("WebSocket" in window))
    setLobbyStatus("Этот браузер не поддерживает игру. Попробуй другой браузер.", true);
  else window.KillexBoot?.runtimeReady();
  // Здесь намеренно нет connect(), WebSocket, таймера движения или цикла арены.
})();
