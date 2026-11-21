"use strict";
const fs = require("node:fs");
const MESSAGE = "Арена временно закрыта, попробуй войти позже";
// Temporary operator lease for isolated load tests. It affects arena admission,
// never lobby access. An abandoned lease expires; an unfinished save stays held.
class ArenaTestingGate {
  constructor({ filePath = null, now = Date.now } = {}) {
    this.filePath = filePath;
    this.now = now;
    this.lease = null;
    this.held = false;
    this.last = null;
    if (filePath) {
      try { this.read(fs.readFileSync(filePath, "utf8")); }
      catch (error) { this.lastError = error.code === "ENOENT" ? null : error.message; }
      this.timer = setInterval(() => this.refresh(), 1000);
      this.timer.unref();
    }
  }
  read(text) {
    if (Buffer.byteLength(text) > 1024) throw Error("Arena testing lease is too large");
    const lease = JSON.parse(text), at = this.now();
    if (!lease || !/^[a-zA-Z0-9_-]{1,80}$/.test(lease.id || "") ||
        !Number.isSafeInteger(lease.expiresAt) || lease.expiresAt < 0 || lease.expiresAt > at + 30 * 60000)
      throw Error("Invalid arena testing lease");
    this.lease = { id: lease.id, expiresAt: lease.expiresAt };
    this.lastError = null;
  }
  async refresh() {
    if (this.checking || this.closed) return;
    if (this.filePath) {
      this.checking = true;
      try { this.read(await fs.promises.readFile(this.filePath, "utf8")); }
      catch (error) {
        if (error.code === "ENOENT") { this.lease = null; this.lastError = null; }
        else this.lastError = error.message; // Retain only the prior bounded lease.
      } finally { this.checking = false; }
    }
    if (!this.closed) this.refreshState();
  }
  get active() { return this.held || !!(this.lease && this.lease.expiresAt > this.now()); }
  hold() { this.held = true; }
  release() { this.held = false; this.refreshState(); }
  status() {
    return { closed: this.active, draining: this.held, message: MESSAGE };
  }
  refreshState() {
    const active = this.active;
    if (active !== this.last) { this.last = active; this.onChange?.(this.status()); }
  }
  close() { this.closed = true; clearInterval(this.timer); this.timer = null; this.onChange = null; }
}
module.exports = { ArenaTestingGate, MESSAGE };
