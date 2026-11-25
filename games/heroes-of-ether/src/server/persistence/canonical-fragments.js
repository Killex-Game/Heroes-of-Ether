"use strict";
const { createHash } = require("node:crypto");
const { PREFIX } = require("./snapshot-documents");
const CHARS = 512 * 1024;
const hash = value => createHash("sha256").update(JSON.stringify(value)).digest("hex");

// Use the exact existing UTF-16 fragment boundaries without materializing an
// additional canonical profile tree or one complete profile JSON string.
// Canonical field buffers end at JSON boundaries, never inside UTF-8 scalars.
function fragmentParts(id, segments, bytes, valueHash) {
  const prefix = PREFIX + Buffer.from(id).toString("base64url") + ":", parts = [];
  let pending = "", offset = 0;
  const emit = value => {
    const end = offset + Buffer.byteLength(value);
    parts.push({ _id: prefix + parts.length, hash: hash(value), start: offset, end });
    offset = end;
  };
  for (const segment of segments) {
    pending += segment.toString("utf8");
    while (pending.length > CHARS) {
      let end = CHARS;
      if (/[\uD800-\uDBFF]/.test(pending[end - 1])) end--;
      emit(pending.slice(0, end));
      pending = pending.slice(end);
    }
  }
  if (pending) emit(pending);
  if (offset !== bytes) throw Error("Canonical fragment byte length mismatch");
  const descriptor = { count: parts.length, hash: valueHash };
  parts.push({ _id: id, hash: hash(descriptor), chunked: true, descriptor: JSON.stringify(descriptor) });
  return parts;
}

function fragmentValue(record, part) {
  const pieces = [];
  let position = 0;
  for (const segment of record.segments) {
    const end = position + segment.length;
    if (end > part.start && position < part.end)
      pieces.push(segment.subarray(Math.max(0, part.start - position), Math.min(segment.length, part.end - position)));
    position = end;
    if (position >= part.end) break;
  }
  return (pieces.length === 1 ? pieces[0] : Buffer.concat(pieces, part.end - part.start)).toString("utf8");
}
module.exports = { fragmentParts, fragmentValue };
