"use strict";
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),sharp=require('sharp');
const {compose}=require('./compose-achievement.cjs');
const root=path.resolve(__dirname,'../..'),docs=path.join(root,'docs/artwork/arena-objectives-20261109');
(async()=>{
 const records=JSON.parse(fs.readFileSync(path.join(docs,'prompts.json'),'utf8'));
 for(const r of records){
  const saved=path.join(docs,r.id+'.png');
  if(!fs.existsSync(saved))fs.copyFileSync(r.source,saved);
  if(!(await sharp(saved).metadata()).hasAlpha)throw Error('Missing alpha: '+r.id);
  const output=path.join(root,'public/assets',r.kind==='achievement'?'achievements/illustrated-v2':'events/black-friday',r.id+'.webp');
  const normalized=sharp(saved).trim({threshold:8}).resize(256,256,{fit:'contain',background:'#00000000'});
  if(r.kind==='achievement'){
   const interior=path.join(docs,r.id+'-composition.png');
   await normalized.png().toFile(interior);await compose(interior,output);
  }else await normalized.webp({quality:94,alphaQuality:100}).toFile(output);
  r.saved=saved;r.output=output;r.tool='image_gen (built-in)';
  r.sha256=crypto.createHash('sha256').update(fs.readFileSync(saved)).digest('hex');
  r.outputSha256=crypto.createHash('sha256').update(fs.readFileSync(output)).digest('hex');
 }
 fs.writeFileSync(path.join(docs,'manifest.json'),JSON.stringify(records,null,2)+'\n');
 console.log('Installed timer and Case achievement.');
})().catch(e=>{console.error(e);process.exitCode=1;});
