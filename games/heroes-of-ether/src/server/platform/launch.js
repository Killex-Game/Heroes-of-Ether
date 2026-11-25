"use strict";
const { createHmac } = require('node:crypto');
const { verifyVkLaunchSignature } = require('../../../deployment/vk-production/auth/vk-mini-app-launch');
const verified = new WeakSet();
const id = value => typeof value === 'string' && /^[1-9][0-9]{0,18}$/.test(value) && BigInt(value) <= 9223372036854775807n;

// Current VK Games and linked OK Games use the signed vk_* launch contract.
// OK's vk_user_id can change when VK ID is linked; vk_ok_user_id is stable.
function verify(search, config, now = Date.now()) {
  if (!config || !id(config.vkAppId) || !Number.isFinite(now)) return null;
  const p = verifyVkLaunchSignature(search, config.appSecret);
  if (!p || p.vk_app_id !== config.vkAppId || !id(p.vk_user_id) ||
      !/^[1-9][0-9]{0,10}$/.test(p.vk_ts || '')) return null;
  const age = now / 1000 - Number(p.vk_ts);
  if (age < -30 || age > 300) return null;
  let network = 'vk', userId = p.vk_user_id;
  if (p.vk_client === 'ok') {
    if (!id(config.okAppId) || p.vk_ok_app_id !== config.okAppId || !id(p.vk_ok_user_id)) return null;
    network = 'ok'; userId = p.vk_ok_user_id;
  } else if ((p.vk_client && p.vk_client !== 'vk') || p.vk_ok_user_id || p.vk_ok_app_id || p.vk_original_vk_id) return null;
  const identity = Object.freeze({ network, appId: config.vkAppId, userId,
    ...(network === 'ok' ? { okAppId: config.okAppId } : {}) });
  verified.add(identity);
  return identity;
}
function requireVerified(identity) {
  if (!verified.has(identity)) throw Error('PLATFORM_IDENTITY_NOT_VERIFIED');
  return identity;
}
function identityKey(identity) {
  return JSON.stringify(['heroether-social-v1', identity?.network, identity?.appId, identity?.okAppId || '', identity?.userId]);
}
function profileToken(identity, secret) {
  requireVerified(identity);
  if (typeof secret !== 'string' || !/^[a-f0-9]{64}$/.test(secret)) throw Error('PLATFORM_SESSION_SECRET_INVALID');
  // Separate persistent secret: rotating the provider app secret must not reset profiles.
  return createHmac('sha256', Buffer.from(secret, 'hex'))
    .update(identityKey(identity))
    .digest('hex');
}
module.exports = { verify, requireVerified, profileToken, identityKey, id };
