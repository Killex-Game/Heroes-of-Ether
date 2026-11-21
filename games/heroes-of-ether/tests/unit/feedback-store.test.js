"use strict";
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{randomUUID}=require('node:crypto');
const {FeedbackStore,normalize}=require('../../src/server/admin/feedback-store'),{temporary}=require('../temp');
const player={id:'player-1',name:'Тестовый герой'},actor={id:'mod-1',name:'Помощник',role:'moderator'};
test('feedback validates Unicode length, captures identity, deadline, and survives journal restart',async t=>{
 const file=path.join(temporary(t,'feedback'),'tickets.wal');let at=Date.UTC(2026,10,17,12);let store=new FeedbackStore({file,now:()=>at});
 const input={text:'🌟'.repeat(1000),requestId:randomUUID()},a=await store.submit(player,input);
 assert.equal(a.number,1);assert.equal(store.detail(1).dueAt,at+72*3600000);assert.equal(store.detail(1).playerName,player.name);
 assert.throws(()=>normalize({...input,text:'🌟'.repeat(1001)}));assert.throws(()=>normalize({...input,text:' \n\t '}));
 assert.equal((await store.submit(player,input)).replay,true);await assert.rejects(store.submit(player,{...input,text:'Другой отзыв'}),{status:409});
 const edit={number:1,version:1,status:'processed',requestId:randomUUID()};at+=1000;await store.update(actor,edit);assert.equal(store.detail(1).handledBy,'Помощник');
 await store.close();store=new FeedbackStore({file,now:()=>at});assert.equal(store.detail(1).status,'processed');assert.equal(store.detail(1).text,input.text);
 assert.equal((await store.update(actor,edit)).version,2);assert.equal((await store.submit(player,input)).number,1);assert.equal(store.rows.size,1);
 await assert.rejects(store.update(actor,{...edit,requestId:randomUUID(),status:'new'}),{status:409});
 const current=store.detail(1);await store.update(actor,{number:1,version:2,status:'new',requestId:randomUUID()});assert.equal(store.detail(1).dueAt,current.dueAt);await store.close();
});
test('feedback rate limits new tickets, never duplicate retries, and keeps ordered pages',async()=>{
 let at=1000000000;const store=new FeedbackStore({now:()=>at}),first={text:'Предложение',requestId:randomUUID()};await store.submit(player,first);
 await assert.rejects(store.submit(player,{...first,requestId:randomUUID()}),{status:429});
 for(let i=0;i<4;i++){at+=60000;await store.submit(player,{text:'Отзыв '+i,requestId:randomUUID()});}
 at+=60000;await assert.rejects(store.submit(player,{text:'Шестой',requestId:randomUUID()}),{status:429});assert.equal((await store.submit(player,first)).number,1);
 for(let i=0;i<7;i++)await store.submit({id:'p'+i,name:'Другой'}, {text:'Тест',requestId:randomUUID()});
 assert.equal(store.list().items.length,10);assert.equal(store.list().items[0].number,12);assert.equal(store.list({page:2}).items.length,2);assert.equal(store.list().items[0].text,undefined);
 await store.update(actor,{number:1,version:1,status:'processed',requestId:randomUUID()});assert.equal(store.list({status:'processed'}).total,1);await store.close();
});
test('feedback disk failure publishes nothing; incomplete tail recovers and corruption fails closed',async t=>{
 const file=path.join(temporary(t,'feedback-failure'),'tickets.wal'),store=new FeedbackStore({file});
 const append=store.append.bind(store),input={text:'Не потерять',requestId:randomUUID()};store.append=async()=>{throw Error('disk failure');};
 await assert.rejects(store.submit(player,input));assert.equal(store.rows.size,0);assert.equal(store.next,1);store.append=append;await store.submit(player,input);await store.close();
 const before=fs.readFileSync(file);fs.appendFileSync(file,'{"record":');const restored=new FeedbackStore({file});assert.equal(restored.detail(1).text,input.text);assert.deepEqual(fs.readFileSync(file),before);await restored.close();
 fs.appendFileSync(file,'{"record":{},"hash":"bad"}\n');assert.throws(()=>new FeedbackStore({file}),/CORRUPT/);
});
test('concurrent changes have one winner and recheck moderator authorization before queued write',async()=>{
 const store=new FeedbackStore();await store.submit(player,{text:'Тест',requestId:randomUUID()});
 const input={number:1,version:1,status:'processed',requestId:randomUUID()};const results=await Promise.allSettled([store.update(actor,input),store.update(actor,{...input,requestId:randomUUID()})]);
 assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(store.detail(1).version,2);
 await assert.rejects(store.update(actor,{...input,version:2,status:'new',requestId:randomUUID()},()=>{throw Error('revoked');}),/revoked/);assert.equal(store.detail(1).status,'processed');await store.close();
});
test('failed fsync rolls back written bytes before a retry and the protected backup restores tickets',async t=>{
 const dir=temporary(t,'feedback-fsync'),data=path.join(dir,'data'),control=path.join(dir,'admin-control');fs.mkdirSync(data);fs.mkdirSync(control);
 const file=path.join(control,'feedback.wal'),store=new FeedbackStore({file}),input={text:'Надёжная запись',requestId:randomUUID()},open=fs.promises.open.bind(fs.promises);let failOnce=true;
 const mock=t.mock.method(fs.promises,'open',async(...args)=>{const fd=await open(...args),sync=fd.sync.bind(fd);fd.sync=async()=>{if(failOnce){failOnce=false;throw Error('fsync failure');}return sync();};return fd;});
 await assert.rejects(store.submit(player,input),{status:503});assert.equal(fs.statSync(file).size,0);assert.equal(store.rows.size,0);mock.mock.restore();await store.submit(player,input);await store.close();
 fs.writeFileSync(path.join(data,'admin-control.json'),'{}');fs.writeFileSync(path.join(control,'transport.key'),'test key');fs.appendFileSync(file,'unfinished');
 const destination=path.join(dir,'backup'),report=require('../../scripts/deployment/admin-security-backup.cjs').capture(dir,destination);assert.equal(report.controlFiles,3);
 const restored=new FeedbackStore({file:path.join(destination,'control','feedback.wal')});assert.equal(restored.detail(1).text,input.text);await restored.close();
});
test('failed rollback fences already queued submissions until restart',async t=>{
 const file=path.join(temporary(t,'feedback-fence'),'tickets.wal'),store=new FeedbackStore({file}),open=fs.promises.open.bind(fs.promises);
 t.mock.method(fs.promises,'open',async(...args)=>{const fd=await open(...args);fd.sync=async()=>{throw Error('disk unavailable');};return fd;});
 const results=await Promise.allSettled([store.submit(player,{text:'Первый',requestId:randomUUID()}),store.submit({id:'second',name:'Второй'},{text:'Второй',requestId:randomUUID()})]);
 assert(results.every(r=>r.status==='rejected'&&r.reason.status===503));assert.equal(store.rows.size,0);assert.equal(store.failed,true);await store.close();
});
