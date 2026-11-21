"use strict";
const fs = require("node:fs"),
  path = require("node:path");
const { randomUUID, createHash } = require("node:crypto");
const { BoosterError } = require("../boosters/booster-catalog");
const { packs } = require("./event-packs");
const activities = require("./event-activities");
const object = (v) => v && typeof v === "object" && !Array.isArray(v);
const integer = (v) => Number.isSafeInteger(v) && v >= 0;
const identifier = (v) =>
  typeof v === "string" &&
  /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/.test(v) &&
  !["constructor", "prototype", "__proto__"].includes(v);
const hash = (v) => createHash("sha256").update(JSON.stringify(v)).digest("hex");
const actions = ["upload", "start", "stop", "duration", "reschedule"];
const maximumDuration = 129600 * 60000;
const minuteAligned = (at) => integer(at) && at % 60000 === 0;
function validEnd(startsAt, endsAt, at) {
  return (
    integer(endsAt) && endsAt > at && endsAt > startsAt && endsAt <= startsAt + maximumDuration
  );
}
function keys(value, allowed) {
  if (!object(value) || Object.keys(value).some((key) => !allowed.includes(key)))
    throw new BoosterError("В файле события есть неподдерживаемые поля.");
}
function manifest(input) {
  keys(input, [
    "schemaVersion",
    "id",
    "title",
    "description",
    "durationMinutes",
    "contentPack",
    "features",
  ]);
  if (input.schemaVersion !== 1 || !identifier(input.id))
    throw new BoosterError("Неверная версия формата или ID события.");
  if (
    typeof input.title !== "string" ||
    input.title.trim().length < 2 ||
    input.title.length > 80 ||
    typeof input.description !== "string" ||
    input.description.length > 600 ||
    /[\u0000-\u001f\u007f]/.test(input.title) ||
    /[\u0000-\u0008\u000b-\u001f\u007f]/.test(input.description)
  )
    throw new BoosterError("Укажи название до 80 символов и описание до 600 символов.");
  if (
    !integer(input.durationMinutes) ||
    input.durationMinutes < 1 ||
    input.durationMinutes > 129600
  )
    throw new BoosterError("Длительность события должна быть от 1 минуты до 90 дней.");
  if (typeof input.contentPack !== "string" || !Object.hasOwn(packs, input.contentPack))
    throw new BoosterError(
      "Набор содержимого не установлен на сервере. Сначала установи подготовленный набор события.",
    );
  keys(input.features, ["roulette", "lite"]);
  if (
    typeof input.features.roulette !== "boolean" ||
    typeof input.features.lite !== "boolean" ||
    (input.features.lite && !input.features.roulette)
  )
    throw new BoosterError(
      "Настройки рулетки и Lite должны быть true/false. Lite требует рулетку.",
    );
  if (input.contentPack === "core-v1" && !input.features.roulette)
    throw new BoosterError(
      "Для базового набора включи рулетку: других активностей в нём пока нет.",
    );
  return {
    schemaVersion: 1,
    id: input.id,
    title: input.title.trim(),
    description: input.description.trim(),
    durationMinutes: input.durationMinutes,
    contentPack: input.contentPack,
    features: { roulette: input.features.roulette, lite: input.features.lite },
  };
}
function validate(data) {
  if (
    !object(data) ||
    data.version !== 1 ||
    !integer(data.revision) ||
    !Array.isArray(data.prepared) ||
    !Array.isArray(data.runs) ||
    !Array.isArray(data.audit) ||
    !object(data.receipts)
  )
    throw Error("Неверное хранилище событий.");
  const ids = new Set();
  for (const entry of data.prepared) {
    manifest(entry.manifest);
    if (
      ids.has(entry.manifest.id) ||
      !integer(entry.uploadedAt) ||
      typeof entry.actorId !== "string"
    )
      throw Error("Неверная подготовка события.");
    ids.add(entry.manifest.id);
  }
  const runIds = new Set();
  for (const r of data.runs) {
    manifest(r.manifest);
    let expectedEnd = r.startsAt + r.manifest.durationMinutes * 60000;
    for (const edit of data.audit.filter((a) => a.action === "reschedule" && a.runId === r.id)) {
      if (
        !integer(edit.at) ||
        edit.at < (r.createdAt ?? r.startsAt) ||
        edit.at >= expectedEnd ||
        edit.previousEndsAt !== expectedEnd ||
        !validEnd(r.startsAt, edit.endsAt, edit.at) ||
        (r.stoppedAt !== null && edit.at > r.stoppedAt)
      )
        throw Error("Неверное изменение срока события.");
      expectedEnd = edit.endsAt;
    }
    if (
      !identifier(r.id) ||
      runIds.has(r.id) ||
      !integer(r.startsAt) ||
      !integer(r.endsAt) ||
      (r.createdAt !== undefined &&
        (!integer(r.createdAt) ||
          r.createdAt > r.startsAt ||
          !minuteAligned(r.startsAt) ||
          !minuteAligned(r.endsAt))) ||
      r.endsAt !== expectedEnd ||
      (r.stoppedAt !== null &&
        (!integer(r.stoppedAt) ||
          r.stoppedAt < (r.createdAt ?? r.startsAt) ||
          r.stoppedAt >= r.endsAt)) ||
      typeof r.actorId !== "string"
    )
      throw Error("Неверный запуск события.");
    runIds.add(r.id);
  }
  for (let i = 1; i < data.runs.length; i++) {
    const prev = data.runs[i - 1];
    if (data.runs[i].startsAt < (prev.stoppedAt ?? prev.endsAt))
      throw Error("Пересечение событий.");
  }
  for (const [id, r] of Object.entries(data.receipts))
    if (
      !identifier(id) ||
      !object(r) ||
      !/^[a-f0-9]{64}$/.test(r.signature) ||
      !actions.includes(r.action) ||
      !identifier(r.eventId) ||
      (r.runId !== null && !runIds.has(r.runId))
    )
      throw Error("Неверная квитанция события.");
  if (data.revision !== data.audit.length || data.revision !== Object.keys(data.receipts).length)
    throw Error("Нарушен журнал событий.");
  for (const a of data.audit)
    if (
      !integer(a.at) ||
      typeof a.actorId !== "string" ||
      !data.receipts[a.requestId] ||
      a.action !== data.receipts[a.requestId].action ||
      a.runId !== data.receipts[a.requestId].runId ||
      a.eventId !== data.receipts[a.requestId].eventId ||
      typeof a.title !== "string"
    )
      throw Error("Неверная запись журнала событий.");
  return data;
}
function atomic(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = file + ".tmp-" + randomUUID();
  let fd;
  try {
    fd = fs.openSync(temporary, "wx", 0o600);
    fs.writeFileSync(fd, JSON.stringify(data, null, 2) + "\n");
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = undefined;
    fs.renameSync(temporary, file);
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
  }
}
class EventManager {
  constructor({ filePath = null, now = Date.now, write = atomic } = {}) {
    this.filePath = filePath;
    this.now = now;
    this.write = write;
    this.data = { version: 1, revision: 0, prepared: [], runs: [], audit: [], receipts: {} };
    if (filePath && fs.existsSync(filePath)) {
      if (fs.statSync(filePath).size > 8 * 1024 * 1024)
        throw Error("Хранилище событий превышает допустимый размер.");
      this.data = validate(JSON.parse(fs.readFileSync(filePath, "utf8")));
    }
  }
  prepared() {
    const installed = [require("./lucky-week").manifest, require("./easter-hunt").manifest, require("./black-friday").manifest, require("../../../public/shared/alchemy-rules").manifest];
    return [
      ...installed.map(
        (manifest) =>
          this.data.prepared.find((e) => e.manifest.id === manifest.id) || {
            manifest,
            uploadedAt: 0,
            actorId: "installed",
          },
      ),
      ...this.data.prepared.filter((e) => !installed.some((m) => m.id === e.manifest.id)),
    ];
  }
  status(run, at = this.now()) {
    return run.stoppedAt !== null
      ? "stopped"
      : at >= run.endsAt
        ? "ended"
        : at >= run.startsAt
          ? "active"
          : "scheduled";
  }
  active(at = this.now()) {
    return this.availability(at).active;
  }
  scheduled(at = this.now()) {
    return this.availability(at).scheduled;
  }
  availability(at) {
    // Admin changes replace data only after durable write. Cache only the time
    // interval between lifecycle boundaries, never player progress or rewards.
    // A clock rollback or an explicit historical query also leaves the interval.
    const runs = this.data.runs, cached = this._availability;
    if (cached && cached.data === this.data && cached.runs === runs &&
        cached.length === runs.length && cached.revision === this.data.revision &&
        at >= cached.from && at < cached.until) return cached;
    let active = null, scheduled = null, from = -Infinity, until = Infinity;
    for (let i = runs.length - 1; i >= 0; i--) {
      const run = runs[i], status = this.status(run, at);
      if (!active && status === "active") active = run;
      if (!scheduled && status === "scheduled") scheduled = run;
      if (run.stoppedAt !== null) continue;
      for (const boundary of [run.startsAt, run.endsAt]) {
        if (boundary <= at) from = Math.max(from, boundary);
        else until = Math.min(until, boundary);
      }
    }
    return (this._availability = {
      data: this.data, runs, length: runs.length, revision: this.data.revision,
      from, until, active, scheduled,
    });
  }
  publicScheduled(at = this.now()) {
    const run = this.scheduled(at);
    return run
      ? {
          runId: run.id,
          ...activities.describe(structuredClone(run.manifest)),
          startsAt: run.startsAt,
          endsAt: run.endsAt,
        }
      : null;
  }
  publicView(at = this.now()) {
    const run = this.active(at);
    return run
      ? {
          runId: run.id,
          ...activities.describe(structuredClone(run.manifest)),
          startsAt: run.startsAt,
          endsAt: run.endsAt,
        }
      : null;
  }
  stamp(at = this.now()) {
    const run = this.active(at),
      linked =
        run &&
        activities.stamp(run.manifest);
    return `${this.data.revision}:${run?.id || "closed"}${linked ? ":" + linked : ""}`;
  }
  rouletteConfig(base, at = this.now()) {
    // Installed content and old testing flags do not open an event without an explicit launch.
    const run = this.active(at), features = run && activities.features(run.manifest);
    return {
      testEnabled: false,
      events:
        run && features.roulette
          ? [
              {
                id: run.id,
                startsAt: run.startsAt,
                endsAt: run.endsAt,
                lite: features.lite,
              },
            ]
          : [],
    };
  }
  view() {
    const at = this.now(),
      active = this.active(at);
    const displayRun = (run) =>
      run && {
        ...run,
        manifest: { ...run.manifest, features: activities.describe(run.manifest).features },
        linkedEvents: activities.describe(run.manifest).linkedEvents,
      };
    return structuredClone({
      revision: this.data.revision,
      serverNow: at,
      active: active ? { ...displayRun(active), status: "active" } : null,
      scheduled: displayRun(this.scheduled(at)),
      prepared: this.prepared().map((p) => ({
        ...p,
        manifest: { ...p.manifest, features: activities.describe(p.manifest).features },
      })),
      packs: Object.values(packs),
      runs: this.data.runs
        .slice(-30)
        .reverse()
        .map((r) => ({ ...displayRun(r), status: this.status(r, at) })),
      audit: this.data.audit.slice(-50).reverse(),
    });
  }
  apply(actorId, action, input) {
    if (typeof actorId !== "string" || !actorId) throw new BoosterError("Не указан владелец.", 403);
    if (!actions.includes(action) || !identifier(input.requestId) || !integer(input.revision))
      throw new BoosterError("Неверная операция события.");
    const command = {
      actorId,
      action,
      revision: input.revision,
      ...(action === "upload"
        ? { manifest: manifest(input.manifest) }
        : action === "duration"
          ? { eventId: input.eventId, durationMinutes: input.durationMinutes }
          : action === "reschedule"
            ? { runId: input.runId, endsAt: input.endsAt }
            : action === "start"
              ? {
                  eventId: input.eventId,
                  ...(input.startsAt === undefined ? {} : { startsAt: input.startsAt }),
                }
              : { runId: input.runId }),
    };
    if (
      (["start", "duration"].includes(action) && !identifier(input.eventId)) ||
      (["stop", "reschedule"].includes(action) && !identifier(input.runId))
    )
      throw new BoosterError("Не выбрано событие.");
    const signature = hash(command),
      previous = this.data.receipts[input.requestId];
    if (previous) {
      if (previous.signature !== signature)
        throw new BoosterError("Этот запрос уже использован для другой операции.", 409);
      return {
        duplicate: true,
        receipt: { action: previous.action, eventId: previous.eventId, runId: previous.runId },
        state: this.view(),
      };
    }
    if (input.revision !== this.data.revision)
      throw new BoosterError(
        "Список событий изменился. Обнови его и проверь параметры заново.",
        409,
      );
    const next = structuredClone(this.data),
      at = this.now(),
      active = this.active(at) || this.scheduled(at);
    let selected,
      runId = null;
    let timing = {};
    if (action === "upload" || action === "duration") {
      if (action === "duration") {
        const prepared = this.prepared().find((e) => e.manifest.id === input.eventId);
        if (!prepared) throw new BoosterError("Подготовленное событие не найдено.", 404);
        selected = manifest({ ...prepared.manifest, durationMinutes: input.durationMinutes });
        timing = {
          previousDurationMinutes: prepared.manifest.durationMinutes,
          durationMinutes: selected.durationMinutes,
        };
      } else selected = command.manifest;
      if (action === "upload" && active?.manifest.id === selected.id)
        throw new BoosterError("Нельзя заменять файл активного или запланированного события.", 409);
      next.prepared = next.prepared.filter((e) => e.manifest.id !== selected.id);
      if (next.prepared.length >= 100)
        throw new BoosterError("Достигнут лимит 100 подготовленных событий.", 409);
      next.prepared.push({ manifest: selected, uploadedAt: at, actorId });
    } else if (action === "start") {
      if (active)
        throw new BoosterError(
          "Сначала дождись окончания текущего события или отмени запланированный запуск.",
          409,
        );
      selected = this.prepared().find((e) => e.manifest.id === input.eventId)?.manifest;
      if (!selected) throw new BoosterError("Подготовленное событие не найдено.", 404);
      const startsAt =
        input.startsAt === undefined ? Math.ceil(at / 60000) * 60000 : input.startsAt;
      if (!minuteAligned(startsAt) || startsAt < at || startsAt > at + maximumDuration)
        throw new BoosterError(
          "Начало должно быть в будущем, с секундами 00, не дальше 90 дней.",
          409,
        );
      runId = randomUUID();
      next.runs.push({
        id: runId,
        manifest: structuredClone(selected),
        createdAt: at,
        startsAt,
        endsAt: startsAt + selected.durationMinutes * 60000,
        stoppedAt: null,
        actorId,
      });
    } else {
      if (!active || active.id !== input.runId)
        throw new BoosterError("Это событие уже завершено или сменилось.", 409);
      const run = next.runs.find((r) => r.id === input.runId);
      if (action === "reschedule") {
        if (!minuteAligned(input.endsAt) || !validEnd(run.startsAt, input.endsAt, at))
          throw new BoosterError(
            "Окончание должно быть в будущем, с секундами 00, не позднее 90 дней от начала события.",
          );
        timing = { previousEndsAt: run.endsAt, endsAt: input.endsAt };
        run.endsAt = input.endsAt;
      } else run.stoppedAt = at;
      selected = run.manifest;
      runId = run.id;
    }
    const receipt = { action, eventId: selected.id, runId };
    next.revision++;
    next.receipts[input.requestId] = { signature, ...receipt };
    next.audit.push({
      at,
      actorId,
      action,
      eventId: selected.id,
      title: selected.title,
      runId,
      requestId: input.requestId,
      ...timing,
    });
    validate(next);
    if (Buffer.byteLength(JSON.stringify(next, null, 2)) > 6 * 1024 * 1024)
      throw new BoosterError(
        "Журнал событий заполнен. Требуется архивирование администратором сервера.",
        409,
      );
    try {
      if (this.filePath) this.write(this.filePath, next);
    } catch (error) {
      console.error("Не удалось сохранить события: " + (error.code || "ошибка записи"));
      throw new BoosterError("Событие не изменено: не удалось сохранить данные. Повтори запрос.", 503);
    }
    this.data = next;
    return { duplicate: false, receipt, state: this.view() };
  }
}
module.exports = { EventManager, manifest, validate };
