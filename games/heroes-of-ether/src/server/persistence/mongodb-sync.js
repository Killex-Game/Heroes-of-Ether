"use strict";
const path = require("node:path");
const { Worker } = require("node:worker_threads");
const { randomUUID } = require("node:crypto");
const { loadConfig, safeError } = require("./mongodb-config");
class MongoSync {
  static async open(root) {
    const config = loadConfig(root);
    if (!config) return null;
    const sync = new MongoSync(root, config);
    try {
      await sync.command("open");
      return sync;
    } catch (error) {
      await sync.worker.terminate();
      throw error;
    }
  }
  constructor(root, config) {
    this.root = root;
    this.config = { ...config, writerId: randomUUID() };
    this.serial = 0;
    this.startedAt = Date.now();
    this.spawn();
  }
  spawn() {
    this.failed = false;
    const worker = (this.worker = new Worker(path.join(__dirname, "mongodb-worker.js"), {
      workerData: { root: this.root, config: this.config },
    }));
    worker.on("message", (message) => {
      if (worker !== this.worker || !message || typeof message !== "object") return;
      if ("metrics" in message) this.metrics = message.metrics;
      if ("metricsError" in message) this.metricsError = message.metricsError;
      if (message.health) this.health = message.health;
      const pending = this.waiting;
      // Metrics are unsolicited messages, including after collection stops.
      // An absent response id must never match an absent pending command.
      if (!pending || message.id !== pending.id) return;
      this.waiting = null;
      clearTimeout(pending.timeout);
      if (message.error)
        pending.reject(Object.assign(Error(message.error), { code: message.error }));
      else pending.resolve(message.result);
    });
    const failed = () => {
      if (worker !== this.worker) return;
      this.failed = true;
      if (this.waiting) {
        clearTimeout(this.waiting.timeout);
        this.waiting.reject(
          Object.assign(Error("MONGO_WORKER_FAILED"), { code: "MONGO_WORKER_FAILED" }),
        );
        this.waiting = null;
      }
    };
    worker.on("error", failed);
    worker.on("exit", failed);
    if(this.metricsEnabled)this.sendMetricsControl(true);
  }
  command(command, profileSnapshot = null) {
    if (this.waiting || this.failed)
      return Promise.reject(
        Object.assign(Error("MONGO_WORKER_UNAVAILABLE"), { code: "MONGO_WORKER_UNAVAILABLE" }),
      );
    return new Promise((resolve, reject) => {
      const id = ++this.serial;
      const timeout = setTimeout(() => {
        this.failed = true;
        this.waiting = null;
        void this.worker.terminate();
        reject(Object.assign(Error("MONGO_SYNC_TIMEOUT"), { code: "MONGO_SYNC_TIMEOUT" }));
      // Cold snapshot reads include the complete database and checksum scan.
      // Allow throttled cold transfers to finish their full verification.
      // Keep ordinary writes bounded separately; no arena ACK waits on Atlas.
      }, command === "open" || command === "resume" ? 1260000 : 45000);
      this.waiting = { id, timeout, resolve, reject };
      this.worker.postMessage({ id, command, profileSnapshot });
    });
  }
  attach(profiles, chat) {
    this.profiles = profiles;
    this.chat = chat;
    this.timer = setInterval(
      () => this.flush().catch((error) => this.warn(error)),
      this.config.intervalMs,
    );
    this.timer.unref();
    void this.flush().catch((error) => this.warn(error));
  }
  warn(error) {
    const code = safeError(error);
    if (this.lastError !== code)
      console.error(`MongoDB: ${code}. Прогресс остаётся в локальном журнале.`);
    this.lastError = code;
  }
  flush(final = false) {
    if (this.running) return this.running;
    this.running = (async () => {
      // Read the same durable revision from pinned checkpoint + sealed WAL.
      // A regular Atlas sync must not rewrite the whole world on disk first.
      // Only paths/revision cross the worker boundary; no live-world clone.
      if (!final) await this.chat?.writer?.checkpoint();
      const pinned = !final ? await this.profiles.journal.pinSnapshot() : null;
      const source = pinned ? { file: pinned.file, revision: pinned.revision } : null;
      try {
      if (this.failed) {
        await this.worker.terminate();
        this.spawn();
        try {
          await this.command("resume", source);
        } catch (error) {
          // A worker that failed to read/acquire its source has no verified
          // manifest. The next flush must resume again, never send sync to it.
          this.failed = true;
          throw error;
        }
      }
      const result = await this.command("sync", source);
      this.lastError = null;
      return result;
      } finally {
        // A timeout must stop the reader before unlinking its inputs.
        if (this.failed) await this.worker.terminate();
        pinned?.release();
      }
    })().finally(() => {
      this.running = null;
    });
    return this.running;
  }
  pause() {
    clearInterval(this.timer);
  }
  monitoring(){
    const health=require('./mongodb-health').syncHealth(this.health,Date.now(),this.config.intervalMs);
    if(this.health?.connected&&!this.health?.syncedAt&&Date.now()-this.startedAt<Math.max(90000,this.config.intervalMs*3))health.state='starting';
    return {enabled:true,health:this.failed?{...health,state:'error',lastError:'MONGO_WORKER_FAILED'}:this.lastError?{...health,state:'error',lastError:this.lastError}:health,metrics:this.metrics||null,metricsError:this.metricsError||null};
  }
  sendMetricsControl(enabled){
    try{this.worker.postMessage({type:'metrics-control',enabled});return true;}
    catch(_){this.metrics=null;this.metricsError='MONGO_METRICS_UNAVAILABLE';return false;}
  }
  setMetrics(enabled){
    if(this.metricsEnabled===!!enabled)return true;
    if(!this.sendMetricsControl(!!enabled))return false;
    this.metricsEnabled=!!enabled;return true;
  }
  async close(final = true) {
    this.pause();
    try {
      await this.running?.catch((error) => this.warn(error));
      if (final) await this.flush(true);
      await this.command("close");
    } catch (error) {
      this.warn(error);
    } finally {
      await this.worker.terminate();
    }
  }
}
module.exports = { MongoSync };
