"use strict";
const { isIP } = require("node:net");
const loopback = (address) => ["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(address);

// Opt-in for a local reverse proxy which REPLACES, never appends, X-Real-IP.
function clientAddress(req, trustLoopbackProxy = false) {
  const direct = req.socket.remoteAddress || "unknown";
  const forwarded = req.headers["x-real-ip"];
  return trustLoopbackProxy && loopback(direct) && typeof forwarded === "string" && isIP(forwarded)
    ? forwarded
    : direct;
}
function secureRequest(req, trustLoopbackProxy = false) {
  return !!req.socket.encrypted || !!(trustLoopbackProxy && loopback(req.socket.remoteAddress) &&
    req.headers["x-forwarded-proto"] === "https");
}
module.exports = { clientAddress, secureRequest };
