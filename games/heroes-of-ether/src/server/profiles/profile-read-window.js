"use strict";
const fs = require("node:fs");
const snapshots = require("./profile-read-snapshot");
const identity = s => [s.dev, s.ino, s.size, s.mtimeNs].join(":");
// A bounded, disposable set of hard links, owned by the journal writer. Each
// reader gets a frozen file manifest and a lease; growth never changes its set.
class ProfileReadWindow {
  constructor(file, { maxBytes = 16 * 1024 * 1024, maxFiles = 2048, maxAgeMs = 300000, now = Date.now } = {}) {
    for (const n of [maxBytes, maxFiles, maxAgeMs]) if (!Number.isSafeInteger(n) || n < 1) throw new RangeError("Invalid profile read window limit");
    Object.assign(this, { file, maxBytes, maxFiles, maxAgeMs, now });
    this.current = null;
    this.cleanups = new Set();
    this.captures = new Set();
  }
  releaseOwner(owner) {
    if (owner.cleanup) return owner.cleanup;
    const cleanup = owner.pin.releaseAsync().catch(error => {
      // This disposable cache never owns the canonical WAL. Preserve a failed
      // directory for exclusive startup cleanup and keep the useful category.
      this.lastError = error.code || "PROFILE_READ_CACHE_CLEANUP";
    }).finally(() => this.cleanups.delete(cleanup));
    owner.cleanup = cleanup;
    this.cleanups.add(cleanup);
    return cleanup;
  }
  async drainCleanup() {
    await Promise.all([...this.captures]);
    await Promise.all([...this.cleanups]);
  }
  reset() {
    const old = this.current;
    this.current = null;
    if (old) { old.retired = true; if (!old.readers) this.releaseOwner(old); }
  }
  capture(files) {
    const current = this.current;
    if (!current) return;
    try {
      const age = this.now() - current.at;
      if (age < 0 || age >= this.maxAgeMs) { this.reset(); return; }
      for (const source of files) {
        const suffix = source.slice(source.lastIndexOf("-") + 1);
        if (!/^\d+$/.test(suffix)) throw Error("Invalid retained journal segment");
        const stat = fs.statSync(source, { bigint: true });
        if (!stat.isFile()) throw Error("Invalid retained journal source");
        const previous = current.rows.get(suffix), id = identity(stat);
        if (previous) {
          if (previous.identity !== id) throw Error("Retained journal source replaced");
          continue;
        }
        const size = Number(stat.size);
        if (current.rows.size + 1 > this.maxFiles || current.bytes + size > this.maxBytes) { this.reset(); return; }
        const target = current.pin.file + ".wal-" + suffix;
        fs.linkSync(source, target);
        current.rows.set(suffix, { target, identity: id }); current.bytes += size;
      }
    } catch (error) {
      // Canonical WAL remains authoritative. Failure never suppresses a write
      // or a checksum error: discard the optimisation and pin the ordinary base.
      this.reset();
      this.lastError = error.code || "PROFILE_READ_WINDOW_INVALID";
    }
  }
  captureAsync(files) {
    const current = this.current;
    if (!current) return Promise.resolve();
    // A checkpoint owns this immutable list until capture finishes. Retain the
    // directory even if expiry/reset retires it while an async link is pending.
    current.readers++;
    const operation = (async () => {
      try {
        const age = this.now() - current.at;
        if (age < 0 || age >= this.maxAgeMs) { this.reset(); return; }
        for (const source of files) {
          if (this.current !== current) return;
          const suffix = source.slice(source.lastIndexOf('-') + 1);
          if (!/^\d+$/.test(suffix)) throw Error('Invalid retained journal segment');
          const stat = await fs.promises.stat(source, { bigint: true });
          if (this.current !== current) return;
          if (!stat.isFile()) throw Error('Invalid retained journal source');
          const previous = current.rows.get(suffix), id = identity(stat);
          if (previous) {
            if (previous.identity !== id) throw Error('Retained journal source replaced');
            continue;
          }
          const size = Number(stat.size);
          if (current.rows.size + 1 > this.maxFiles || current.bytes + size > this.maxBytes) { this.reset(); return; }
          const target = current.pin.file + '.wal-' + suffix;
          await fs.promises.link(source, target);
          if (this.current !== current) return;
          current.rows.set(suffix, { target, identity: id }); current.bytes += size;
        }
      } catch (error) {
        if (this.current === current) this.reset();
        this.lastError = error.code || 'PROFILE_READ_WINDOW_INVALID';
      } finally {
        current.readers--;
        if (current.retired && !current.readers) this.releaseOwner(current);
      }
    })();
    this.captures.add(operation);
    operation.then(() => this.captures.delete(operation), () => this.captures.delete(operation));
    return operation;
  }
  pin(files, revision) {
    this.capture(files);
    if (!this.current) {
      const anchor = snapshots.pin(this.file, [], revision);
      this.current = { pin: anchor, rows: new Map(), bytes: 0, at: this.now(), readers: 0, retired: false };
      this.capture(files);
    }
    if (!this.current) return snapshots.pin(this.file, files, revision);
    const current = this.current, { pin, rows } = current, window = this;
    const retained = [...rows].sort((a, b) => Number(a[0]) - Number(b[0])).map(([, row]) => row.target);
    current.readers++;
    let released = false;
    function release() {
      if (released) return current.cleanup;
      released = true;
      current.readers--;
      if (current.retired && !current.readers) return window.releaseOwner(current);
    }
    return { file: pin.file, files: Object.freeze(retained), revision,
      release, releaseAsync: release };
  }
}
module.exports = { ProfileReadWindow };
