"use strict";
(() => {
  const node = (tag, text, cls) => {
    const n = document.createElement(tag);
    if (text !== undefined) n.textContent = text;
    if (cls) n.className = cls;
    return n;
  };
  const button = (label, fn, cls) => {
    const b = node("button", label, cls);
    b.type = "button";
    b.onclick = fn;
    return b;
  };
  const date = (v) => new Date(v).toLocaleString("ru-RU", { timeZone: "Europe/Moscow" }) + " МСК";
  const dateInput = (v) => new Date(v + 3 * 3600000).toISOString().slice(0, 16);
  const parseMinute = (v) =>
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(v) ? Date.parse(v + ":00+03:00") : NaN;
  const duration = (n) =>
    n % 1440 === 0 ? `${n / 1440} дн.` : n % 60 === 0 ? `${n / 60} ч.` : `${n} мин.`;
  const labels = {
    upload: "Загружен",
    start: "Запуск назначен",
    stop: "Остановлен вручную",
    duration: "Изменён срок следующего запуска",
    reschedule: "Изменено окончание",
  };
  class EventManagerUI {
    constructor({ api }) {
      this.api = api;
      this.busy = false;
      this.pending = null;
      this.startDates = new Map();
      this.panel = document.getElementById("eventsPanel");
      const head = node("div", undefined, "section-title"),
        title = node("h2", "События");
      title.id = "eventsTitle";
      this.refresh = button("Обновить", () =>
        this.load().catch((e) => this.message(e.message, true)),
      );
      head.append(title, this.refresh);
      this.status = node(
        "p",
        "Загрузи подготовленный файл события. Запуск потребует пароль админ-панели.",
        "muted",
      );
      this.messageBox = node("p", "", "event-message");
      this.messageBox.setAttribute("role", "status");
      this.messageBox.setAttribute("aria-live", "polite");
      const upload = node("form", undefined, "event-upload"),
        label = node("label", "Подготовленное событие, JSON до 3,5 КБ");
      this.file = node("input");
      this.file.type = "file";
      this.file.accept = ".json,application/json";
      this.file.id = "eventFile";
      this.file.required = true;
      label.append(this.file);
      this.uploadButton = node("button", "Загрузить и проверить");
      this.uploadButton.type = "submit";
      upload.append(label, this.uploadButton);
      upload.onsubmit = (e) => {
        e.preventDefault();
        this.upload();
      };
      this.active = node("div", undefined, "event-active");
      this.prepared = node("div", undefined, "event-prepared");
      const guide = node("details", undefined, "event-guide");
      guide.append(
        node("summary", "Как подготовить и запустить событие"),
        node(
          "p",
          "1. Загрузи JSON с параметрами подготовленного события. Загрузка сохраняет его в админке, игрокам оно ещё недоступно.",
        ),
        node(
          "p",
          "2. Выбери длительность или задай дни, часы и минуты, затем сохрани срок. Начало можно назначить на точную дату по Москве. Пустое поле означает ближайшую полную минуту после подтверждения паролем.",
        ),
        node(
          "p",
          "3. Начало и окончание сохраняются с секундами 00. До назначенного старта событие недоступно игрокам. Открытая игра обновится автоматически в течение 20 секунд. Запланированный запуск можно отменить.",
        ),
        node(
          "p",
          "Формат: schemaVersion: 1; id: уникальный латинский ID; title: название; description: описание; durationMinutes: срок в минутах; contentPack: ID установленного набора; features: { roulette: true, lite: true или false }.",
        ),
        node(
          "p",
          "«Удачная неделя» уже подготовлена: рулетка, Lite и пять достижений. Срок по умолчанию - 7 дней, его можно изменить здесь. У активного события можно изменить дату окончания с подтверждением паролем. Все даты указаны по Москве.",
        ),
        node(
          "p",
          "Рулетка и Lite доступны только во время активного события. Между событиями кнопка рулетки заблокирована, баланс билетов скрыт. Билеты и заработанные награды сохраняются.",
        ),
      );
      const history = node("details", undefined, "event-guide");
      history.append(node("summary", "Журнал событий"));
      this.history = node("div", undefined, "event-history");
      history.append(this.history);
      this.retry = button("Повторить тот же запрос", () => this.retryPending());
      this.retry.hidden = true;
      this.panel.append(
        head,
        this.status,
        upload,
        this.messageBox,
        this.retry,
        this.active,
        node("h3", "Подготовленные события"),
        this.prepared,
        guide,
        history,
      );
      this.dialog = node("dialog", undefined, "event-confirm");
      this.dialog.id = "eventConfirm";
      this.dialog.setAttribute("aria-labelledby", "eventConfirmTitle");
      const form = node("form"),
        heading = node("h2");
      heading.id = "eventConfirmTitle";
      this.heading = heading;
      this.summary = node("p", undefined, "event-confirm-summary");
      const passwordLabel = node("label", "Пароль админ-панели");
      this.password = node("input");
      this.password.id = "eventPassword";
      this.password.name = "event-password";
      Object.assign(this.password, {
        type: "password",
        autocomplete: "current-password",
        minLength: 12,
        maxLength: 128,
        required: true,
      });
      passwordLabel.append(this.password);
      this.error = node("p", "", "event-error");
      this.error.setAttribute("role", "alert");
      this.cancel = button("Отмена", () => this.dialog.close());
      this.submit = node("button", "Подтвердить запуск", "primary");
      this.submit.type = "submit";
      const actions = node("div", undefined, "dialog-actions");
      actions.append(this.cancel, this.submit);
      form.append(heading, this.summary, passwordLabel, this.error, actions);
      form.onsubmit = (e) => {
        e.preventDefault();
        const password = this.password.value;
        this.password.value = "";
        this.commit(password);
      };
      this.dialog.append(form);
      document.body.append(this.dialog);
      this.dialog.addEventListener("cancel", (e) => {
        if (this.busy) e.preventDefault();
      });
      this.dialog.addEventListener("close", () => {
        this.password.value = "";
        if (!this.sent) this.pending = null;
        this.render();
      });
      this.clock = window.KillexActivity.every(() => {
        if (this.state && !this.busy && !document.hidden) this.render();
      }, 1000, () => window.KillexActivity.visible(this.panel));
    }
    message(text, error = false) {
      this.messageBox.textContent = text;
      this.messageBox.classList.toggle("event-error", error);
    }
    lock() {
      this.state = null;
      this.renderKey = null;
      this.password.value = "";
      this.dialog.close();
      this.active.replaceChildren();
      this.prepared.replaceChildren();
      this.history.replaceChildren();
    }
    async load() {
      const state = await this.api("events");
      if (document.getElementById("workspace").hidden) return;
      this.state = state;
      this.offset = state.serverNow - Date.now();
      this.render();
    }
    render() {
      if (!this.state) return;
      const now = Date.now() + this.offset,
        current = this.state.active || this.state.scheduled,
        active = current?.endsAt > now ? current : null,
        scheduled = active && active.startsAt > now;
      this.status.textContent = active
        ? scheduled
          ? "Запуск запланирован. Событие откроется в назначенную минуту."
          : "Событие работает. Новое событие можно запустить после его завершения."
        : "Активного события нет. Загрузка файла не запускает событие.";
      const disabled = this.busy || !!this.pending;
      window.KillexControls.state(this.file, disabled, false);
      window.KillexControls.state(this.uploadButton, disabled, false);
      window.KillexControls.state(this.refresh, this.busy, false);
      this.retry.hidden = !this.pending || !this.sent || this.busy;
      const key = `${this.state.revision}:${!!active}:${!!scheduled}:${disabled}`;
      if (key !== this.renderKey) {
        this.startPreviews = [];
        this.active.replaceChildren();
        if (active) {
          const box = node("article", undefined, "event-live-card");
          box.append(
            node("span", scheduled ? "Запланирован" : "Сейчас в игре", "event-tag"),
            node("h3", active.manifest.title),
            node("p", `Начало: ${date(active.startsAt)}. Окончание: ${date(active.endsAt)}.`),
          );
          const stop = button(scheduled ? "Отменить запуск" : "Завершить досрочно", () =>
            this.confirm("stop", active),
          );
          window.KillexControls.state(stop, disabled, false);
          const timing = node("form", undefined, "event-timing"),
            label = node("label", "Дата и время окончания, МСК"),
            end = node("input");
          Object.assign(end, {
            type: "datetime-local",
            name: "event-end",
            required: true,
            value: dateInput(active.endsAt),
            step: "60",
            min: dateInput(Math.ceil((Date.now() + this.offset + 1) / 60000) * 60000),
            max: dateInput(active.startsAt + 90 * 86400000),
            disabled,
          });
          label.append(end);
          const save = node("button", "Изменить окончание");
          save.type = "submit";
          window.KillexControls.state(save, disabled, false);
          timing.append(label, save);
          timing.onsubmit = (e) => {
            e.preventDefault();
            const endsAt = parseMinute(end.value);
            if (!Number.isSafeInteger(endsAt) || endsAt <= Date.now() + this.offset) {
              this.message("Укажи дату окончания в будущем.", true);
              return;
            }
            this.confirm("reschedule", active, { endsAt });
          };
          box.append(
            timing,
            node(
              "p",
              "Изменение срока сохранит прогресс текущего запуска. Lite будет действовать до новой даты. Общий срок - не более 90 дней.",
              "muted",
            ),
            stop,
          );
          this.active.append(box);
        }
        // Avoid replacing cards under the focused button every second.
        this.renderKey = key;
        this.prepared.replaceChildren();
        for (const entry of this.state.prepared) {
          const m = entry.manifest,
            card = node("article", undefined, "event-card");
          const pack = this.state.packs.find((p) => p.id === m.contentPack);
          card.append(
            node("h3", m.title),
            node("p", m.description || "Описание не задано."),
            node(
              "p",
              `Длительность: ${duration(m.durationMinutes)}. Рулетка: ${m.features.roulette ? "да" : "нет"}. Lite: ${m.features.lite ? "да" : "нет"}.`,
            ),
            node(
              "small",
              `Набор: ${pack?.title || m.contentPack}. Достижений: ${pack?.achievements.length || 0}, шапок: ${pack?.hats.length || 0}, бабочек: ${pack?.bows.length || 0}, наград: ${pack?.rewards.length || 0}.`,
              "muted",
            ),
          );
          const startLabel = node("label", "Начало по Москве"),
            startDate = node("input"),
            preview = node("p", "", "muted event-interval-preview");
          Object.assign(startDate, {
            type: "datetime-local",
            name: "event-start",
            step: "60",
            min: dateInput(Math.ceil(now / 60000) * 60000),
            max: dateInput(now + 90 * 86400000),
            disabled: disabled || !!active,
            value: this.startDates.get(m.id) || "",
          });
          startLabel.className = "event-start-time";
          startLabel.append(startDate);
          const start = button(
            "Запустить",
            () => {
              const startsAt = parseMinute(startDate.value);
              if (
                startDate.value &&
                (!Number.isSafeInteger(startsAt) || startsAt < Date.now() + this.offset)
              ) {
                this.message("Выбери начало в будущем с точностью до минуты.", true);
                return;
              }
              this.confirm("start", entry, startDate.value ? { startsAt } : {});
            },
            "primary event-start",
          );
          window.KillexControls.state(start, disabled || !!active, !!active);
          const timing = node("form", undefined, "event-duration-form"),
            fields = node("div", undefined, "event-duration-fields"),
            inputs = [];
          const parts = [
            Math.floor(m.durationMinutes / 1440),
            Math.floor((m.durationMinutes % 1440) / 60),
            m.durationMinutes % 60,
          ];
          for (const [i, text] of ["Дни", "Часы", "Минуты"].entries()) {
            const label = node("label", text),
              input = node("input");
            Object.assign(input, {
              type: "number",
              name: ["days", "hours", "minutes"][i],
              min: "0",
              max: String([90, 23, 59][i]),
              step: "1",
              value: String(parts[i]),
              required: true,
              disabled,
            });
            label.append(input);
            fields.append(label);
            inputs.push(input);
          }
          const total = () =>
            inputs.reduce((sum, input, i) => sum + input.valueAsNumber * [1440, 60, 1][i], 0);
          const updatePreview = () => {
            const begins = startDate.value
                ? parseMinute(startDate.value)
                : Math.ceil((Date.now() + this.offset) / 60000) * 60000,
              minutes = total();
            preview.textContent =
              Number.isSafeInteger(begins) &&
              Number.isSafeInteger(minutes) &&
              minutes >= 1 &&
              minutes <= 129600
                ? `${startDate.value ? "Начало" : "Ближайший старт"}: ${date(begins)}\nОкончание: ${date(begins + minutes * 60000)}`
                : "Укажи корректный срок и дату начала.";
          };
          startDate.oninput = () => {
            this.startDates.set(m.id, startDate.value);
            updatePreview();
          };
          this.startPreviews.push(updatePreview);
          const hint = node(
            "p",
            "От 1 минуты до 90 дней. Срок отсчитывается после запуска.",
            "muted event-duration-hint",
          );
          const save = node("button", "Сохранить срок");
          save.type = "submit";
          window.KillexControls.state(save, disabled, false);
          fields.oninput = () => {
            const dirty = total() !== m.durationMinutes;
            window.KillexControls.state(start, disabled || !!active || dirty, !!active || dirty);
            hint.textContent = dirty
              ? "Сохрани новый срок перед запуском."
              : "От 1 минуты до 90 дней. Срок отсчитывается после запуска.";
            updatePreview();
          };
          const presets = node("div", undefined, "event-duration-presets");
          for (const minutes of [60, 180, 360, 720, 1440, 4320, 10080]) {
            const preset = button(duration(minutes), () => {
              [Math.floor(minutes / 1440), Math.floor((minutes % 1440) / 60), minutes % 60].forEach(
                (v, i) => {
                  inputs[i].value = String(v);
                },
              );
              fields.oninput();
            });
            window.KillexControls.state(preset, disabled, false);
            presets.append(preset);
          }
          timing.onsubmit = (e) => {
            e.preventDefault();
            const minutes = total();
            if (!Number.isSafeInteger(minutes) || minutes < 1 || minutes > 129600) {
              this.message("Длительность должна быть от 1 минуты до 90 дней.", true);
              return;
            }
            if (this.busy || this.pending) return;
            this.sent = false;
            this.pending = {
              action: "duration",
              body: {
                eventId: m.id,
                durationMinutes: minutes,
                revision: this.state.revision,
                requestId: window.KillexRequestIds.create(),
              },
            };
            this.commit();
          };
          timing.append(node("h4", "Длительность следующего запуска"), presets, fields, hint, save);
          card.append(
            timing,
            startLabel,
            node(
              "small",
              "Пустая дата - ближайшая минута после подтверждения. Секунды всегда 00.",
              "muted",
            ),
            preview,
            start,
          );
          this.prepared.append(card);
        }
        if (!this.state.prepared.length)
          this.prepared.append(node("p", "События ещё не загружены.", "muted"));
        this.history.replaceChildren();
        for (const a of this.state.audit)
          this.history.append(
            node(
              "p",
              `${date(a.at)} - ${labels[a.action]}: ${a.title}. ${a.action === "reschedule" ? `${date(a.previousEndsAt)} → ${date(a.endsAt)}. ` : a.action === "duration" ? `${duration(a.previousDurationMinutes)} → ${duration(a.durationMinutes)}. ` : ""}Владелец: ${a.actorId}`,
            ),
          );
        if (!this.state.audit.length) this.history.append(node("p", "Операций пока нет.", "muted"));
      }
      for (const update of this.startPreviews || []) update();
    }
    async upload() {
      if (this.busy || this.pending || !this.state) return;
      try {
        const file = this.file.files[0];
        if (!file) return;
        if (file.size > 3500) throw Error("Файл слишком большой. Допустимо до 3,5 КБ.");
        let manifest;
        try {
          manifest = JSON.parse(await file.text());
        } catch (_) {
          throw Error("Не удалось прочитать JSON. Проверь формат файла.");
        }
        if (this.busy || this.pending || !this.state) return;
        this.pending = {
          action: "upload",
          body: {
            manifest,
            revision: this.state.revision,
            requestId: window.KillexRequestIds.create(),
          },
        };
        await this.commit();
      } catch (error) {
        this.message(error.message, true);
      }
    }
    confirm(action, entry, extra = {}) {
      if (this.busy || this.pending || !this.state) return;
      this.sent = false;
      this.pending = {
        action,
        title: entry.manifest.title,
        duration: entry.manifest.durationMinutes,
        previousEndsAt: entry.endsAt,
        scheduled: entry.startsAt > Date.now() + this.offset,
        body: {
          revision: this.state.revision,
          requestId: window.KillexRequestIds.create(),
          ...(action === "start" ? { eventId: entry.manifest.id } : { runId: entry.id }),
          ...extra,
        },
      };
      this.openConfirmation();
    }
    openConfirmation() {
      const start = this.pending.action === "start";
      this.heading.textContent = start ? "Запуск события" : "Завершение события";
      this.summary.textContent = start
        ? `«${this.pending.title}». ${this.pending.body.startsAt === undefined ? "Начало - ближайшая полная минута после подтверждения." : `Начало: ${date(this.pending.body.startsAt)}. Окончание: ${date(this.pending.body.startsAt + this.pending.duration * 60000)}.`} Срок: ${duration(this.pending.duration)}. Секунды начала и окончания - 00. Билеты и награды игроков сохранятся.`
        : `Завершить «${this.pending.title}» сейчас? Доступ к рулетке и Lite этого события закроется. Билеты и заработанные награды сохранятся.`;
      this.submit.textContent = start ? "Подтвердить запуск" : "Завершить событие";
      if (this.pending.action === "stop" && this.pending.scheduled) {
        this.heading.textContent = "Отмена запуска";
        this.summary.textContent = `Отменить запланированный запуск «${this.pending.title}»? Событие ещё не началось.`;
        this.submit.textContent = "Отменить запуск";
      }
      if (this.pending.action === "reschedule") {
        this.heading.textContent = "Изменение срока события";
        this.summary.textContent = `«${this.pending.title}». Сейчас окончание: ${date(this.pending.previousEndsAt)}. Новое окончание: ${date(this.pending.body.endsAt)}. Прогресс и награды сохранятся. Срок Lite изменится вместе с событием. Длительность следующих запусков задаётся отдельно.`;
        this.submit.textContent = "Подтвердить новый срок";
      }
      this.password.value = "";
      this.error.textContent = "";
      this.dialog.showModal();
      this.password.focus();
      this.render();
    }
    retryPending() {
      if (this.pending && !this.busy)
        ["upload", "duration"].includes(this.pending.action)
          ? this.commit()
          : this.openConfirmation();
    }
    async commit(password) {
      if (!this.pending || this.busy) return;
      this.busy = true;
      this.sent = true;
      this.error.textContent = "";
      window.KillexControls.state(this.cancel, true, false);
      window.KillexControls.state(this.submit, true, false);
      this.render();
      const pending = this.pending;
      try {
        const result = await this.api("events/" + pending.action, {
          ...pending.body,
          ...(password === undefined ? {} : { password }),
        });
        this.state = result.state;
        if (pending.action === "start") this.startDates.delete(pending.body.eventId);
        this.offset = result.state.serverNow - Date.now();
        this.pending = null;
        this.sent = false;
        this.dialog.close();
        this.message(
          result.duplicate
            ? "Операция уже сохранена. Повторного запуска нет."
            : pending.action === "upload"
              ? "Файл проверен и сохранён. Можно проверить карточку и запустить событие."
              : pending.action === "duration"
                ? "Срок следующего запуска сохранён. Текущее событие не изменено."
                : pending.action === "reschedule"
                  ? "Новое окончание сохранено. Открытые клиенты обновятся автоматически."
                  : pending.action === "start"
                    ? "Запуск сохранён. Событие откроется в назначенную минуту, клиенты обновятся автоматически."
                    : pending.scheduled
                      ? "Запланированный запуск отменён."
                      : "Событие завершено.",
        );
        if (pending.action === "upload") this.file.value = "";
      } catch (error) {
        const uncertain = !error.status || [401, 429, 500, 503].includes(error.status);
        if (!uncertain) this.sent = false;
        if (
          (["upload", "duration"].includes(pending.action) && !uncertain) ||
          [404, 409].includes(error.status)
        ) {
          this.pending = null;
          this.sent = false;
          this.dialog.close();
          if (error.status === 409) await this.load().catch(() => {});
        }
        this.error.textContent =
          error.name === "AbortError"
            ? "Ответ не получен. Повтори подтверждение: запрос защищён от повторного запуска."
            : error.message;
        this.message(this.error.textContent, true);
        if (this.dialog.open) this.password.focus();
      } finally {
        this.busy = false;
        window.KillexControls.state(this.cancel, false);
        window.KillexControls.state(this.submit, false);
        this.render();
      }
    }
  }
  window.KillexEventManager = EventManagerUI;
})();
