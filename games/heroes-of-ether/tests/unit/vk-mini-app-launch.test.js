"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { createHmac } = require("node:crypto");
const {
  verifyVkLaunchSignature,
  verifyVkMiniAppLaunch,
  requireVerifiedIdentity,
} = require("../../deployment/vk-production/auth/vk-mini-app-launch");
const now = 1900000000000;
const secret = "test-only-not-a-real-app-secret";
const options = { secret, appId: "123", now };
const fields = {
  vk_app_id: "123",
  vk_user_id: "456",
  vk_ts: String(now / 1000),
  vk_access_token_settings: "",
};
function signed(p = fields) {
  const q = Object.keys(p)
    .sort()
    .map((key) => `${key}=${encodeURIComponent(p[key])}`)
    .join("&");
  return q + "&sign=" + createHmac("sha256", secret).update(q).digest("base64url");
}
test("official archived VKCOM signature vector (not a valid modern login without timestamp)", () => {
  // Public example, not credentials: github.com/VKCOM/vk-apps-launch-params/examples/node.js
  const q =
    "vk_user_id=494075&vk_app_id=6736218&vk_is_app_user=1&vk_are_notifications_enabled=1&vk_language=ru&vk_access_token_settings=&vk_platform=android&sign=htQFduJpLxz7ribXRZpDFUH-XEUhC9rBPTJkjUFEkRA";
  assert.equal(verifyVkLaunchSignature(q, "wvl68m4dR1UpLrVRli").vk_user_id, "494075");
  assert.equal(
    verifyVkMiniAppLaunch(q, { secret: "wvl68m4dR1UpLrVRli", appId: "6736218", now }),
    null,
  );
});
test("signed identity excludes unsigned privileges and resists object forgery", () => {
  const identity = verifyVkMiniAppLaunch("?" + signed() + "&admin=true&user_id=999", options);
  assert.deepEqual(identity, { provider: "vk-mini-apps", appId: "123", userId: "456" });
  assert.equal(requireVerifiedIdentity(identity), identity);
  assert.equal(Object.isFrozen(identity), true);
  assert.throws(() => requireVerifiedIdentity({ ...identity }), /UNVERIFIED/);
});
test("decode once, encode signed values, no delimiter or unicode ambiguity", () => {
  const p = { ...fields, vk_ref: "книга &x=y +100% / ? ' " };
  const q = signed(p);
  assert.ok(verifyVkMiniAppLaunch(q, options));
  assert.ok(verifyVkMiniAppLaunch(q.replaceAll("%20", "+"), options));
  assert.equal(verifyVkMiniAppLaunch(q.replace("%26x", "%2526x"), options), null);
  assert.equal(verifyVkMiniAppLaunch(q.replace("456", "457"), options), null);
});
test("reject other app, expired / future / missing timestamp and anonymous user", () => {
  for (const p of [
    { ...fields, vk_app_id: "124" },
    { ...fields, vk_user_id: "0" },
    { ...fields, vk_user_id: "0456" },
    { ...fields, vk_user_id: "-1" },
    { ...fields, vk_ts: String(now / 1000 - 301) },
    { ...fields, vk_ts: String(now / 1000 + 31) },
    { ...fields, vk_ts: "" },
    { ...fields, vk_ts: "1e9" },
  ])
    assert.equal(verifyVkMiniAppLaunch(signed(p), options), null);
  assert.ok(verifyVkMiniAppLaunch(signed({ ...fields, vk_ts: String(now / 1000 - 300) }), options));
  assert.equal(verifyVkMiniAppLaunch(signed(), { ...options, secret: "wrong" }), null);
  assert.equal(verifyVkMiniAppLaunch(signed(), { ...options, appId: 123 }), null);
});
test("bounded strict input rejects duplicate/encoded duplicate and malformed signatures", () => {
  for (const q of [
    null,
    {},
    "https://game.invalid/?" + signed(),
    signed() + "&vk_user_id=999",
    signed() + "&%76k_user_id=456",
    signed() + "&sign=a",
    signed() + "&x=%GG",
    signed() + "&x=%ED%A0%80",
    signed() + "&x=1&x=2",
    signed().replace(/sign=.*/, "sign=" + "a".repeat(43)),
    signed() + "=",
    signed() + "&x=" + "a".repeat(8192),
    signed() + Array.from({ length: 65 }, (_, i) => `&x${i}=1`).join(""),
  ])
    assert.equal(verifyVkMiniAppLaunch(q, options), null);
});
