"use strict";
const { Sender } = require("ws");
const standardSendFrame = Sender.prototype.sendFrame;
const MAX_CONTIGUOUS_FRAME = 64 * 1024;
const frameHeadrooms = new WeakMap();

// A state worker can reserve space before each payload in its transferred
// allocation. Register only that exact Buffer view; ordinary ws messages keep
// the standard path. The header is still generated and validated by ws.
function stateFramePayload(bytes, offset, length, headroom = 0) {
  const payload = bytes.subarray(offset, offset + length);
  if (Number.isInteger(headroom) && headroom >= 2 && headroom <= 10 &&
      Number.isInteger(offset) && offset >= headroom &&
      Number.isInteger(length) && length >= 0 && offset + length <= bytes.length)
    frameHeadrooms.set(payload, { bytes, offset, headroom });
  return payload;
}

// Windows loopback writev is expensive for the two-buffer ws header/payload
// pair. Coalesce small server frames without changing ws framing, ordering,
// compression, callbacks or socket backpressure. Other platforms keep ws's
// standard path until separately measured. If ws changes its sender interface,
// fall back rather than installing an incompatible adapter.
function coalesceServerFrames(ws, platform = process.platform) {
  const sender = ws._sender;
  if (platform !== "win32" || !ws._isServer || !sender ||
      sender.sendFrame !== standardSendFrame || sender._socket !== ws._socket ||
      typeof ws._socket?.write !== "function") return false;
  sender.sendFrame = function (list, callback) {
    if (list.length !== 2 || !Buffer.isBuffer(list[0]) || !Buffer.isBuffer(list[1]) ||
        list[0].length + list[1].length > MAX_CONTIGUOUS_FRAME || (list[0][1] & 128))
      return standardSendFrame.call(this, list, callback);
    const reserved = frameHeadrooms.get(list[1]);
    if (reserved && list[0].length <= reserved.headroom) {
      // Consume the reservation once: queued frames must never have their
      // header overwritten by a later send of the same payload.
      frameHeadrooms.delete(list[1]);
      const start = reserved.offset - list[0].length;
      list[0].copy(reserved.bytes, start);
      this._socket.write(reserved.bytes.subarray(start, reserved.offset + list[1].length), callback);
    } else this._socket.write(Buffer.concat(list), callback);
  };
  return true;
}
module.exports = { coalesceServerFrames, stateFramePayload, MAX_CONTIGUOUS_FRAME };
