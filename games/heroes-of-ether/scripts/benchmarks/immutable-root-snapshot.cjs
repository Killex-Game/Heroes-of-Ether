'use strict';
const fs=require('node:fs'),path=require('node:path'),Module=require('node:module'),assert=require('node:assert/strict');
const {performance}=require('node:perf_hooks');
const [baselineDirectory,output]=process.argv.slice(2);assert(baselineDirectory&&output&&global.gc&&!fs.existsSync(output));
const file=require.resolve('../../src/server/persistence/snapshot-builder'),old=new Module(file,module);
old.filename=file;old.paths=Module._nodeModulePaths(path.dirname(file));
const immutableFile=require.resolve('../../src/server/persistence/immutable-document'),immutable=new Module(immutableFile,module);
immutable.filename=immutableFile;immutable.paths=Module._nodeModulePaths(path.dirname(immutableFile));
immutable._compile(fs.readFileSync(path.join(baselineDirectory,'immutable-document.js'),'utf8'),immutableFile);
const originalRequire=old.require.bind(old);old.require=id=>id==='./immutable-document'?immutable.exports:originalRequire(id);
old._compile(fs.readFileSync(path.join(baselineDirectory,'snapshot-builder.js'),'utf8'),file);
const implementations=[old.exports,require(file)],results=[],expected=new Map();let comparedFrames=0;
function run(variant,count,rootRows){
 let world={version:14,_journalRevision:1,profiles:{},clans:{}};
 for(let i=0;i<count;i++)world.profiles['p'+i]={id:'p'+i,wallet:{coins:10000},progress:{xp:0},arenaReceipts:{a:Object.fromEntries(Array.from({length:12},(_,j)=>['r'+j,'confirmed-'+i+'-'+j]))}};
 if(rootRows)world.events={receipts:Object.fromEntries(Array.from({length:rootRows},(_,i)=>['event-'+i,{at:i,owner:'profile-'+i,claimed:true,items:['coins','crystals','ether']}]))};
 const builder=new implementations[variant].SnapshotBuilder({immutableSource:{owns:value=>value===world}});
 const frames=[];let previous,coldMs=0,warmMs=0,reusedDocuments=0;
 global.gc();const startCpu=process.cpuUsage();
 for(let tick=0;tick<21;tick++){
  if(tick){const profiles={...world.profiles};for(let j=0;j<30;j++){const id='p'+((tick*17+j)%count),p=profiles[id];profiles[id]={...p,progress:{xp:tick*5}};}world={...world,profiles,_journalRevision:tick+1};}
  const begin=performance.now(),next=builder.pack(world),elapsed=performance.now()-begin;
  if(tick)warmMs+=elapsed;else coldMs=elapsed;
  if(previous)for(const [id,doc]of next.docs)if(previous.docs.get(id)===doc)reusedDocuments++;
  frames.push({revision:next.revision,worldHash:next.worldHash,digest:next.digest,documents:next.docs.size});
  previous=next;
 }
 const cpu=process.cpuUsage(startCpu);global.gc();
 const key=count+':'+rootRows;if(expected.has(key)){assert.deepEqual(frames,expected.get(key));comparedFrames+=frames.length;}else expected.set(key,frames);
 return{variant:variant?'candidate':'baseline',profiles:count,rootRows,coldMs,warmMs,cpuMs:(cpu.user+cpu.system)/1000,reusedDocuments,memory:process.memoryUsage(),maxRSSKiB:process.resourceUsage().maxRSS,frames};
}
for(const rootRows of [0,10000])for(const variant of [0,1,1,0]){global.gc();results.push(run(variant,1280,rootRows));}
const report={at:new Date().toISOString(),node:process.version,platform:process.platform,unchangedReceiptFields:true,exactFrameComparisons:comparedFrames,results,scope:'Canonical immutable snapshot preparation with 0 or 10000 synthetic global event receipts only, excluding filesystem, network, PostgreSQL and game simulation; not measured CCU'};
fs.writeFileSync(output,JSON.stringify(report,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({output,exactFrameComparisons:comparedFrames,rows:results.length}));
