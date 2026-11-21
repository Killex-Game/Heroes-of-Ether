'use strict';
// Only isolated in-memory browser scenarios: audio/layout tests begin with an
// established player; onboarding is exercised by its own browser scenarios.
const assert=require('node:assert/strict');
function prepareProfile(store,auth){
 assert.equal(store.journal,undefined,'Never prepare a live/durable profile');
 const player=store.find(auth.token);
 player.personal={...player.personal,nameSet:true,introPending:false};
 player.loginReward={date:require('../../src/server/accounts/account-benefits').loginRewardDay(store.now()),day:1};
 return player;
}
async function prepareContext(context){
 await context.addInitScript(()=>{
  document.addEventListener('killex:profile',event=>{
   localStorage.setItem(KillexPlatform.storageKey('.releaseNotes.v1.'+event.detail.id),KillexRelease.id);
  },{once:true});
 });
}
async function clearInitialDialogs(page){
 for(let i=0;i<5;i++){
  await page.evaluate(()=>document.querySelectorAll('dialog[open]').forEach(dialog=>dialog.close()));
  await page.waitForTimeout(40);
 }
}
module.exports={prepareProfile,prepareContext,clearInitialDialogs};
