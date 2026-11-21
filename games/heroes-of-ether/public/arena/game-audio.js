/* Музыка лобби и звуки арены с раздельными настройками. */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.KillexAudio = api;
})(typeof globalThis !== "undefined" ? globalThis : this, () => {
  "use strict";
  const volumeLevel = value => Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 1;
  const TRACKS = Object.freeze({
    defeat: { file: "defeat-v1.wav", volume: 0.65, cooldown: 800, voices: 1 },
    merge: { file: "merge-v1.wav", volume: 0.48, cooldown: 160, voices: 2 },
    mine: { file: "mine-v1.wav", volume: 0.6, cooldown: 100, voices: 2 },
    quests: { file: "quests-selected-v1.wav", volume: 0.8, cooldown: 180, voices: 1 },
    shop: { file: "shop-selected-v1.wav", volume: 0.7, cooldown: 250, voices: 1 },
    clan: { file: "clan-selected-v1.wav", volume: 0.7, cooldown: 350, voices: 1 },
    wardrobe: { file: "wardrobe-selected-v1.wav", volume: 0.6, cooldown: 250, voices: 1 },
    // The WAV has a silent tail for WebKit; bound overlapping ticks during fast rotation.
    roulette: { file: "roulette-tick-selected-v1.wav", volume: 0.55, cooldown: 80, voices: 4 },
    shield: { file: "shield-selected-v1.wav", volume: 0.5, cooldown: 180, voices: 2 },
    title: { file: "title-selected-v1.wav", volume: 0.65, cooldown: 500, voices: 1 },
  });

  class Player {
    constructor({
      enabled = true,
      volume = 1,
      document = globalThis.document,
      Audio = globalThis.Audio,
      now = () => performance.now(),
    } = {}) {
      Object.assign(this, { enabled, document, Audio, now });
      this.volume = volumeLevel(volume);
      this.voices = new Map();
      this.last = new Map();
      this.unlocked = false;
      this.generation = 0;
      this.onGesture = (event) => {
        if (event.isTrusted) this.unlock();
      };
      this.onVisibility = () => {
        if (document.hidden) this.stop();
      };
      document.addEventListener("pointerdown", this.onGesture, { capture: true });
      document.addEventListener("keydown", this.onGesture, { capture: true });
      document.addEventListener("visibilitychange", this.onVisibility);
    }
    unlock() {
      if (this.unlocked || !this.enabled || !this.volume || !this.Audio) return;
      this.unlocked = true;
      // Each media element is primed during a user gesture, including Safari's fallback.
      for (const [id, track] of Object.entries(TRACKS)) {
        const voices = Array.from({ length: track.voices }, () => {
          const audio = new this.Audio("/assets/audio/" + track.file);
          audio.preload = "auto";
          audio.muted = true;
          const voice = { audio, serial: 0, busy: false };
          audio.addEventListener("ended", () => {
            voice.busy = false;
          });
          audio.addEventListener("error", () => {
            voice.busy = false;
          });
          try {
            Promise.resolve(audio.play())
              .then(() => {
                if (voice.serial === 0) {
                  audio.pause();
                  audio.currentTime = 0;
                }
              })
              .catch(() => {});
          } catch (_) {}
          return voice;
        });
        this.voices.set(id, voices);
      }
    }
    play(id, gain = 1, rate = 1) {
      const track = TRACKS[id],
        now = this.now();
      if (
        !track ||
        !this.enabled ||
        !this.volume ||
        !this.unlocked ||
        this.document.hidden ||
        !Number.isFinite(gain) ||
        gain <= 0 ||
        !Number.isFinite(rate) || rate < .5 || rate > 4 ||
        now - (this.last.get(id) ?? -Infinity) < track.cooldown / rate
      )
        return false;
      const voice = this.voices.get(id)?.find((v) => !v.busy);
      if (!voice) return false;
      this.last.set(id, now);
      voice.busy = true;
      const serial = ++voice.serial,
        generation = this.generation;
      const audio = voice.audio;
      try {
        audio.pause();
        audio.currentTime = 0;
        audio.playbackRate = rate;
        audio.preservesPitch = rate === 1;
        voice.gain = track.volume * Math.min(1, gain);
        audio.volume = voice.gain * this.volume;
        audio.muted = false;
        Promise.resolve(audio.play())
          .then(() => {
            if (voice.serial !== serial) return;
            // Never replay stale effects after a slow load, tab return or preference change.
            if (
              generation !== this.generation ||
              !this.enabled ||
              this.document.hidden ||
              this.now() - now > 700
            ) {
              audio.pause();
              voice.busy = false;
            }
          })
          .catch(() => {
            if (voice.serial === serial) voice.busy = false;
          });
        return true;
      } catch (_) {
        voice.busy = false;
        return false;
      }
    }
    setEnabled(enabled) {
      this.enabled = enabled === true;
      if (!this.enabled) this.stop();
      else this.unlock();
    }
    setVolume(volume) {
      this.volume = volumeLevel(volume);
      if (!this.volume) this.stop();
      else {
        for (const voices of this.voices.values())
          for (const voice of voices)
            if (voice.busy) voice.audio.volume = voice.gain * this.volume;
        this.unlock();
      }
    }
    stop() {
      this.generation++;
      for (const voices of this.voices.values())
        for (const voice of voices) {
          voice.serial++;
          voice.busy = false;
          voice.audio.pause();
        }
    }
    stopTrack(id) {
      for (const voice of this.voices.get(id) || []) {
        voice.serial++; voice.busy = false; voice.audio.pause();
      }
    }
    destroy() {
      this.stop();
      this.document.removeEventListener("pointerdown", this.onGesture, { capture: true });
      this.document.removeEventListener("keydown", this.onGesture, { capture: true });
      this.document.removeEventListener("visibilitychange", this.onVisibility);
      for (const voices of this.voices.values())
        for (const { audio } of voices) {
          audio.removeAttribute("src");
          audio.load();
        }
      this.voices.clear();
    }
  }

  class LobbyMusic {
    constructor({ enabled = true, volume = 1, document = globalThis.document, Audio = globalThis.Audio } = {}) {
      Object.assign(this, { enabled, document, active: false, unlocked: false });
      this.volume = volumeLevel(volume);
      this.audio = Audio ? new Audio("/assets/audio/tavern-circle-v1.mp3") : null;
      if (this.audio) {
        this.audio.loop = true;
        this.audio.volume = 0.32 * this.volume;
        this.audio.preload = "metadata";
        // WebKit может поставить MP3 на паузу при внутренней перемотке повтора.
        this.onLoopSeek = () => {
          if (this.audio.currentTime < 0.1) this.sync();
        };
        this.audio.addEventListener("seeked", this.onLoopSeek);
      }
      this.onGesture = (event) => {
        if (!event.isTrusted) return;
        this.unlocked = true;
        this.sync();
      };
      this.onVisibility = () => this.sync();
      document.addEventListener("pointerdown", this.onGesture, { capture: true });
      document.addEventListener("keydown", this.onGesture, { capture: true });
      document.addEventListener("visibilitychange", this.onVisibility);
    }
    shouldPlay() {
      return this.active && this.enabled && this.volume > 0 && this.unlocked && !this.document.hidden;
    }
    sync() {
      if (!this.audio) return;
      if (!this.shouldPlay()) {
        this.audio.pause();
        return;
      }
      if (!this.audio.paused) return;
      try {
        Promise.resolve(this.audio.play())
          .then(() => {
            if (!this.shouldPlay()) this.audio.pause();
          })
          .catch(() => {}); // Браузер может потребовать новый пользовательский жест.
      } catch (_) {}
    }
    setActive(active) {
      this.active = active === true;
      this.sync();
    }
    setEnabled(enabled) {
      this.enabled = enabled === true;
      this.sync();
    }
    setVolume(volume) {
      this.volume = volumeLevel(volume);
      if (this.audio) this.audio.volume = 0.32 * this.volume;
      this.sync();
    }
    destroy() {
      this.setActive(false);
      this.document.removeEventListener("pointerdown", this.onGesture, { capture: true });
      this.document.removeEventListener("keydown", this.onGesture, { capture: true });
      this.document.removeEventListener("visibilitychange", this.onVisibility);
      if (this.audio) {
        this.audio.removeEventListener("seeked", this.onLoopSeek);
        this.audio.removeAttribute("src");
        this.audio.load();
      }
    }
  }

  class ArenaEvents {
    constructor(play) {
      this.play = play;
      this.reset();
    }
    reset() {
      this.previous = null;
      this.seen = new Set();
      this.lifeResults = new Set();
    }
    remember(set, id) {
      if (set.has(id)) return false;
      set.add(id);
      if (set.size > 256) set.delete(set.values().next().value);
      return true;
    }
    lifeEnded(result) {
      if (typeof result?.id !== "string" || !this.remember(this.lifeResults, result.id)) return;
      if (result.reason === "absorbed" || result.reason === "burned") this.play("defeat");
    }
    state(message, myId) {
      const me = message.players?.find((p) => p.id === myId);
      const old = this.previous;
      const sameLife = me && old && me.id === old.id && me.spawnSerial === old.spawnSerial;
      const parts = me?.parts || [];
      if (
        sameLife &&
        parts.some((part) => old.parts.has(part.id) && part.mergeVersion > old.parts.get(part.id))
      )
        this.play("merge");
      this.previous = me
        ? {
            id: me.id,
            spawnSerial: me.spawnSerial,
            parts: new Map(parts.map((p) => [p.id, p.mergeVersion || 0])),
          }
        : null;
      for (const event of message.audioEvents || []) {
        if (
          !["mine", "shield"].includes(event?.type) ||
          typeof event.id !== "string" ||
          !Number.isFinite(event.x) ||
          !Number.isFinite(event.y) ||
          !this.remember(this.seen, event.id)
        )
          continue;
        // First snapshot establishes a baseline; entering an arena doesn't replay old explosions.
        if (!sameLife) continue;
        // Shield feedback belongs only to the protected player, never nearby observers.
        if (event.type === "shield") {
          if (event.targetId === myId) this.play("shield", 1);
          continue;
        }
        const distance = Math.min(
          ...parts.map((p) => Math.max(0, Math.hypot(p.x - event.x, p.y - event.y) - p.radius)),
        );
        const gain = event.targetId === myId ? 1 : Math.max(0, 1 - distance / 900) ** 2;
        if (gain > 0.03) this.play(event.type, gain);
      }
    }
  }
  // The easing belongs to the animation itself: clicks follow actual sector crossings.
  // At low frame rates, never replay a backlog of ticks or keep ticking after closing.
  function followRoulette(
    animation,
    degrees,
    sectors,
    play,
    {
      request = globalThis.requestAnimationFrame,
      cancel = globalThis.cancelAnimationFrame,
      document = globalThis.document,
    } = {},
  ) {
    let frame,
      stopped = false,
      previous = 0;
    function sample() {
      if (stopped || animation.playState !== "running") return;
      const progress = animation.effect.getComputedTiming().progress;
      const sector = Math.floor(((progress || 0) * degrees * sectors) / 360 + 0.5);
      if (sector > previous && !document.hidden) play("roulette");
      previous = sector;
      frame = request(sample);
    }
    frame = request(sample);
    return () => {
      stopped = true;
      cancel(frame);
    };
  }
  return { Player, LobbyMusic, ArenaEvents, TRACKS, followRoulette };
});
