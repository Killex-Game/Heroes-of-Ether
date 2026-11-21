const fs=require('node:fs'),path=require('node:path'),{pathToFileURL}=require('node:url');
process.env.PLAYWRIGHT_BROWSERS_PATH='C:/Users/semen/Documents/ChatGPT/Сферорумия/.browser-runtimes';
const pw=require('C:/Users/semen/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const http=require('node:http');
(async()=>{
 const server=http.createServer((req,res)=>{
  const file=path.resolve(__dirname,'.'+decodeURIComponent(new URL(req.url,'http://localhost').pathname));
  if(!file.startsWith(__dirname+path.sep)){res.writeHead(403).end();return;}
  try{
   const bytes=fs.readFileSync(file);const headers={'Content-Type':({'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.wav':'audio/wav','.json':'application/json'})[path.extname(file)]||'application/octet-stream','Accept-Ranges':'bytes'};
   const range=/^bytes=(\d+)-(\d*)$/.exec(req.headers.range||'');
   if(range){const start=Number(range[1]),end=Math.min(Number(range[2]||bytes.length-1),bytes.length-1);res.writeHead(206,{...headers,'Content-Length':end-start+1,'Content-Range':`bytes ${start}-${end}/${bytes.length}`});res.end(bytes.subarray(start,end+1));}
   else{res.writeHead(200,{...headers,'Content-Length':bytes.length});res.end(bytes);}
  }catch{res.writeHead(404).end();}
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const url=`http://127.0.0.1:${server.address().port}/index.html`;
 const results=await Promise.allSettled(['chromium','firefox','webkit'].map(async name=>{
  const browser=await pw[name].launch(name==='chromium'?{channel:'chrome',headless:true}:{headless:true});
  try{
   const context=await browser.newContext({viewport:{width:1440,height:1000},acceptDownloads:true});
   const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto(url);
   if(await page.locator('.card').count()!==16)throw Error('Expected 16 cards');
   if(await page.locator('.variant').count()!==32)throw Error('Expected 32 clips');
   const metadata=await page.evaluate(async()=>{
    const all=[];for(const card of window.AUDITION.cards)for(const v of card.variants){
     const a=new Audio(v.file);await new Promise((resolve,reject)=>{const t=setTimeout(()=>reject(Error('Timeout '+v.id)),8000);a.onloadedmetadata=()=>{clearTimeout(t);resolve();};a.onerror=()=>{clearTimeout(t);reject(Error(v.id+' '+a.error?.message));};a.load();});
     if(!Number.isFinite(a.duration)||Math.abs(a.duration-v.duration)>.03)throw Error('Duration '+v.id+': '+a.duration+' expected '+v.duration);
     all.push(v.id);
    }return all;
   });
   await page.locator('[data-variant="05A"] .play').click();await page.waitForTimeout(100);
   if(await page.locator('.variant.playing').count()!==1)throw Error('Playback state');
   await page.locator('#stop').click();if(await page.locator('.variant.playing').count()!==0)throw Error('Stop');
   await page.locator('[data-card="1"][data-choice="A"]').click();await page.reload();
   if(await page.locator('[data-card="1"][data-choice="A"]').getAttribute('aria-pressed')!=='true')throw Error('Persist choice');
   const download=page.waitForEvent('download');await page.locator('#export').click();const d=await download;await d.saveAs(path.join(__dirname,`review-export-${name}.txt`));
   const sizes=[];
   for(const width of [1440,844,390]){
    await page.setViewportSize({width,height:1000});
    const dimensions=await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth,cards:[...document.querySelectorAll('.card')].map(c=>({w:c.clientWidth,s:c.scrollWidth}))}));
    if(dimensions.scroll>width+1||dimensions.cards.some(c=>c.s>c.w+2))throw Error('Overflow '+width);
    sizes.push(width);
    if(name==='chromium'&&(width===1440||width===390))await page.screenshot({path:path.join(__dirname,`preview-${width}.png`),fullPage:false});
   }
   if(errors.length)throw Error(errors.join('; '));
   await context.close();return {browser:name,decodedFiles:metadata.length,widths:sizes,playStop:true,selectionPersists:true,export:true,errors};
  }finally{await browser.close();}
 }));
 const report=results.map((r,i)=>r.status==='fulfilled'?r.value:{browser:['chromium','firefox','webkit'][i],error:String(r.reason)});
 fs.writeFileSync(path.join(__dirname,'verification.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
 await new Promise(resolve=>server.close(resolve));
 if(results.some(r=>r.status==='rejected'))process.exitCode=1;
})().catch(e=>{console.error(e);process.exitCode=1});
