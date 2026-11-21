const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const sharp = require("sharp");
const root = path.resolve(__dirname, "../..");
const docs = path.join(root, "docs/artwork/crest-refined-20261108");
const source = path.join(root, "public/assets/clan-crests/prism-v3");
const target = path.join(root, "public/assets/clan-crests/prism-refined-v5");
const edits = JSON.parse(fs.readFileSync(path.join(docs, "generations.json"), "utf8")).entries;
const hash = b => crypto.createHash("sha256").update(b).digest("hex");
async function bounds(file) {
  const {data, info} = await sharp(file).ensureAlpha().raw().toBuffer({resolveWithObject:true});
  let left=info.width, top=info.height, right=0, bottom=0;
  for(let y=0;y<info.height;y++)for(let x=0;x<info.width;x++){
    if(data[(y*info.width+x)*4+3] > 10){left=Math.min(left,x);top=Math.min(top,y);right=Math.max(right,x);bottom=Math.max(bottom,y);}
  }
  if(right<=left||bottom<=top)throw Error("Empty image: "+file);
  return {left,top,width:right-left+1,height:bottom-top+1};
}
(async()=>{
  for(const size of [128,512]){
    fs.mkdirSync(path.join(target,String(size)),{recursive:true});
    for(const file of fs.readdirSync(path.join(source,String(size))))fs.copyFileSync(path.join(source,String(size),file),path.join(target,String(size),file));
  }
  fs.mkdirSync(path.join(docs,"sources"),{recursive:true});
  const overrides={}, manifest=[];
  for(const entry of edits){
    if(!entry.path)throw Error("Missing generation: "+entry.id);
    const original=fs.readFileSync(entry.path);
    fs.writeFileSync(path.join(docs,"sources",entry.id+".png"),original);
    const box=await bounds(entry.path);
    // Crop transparent padding only; normalize the same 440px icon envelope.
    const icon=await sharp(entry.path).extract(box).resize(440,440,{fit:"inside"}).png().toBuffer();
    const m=await sharp(icon).metadata();
    const full=await sharp({create:{width:512,height:512,channels:4,background:"#00000000"}})
      .composite([{input:icon,left:Math.round((512-m.width)/2),top:Math.round((512-m.height)/2)}]).png().toBuffer();
    const outputs={};
    for(const size of [128,512]){
      const buffer=await sharp(full).resize(size,size).webp({quality:92,alphaQuality:100}).toBuffer();
      fs.writeFileSync(path.join(target,String(size),entry.id+".webp"),buffer);
      outputs[size]=hash(buffer);
    }
    const embedded=await sharp(full).resize(256,256).png({compressionLevel:9}).toBuffer();
    overrides[entry.id]='<image x="96" y="96" width="320" height="320" href="data:image/png;base64,'+embedded.toString("base64")+'"/>';
    manifest.push({id:entry.id,source:entry.path,sha256:hash(original),outputSha256:outputs,prompt:entry.prompt});
  }
  fs.writeFileSync(path.join(root,"public/shared/clan-crest-symbols-refined.js"),
    '/* Existing Prizm identities, refined detail. Sources: docs/artwork/crest-refined-20261108. */\n'+
    '(function(root,factory){if(typeof module==="object"&&module.exports)module.exports=factory(require("./clan-crest-symbols-prism"));else root.KillexCrestPrismSymbols=factory(root.KillexCrestPrismSymbols);})(typeof globalThis!=="undefined"?globalThis:this,function(original){return Object.freeze({...original,...'+JSON.stringify(overrides)+'});});\n');
  fs.writeFileSync(path.join(docs,"manifest.json"),JSON.stringify({entries:manifest,unchanged:fs.readdirSync(path.join(source,"512")).filter(f=>!edits.some(e=>f===e.id+".webp"))},null,2)+"\n");
  console.log(JSON.stringify({refined:edits.length,unchanged:25-edits.length,folder:target}));
})().catch(e=>{console.error(e);process.exitCode=1});
