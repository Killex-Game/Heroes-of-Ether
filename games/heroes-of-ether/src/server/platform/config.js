"use strict";
const fs = require('node:fs');
const path = require('node:path');
const { id } = require('./launch');
function validate(value) {
  if (!value || value.enabled === false) return null;
  if (value.enabled !== true || !id(value.vkAppId) ||
      (value.okAppId !== null && value.okAppId !== undefined && !id(value.okAppId)) ||
      typeof value.appSecret !== 'string' || value.appSecret.length < 8 || value.appSecret.length > 512 ||
      typeof value.sessionSecret !== 'string' || !/^[a-f0-9]{64}$/.test(value.sessionSecret) ||
      typeof value.requirePlatform !== 'boolean') throw Error('PLATFORM_CONFIG_INVALID');
  return Object.freeze({ enabled:true, vkAppId:value.vkAppId, okAppId:value.okAppId || null,
    appSecret:value.appSecret, sessionSecret:value.sessionSecret, requirePlatform:value.requirePlatform });
}
function read(directory) {
  const file = path.join(directory, 'social-platforms.local.json');
  if (!fs.existsSync(file)) return null;
  try { return validate(JSON.parse(fs.readFileSync(file, 'utf8'))); }
  catch (_) { throw Object.assign(Error('Некорректны настройки входа через социальные сети.'), {code:'SERVER_CONFIG'}); }
}
module.exports = { read, validate };
