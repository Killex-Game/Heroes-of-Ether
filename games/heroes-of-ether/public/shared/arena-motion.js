/* Отрисовка позиций между серверными шагами, без изменения игровой физики. */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.KillexArenaMotion = api;
})(typeof globalThis !== "undefined" ? globalThis : this, () => {
  "use strict";
  const clamp = (n, min, max) => Math.max(min, Math.min(max, n));
  class Motion {
    constructor({ tickMs = 50, delayMs = 120, fadeMs = 200 } = {}) {
      this.tickMs = tickMs;
      this.delayMs = delayMs;
      this.fadeMs = fadeMs;
      this.clear();
    }
    clear() {
      this.tracks = new Map();
      this.presentLives = new Set();
      this.arrivals = [];
      this.latest = null;
      this.cursor = null;
      this.lastFrame = null;
      this.lastReceived = null;
      this.rate = 1;
      this.serverRate = 1;
      this.requestedDelay = this.delayMs;
      this.playbackDelayMs = this.delayMs;
      this.contactRemainder = 0;
    }
    sync(bodies, tick, now, endings = [], contacts = []) {
      if (!Number.isSafeInteger(tick) || tick < 0 || !Number.isFinite(now)) return;
      const time = tick * this.tickMs;
      if (this.latest !== null && time < this.latest) return;
      // После длительной паузы не проигрываем накопившийся старый путь.
      const reset = this.latest === null || now - this.lastReceived > 500;
      if (reset) {
        this.tracks.clear();
        this.arrivals = [];
        this.cursor = time - this.delayMs;
        this.lastFrame = now;
        this.rate = 1;
        this.playbackDelayMs = this.delayMs;
        this.contactRemainder = 0;
      }
      if (this.latest === null || time > this.latest || reset) {
        this.arrivals.push({ time, at: now });
        while (
          this.arrivals.length > 24 ||
          (this.arrivals.length > 2 && now - this.arrivals[0].at > 1200)
        )
          this.arrivals.shift();
        this.updateArrivalTiming();
      }
      this.latest = time;
      this.lastReceived = now;
      const alive = new Set();
      const lives = new Set();
      for (const record of bodies) {
        const { key, player, part } = record;
        if (!Number.isFinite(part.x) || !Number.isFinite(part.y)) continue;
        alive.add(key);
        const life = player.id + ":" + player.spawnSerial;
        if (!record.kind) lives.add(life);
        let track = this.tracks.get(key);
        if (!track || track.spawnSerial !== player.spawnSerial) {
          const birth =
            !reset &&
            part.birth &&
            Number.isSafeInteger(part.birth.tick) &&
            part.birth.tick >= 0 &&
            part.birth.tick * this.tickMs <= time &&
            time - part.birth.tick * this.tickMs < 1000 &&
            Number.isFinite(part.birth.x) &&
            Number.isFinite(part.birth.y) &&
            (record.kind === "food" || record.kind === "hazard" || this.presentLives.has(life))
              ? { ...part.birth, time: part.birth.tick * this.tickMs }
              : null;
          track = {
            spawnSerial: player.spawnSerial,
            points: [],
            born: birth ? birth.time : reset || track ? time - this.delayMs : time,
            birth,
            createdAt: now,
            fadeIn: !record.kind && !player.departure && !this.presentLives.has(life),
            fadeOutMs: 0,
          };
          if (birth && birth.time < time) track.points.push({ ...birth, record });
          this.tracks.set(key, track);
        }
        delete track.removedAt;
        const origin = track.birth?.time === time ? track.birth : part;
        const point = { time, x: origin.x, y: origin.y, record },
          points = track.points;
        // Бустер или деление могут прислать дополнительное состояние того же шага.
        if (points.at(-1)?.time === time) points[points.length - 1] = point;
        else points.push(point);
        while (
          points.length > 32 ||
          (points.length > 2 && points[1].time < this.cursor - this.tickMs)
        )
          points.shift();
      }
      this.presentLives = lives;
      // При пропуске промежуточного снимка цель остаётся у места контакта
      // до попадания, а не начинает подтягиваться навстречу летящему крюку.
      for (const contact of contacts) {
        const track = this.tracks.get(contact.key),
          contactTime = contact.tick * this.tickMs;
        if (
          !track ||
          !Number.isSafeInteger(contact.tick) ||
          contactTime > time ||
          !Number.isFinite(contact.x) ||
          !Number.isFinite(contact.y)
        )
          continue;
        const points = track.points,
          index = points.findIndex((point) => point.time >= contactTime);
        if (index > 0 && points[index].time !== contactTime) {
          points.splice(index, 0, {
            ...points[index - 1],
            time: contactTime,
            x: contact.x,
            y: contact.y,
          });
          while (points.length > 32) points.shift();
        }
      }
      // Исчезновение и рост массы показываем на тех же часах, что и движение.
      // Последняя подтверждённая точка контакта не теряется между снимками.
      for (const end of endings) {
        const track = this.tracks.get(end.key);
        const endTime = end.tick * this.tickMs;
        if (
          !track ||
          alive.has(end.key) ||
          !Number.isSafeInteger(end.tick) ||
          endTime > time ||
          !Number.isFinite(end.x) ||
          !Number.isFinite(end.y)
        )
          continue;
        const last = track.points.at(-1);
        if (endTime < last.time) continue;
        const point = { ...last, time: endTime, x: end.x, y: end.y };
        if (endTime === last.time) track.points[track.points.length - 1] = point;
        else track.points.push(point);
        track.removedAt = endTime;
        track.fadeOutMs = end.reason === "fire" ? this.fadeMs : 0;
        // Only pulls must show a contact frame before moving their target.
        // Ordinary shots use the endpoint without stalling the shared timeline.
        track.contact = last.record.kind === "projectile" && end.hold !== false;
      }
      for (const [key, track] of this.tracks) {
        if (!alive.has(key)) track.removedAt ??= time;
        if (
          (!track.contact || track.contactShown) &&
          track.removedAt + track.fadeOutMs <= this.cursor
        )
          this.tracks.delete(key);
      }
    }
    updateArrivalTiming() {
      const first = this.arrivals[0],
        last = this.arrivals.at(-1);
      const elapsed = last.at - first.at;
      const serverRate = elapsed >= 300 ? clamp((last.time - first.time) / elapsed, 0.5, 1.05) : 1;
      // Reserve a little more confirmed history on a jittery connection. The
      // cursor never rewinds or predicts collisions; a quiet link returns to
      // its normal latency gradually rather than speeding up abruptly.
      const jitter = this.arrivals
        .slice(1)
        .map((arrival, i) => {
          const previous = this.arrivals[i];
          return Math.max(
            0,
            arrival.at - previous.at - (arrival.time - previous.time) / serverRate,
          );
        })
        .sort((a, b) => a - b);
      const reserve = jitter[Math.floor(jitter.length * 0.95)] || 0;
      this.serverRate = serverRate;
      this.requestedDelay = clamp(
        this.delayMs + reserve,
        this.delayMs,
        Math.max(this.delayMs, 240),
      );
    }
    advance(now) {
      if (this.latest === null) return;
      const dt = Math.max(0, now - this.lastFrame);
      this.lastFrame = now;
      if (dt > 500) {
        this.cursor = Math.max(this.cursor, this.latest - this.delayMs);
        return;
      }
      this.playbackDelayMs = Math.max(this.requestedDelay, this.playbackDelayMs - dt * 0.008);
      // Малые колебания доставки не превращаем в ускорения каждого кадра.
      const buffered = this.latest - this.cursor;
      const correction = clamp((buffered - this.playbackDelayMs) / 1500, -0.08, 0.08);
      const targetRate = clamp(this.serverRate + correction, 0.5, 1.1);
      this.rate += (targetRate - this.rate) * (1 - Math.exp(-dt / 400));
      let next = Math.min(this.latest, this.cursor + dt * this.rate + this.contactRemainder);
      const proposed = next;
      // Даже редкий кадр должен показать само касание прежде, чем начнётся перенос.
      for (const track of this.tracks.values())
        if (
          track.contact &&
          !track.contactShown &&
          track.removedAt >= this.cursor &&
          track.removedAt < next
        )
          next = track.removedAt;
      this.cursor = next;
      this.contactRemainder = Math.min(this.tickMs, proposed - next);
    }
    sample(key) {
      return this.sampleTrack(this.tracks.get(key));
    }
    sampleTrack(track) {
      if (track?.contact && !track.contactShown && this.cursor >= track.removedAt) {
        track.samplePoint = track.points.at(-1);
        return track.samplePoint;
      }
      if (!track || this.cursor < track.born || this.cursor >= track.removedAt + track.fadeOutMs)
        return null;
      const points = track.points;
      if (!points?.length) return null;
      if (this.cursor <= points[0].time) {
        track.samplePoint = points[0];
        return points[0];
      }
      for (let i = 1; i < points.length; i++) {
        const b = points[i],
          a = points[i - 1];
        if (b.time >= this.cursor) {
          track.samplePoint = this.cursor < b.time ? a : b;
          if (
            b.record.kind === "projectile" &&
            b.record.part.motionVersion !== a.record.part.motionVersion
          )
            return this.cursor < b.time ? a : b;
          const t = clamp((this.cursor - a.time) / (b.time - a.time), 0, 1);
          return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
        }
      }
      // При потере связи не летим сквозь стены за последнюю подтверждённую точку.
      track.samplePoint = points.at(-1);
      return track.samplePoint;
    }
    visible(reuseForFrame = false) {
      const records = [];
      for (const track of this.tracks.values()) {
        const position = this.sampleTrack(track);
        if (!position) continue;
        const point = track.samplePoint;
        const retiring = this.cursor >= track.removedAt;
        const fade =
          point.record.kind || (!retiring && !track.fadeIn)
            ? 1
            : clamp(
                retiring
                  ? 1 - (this.cursor - track.removedAt) / track.fadeOutMs
                  : (this.cursor - track.born) / this.fadeMs,
                0,
                1,
              );
        // The render loop consumes these synchronously. Other callers can keep
        // a previous frame without later interpolation changing its records.
        let record = reuseForFrame && track.renderSource === point.record && track.renderRecord;
        if (!record) {
          record = { ...point.record, position, retiring, opacity: 0, elapsed: 0, age: 0 };
          if (reuseForFrame) {
            track.renderSource = point.record;
            track.renderRecord = record;
          }
        }
        record.position = position;
        record.retiring = retiring;
        record.opacity = fade * fade * (3 - 2 * fade);
        record.elapsed = Math.max(0, this.cursor - point.time);
        record.age = Math.max(0, this.lastFrame - track.createdAt);
        records.push(record);
        if (track.contact && this.cursor >= track.removedAt) track.contactShown = true;
      }
      return records;
    }
  }
  return { Motion };
});
