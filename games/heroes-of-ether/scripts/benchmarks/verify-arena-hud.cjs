"use strict";
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { chromium } = require("playwright");
const game = path.resolve(__dirname, "../.."), root = path.resolve(game, "../..");
const out = path.join(root, "artifacts/arena-long-session-20261109");
(async () => {
  const browser = await chromium.launch({ headless: true, channel: "chrome" });
  try {
    const results = [];
    for (const version of ["before", "after"]) {
      const page = await browser.newPage();
      await page.setContent('<main id="arena"><div class="leaderboard"></div></main>');
      for (const file of ["public/shared/booster-cooldowns.js", "public/shared/quick-slot-rules.js"])
        await page.addScriptTag({content:fs.readFileSync(path.join(game,file),"utf8")});
      await page.addScriptTag({content:fs.readFileSync(version === "before"
        ? path.join(root,"backups/arena-long-session-20261109/source/public/ui/boosters/shop-and-inventory-dialog.js")
        : path.join(game,"public/ui/boosters/shop-and-inventory-dialog.js"),"utf8")});
      const result = await page.evaluate(() => {
        const host=document.createElement("div");document.body.append(host);
        const node=(tag="span")=>{const n=document.createElement(tag);host.append(n);return n;};
        const me={level:600,mass:50000,massLimit:1000000,boosterLimit:30,account:{vip:true,premium:true},
          boosterUses:{},turbo:{totalMs:180000,remainingMs:180000,active:false}};
        const ui=Object.create(window.KillexBoosterUI.prototype);
        const items=["meat","harpoon","clan_shield","axe","easter_egg","knuckles"].map(id=>({id,name:id,kind:"projectile",useLevel:1,tier:"rare",icon:id+".png"}));
        Object.assign(ui,{game:{getMe:()=>me,isArena:()=>true},profile:{inventory:Object.fromEntries(items.map(i=>[i.id,25]))},
          catalog:{items},slots:items.map(i=>i.id),slotButtons:items.map(()=>node("button")),activations:new Map(),
          budget:node(),budgetUntil:0,stateReceivedAt:performance.now(),turboButton:node("button"),turboOverlay:node(),turboSeconds:node(),turboMode:node()});
        let ms=0;
        ui.cooldown=()=>({ms,duration:1000});
        ui.updateQuick();
        const observer=new MutationObserver(()=>{});observer.observe(host,{subtree:true,attributes:true,childList:true,characterData:true});
        const start=performance.now();
        for(let i=0;i<1000;i++)ui.updateQuick();
        const elapsed=performance.now()-start, unchangedMutations=observer.takeRecords().length;
        const snapshots=[];
        for(const state of ["cooling","consumed","targeting","unlock","exhausted","reset"]){
          ms=state==="cooling"?500:0;
          me.boosterUses.meat=state==="consumed"?30:0;
          ui.targeting=state==="targeting"?items[1]:null;
          me.account=state==="unlock"?{}:{vip:true,premium:true};
          me.turbo.remainingMs=state==="exhausted"?0:180000;
          ui.updateQuick();snapshots.push(host.innerHTML);
        }
        observer.disconnect();return {elapsed,unchangedMutations,snapshots};
      });
      results.push({version,...result});await page.close();
    }
    assert.deepEqual(results[0].snapshots, results[1].snapshots, "HUD outputs remain identical through cooldown, count, target, account and turbo changes");
    assert.equal(results[1].unchangedMutations,0,"unchanged HUD must not mutate the DOM");
    const page=await browser.newPage();
    await page.setContent('<main id="arena"><div class="leaderboard"></div></main>');
    await page.addScriptTag({content:fs.readFileSync(path.join(game,"public/ui/progression/arena-objectives.js"),"utf8")});
    for(const [icon,description,progress] of [["assets/menu-icons/128/currency_bucks.webp","Собери эфир",1],["assets/boosters/png/rocket.png","Атакуй ракетой",2],["assets/arena/thorn-v2.webp","Атакуй колючкой",3]]){
      await page.evaluate(({icon,description,progress})=>document.dispatchEvent(new CustomEvent("killex:arena-profile",{detail:{arenaObjectives:{event:{id:"same-slot",name:description,description,icon,progress,target:15,reward:30,expiresAt:Date.now()+60000}}}})),{icon,description,progress});
      assert.equal(await page.locator(".arena-objective").nth(1).locator("img").getAttribute("src"),icon);
      assert.equal(await page.locator(".arena-objective-text").nth(1).textContent(),description);
      assert.ok(Math.abs(await page.locator(".arena-objective-meter i").nth(1).evaluate(n=>parseFloat(n.style.width))-progress/15*100)<0.0001);
    }
    await page.evaluate(()=>document.dispatchEvent(new CustomEvent("killex:profile",{detail:{}})));
    assert.equal(await page.locator(".arena-objective").nth(1).isHidden(),true);
    await page.evaluate(()=>document.dispatchEvent(new CustomEvent("killex:arena-profile",{detail:{arenaObjectives:{event:{id:"new-life",name:"Ракета",description:"Ракета",icon:"assets/boosters/png/rocket.png",progress:0,target:5,reward:10,expiresAt:Date.now()+60000}}}})));
    assert.equal(await page.locator(".arena-objective").nth(1).isVisible(),true);
    assert.equal(await page.locator(".arena-objective").nth(1).locator("img").getAttribute("src"),"assets/boosters/png/rocket.png");
    fs.writeFileSync(path.join(out,"hud-verification.json"),JSON.stringify({results:results.map(({snapshots,...r})=>r),sameOutput:true,taskIcons:true},null,2));
    console.log(JSON.stringify(results.map(({snapshots,...r})=>r)));
    console.log("HUD state parity and objective icon transitions passed");
  } finally { await browser.close(); }
})().catch(e=>{console.error(e);process.exitCode=1});
