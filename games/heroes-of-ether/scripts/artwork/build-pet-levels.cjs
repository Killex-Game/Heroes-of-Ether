"use strict";

// Technical export only: image_gen supplies alpha and artwork; this script never
// paints pixels or removes a background. All six levels use one scale per pet.
const fs = require("node:fs/promises");
const path = require("node:path");
const sharp = require("sharp");
const root = path.resolve(__dirname, "../..");
const sourceDir = path.join(root, "design/generated-20261024/pet-levels");
const outputDir = path.join(root, "public/assets/pets/levels-v1");
const configs = {
  zaya: { scale: 1.2, anchors: [250,254,254,250,254,254], feet: [403,404,403,394,394,395] },
  leva: { scale: 1.12, anchors: [267,252,232,267,252,232], feet: [433,433,433,393,393,392] },
  drakosha: { scale: 1.3, anchors: [260,252,252,260,252,252], feet: [403,403,403,394,395,395] },
  manya: { scale: 1.08, anchors: [234,234,234,234,234,234], feet: [420,420,420,411,411,411] },
};

async function alphaBounds(input, edgeWidth = 24) {
  const { data, info } = await sharp(input).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let minX=info.width, minY=info.height, maxX=-1, maxY=-1, edgePixels=0, transparent=0;
  for (let y=0; y<info.height; y++) for (let x=0; x<info.width; x++) {
    const alpha = data[(y*info.width+x)*4+3];
    if (!alpha) transparent++;
    if (alpha <= 16) continue;
    minX=Math.min(minX,x); minY=Math.min(minY,y); maxX=Math.max(maxX,x); maxY=Math.max(maxY,y);
    if (x<edgeWidth || y<edgeWidth || x>=info.width-edgeWidth || y>=info.height-edgeWidth) edgePixels++;
  }
  return { width: info.width, height: info.height, minX,minY,maxX,maxY,edgePixels,transparent };
}

(async () => {
  await fs.mkdir(outputDir, { recursive:true });
  const report=[];
  const qa=[];
  for (const [id, config] of Object.entries(configs)) {
    const atlas=path.join(sourceDir,`${id}-levels-0-5-atlas-v1.png`);
    const meta=await sharp(atlas).metadata();
    if (meta.width!==1536 || meta.height!==1024 || !meta.hasAlpha) throw new Error(`${id}: invalid transparent atlas`);
    const resized=Math.round(512*config.scale), factor=resized/512;
    for (let level=0; level<6; level++) {
      const crop=await sharp(atlas).extract({left:(level%3)*512,top:Math.floor(level/3)*512,width:512,height:512}).png().toBuffer();
      const inputCheck=await alphaBounds(crop,32);
      if (inputCheck.edgePixels) throw new Error(`${id}-${level}: source touches cell edge`);
      const artwork=await sharp(crop).resize(resized,resized).png().toBuffer();
      const left=256+Math.round(256-config.anchors[level]*factor);
      const top=256+Math.round(452-config.feet[level]*factor);
      const aligned=await sharp({create:{width:1024,height:1024,channels:4,background:{r:0,g:0,b:0,alpha:0}}})
        .composite([{input:artwork,left,top}]).png().toBuffer();
      const file=path.join(outputDir,`${id}-${level}.webp`);
      await sharp(aligned).extract({left:256,top:256,width:512,height:512}).webp({lossless:true,effort:6}).toFile(file);
      const outMeta=await sharp(file).metadata(), bounds=await alphaBounds(file);
      if (!outMeta.hasAlpha || bounds.edgePixels || !bounds.transparent) throw new Error(`${id}-${level}: invalid export margins or alpha`);
      report.push({id,level,file:path.relative(root,file).replaceAll(path.sep,"/"),...bounds,bytes:(await fs.stat(file)).size,scale:factor,baseline:452});
      const row=Object.keys(configs).indexOf(id);
      qa.push({input:await sharp(file).resize(128,128).png().toBuffer(),left:level*160+16,top:row*224+16});
      qa.push({input:await sharp(file).resize(64,64).png().toBuffer(),left:level*160+16,top:row*224+152});
      qa.push({input:await sharp(file).resize(48,48).png().toBuffer(),left:level*160+96,top:row*224+160});
    }
  }
  await sharp({create:{width:960,height:896,channels:4,background:"#f3e7d2"}}).composite(qa).png().toFile(path.join(sourceDir,"levels-v1-small-size-check.png"));
  await sharp({create:{width:960,height:896,channels:4,background:"#273748"}}).composite(qa).png().toFile(path.join(sourceDir,"levels-v1-dark-check.png"));
  await fs.writeFile(path.join(sourceDir,"levels-v1-validation.json"),JSON.stringify({date:"2026-10-24",count:report.length,export:"lossless WebP 512x512",processing:"Imagegen alpha preserved. Only grid slicing, one common scale per pet, translation, padding and lossless encoding.",sprites:report},null,2)+"\n");
  console.log(JSON.stringify({count:report.length,totalBytes:report.reduce((s,r)=>s+r.bytes,0),alpha:true,safeMargins:true,output:outputDir}));
})().catch(error=>{console.error(error);process.exitCode=1;});
