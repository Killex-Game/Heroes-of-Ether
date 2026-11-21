/* Benchmark only: not imported by the game. Preserve the ws frame bytes while
 * comparing one contiguous write with ws's standard two-buffer writev path. */
"use strict";
const { isMainThread } = require("node:worker_threads");
if (isMainThread && process.env.LOAD_SOCKET_WRITE === "1") {
  const { Sender } = require("ws");
  const sendFrame = Sender.prototype.sendFrame;
  Sender.prototype.sendFrame = function (list, callback) {
    if (list.length !== 2 || !Buffer.isBuffer(list[0]) || !Buffer.isBuffer(list[1]))
      return sendFrame.call(this, list, callback);
    this._socket.write(Buffer.concat(list), callback);
  };
}
