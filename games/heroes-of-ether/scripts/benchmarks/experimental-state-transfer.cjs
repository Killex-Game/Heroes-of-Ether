/* Test-only transport experiment; never imported by the live server. */
"use strict";
const threads = require("node:worker_threads");
const v8 = require("node:v8");
const format = process.env.LOAD_STATE_SERIALIZATION;
if (!["json", "v8"].includes(format)) throw Error("Set LOAD_STATE_SERIALIZATION=json|v8");
if (threads.isMainThread) {
  const send = threads.Worker.prototype.postMessage;
  threads.Worker.prototype.postMessage = function (job, transfers) {
    if (!job.rooms || !job.id) return send.call(this, job, transfers);
    const data = format === "v8" ? v8.serialize(job) : Buffer.from(JSON.stringify(job));
    const bytes = Buffer.allocUnsafeSlow(data.length);
    data.copy(bytes);
    return send.call(this, { stateTransfer: format, bytes }, [bytes.buffer]);
  };
} else if (threads.parentPort) {
  const on = threads.parentPort.on;
  threads.parentPort.on = function (name, listener) {
    if (name !== "message") return on.call(this, name, listener);
    return on.call(this, name, job => listener(job.stateTransfer
      ? job.stateTransfer === "v8" ? v8.deserialize(job.bytes) : JSON.parse(Buffer.from(job.bytes).toString())
      : job));
  };
}
