const fs=require('node:fs');
const path=require('node:path');
const {chromium}=require('C:/Users/semen/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
(async()=>{
 const browser=await chromium.launch({channel:'chrome',headless:true});
 const page=await browser.newPage();
 const base=__dirname;
 const walk=d=>fs.readdirSync(d,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(path.join(d,e.name)):[path.join(d,e.name)]);
 const files=walk(path.join(base,'sources')).filter(p=>/\.(ogg|mp3|wav)$/i.test(p)&&!p.includes('Preview')&&!p.includes('casino')&&!p.includes('jingles'));
 const result=[];
 for(const file of files){
  const data=await page.evaluate(async b64=>{
   const ctx=new OfflineAudioContext(2,1,44100);
   const a=Uint8Array.from(atob(b64),c=>c.charCodeAt(0));
   const b=await ctx.decodeAudioData(a.buffer);
   let peak=0,sq=0; const arr=b.getChannelData(0), env=[];
   for(let i=0;i<arr.length;i++){peak=Math.max(peak,Math.abs(arr[i]));sq+=arr[i]*arr[i];}
   for(let i=0;i<arr.length;i+=Math.round(b.sampleRate*.1)){
    let s=0,n=0;for(let j=i;j<Math.min(i+b.sampleRate*.1,arr.length);j++){s+=arr[j]*arr[j];n++;}env.push(+Math.sqrt(s/n).toFixed(3));
   }
   return {duration:+b.duration.toFixed(3),peak:+peak.toFixed(4),rms:+Math.sqrt(sq/arr.length).toFixed(4),env};
  },fs.readFileSync(file).toString('base64'));
  result.push({file:path.relative(base,file).replaceAll('\\','/'),...data});
 }
 fs.writeFileSync(path.join(base,'source-analysis.json'),JSON.stringify(result,null,2));
 console.log(JSON.stringify(result.filter(r=>r.file.includes('extra')).map(r=>r),null,2));
 await browser.close();
})().catch(e=>{console.error(e);process.exitCode=1});
