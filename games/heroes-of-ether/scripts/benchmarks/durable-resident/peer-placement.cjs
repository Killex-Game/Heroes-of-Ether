'use strict';
// Optional isolated Linux benchmark handshake. The privileged test supervisor
// validates and moves only this benchmark's fresh generator child, before any
// sockets or workload start. Production never imports this helper.
const fs=require('node:fs'),path=require('node:path'),{randomUUID}=require('node:crypto');
module.exports=async function placePeer(peer){
 const directory=process.env.ROOM_BENCH_PEER_PLACEMENT;if(!directory)return;
 if(process.platform!=='linux'||!path.isAbsolute(directory))throw Error('Invalid isolated peer placement');
 const nonce=randomUUID(),name=path.join(directory,String(peer.pid));
 fs.writeFileSync(name+'.json',JSON.stringify({pid:peer.pid,parent:process.pid,nonce}),{flag:'wx',mode:0o600});
 const deadline=performance.now()+15000;
 while(performance.now()<deadline){
  if(peer.exitCode!==null||peer.signalCode!==null)throw Error('Generator exited during placement');
  if(fs.existsSync(name+'.ok')){
   const ack=JSON.parse(fs.readFileSync(name+'.ok','utf8'));
   if(ack.pid!==peer.pid||ack.nonce!==nonce||!ack.separated)throw Error('Invalid generator placement acknowledgement');
   return;
  }
  await new Promise(resolve=>setTimeout(resolve,100));
 }
 throw Error('Generator resource placement timed out');
};
