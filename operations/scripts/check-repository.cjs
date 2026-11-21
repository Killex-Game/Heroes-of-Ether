"use strict";
// Read-only check of the Git index. Never print file contents or secret values.
const {execFileSync}=require('node:child_process');
const path=require('node:path'),{createHash}=require('node:crypto');
const forbidden=/(^|\/)(?:data|admin-control|secrets|backups|artifacts|node_modules|\.cache)(\/|$)|(^|\/)\.env(?:\.|$)|\.credentials\.env$|\.(?:key|pem|pfx|p12|cpuprofile|heapsnapshot|log)$|(^|\/)config\/(?:mongodb\.local|owner-admin)\.json$|(^|\/)operations\/runtimes\//i;
const markers=[/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,/\bgh[pousr]_[a-zA-Z0-9]{30,}\b/,/\bgithub_pat_[a-zA-Z0-9_]{40,}\b/,/mongodb(?:\+srv)?:\/\/[^\s/:@]+:[^\s/@]+@/i];
function check(root){
  const git=(args,input)=>execFileSync('git',args,{cwd:root,input,maxBuffer:16*1024*1024,stdio:['pipe','pipe','pipe']});
  const base=git(['rev-parse','--show-toplevel']).toString().trim(),problems=[];
  const entries=git(['ls-files','--stage','-z']).toString().split('\0').filter(Boolean);
  let exceptions={};if(entries.some(e=>e.endsWith('\t.repository-check.json')))exceptions=JSON.parse(git(['show',':.repository-check.json']).toString());
  const oids=[...new Set(entries.map(e=>e.split(' ')[1]))];
  const objects=new Map(oids.length?git(['cat-file','--batch-check'],oids.join('\n')+'\n').toString().trim().split('\n').map(row=>{const [oid,type,size]=row.split(' ');return [oid,{type,bytes:Number(size)}];}):[]),inspect=new Map();
  for(const entry of entries){
    const match=entry.match(/^(\d+) ([0-9a-f]+) (\d)\t([\s\S]+)$/);if(!match)throw Error('Unrecognized Git index entry');
    const [,mode,oid,stage,name]=match;
    if(stage!=='0'){problems.push({path:name,reason:'unresolved-conflict'});continue;}
    if(mode==='120000'||mode==='160000'){problems.push({path:name,reason:'review-link-or-submodule'});continue;}
    if(forbidden.test(name)&&!/(^|\/)\.env\.example$/.test(name))problems.push({path:name,reason:'private-or-runtime-path'});
    const {bytes,type}=objects.get(oid)||{};if(type!=='blob'||!Number.isSafeInteger(bytes))throw Error('Missing Git blob');
    if(bytes>50*1024*1024){problems.push({path:name,reason:'file-over-team-50MiB-limit'});continue;}
    // Inspect code/config/text only. Binary artwork is allowed, never decoded.
    if(bytes<=2*1024*1024&&!/\.(?:png|webp|jpg|jpeg|gif|ico|woff2?|ttf|otf|mp3|ogg|mp4|webm|zip)$/i.test(name)){
      const item=inspect.get(oid)||{oid,bytes,names:[]};item.names.push(name);inspect.set(oid,item);
    }
  }
  const waiting=[...inspect.values()];
  for(let i=0;i<waiting.length;){
    const batch=[];let total=0;
    while(i<waiting.length&&total<4*1024*1024){const item=waiting[i++];batch.push(item);total+=item.bytes;}
    const data=git(['cat-file','--batch'],batch.map(x=>x.oid).join('\n')+'\n');let offset=0;
    for(const item of batch){const end=data.indexOf(10,offset);if(end<0)throw Error('Invalid Git batch');
      const header=data.subarray(offset,end).toString().split(' ');if(header[0]!==item.oid||header[1]!=='blob'||Number(header[2])!==item.bytes)throw Error('Git batch mismatch');
      offset=end+1;const body=data.subarray(offset,offset+item.bytes);offset+=item.bytes+1;
      if(!body.includes(0)&&markers.some(re=>re.test(body.toString('utf8'))))for(const name of item.names){
        const approved=exceptions[name];
        if(!approved?.reason||approved.sha256!==createHash('sha256').update(body).digest('hex'))problems.push({path:name,reason:'possible-credential'});
      }
    }
  }
  return {root:base,indexEntries:entries.length,ok:problems.length===0,problems};
}
module.exports={check};
if(require.main===module){
  try{const report=check(path.resolve(process.argv[2]||'.'));console.log(JSON.stringify(report,null,2));if(!report.ok)process.exitCode=1;}
  catch(_){console.error('Repository check failed. Use an existing Git checkout; no files were changed.');process.exitCode=2;}
}
