"use strict";
const fs=require('node:fs'),path=require('node:path');
// Root filesystem's backing block device, once only (no partition/parent double counting).
function diskCounters(at=Date.now()){
  if(process.platform!=='linux')return {available:false,reason:'Дисковые счётчики доступны на Linux VPS'};
  try{
    const line=fs.readFileSync('/proc/self/mountinfo','utf8').split('\n').find(s=>s.split(' ')[4]==='/');
    const device=line?.split(' ')[2];if(!device)throw Error();
    let resolved=fs.realpathSync('/sys/dev/block/'+device);
    if(fs.existsSync(path.join(resolved,'partition')))resolved=path.dirname(resolved);
    const fields=fs.readFileSync(path.join(resolved,'stat'),'utf8').trim().split(/\s+/).map(Number);
    if(fields.length<11||fields.some(n=>!Number.isFinite(n)))throw Error();
    const name=path.basename(resolved);
    return {available:true,epoch:name,device:name,at,read:fields[2]*512,write:fields[6]*512};
  }catch(_){return {available:false,reason:'Счётчики диска корневого раздела недоступны'};}
}
module.exports={diskCounters};
