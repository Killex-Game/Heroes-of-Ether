"use strict";
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{spawnSync}=require('node:child_process');
test('maintenance public hint survives release switches, contains no private data and disappears on reopen',t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'heroether-maintenance-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const shared=path.join(root,'shared'),data=path.join(shared,'data');fs.mkdirSync(data,{recursive:true});
 const script=fs.readFileSync(path.resolve(__dirname,'../../scripts/deployment/maintenance.cjs'));
 const run=(release,action)=>{const result=spawnSync(process.execPath,[path.join(root,release,'scripts/deployment/maintenance.cjs'),action],{encoding:'utf8'});assert.equal(result.status,0,result.stderr);return JSON.parse(result.stdout);};
 for(const release of ['before','after']){const dir=path.join(root,release);fs.mkdirSync(path.join(dir,'scripts/deployment'),{recursive:true});fs.writeFileSync(path.join(dir,'scripts/deployment/maintenance.cjs'),script);fs.symlinkSync(data,path.join(dir,'data'),process.platform==='win32'?'junction':'dir');}
 fs.writeFileSync(path.join(data,'profiles.json'),'private fixture');
 assert.equal(run('before','on').maintenance,true);const hint=path.join(shared,'maintenance-public.json');
 const value=JSON.parse(fs.readFileSync(hint,'utf8'));assert.deepEqual(value,{maintenance:true,mode:'maintenance',title:'Техническое обновление',message:'Устанавливаем обновление игры.',retryAfter:5});
 if(process.platform!=='win32')assert.equal(fs.statSync(hint).mode&0o777,0o644);
 assert.equal(run('after','status').maintenance,true);assert.equal(run('after','on').maintenance,true);
 assert.equal(run('after','off').maintenance,false);assert(!fs.existsSync(hint));assert(!fs.existsSync(path.join(data,'maintenance.enabled')));
 assert.equal(run('before','off').maintenance,false);assert.equal(fs.readFileSync(path.join(data,'profiles.json'),'utf8'),'private fixture');
});
