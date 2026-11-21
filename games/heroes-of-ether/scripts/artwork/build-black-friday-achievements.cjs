"use strict";
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),sharp=require('sharp');
const root=path.resolve(__dirname,'../..'),docs=path.join(root,'docs/artwork/black-friday-achievements-20261109');
const entries=JSON.parse(fs.readFileSync(path.join(docs,'prompts.json'),'utf8'));
const {compose}=require('./compose-achievement.cjs');
(async()=>{
 const result=[];
 for(const e of entries){
  const saved=path.join(docs,e.id+'.png');
  if(!fs.existsSync(saved))fs.copyFileSync(e.source,saved);
  const meta=await sharp(saved).metadata();
  if(!meta.hasAlpha)throw Error('Transparency missing: '+e.id);
  let output;
  if(e.installed){
   output=path.join(root,'public/assets/achievements/illustrated-v2',e.id+'.webp');
   const interior=path.join(docs,e.id+'-composition.png');
   await sharp(saved).trim({threshold:8}).resize(256,256,{fit:'contain',background:'#00000000'}).png().toFile(interior);
   await compose(interior,output);
  }
  result.push({...e,saved,output,tool:'image_gen (built-in)',sha256:crypto.createHash('sha256').update(fs.readFileSync(saved)).digest('hex')});
 }
 fs.writeFileSync(path.join(docs,'manifest.json'),JSON.stringify(result,null,2)+'\n');
 console.log('Saved '+result.length+' originals and five game icons.');
})().catch(e=>{console.error(e);process.exitCode=1;});

