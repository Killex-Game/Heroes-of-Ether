"use strict";
const test = require("node:test"), assert = require("node:assert/strict"), { randomBytes } = require("node:crypto");
const otp = require("../../src/server/admin/admin-otp");
test("RFC 6238 SHA1 vectors, exact step, bounded skew and replay denial", () => {
  const secret = otp.base32(Buffer.from("12345678901234567890"));
  for (const [seconds, expected] of [[59,"94287082"],[1111111109,"07081804"],[1111111111,"14050471"],[1234567890,"89005924"],[2000000000,"69279037"],[20000000000,"65353130"]])
    assert.equal(otp.code(secret, Math.floor(seconds / 30), 8), expected);
  const now = 1700000000000, step = Math.floor(now / 30000);
  for (const delta of [-1, 0, 1]) assert.equal(otp.verify(secret, otp.code(secret, step + delta), now), step + delta);
  for (const delta of [-2, 2]) assert.equal(otp.verify(secret, otp.code(secret, step + delta), now), null);
  assert.equal(otp.verify(secret, otp.code(secret, step), now, step), null);
  for (const bad of [null,"12345","１２３４５６","1234567",123456]) assert.equal(otp.verify(secret, bad, now), null);
});
test("TOTP encryption authenticates account and ciphertext; URI contains supported parameters", () => {
  const secret=otp.newSecret(), key=randomBytes(32), encrypted=otp.encrypt(secret,key,"owner:a");
  assert.equal(otp.decrypt(encrypted,key,"owner:a"),secret);
  assert.throws(()=>otp.decrypt(encrypted,key,"owner:b"));
  assert.throws(()=>otp.decrypt({...encrypted,data:"00".repeat(32)},key,"owner:a"));
  assert(!JSON.stringify(encrypted).includes(secret));
  const uri=new URL(otp.uri(secret,"tester"));assert.equal(uri.protocol,"otpauth:");assert.equal(uri.hostname,"totp");assert.equal(uri.searchParams.get("period"),"30");
});
