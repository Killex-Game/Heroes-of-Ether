"use strict";
// Shared vk_* signature primitive. src/server/platform/launch adds current
// VK Games / OK identity validation. The old helper below remains a sandbox API.
// Neither helper verifies payment callbacks.
const { createHmac, timingSafeEqual } = require("node:crypto");
const verifiedIdentities = new WeakSet();
const positiveId = (value) => typeof value === "string" && /^[1-9][0-9]{0,19}$/.test(value);

function parseLaunch(search) {
  if (typeof search !== "string" || Buffer.byteLength(search) > 8192) return null;
  const pairs = search.replace(/^\?/, "").split("&");
  if (!pairs.length || pairs.length > 64) return null;
  const params = new Map();
  for (const pair of pairs) {
    const equals = pair.indexOf("=");
    if (equals < 1) return null;
    const decode = (value) => decodeURIComponent(value.replace(/\+/g, " "));
    const key = decode(pair.slice(0, equals));
    const value = decode(pair.slice(equals + 1));
    if (!/^[a-zA-Z0-9_]+$/.test(key) || params.has(key)) return null;
    params.set(key, value);
  }
  return params;
}

// Signature verification alone is not authentication: app, age and user checks
// below are required before issuing the opaque verified identity.
function verifyVkLaunchSignature(search, secret) {
  if (typeof secret !== "string" || !secret) return null;
  try {
    const params = parseLaunch(search);
    const sign = params?.get("sign");
    if (!sign || !/^[A-Za-z0-9_-]{43}$/.test(sign)) return null;
    const signedKeys = [...params.keys()].filter((key) => key.startsWith("vk_")).sort();
    if (!signedKeys.length) return null;
    const canonical = signedKeys
      .map((key) => `${key}=${encodeURIComponent(params.get(key))}`)
      .join("&");
    const expected = createHmac("sha256", secret).update(canonical).digest();
    const received = Buffer.from(sign, "base64url");
    if (received.length !== expected.length || received.toString("base64url") !== sign) return null;
    if (!timingSafeEqual(received, expected)) return null;
    // Unsigned parameters must never become identity / permissions.
    return Object.freeze(Object.fromEntries(signedKeys.map((key) => [key, params.get(key)])));
  } catch (_) {
    return null;
  }
}

function verifyVkMiniAppLaunch(
  search,
  { secret, appId, now = Date.now(), maxAgeSeconds = 300, futureSkewSeconds = 30 } = {},
) {
  if (
    !positiveId(appId) ||
    !Number.isFinite(now) ||
    now < 0 ||
    !Number.isInteger(maxAgeSeconds) ||
    maxAgeSeconds < 1 ||
    maxAgeSeconds > 3600 ||
    !Number.isInteger(futureSkewSeconds) ||
    futureSkewSeconds < 0 ||
    futureSkewSeconds > 60
  )
    return null;
  const params = verifyVkLaunchSignature(search, secret);
  if (
    !params ||
    params.vk_app_id !== appId ||
    !positiveId(params.vk_user_id) ||
    !/^[1-9][0-9]{0,10}$/.test(params.vk_ts || "")
  )
    return null;
  const timestamp = Number(params.vk_ts);
  const age = now / 1000 - timestamp;
  if (age > maxAgeSeconds || age < -futureSkewSeconds) return null;
  const identity = Object.freeze({ provider: "vk-mini-apps", appId, userId: params.vk_user_id });
  verifiedIdentities.add(identity);
  return identity;
}

function requireVerifiedIdentity(identity) {
  if (!identity || !verifiedIdentities.has(identity)) {
    throw Object.assign(Error("AUTH_UNVERIFIED_IDENTITY"), { code: "AUTH_UNVERIFIED_IDENTITY" });
  }
  return identity;
}
module.exports = { verifyVkLaunchSignature, verifyVkMiniAppLaunch, requireVerifiedIdentity };
