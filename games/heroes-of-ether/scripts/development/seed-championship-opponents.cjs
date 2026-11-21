"use strict";
const fs=require('node:fs'),path=require('node:path');
const {ProfileStore}=require('../../src/server/profiles/profile-store');
const {prepareChampionshipOpponents}=require('../../src/server/testing/championship-opponents');
const apply=process.argv.includes('--apply');
const file=path.resolve(__dirname,'../../data/profiles.json');
const lock=path.join(path.dirname(file),'server.lock');
if(apply&&fs.existsSync(lock)) throw Error('Требуется штатная остановка локального сервера.');
(async()=>{
  const at=Date.now(),store=new ProfileStore({filePath:file,now:()=>at});
  const prepared=prepareChampionshipOpponents(store.data,at);
  if(apply&&prepared.summary.addedClans) {
    if(fs.existsSync(lock))throw Error('Сервер запущен во время подготовки.');
    const backup=path.join(path.dirname(file),'backups',`championship-opponents-${at}`);
    fs.mkdirSync(backup,{recursive:true});
    fs.writeFileSync(path.join(backup,'recovered-profiles.json'),JSON.stringify(store.data)+'\n',{flag:'wx'});
    store.save(prepared.data,at);
    await store.close();
  }
  console.log(JSON.stringify({applied:apply,...prepared.summary},null,2));
})().catch(e=>{console.error(e);process.exitCode=1;});
