"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { once } = require("node:events");
const { createGameServer } = require("../../server");
const { HTTP_LIMITS } = require("../../src/server/http/request-rate-limits");
const { clientAddress, secureRequest } = require("../../src/server/http/trusted-proxy");

test("Proxy headers are ignored by default and for non-loopback peers", () => {
  const req = { socket: { remoteAddress: "127.0.0.1" }, headers: {
    "x-real-ip": "203.0.113.1", "x-forwarded-proto": "https" } };
  assert.equal(clientAddress(req), "127.0.0.1");
  assert.equal(secureRequest(req), false);
  assert.equal(clientAddress(req, true), "203.0.113.1");
  assert.equal(secureRequest(req, true), true);
  req.socket.remoteAddress = "203.0.113.2";
  assert.equal(clientAddress(req, true), "203.0.113.2");
  assert.equal(secureRequest(req, true), false);
  req.socket.remoteAddress = "127.0.0.1";
  req.headers["x-real-ip"] = "203.0.113.1, 203.0.113.2";
  assert.equal(clientAddress(req, true), "127.0.0.1");
});

test("Different proxied testers have separate rate budgets and HTTPS cookies", async (t) => {
  const app = createGameServer({ trustLoopbackProxy: true, autoTick: false,
    rateNow: () => 0, testBots: { enabled: false },
    httpLimits: { ...HTTP_LIMITS, api: { capacity: 1, perSecond: 1 } } });
  app.httpServer.listen(0, "127.0.0.1");
  await once(app.httpServer, "listening");
  t.after(() => app.close());
  const url = `http://127.0.0.1:${app.httpServer.address().port}`;
  const request = (ip) => fetch(url + "/api/profile", { headers: {
    "X-Real-IP": ip, "X-Forwarded-Proto": "https" } });
  const first = await request("203.0.113.1");
  assert.equal(first.status, 200);
  assert.match(first.headers.get("set-cookie"), /; Secure/);
  const a = await first.json();
  assert.equal((await request("203.0.113.1")).status, 429);
  const second = await request("203.0.113.2");
  assert.equal(second.status, 200);
  assert.notEqual((await second.json()).profile.id, a.profile.id);
});
