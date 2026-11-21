const fs=require('node:fs');
const path=require('node:path');
const {chromium}=require('C:/Users/semen/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const root=__dirname;
const refs={
 rpg:{author:'Kenney',title:'RPG Audio',url:'https://kenney.nl/assets/rpg-audio',evidence:'evidence/kenney-rpg.html'},
 ui:{author:'Kenney',title:'Interface Sounds',url:'https://kenney.nl/assets/interface-sounds',evidence:'evidence/kenney-interface.html'},
 jingles:{author:'Kenney',title:'Music Jingles',url:'https://kenney.nl/assets/music-jingles',evidence:'evidence/kenney-jingles.html'},
 bell:{author:'775noise',title:'Shop door bell.wav',url:'https://freesound.org/people/775noise/sounds/494565/',evidence:'evidence/bell.html',preview:true},
 backpack:{author:'veronicalyn',title:'Opening Backpack',url:'https://freesound.org/people/veronicalyn/sounds/444915/',evidence:'evidence/backpack.html',preview:true},
 curtain:{author:'fryzu82',title:'curtain opening.wav',url:'https://freesound.org/people/fryzu82/sounds/142301/',evidence:'evidence/curtain.html',preview:true},
 pops:{author:'EZduzziteh',title:'Pop sounds',url:'https://opengameart.org/content/pop-sounds-0',evidence:'evidence/pops.html'},
 shield:{author:'bart',title:'Space Ship Shield Sounds',url:'https://opengameart.org/content/space-ship-shield-sounds',evidence:'evidence/shield.html'},
 fanfare:{author:'Trex0n / Cal McEachern',title:'Happy and Sad Tuba Fanfare',url:'https://opengameart.org/content/happy-and-sad-tuba-fanfare',evidence:'evidence/fanfare.html'},
};
for(const v of Object.values(refs)) Object.assign(v,{license:'CC0-1.0',licenseUrl:'https://creativecommons.org/publicdomain/zero/1.0/',commercialUse:true,attributionRequired:false,checkedOn:'2026-10-27'});
const r=(name,extra={})=>({file:`sources/rpg/Audio/${name}.ogg`,ref:'rpg',...extra});
const u=(name,extra={})=>({file:`sources/interface/Audio/${name}.ogg`,ref:'ui',...extra});
const e=(name,ref,extra={})=>({file:`sources/extra/${name}`,ref,...extra});
const p=(n,extra={})=>e(`pop${n}.wav`,'pops',extra);
const j=(name,extra={})=>({file:`sources/jingles/Audio/${name}.ogg`,ref:'jingles',...extra});
const v=(name,layers,note='')=>({name,layers,note});
const roulette=(name)=>Array.from({length:27},(_,i)=>u(name,{at:.04+i*.055+Math.pow(i/26,3)*2.15,gain:1-i*.009}));
const cards=[
 {title:'Обычная кнопка',group:'Интерфейс',description:'Короткий отклик для остальных кнопок.',variants:[v('Щелчок', [u('click_001')]),v('Переключатель',[u('toggle_001')])]},
 {title:'Задания',group:'Интерфейс',description:'Лист бумаги и открытие книги.',variants:[v('Перевернуть лист',[r('bookFlip2')]),v('Раскрыть книгу',[r('bookOpen'),r('bookFlip1',{at:.08,gain:.7})],'Составной вариант: книга и лист.')]},
 {title:'Магазин',group:'Интерфейс',description:'Открытие рюкзака.',variants:[v('Кожа и пряжка',[r('beltHandle2'),r('handleSmallLeather',{at:.17}),r('cloth4',{at:.3,gain:.6})],'Составной вариант для рюкзака с ремнями.'),v('Молния рюкзака',[e('backpack-preview.mp3','backpack',{start:2.5,end:4.2})],'Фрагмент общедоступного HQ-превью Freesound.')]},
 {title:'Инвентарь',group:'Интерфейс',description:'Скрип крышки сундука.',variants:[v('Замок и крышка',[r('metalLatch',{gain:.35}),r('creak2',{at:.1})],'Составной вариант: защёлка и деревянный скрип.'),v('Короткий скрип',[r('creak1')])]},
 {title:'Клан',group:'Интерфейс',description:'Дверь с колокольчиком.',variants:[v('Дверь и звон',[r('doorOpen_1',{gain:.6}),e('bell-preview.mp3','bell',{start:.28,end:1.95,at:.16})],'Дверь Kenney и фрагмент колокольчика Freesound.'),v('Дверь и лёгкий звон',[r('doorOpen_2',{gain:.4}),e('bell-preview.mp3','bell',{start:2.4,end:3.85,at:.08})],'Другой удар колокольчика из той же записи.')]},
 {title:'Поглощение колючки',group:'Арена',description:'Короткий хлопок при срабатывании колючки.',variants:[v('Двойной хлопок',[p(8),p(3,{at:.045,rate:.8,gain:.6})],'Составной эффект из пузырьковых хлопков.'),v('Низкий хлопок',[p(4,{rate:.65}),p(7,{at:.04,rate:1.2,gain:.5})],'Пониженный тон и короткий второй акцент.')]},
 {title:'Разделение',group:'Арена',description:'Быстрый звук отрыва новой части.',variants:[v('Пузырёк',[p(3)]),v('Два пузырька',[p(1),p(2,{at:.055,rate:1.15,gain:.7})],'Два коротких хлопка подряд.')]},
 {title:'Игрок съеден целиком',group:'Арена',description:'Отдельный акцент полного поглощения.',variants:[v('Объёмный пузырёк',[p(5,{rate:.7}),p(6,{at:.1,rate:.85,gain:.6})],'Пониженный тон, два слоя.'),v('Капля и хлопок',[u('drop_004',{rate:.75}),p(3,{at:.09,rate:.8,gain:.35})],'Интерфейсная капля с коротким акцентом.')]},
 {title:'Достижения',group:'Интерфейс',description:'Звон медали.',variants:[v('Металлический щелчок',[r('metalClick')]),v('Звонкий акцент',[u('glass_004',{rate:.85})],'Альтернатива с более длинным резонансом.')]},
 {title:'Рулетка',group:'Рулетка',description:'Пример прокрутки с замедлением.',variants:[v('Частые щелчки',[...roulette('tick_001')],'Демонстрационная последовательность. В игре щелчки нужно привязать к секторам.'),v('Выраженные щелчки',[...roulette('tick_004')],'Та же длительность и замедление, другой исходный щелчок.')]},
 {title:'Гардероб',group:'Интерфейс',description:'Открытие шторки.',variants:[v('Настоящая шторка',[e('curtain-preview.mp3','curtain',{start:1.85,end:4.45})],'Фрагмент общедоступного HQ-превью Freesound.'),v('Быстрый шелест ткани',[r('cloth1'),r('cloth3',{at:.22,gain:.7})],'Составная короткая альтернатива для быстрого открытия окна.')]},
 {title:'Покупка валюты',group:'Награды',description:'Монеты, кристаллы и эфир.',variants:[v('Звон монет',[r('handleCoins2'),r('handleCoins',{at:.08,gain:.55})],'Две записи монет.'),v('Подтверждение и звон',[u('confirmation_002',{gain:.6}),r('handleCoins2',{at:.12,gain:.55})],'Общий сигнал успешной покупки для всех трёх валют.')]},
 {title:'Щит поглотил бустер',group:'Арена',description:'Энергетический отклик защиты.',variants:[v('Импульс щита',[e('shield/space shield sounds - 1.wav','shield',{end:1.18})]),v('Другой резонанс',[e('shield/space shield sounds - 3.wav','shield',{end:1.18})])]},
 {title:'Акции',group:'Интерфейс',description:'Небольшой музыкальный акцент.',variants:[v('Струнный акцент',[j('Pizzicato jingles/jingles_PIZZI10')]),v('Короткое приглашение',[u('confirmation_004',{rate:1.1}),u('glass_001',{at:.17,gain:.35})],'Составной вариант без длинной мелодии.')]},
 {title:'Новое звание',group:'Награды',description:'Торжественный сигнал достижения.',variants:[v('Фанфара тубы',[e('fanfarehappy.ogg','fanfare',{end:2.2})]),v('Музыкальная фанфара',[j('Hit jingles/jingles_HIT09')])]},
 {title:'Надеть шапку / бабочку',group:'Интерфейс',description:'Шелест ткани при смене аксессуара.',variants:[v('Мягкая ткань',[r('cloth2')]),v('Ткань с застёжкой',[r('clothBelt2')])]},
];

function wav(channels,rate){
 const count=channels[0].length,n=channels.length;const b=Buffer.alloc(44+count*n*2);
 b.write('RIFF');b.writeUInt32LE(b.length-8,4);b.write('WAVEfmt ',8);b.writeUInt32LE(16,16);b.writeUInt16LE(1,20);b.writeUInt16LE(n,22);b.writeUInt32LE(rate,24);b.writeUInt32LE(rate*n*2,28);b.writeUInt16LE(n*2,32);b.writeUInt16LE(16,34);b.write('data',36);b.writeUInt32LE(count*n*2,40);
 for(let i=0;i<count;i++) for(let c=0;c<n;c++) b.writeInt16LE(Math.round(Math.max(-1,Math.min(1,channels[c][i]))*32767),44+(i*n+c)*2);
 return b;
}

(async()=>{
 fs.mkdirSync(path.join(root,'audio'),{recursive:true});
 const browser=await chromium.launch({channel:'chrome',headless:true});const page=await browser.newPage();
 for(let i=0;i<cards.length;i++){
  cards[i].id=i+1;
  for(let k=0;k<cards[i].variants.length;k++){
   const variant=cards[i].variants[k];variant.id=`${String(i+1).padStart(2,'0')}${k?'B':'A'}`;
   const files=Object.fromEntries([...new Set(variant.layers.map(x=>x.file))].map(file=>[file,fs.readFileSync(path.join(root,file)).toString('base64')]));
   const result=await page.evaluate(async({files,layers})=>{
    const rate=44100,ctx=new OfflineAudioContext(2,1,rate),buffers={};
    for(const [key,value] of Object.entries(files)) buffers[key]=await ctx.decodeAudioData(Uint8Array.from(atob(value),c=>c.charCodeAt(0)).buffer);
    let duration=0;
    for(const l of layers){const b=buffers[l.file];duration=Math.max(duration,(l.at||0)+(Math.min(l.end??b.duration,b.duration)-(l.start||0))/(l.rate||1));}
    const out=[new Float32Array(Math.ceil((duration+.04)*rate)),new Float32Array(Math.ceil((duration+.04)*rate))];
    for(const l of layers){
     const b=buffers[l.file],start=Math.floor((l.start||0)*rate),end=Math.min(Math.floor((l.end??b.duration)*rate),b.length),speed=l.rate||1,n=Math.floor((end-start)/speed),offset=Math.floor((l.at||0)*rate);
     let peak=0;for(let c=0;c<b.numberOfChannels;c++){const a=b.getChannelData(c);for(let x=start;x<end;x++)peak=Math.max(peak,Math.abs(a[x]));}
     const gain=(l.gain??1)*.55/Math.max(.001,peak);
     for(let c=0;c<2;c++){
      const a=b.getChannelData(Math.min(c,b.numberOfChannels-1));
      for(let x=0;x<n;x++){const f=start+x*speed,ix=Math.floor(f),mix=f-ix;const sample=a[ix]*(1-mix)+(a[Math.min(ix+1,end-1)]||0)*mix;
       const fade=Math.min(1,x/(rate*.0015),(n-x)/(rate*.008));out[c][offset+x]+=sample*gain*fade;
      }
     }
    }
    let peak=0,sq=0;for(const a of out)for(const s of a){peak=Math.max(peak,Math.abs(s));sq+=s*s;}
    const rms=Math.sqrt(sq/(out[0].length*2));const gain=Math.min(.72/Math.max(peak,.0001),.085/Math.max(rms,.0001),3);
    for(const a of out)for(let x=0;x<a.length;x++)a[x]*=gain;
    const bars=[];for(let x=0;x<44;x++){let m=0;for(let n=Math.floor(out[0].length*x/44);n<out[0].length*(x+1)/44;n++)m=Math.max(m,Math.abs(out[0][n]));bars.push(m);}
    return {channels:out.map(a=>Array.from(a)),duration:out[0].length/rate,peak:peak*gain,rms:rms*gain,bars};
   },{files,layers:variant.layers});
   variant.file=`audio/${variant.id}.wav`;variant.duration=+result.duration.toFixed(3);variant.peak=+result.peak.toFixed(4);variant.rms=+result.rms.toFixed(4);variant.bars=result.bars;
   variant.sources=[...new Set(variant.layers.map(x=>x.ref))];variant.processing='Обрезка по указанным интервалам, нормализация уровня, короткие края без щелчков. Монтаж и изменение высоты тона — только там, где указано в слоях.';
   fs.writeFileSync(path.join(root,variant.file),wav(result.channels,44100));
  }
 }
 await browser.close();
 const manifest={status:'Только предпрослушивание, в игру не внедрено',date:'2026-10-27',license:'CC0-1.0',sources:refs,cards};
 fs.writeFileSync(path.join(root,'manifest.json'),JSON.stringify(manifest,null,2));
 fs.writeFileSync(path.join(root,'data.js'),'window.AUDITION = '+JSON.stringify(manifest)+';');
 console.log(JSON.stringify({cards:cards.length,clips:cards.flatMap(c=>c.variants).length,totalSeconds:Math.round(cards.flatMap(c=>c.variants).reduce((s,v)=>s+v.duration,0))}));
})().catch(e=>{console.error(e);process.exitCode=1});
