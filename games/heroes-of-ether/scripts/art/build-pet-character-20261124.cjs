"use strict";
// Technical export of image_gen artwork. No repainting or background removal.
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
const sharp = require(process.env.KILLEX_SHARP_MODULE || "sharp");
const game = path.resolve(__dirname, "../.."), design = path.join(game, "design/pet-character-20261124");
const backup = process.env.KILLEX_ART_BACKUP;
if (!backup || !path.isAbsolute(backup)) throw Error("Absolute KILLEX_ART_BACKUP is required");
const hash = b => crypto.createHash("sha256").update(b).digest("hex");
async function bounds(input) {
  const {data, info} = await sharp(input).ensureAlpha().raw().toBuffer({resolveWithObject:true});
  let left=info.width, top=info.height, right=-1, bottom=-1;
  for(let y=0;y<info.height;y++)for(let x=0;x<info.width;x++)if(data[(y*info.width+x)*4+3]>16){
    left=Math.min(left,x);right=Math.max(right,x);top=Math.min(top,y);bottom=Math.max(bottom,y);
  }
  if(right<0)throw Error("Empty artwork");
  return {left,top,width:right-left+1,height:bottom-top+1};
}
const jobs=[...['drakosha','leva','zaya'].flatMap(p=>Array.from({length:6},(_,i)=>({source:`${p}-${i}`,target:`pets/levels-v1/${p}-${i}.webp`}))),
  ...['drakosha','leva','zaya'].map(p=>({source:`${p}-3`,target:`achievements/illustrated-v2/pet_level_${p}.webp`})),
  ...[1,2,4,6,7].map(id=>({source:`emote-${id}`,target:`emotes/pets-v1/${id}.webp`})),
  {source:'pet-exclusive',target:'achievements/illustrated-v2/pet_exclusive.webp'},
  {source:'pets-banner',target:'banners/pets.webp',scene:true},
  {source:'easter-banner-final',target:'events/easter-hunt/banner.png',scene:true},
  {source:'easter-banner-final',target:'events/easter-hunt/card-banner.webp',scene:true}];
(async()=>{
  fs.mkdirSync(backup,{recursive:true}); const report=[];
  for(const j of jobs){
    const rel='public/assets/'+j.target, dest=path.join(game,rel), saved=path.join(backup,rel);
    fs.mkdirSync(path.dirname(saved),{recursive:true});
    if(!fs.existsSync(saved))fs.copyFileSync(dest,saved);
    const original=fs.readFileSync(saved),meta=await sharp(original).metadata(),src=path.join(design,'sources',j.source+'.png');
    let pipeline, frame;
    if(j.scene)pipeline=sharp(src).resize(meta.width,meta.height,{fit:'cover',position:'centre'}).removeAlpha();
    else{
      const old=await bounds(original),fresh=await bounds(src);
      const body=await sharp(src).extract(fresh).resize(old.width,old.height,{fit:'inside'}).png().toBuffer(),m=await sharp(body).metadata();
      const left=old.left+Math.round((old.width-m.width)/2),top=old.top+old.height-m.height;
      pipeline=sharp({create:{width:meta.width,height:meta.height,channels:4,background:{r:0,g:0,b:0,alpha:0}}}).composite([{input:body,left,top}]);
      frame={old,source:fresh,result:{left,top,width:m.width,height:m.height}};
    }
    const bytes=await (meta.format==='png'?pipeline.png({compressionLevel:9,palette:true,quality:95,effort:10,dither:0.5}):pipeline.webp({quality:90,alphaQuality:100})).toBuffer();
    const check=await sharp(bytes).metadata();
    if(check.width!==meta.width||check.height!==meta.height||check.format!==meta.format)throw Error('Format changed: '+rel);
    const tmp=dest+'.pet-next';fs.writeFileSync(tmp,bytes,{flag:'wx'});fs.renameSync(tmp,dest);
    report.push({file:rel,source:j.source+'.png',before:hash(original),after:hash(bytes),sourceSha256:hash(fs.readFileSync(src)),oldBytes:original.length,bytes:bytes.length,frame});
  }
  fs.writeFileSync(path.join(design,'export.json'),JSON.stringify(report,null,2));
  console.log(JSON.stringify({files:report.length,oldBytes:report.reduce((n,r)=>n+r.oldBytes,0),bytes:report.reduce((n,r)=>n+r.bytes,0)}));
})().catch(e=>{console.error(e);process.exitCode=1;});
