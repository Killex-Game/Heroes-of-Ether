"use strict";
const { randomBytes, createHmac, timingSafeEqual, createCipheriv, createDecipheriv, createHash } = require("node:crypto");
const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const digest = value => createHash("sha256").update(value).digest("hex");
function equal(a, b) {
  return typeof a === "string" && typeof b === "string" && Buffer.byteLength(a) === Buffer.byteLength(b) && timingSafeEqual(Buffer.from(a), Buffer.from(b));
}
function base32(bytes) {
  let value = 0, bits = 0, result = "";
  for (const byte of bytes) { value = (value << 8) | byte; bits += 8; while (bits >= 5) { bits -= 5; result += alphabet[(value >>> bits) & 31]; } }
  if (bits) result += alphabet[(value << (5 - bits)) & 31];
  return result;
}
function decode(value) {
  if (!/^[A-Z2-7]{32}$/.test(value)) throw Error("Invalid TOTP secret");
  let buffer = 0, bits = 0; const bytes = [];
  for (const letter of value) { buffer = (buffer << 5) | alphabet.indexOf(letter); bits += 5; if (bits >= 8) { bits -= 8; bytes.push((buffer >>> bits) & 255); } }
  return Buffer.from(bytes);
}
function code(secret, counter, digits = 6) {
  const input = Buffer.alloc(8); input.writeBigUInt64BE(BigInt(counter));
  const mac = createHmac("sha1", decode(secret)).update(input).digest(), offset = mac[mac.length - 1] & 15;
  return String((mac.readUInt32BE(offset) & 0x7fffffff) % (10 ** digits)).padStart(digits, "0");
}
function verify(secret, value, now, previous = -1) {
  if (typeof value !== "string" || !/^\d{6}$/.test(value)) return null;
  const step = Math.floor(now / 30000); let matched = null;
  for (const n of [step - 1, step, step + 1]) if (n >= 0 && equal(code(secret, n), value) && n > previous) matched = n;
  return matched;
}
function encrypt(secret, key, account) {
  const iv = randomBytes(12), cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(account));
  const data = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
  return { iv: iv.toString("hex"), data: data.toString("hex"), tag: cipher.getAuthTag().toString("hex") };
}
function decrypt(value, key, account) {
  const cipher = createDecipheriv("aes-256-gcm", key, Buffer.from(value.iv, "hex"));
  cipher.setAAD(Buffer.from(account)); cipher.setAuthTag(Buffer.from(value.tag, "hex"));
  return Buffer.concat([cipher.update(Buffer.from(value.data, "hex")), cipher.final()]).toString("utf8");
}
function recovery() { return Array.from({ length: 10 }, () => randomBytes(12).toString("hex").match(/.{4}/g).join("-")); }
function recoveryHash(id, value) { return digest(id + ":" + String(value).toLowerCase().replace(/[-\s]/g, "")); }
function uri(secret, login) {
  const issuer = "Killex Heroes of Ether";
  return `otpauth://totp/${encodeURIComponent(issuer + ":" + login)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;
}
module.exports = { digest, equal, base32, code, verify, encrypt, decrypt, recovery, recoveryHash, uri, newSecret: () => base32(randomBytes(20)) };
