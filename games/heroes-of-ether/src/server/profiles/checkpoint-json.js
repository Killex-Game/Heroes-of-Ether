"use strict";
const fs = require("node:fs");
const TABLES = new Set(["profiles", "clans", "residentRooms"]);
const whitespace = byte => byte === 32 || byte === 9 || byte === 10 || byte === 13;
const invalid = () => { throw new SyntaxError("Invalid checkpoint JSON"); };

// Checkpoints are immutable JSON files, pinned by the caller when necessary.
// Parse individual records with the native JSON parser, keeping at most one
// record's source bytes instead of a second UTF-16 copy of the entire world.
class Reader {
  constructor(fd, chunkSize, reuseRecords) { this.fd = fd; this.chunkSize = chunkSize; this.reuseRecords = reuseRecords;
    this.buffer = Buffer.alloc(0); this.offset = 0; }
  peek() {
    if (this.offset === this.buffer.length) {
      const buffer = Buffer.allocUnsafe(this.chunkSize), n = fs.readSync(this.fd, buffer, 0, buffer.length, null);
      this.buffer = buffer.subarray(0, n); this.offset = 0;
    }
    return this.buffer[this.offset];
  }
  space() { while (whitespace(this.peek())) this.offset++; }
  expect(byte) { this.space(); if (this.peek() !== byte) invalid(); this.offset++; }
  token(previous) {
    this.space(); const first = this.peek();
    if (first === undefined || first === 44 || first === 58 || first === 93 || first === 125) invalid();
    const compound = first === 123 || first === 91, quoted = first === 34, parts = [];
    let depth = 0, string = false, escaped = false, done = false;
    do {
      if (this.peek() === undefined) break;
      const start = this.offset, buffer = this.buffer;
      for (; this.offset < buffer.length; this.offset++) {
        const byte = buffer[this.offset];
        if (string) {
          if (escaped) escaped = false;
          else if (byte === 92) escaped = true;
          else if (byte === 34) { string = false; if (quoted) { this.offset++; done = true; break; } }
        } else if (byte === 34) string = true;
        else if (compound) {
          if (byte === 123 || byte === 91) depth++;
          else if (byte === 125 || byte === 93) { if (--depth === 0) { this.offset++; done = true; break; } }
        } else if (whitespace(byte) || byte === 44 || byte === 125 || byte === 93) { done = true; break; }
      }
      if (this.offset > start) parts.push(buffer.subarray(start, this.offset));
    } while (!done);
    const bytes = parts.length === 1 ? parts[0] : Buffer.concat(parts);
    // The caller owns an immutable persisted JSON tree. Exact source-byte
    // equality proves both syntax and value; differently formatted or changed
    // records still use JSON.parse. Never retain a second full-world string.
    if (previous !== undefined) {
      const serialized = JSON.stringify(previous);
      if (serialized !== undefined && bytes.equals(Buffer.from(serialized))) return previous;
    }
    return JSON.parse(bytes.toString("utf8"));
  }
  object(splitTables, table) {
    this.expect(123); const result = {};
    this.space(); if (this.peek() === 125) { this.offset++; return result; }
    for (;;) {
      this.space(); if (this.peek() !== 34) invalid(); const key = this.token();
      this.expect(58); this.space();
      const prior = table && this.reuseRecords?.[table];
      const value = splitTables && TABLES.has(key) && this.peek() === 123 ? this.object(false, key)
        : this.token(prior && Object.hasOwn(prior, key) ? prior[key] : undefined);
      // Match JSON.parse for duplicate keys and the literal __proto__ key.
      Object.defineProperty(result, key, { value, enumerable: true, configurable: true, writable: true });
      this.space(); const next = this.peek(); this.offset++;
      if (next === 125) return result;
      if (next !== 44) invalid();
    }
  }
}
function readCheckpoint(file, { chunkSize = 256 * 1024, threshold = 1024 * 1024, reuseRecords = null } = {}) {
  if (!Number.isSafeInteger(chunkSize) || chunkSize < 1) throw new RangeError("Invalid JSON read buffer");
  const fd = fs.openSync(file, "r");
  try {
    if (!reuseRecords && fs.fstatSync(fd).size < threshold) return JSON.parse(fs.readFileSync(fd, "utf8"));
    const reader = new Reader(fd, chunkSize, reuseRecords); reader.space();
    const result = reader.peek() === 123 ? reader.object(true) : reader.token();
    reader.space(); if (reader.peek() !== undefined) invalid();
    return result;
  } finally { fs.closeSync(fd); }
}

// Used only on the plain JSON tree reconstructed from checkpoint + WAL.
// Native JSON.stringify still handles every record. Atomic rename and fsync
// stay with the journal; a partial temporary file is never acknowledged.
function writeCheckpoint(fd, data) {
  let pending = [], length = 0;
  const flush = () => {
    if (pending.length) fs.writeFileSync(fd, pending.join(""));
    pending = []; length = 0;
  };
  const write = text => {
    if (text.length >= 65536) { flush(); fs.writeFileSync(fd, text); }
    else { pending.push(text); length += text.length; if (length >= 65536) flush(); }
  };
  if (!data || typeof data !== "object" || Array.isArray(data)) { write(JSON.stringify(data) + "\n"); flush(); return; }
  write("{"); let first = true;
  for (const key of Object.keys(data)) {
    const value = data[key];
    if (!first) write(","); first = false;
    write(JSON.stringify(key) + ":");
    if (TABLES.has(key) && value && typeof value === "object" && !Array.isArray(value)) {
      write("{"); let firstRow = true;
      for (const id of Object.keys(value)) {
        if (!firstRow) write(","); firstRow = false;
        write(JSON.stringify(id) + ":"); write(JSON.stringify(value[id]));
      }
      write("}");
    } else write(JSON.stringify(value));
  }
  write("}\n"); flush();
}
module.exports = { readCheckpoint, writeCheckpoint };
