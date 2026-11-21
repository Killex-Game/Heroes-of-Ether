"use strict";
const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'../..');
function edit(file,fn){const p=path.join(root,file),s=fs.readFileSync(p,'utf8');fs.writeFileSync(p,fn(s));}
const replace=(s,a,b)=>{if(!s.includes(a))throw Error('Missing anchor: '+a.slice(0,100));return s.replace(a,b);};
edit('src/server/events/black-friday.js',s=>{
 s=s.replaceAll('\r\n','\n');
 s=replace(s,'const DAY =','const book = require("./black-friday-orders");\nconst DAY =');
 s=s.replaceAll('За 15 заказов','За 50 заказов').replaceAll('finalTarget: 15','finalTarget: 50').replaceAll('Выполнено 15 заказов','Выполнено 50 заказов').replaceAll('regalia.webp','regalia-v2.webp');
 s=replace(s,'  { id: "crystals", currency: "crystals", cost: 50, tokens: 15, limit: 2 },','  { id: "crystals", currency: "crystals", cost: 50, tokens: 15, limit: 2 },\n  { id: "bucks", currency: "bucks", cost: 30, tokens: 10, limit: null },');
 const a=s.indexOf('function progress('),b=s.indexOf('function regalia(',a);
 s=s.slice(0,a)+`function progress(p, manager, event, at) {
  if (!["questSample", "lifeEnded"].includes(event.type)) return;
  const run = runAt(manager, at), session = p.quests?.session;
  if (!run || !session || session.id !== event.lifeId || event.reason === "recovered") return;
  const date=day(at), start=Math.max(run.startsAt,date*DAY-MSK);
  const old=p.blackFriday?.runs?.[run.id], d=structuredClone(book.daily(p,old,date,start));
  const before=JSON.stringify(d.lanes);
  book.progress(p,d,event,at,start,session);
  if (before!==JSON.stringify(d.lanes)) state(p,run).days[date]=d;
}
const achievement = (id,name,unit,thresholds,rewards,description) => ({id,name,unit,thresholds,rewards,description,category:"event",exception:false,cumulative:true,available:true});
const achievements = [
  achievement("friday_orders","Главный исполнитель","заказов",[5,10,25,40,50],[3,5,10,15,25],"Выполнять заказы Лавки Мани."),
  achievement("friday_trophy","Трофей","регалий",[1],[30],"Получить регалию «Карточная шкатулка»."),
  achievement("friday_tokens","Зажиточный","жетонов",[100,300,600,1000,1500],[3,5,10,15,25],"Получать жетоны за заказы и обмены. Потраченные жетоны тоже учитываются."),
  achievement("friday_exchange","Обменник","обменов",[1,5,10,20,50],[1,3,5,10,15],"Обменивать валюту на жетоны."),
  achievement("friday_shopper","Ценный покупатель","покупок",[1,5,10,20,30],[1,3,5,10,15],"Получать призы в Лавке Мани за жетоны."),
];
function metrics(s) { return {
  friday_orders:s?.completedOrders||0, friday_trophy:s?.finalAt!=null?1:0,
  friday_tokens:Object.values(s?.days||{}).reduce((n,d)=>n+(d.earned||0),0),
  friday_exchange:Object.values(s?.days||{}).reduce((n,d)=>n+Object.values(d.exchanges).reduce((a,b)=>a+b,0),0),
  friday_shopper:Object.values(s?.purchases||{}).reduce((a,b)=>a+b,0),
}; }
function award(p,s) {
  const values=metrics(s); s.achievementClaims ||= {};
  for(const a of achievements) {
    let count=s.achievementClaims[a.id]||0;
    while(count<a.thresholds.length && values[a.id]>=a.thresholds[count]) p.greatness=add(p.greatness,a.rewards[count++]);
    s.achievementClaims[a.id]=count;
  }
}
function achievementView(p,manager,at) {
  const run=runAt(manager,at); if(!run) return [];
  const s=p.blackFriday?.runs?.[run.id],values=metrics(s);
  return achievements.map(a=>({...a,eventRunId:run.id,value:values[a.id],claimed:s?.achievementClaims?.[a.id]||0,description:"Чёрная пятница. "+a.description}));
}
`+s.slice(b);
 s=replace(s,'d = s?.days?.[day(at)] || freshDay();','d = book.daily(p,s,day(at),Math.max(run.startsAt,day(at)*DAY-MSK));');
 s=replace(s,'orders: orders.map((o) => ({ ...o, progress: d[o.id], claimed: d.claimed.includes(o.id) })),','orders: book.rows(d),\n    dailyCompleted: book.count(d),\n    swapCost: d.swaps ? 3 : 0,\n    achievements: achievementView(p,manager,at),');
 s=replace(s,'count: v.claimed.length,','count: book.count(v),');
 s=replace(s,'["order", "buy", "exchange", "final"]','["order", "swap", "buy", "exchange", "final"]');
 s=replace(s,'d = (s.days[day(at)] ||= freshDay());','d = book.ensure(p,s,day(at),Math.max(run.startsAt,day(at)*DAY-MSK));');
 const start=s.indexOf('      if (input.action === "order") {'),end=s.indexOf('      } else if (input.action === "buy")',start);
 s=s.slice(0,start)+`      if (input.action === "order" || input.action === "swap") {
        const o = book.rows(d).find(o=>o.id===input.id), swap=input.action==="swap";
        if(!o || o.claimed || (!swap && o.progress<o.target)) throw new BoosterError("Заказ изменился, ещё не выполнен или уже получен.",409);
        book.advance(p,d,day(at),o,at,random,swap);
        if(!swap) {
          s.completedOrders=add(s.completedOrders,1);
          s.tokens=add(s.tokens,o.tokens);
          d.earned=add(d.earned,o.tokens);
        }
`+s.slice(end);
 s=replace(s,'(d.exchanges[o.id] || 0) >= o.limit','(o.limit != null && (d.exchanges[o.id] || 0) >= o.limit)');
 s=replace(s,'        d.exchanges[o.id] = add(d.exchanges[o.id] || 0, 1);','        d.exchanges[o.id] = add(d.exchanges[o.id] || 0, 1);\n        d.earned = add(d.earned,o.tokens);');
 s=replace(s,'s.completedOrders < 15','s.completedOrders < 50').replace('Выполни 15 заказов','Выполни 50 заказов');
 s=replace(s,'        s.finalAt = at;','        s.finalAt = at;\n        s.finalTarget = 50;');
 s=replace(s,'      validate(p);','      award(p,s);\n      validate(p);');
 s=replace(s,'!orders.every((o) => integer(d[o.id]) && d[o.id] <= o.target) ||\n        !Array.isArray(d.claimed) ||\n        new Set(d.claimed).size !== d.claimed.length ||\n        !d.claimed.every((id) => orders.some((o) => o.id === id && d[id] >= o.target)) ||','(d.version === 2 ? !book.validate(d) : (\n          !orders.every((o) => integer(d[o.id]) && d[o.id] <= o.target) ||\n          !Array.isArray(d.claimed) ||\n          new Set(d.claimed).size !== d.claimed.length ||\n          !d.claimed.every((id) => orders.some((o) => o.id === id && d[id] >= o.target)))) ||');
 s=replace(s,'!exchanges.every((o) => (d.exchanges[o.id] || 0) <= o.limit)','!exchanges.every((o) => o.limit == null || (d.exchanges[o.id] || 0) <= o.limit)');
 s=replace(s,'count += d.claimed.length;','count += book.count(d);');
 s=replace(s,'(s.finalAt !== null && count < 15)','(s.finalAt !== null && count < (s.finalTarget || 15))');
 s=replace(s,'    let count = 0;',`    if(s.finalTarget!==undefined && s.finalTarget!==50) throw Error("Повреждена цель лавки.");
    if(s.achievementClaims!==undefined && (!validMap(s.achievementClaims,achievements.map(a=>a.id)) || achievements.some(a=>(s.achievementClaims[a.id]||0)>a.thresholds.filter(n=>n<=metrics(s)[a.id]).length))) throw Error("Повреждены достижения лавки.");
    let count = 0;`);
 s=replace(s,'  manifest,','  manifest,\n  achievements,\n  achievementView,');
 return s;
});
edit('src/server/events/black-friday-orders.js',s=>replace(s,'|| at <= session.sampledAt','|| (event.type === "questSample" && at <= session.sampledAt)'));
edit('src/server/events/event-packs.js',s=>replace(s,'title: "Чёрная пятница", achievements: [], hats: [], bows: [], rewards: [],','title: "Чёрная пятница",\n    achievements: [...require("./black-friday").achievements,...require("./lucky-week").achievements],\n    linkedEvents: ["lucky-week"], hats: [], bows: [], rewards: [],'));
edit('src/server/profiles/profile-store.js',s=>{
 s=replace(s,'          ...easter.achievementView(profile, this.events, this.now()),','          ...easter.achievementView(profile, this.events, this.now()),\n          ...blackFriday.achievementView(profile, this.events, this.now()),');
 s=replace(s,'const balance = p.wallet[product.currency] + product.amount;','const promo = blackFriday.runAt(this.events,this.now());\n          if(input.currencyPromoRunId !== undefined && input.currencyPromoRunId !== (promo?.id || null))\n            throw new BoosterError("Условия акции изменились. Открой покупку заново.",409);\n          const amount = product.amount * (promo ? 2 : 1);\n          const balance = p.wallet[product.currency] + amount;');
 s=replace(s,'p.activity.values[achievement] + product.amount','p.activity.values[achievement] + amount');
 return s;
});
edit('src/server/rankings/event-leaderboards.js',s=>{
 s=replace(s,'const definitions = {',`const definitions = {
  "black-friday-v1": {
    title:"Топ исполнителей", unit:"жетонов",
    score:(p,id,day)=>p.blackFriday?.runs?.[id]?.days?.[day]?.earned||0,
    days:(p,id)=>Object.keys(p.blackFriday?.runs?.[id]?.days||{}).map(Number),
    prizes:[
      {from:1,to:3,greatness:30,coins:100,crystals:15,bucks:0,tickets:3},
      {from:4,to:10,greatness:20,coins:75,crystals:10,bucks:0,tickets:2},
      {from:11,to:50,greatness:10,coins:50,crystals:5,bucks:0,tickets:1},
      {from:51,to:100,greatness:5,coins:25,crystals:0,bucks:0,tickets:0},
    ],
  },`);
 s=replace(s,': `Собрано яиц: ${entry.score}.',': `Получено ${definition.unit}: ${entry.score}.');
 return s;
});
console.log('Black Friday server rules updated');
