'use strict';
// Diagnostic-only preload. Counts broad rescans without changing settlement.
const {SettlementCache}=require('../../src/server/profiles/settlement-cache');
const tables=require('../../src/server/profiles/immutable-table-delta');
const fs=require('node:fs');
const stats={};
for(const name of ['worldChestExpiryDue','matchingProfiles']) {
 const original=SettlementCache.prototype[name];
 SettlementCache.prototype[name]=function(...args) {
  const key=name==='matchingProfiles'?args[0]:name;
  const s=stats[key]??=( {calls:0,full:0,rows:0,ms:0,exact:0,unknown:0,expiry:0} );s.calls++;
  const profiles=args[name==='matchingProfiles'?1:0];
  const prior=name==='matchingProfiles'?this.matches.get(key):this.lastTreasuryWorld;
  const valid=name==='matchingProfiles'?prior?.context===args[3]:prior&&args[1]>=prior.from&&args[1]<prior.until;
  const changed=valid&&prior?tables.changedKeys(prior.profiles,profiles):null;
  const known=name==='matchingProfiles'?this.matchWorlds?.get(key)?.get(profiles):this.treasuryWorlds?.get(profiles);
  const cached=known&&(name==='matchingProfiles'?known.context===args[3]:args[1]>=known.from&&args[1]<known.until);
  if(prior?.profiles===profiles)s.exact++;
  if(cached)s.cached=(s.cached||0)+1;
  else if(changed===null){s.full++;s.rows+=Object.keys(profiles).length;if(valid)s.unknown++;else s.expiry++;}
  else s.rows+=changed.length;
  const at=performance.now();try{return original.apply(this,args);}finally{s.ms+=performance.now()-at;}
 };
}
process.on('exit',()=>{if(process.env.SETTLEMENT_PROBE_OUT)fs.writeFileSync(process.env.SETTLEMENT_PROBE_OUT,JSON.stringify(stats,null,2));});
