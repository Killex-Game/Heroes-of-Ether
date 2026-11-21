"use strict";
const { BoosterError, BOOSTERS } = require('../boosters/booster-catalog');
const { newBanId, isShort } = require('./ban-identifiers');
const currencies = { coins:'Монеты', crystals:'Кристаллы', bucks:'Эфир' };
function append(world, profile, event, command, actorName) {
  if (!['wallet','inventory','account'].includes(command.action)) return;
  const id = newBanId(world), key = Object.keys(event.after)[0];
  const notice = { id, at:event.at, actorName, reason:event.reason, action:command.action,
    item:command.action === 'wallet' ? currencies[key] : command.action === 'inventory' ? BOOSTERS.get(key).name : command.kind === 'vip' ? 'VIP' : 'Premium',
    before:event.before[key], after:event.after[key],
    ...(command.action === 'account' ? { days:command.days } : { amount:command.amount }) };
  profile.administrativeNotices = [...(profile.administrativeNotices || []), notice];
  event.operationId = id;
}
function view(profile) { return (profile.administrativeNotices || []).slice(0,20).map(n=>({...n})); }
function acknowledge(profiles, token, input) {
  if (!isShort(input.id)) throw new BoosterError('Неверный ID уведомления.');
  return profiles.transactProfile(token, input.requestId, JSON.stringify(['admin-notice-read',input.id]), p=>{
    p.administrativeNotices = (p.administrativeNotices || []).filter(n=>n.id!==input.id);
  });
}
function validate(p) {
  const rows = p.administrativeNotices;
  if (rows === undefined) return;
  if (!Array.isArray(rows) || rows.some(n=>!n || !isShort(n.id) || !Number.isSafeInteger(n.at) || n.at<0 ||
    typeof n.actorName!=='string' || !n.actorName || n.actorName.length>100 || typeof n.reason!=='string' || n.reason.length>500 ||
    !['wallet','inventory','account'].includes(n.action) || typeof n.item!=='string' || !n.item ||
    !Number.isSafeInteger(n.before) || n.before<0 || !Number.isSafeInteger(n.after) || n.after<0 ||
    (n.action==='account' ? !Number.isInteger(n.days)||n.days<0||n.days>365 : !Number.isSafeInteger(n.amount)||n.amount!==n.after-n.before)) ||
    new Set(rows.map(n=>n.id)).size!==rows.length) throw Error('Повреждены уведомления о правках профиля.');
}
module.exports={append,view,acknowledge,validate};
