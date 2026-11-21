"use strict";
const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),os=require("node:os"),path=require("node:path"),{once}=require("node:events"),{randomUUID}=require("node:crypto");
const {OwnerAccess}=require("../../src/server/admin/owner-access"),{ProfileStore}=require("../../src/server/profiles/profile-store"),{createGameServer}=require("../../src/server/game-server"),{Arena}=require("../../src/server/arena/arena-simulation"),otp=require("../../src/server/admin/admin-otp");
const password="Owner test password 2026", personalPassword="Moderator private password 2026";
async function fixture(t) {
  let at=1700000010000;
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),"ether-admin-2fa-")),profiles=new ProfileStore({now:()=>at}),a=profiles.open(),b=profiles.open();
  const options={ownerId:a.profile.id,filePath:path.join(dir,"owner.json"),bootstrapPath:path.join(dir,"first.json"),keyPath:path.join(dir,"private","key"),now:()=>at};
  const access=new OwnerAccess(options),app=createGameServer({profiles,ownerAccess:access,wallNow:()=>at,autoTick:false,arena:new Arena({etherCount:0}),testBots:{enabled:false}});
  app.httpServer.listen(0,"127.0.0.1");await once(app.httpServer,"listening");t.after(async()=>{await app.close();fs.rmSync(dir,{recursive:true,force:true});});
  const url="http://127.0.0.1:"+app.httpServer.address().port;
  function client(gameToken) {
    const jar=new Map(gameToken?[["sferorumiya_session",gameToken]]:[]);let csrf="";
    return {jar,async request(route,body,extra={}) {
      const r=await fetch(url+"/api/admin/"+route,{method:body?"POST":"GET",headers:{Origin:url,Cookie:[...jar].map(([k,v])=>k+"="+v).join("; "),...(body?{"Content-Type":"application/json","X-Owner-CSRF":csrf}:{}),...extra},...(body?{body:JSON.stringify(body)}:{})});
      for(const c of r.headers.getSetCookie()){const pair=c.split(";")[0],i=pair.indexOf("=");jar.set(pair.slice(0,i),pair.slice(i+1));}
      const data=await r.json();if(data.csrf)csrf=data.csrf;return{status:r.status,data,headers:r.headers};
    }};
  }
  const owner=client(a.token);assert.equal((await owner.request("setup",{password,setupCode:JSON.parse(fs.readFileSync(options.bootstrapPath)).setupCode})).status,200);
  const current=secret=>otp.code(secret,Math.floor(at/30000));
  const begin=await owner.request("security/enroll-begin",{password});assert.equal(begin.status,200);
  const secret=begin.data.secret,activate=await owner.request("security/enroll-confirm",{code:current(secret),enrollmentId:begin.data.enrollmentId});assert.equal(activate.status,200);
  return{url,dir,profiles,a,b,access,app,options,owner,secret,codes:activate.data.recoveryCodes,client,current,advance:()=>at+=30000,command:()=>({action:"wallet",currency:"coins",amount:17,reason:"Проверка прав модератора",requestId:randomUUID(),targetId:b.profile.id,revision:profiles.byId(b.profile.id).revision}),async create(){at+=30000;const r=await owner.request("moderators",{action:"create",login:"helper",name:"Модератор",reason:"Тестовый доступ",password,code:current(secret)});assert.equal(r.status,200,JSON.stringify(r.data));return r.data;}};
}

test('owner edits identity; moderator edits only own identity/password with fresh 2FA and rotated session',async t=>{
  const f=await fixture(t),created=await f.create(),mod=f.client();
  const first=await mod.request('auth/login',{login:'helper',password:created.temporaryPassword}),secret=first.data.secret;
  await mod.request('auth/verify',{code:f.current(secret),newPassword:personalPassword});
  f.advance();const target=f.access.security.list()[0];
  const edited=await f.owner.request('moderators',{action:'edit',id:target.id,version:target.version,login:'Helper.New',name:'Север',reason:'Уточнение имени',password,code:f.current(f.secret)});
  assert.equal(edited.status,200,JSON.stringify(edited.data));assert.equal(edited.data.moderators[0].login,'helper.new');assert.notEqual((await mod.request('players')).status,200);
  const login=await mod.request('auth/login',{login:'helper.new',password:personalPassword});assert.equal(login.data.enrollmentRequired,false);await mod.request('auth/verify',{code:f.current(secret)});
  f.advance();const view=(await mod.request('security')).data,oldJar=[...mod.jar];
  const input={version:view.version,login:'helper.self',name:'Сова',password:personalPassword,code:f.current(secret),newPassword:'Different moderator password 2026',id:f.a.profile.id,role:'owner',enabled:false};
  assert.equal((await mod.request('security/profile',input,{'X-Owner-CSRF':'wrong'})).status,403);
  assert.equal((await mod.request('security/profile',{...input,password:'Wrong password 2026'})).status,403);
  const before=structuredClone(f.access.security.load()),tmp=f.access.security.file+'.tmp';fs.mkdirSync(tmp);
  assert.equal((await mod.request('security/profile',input)).status,500);assert.deepEqual(f.access.security.load(),before);fs.rmdirSync(tmp);
  const saved=await mod.request('security/profile',input);assert.equal(saved.status,200,JSON.stringify(saved.data));assert.equal(saved.data.role,'moderator');assert.equal(saved.data.login,'helper.self');
  assert.equal((await mod.request('players')).status,200);const stale=f.client();oldJar.forEach(([k,v])=>stale.jar.set(k,v));assert.notEqual((await stale.request('players')).status,200);
  const state=f.access.security.load();assert.deepEqual(state.owner,before.owner);assert.equal(state.moderators[0].id,target.id);assert.equal(state.moderators[0].enabled,true);
  assert(!JSON.stringify(state.audit).includes(input.newPassword));assert(!JSON.stringify(state.audit).includes(input.code));
  assert.equal((await mod.request('moderators',{action:'edit'})).status,403);assert.equal((await mod.request('security/profile',input)).status,409);
  f.advance();const v=(await mod.request('security')).data;assert.equal((await mod.request('security/profile',{...input,version:v.version,password:input.newPassword,code:f.current(secret),login:'owner'})).status,400);
  await mod.request('logout',{});assert.equal((await mod.request('auth/login',{login:'helper.self',password:personalPassword})).status,403);
  assert.equal((await mod.request('auth/login',{login:'helper.self',password:input.newPassword})).status,200);
  assert.equal((await mod.request('auth/verify',{code:f.current(secret)})).status,200);
  const loaded=new OwnerAccess(f.options);assert.equal(loaded.security.list()[0].name,'Сова');
});
test("owner password is only stage one; TOTP consumes once, persists, and recovery is single-use",async t=>{
  const f=await fixture(t),client=f.client();f.advance();
  const before=JSON.stringify(f.access.security.load());assert(!before.includes(f.secret));assert(!before.includes(f.codes[0]));
  let r=await client.request("auth/login",{login:"owner",password});assert.equal(r.status,200);assert.equal(r.data.authenticated,false);assert(r.data.requires2fa);assert.equal((await client.request("players")).status,403);
  r=await client.request("auth/verify",{code:f.current(f.secret)});assert.equal(r.status,200);assert(r.data.authenticated);assert.equal((await client.request("players")).status,200);
  const loaded=new OwnerAccess(f.options);assert.equal(loaded.security.load().owner.factor.lastCounter,f.access.security.load().owner.factor.lastCounter);
  assert.throws(()=>loaded.security.factorPatch(f.a.profile.id,loaded.security.load().owner.factor,f.current(f.secret)),/использован/);
  await client.request("logout",{});await client.request("auth/login",{login:"owner",password});r=await client.request("auth/verify",{code:f.codes[0]});assert.equal(r.status,200);
  await client.request("logout",{});await client.request("auth/login",{login:"owner",password});assert.equal((await client.request("auth/verify",{code:f.codes[0]})).status,403);
});
test("moderator must enroll and choose password; server denies every owner-only route",async t=>{
  const f=await fixture(t),created=await f.create(),mod=f.client();
  let r=await mod.request("auth/login",{login:"helper",password:created.temporaryPassword});assert.equal(r.status,200);assert(r.data.enrollmentRequired);const secret=r.data.secret;
  assert.equal((await mod.request("players")).status,403);
  r=await mod.request("auth/verify",{code:f.current(secret),newPassword:personalPassword});assert.equal(r.status,200);assert.equal(r.data.role,"moderator");assert.equal(r.data.recoveryCodes.length,10);
  for(const route of ["players","player?id="+f.b.profile.id,"audit","audit?source=actions","audit?source=security","transactions?targetId="+f.b.profile.id,"service-journal","security","performance","monitoring?graphs=1","overview-calendar","payments"])assert.equal((await mod.request(route)).status,200,route);
  for(const route of ["events","promo-codes","news","trash","maintenance","moderators","clan-seasons"])assert.equal((await mod.request(route)).status,403,route);
  for(const route of ["events/start","news/banner","trash","maintenance","moderators","security/enroll-begin","overview-calendar","performance","monitoring","clan-seasons","payments"])assert.equal((await mod.request(route,{action:"create",password})).status,403,route);
  const command=f.command(),balance=f.profiles.byId(f.b.profile.id).wallet.coins;
  r=await mod.request("action",command);assert.equal(r.status,200,JSON.stringify(r.data));assert.equal(f.profiles.byId(f.b.profile.id).wallet.coins,balance+17);
  assert.equal((await mod.request("action",command)).data.duplicate,true);
  const event=f.profiles.data.administration.audit.at(-1);assert.equal(event.actorName,"helper");assert(event.actorId.startsWith("moderator:"));
  const notice=f.profiles.find(f.b.token).administrativeNotices[0];assert.equal(notice.actorName,'Модератор');assert.equal(notice.id,event.operationId);
  const ownNotice=await fetch(f.url+'/api/profile/admin-notices/read',{method:'POST',headers:{Origin:f.url,Cookie:'sferorumiya_session='+f.b.token,'Content-Type':'application/json'},body:JSON.stringify({id:notice.id,requestId:randomUUID()})});
  assert.equal(ownNotice.status,200);assert.equal((await ownNotice.json()).profile.administrativeNotices.length,0);assert.equal(f.profiles.data.administration.audit.at(-1).operationId,notice.id);
  assert.equal((await mod.request("action",{...f.command(),targetId:f.a.profile.id,revision:f.profiles.byId(f.a.profile.id).revision})).status,403);
  const banCommand={...f.command(),action:"ban",minutes:60,moderationRevision:0};
  const banResult=await mod.request("action",banCommand);assert.equal(banResult.status,200);
  const ban=f.profiles.byId(f.b.profile.id).moderation.ban;
  assert.equal(ban.byName,"Модератор");assert.equal(ban.id,banResult.data.player.ban.id);
  assert.match(ban.id,/^[2-9A-HJ-NP-Z]{6}$/);
  assert.equal((await mod.request("action",banCommand)).data.eventId,banResult.data.eventId);
  f.advance();r=await f.owner.request("moderators",{action:"disable",id:created.moderators[0].id,reason:"Отзыв доступа",password,code:f.current(f.secret)});assert.equal(r.status,200);
  assert.notEqual((await mod.request("players")).status,200);
  assert.equal((await mod.request("auth/login",{login:"helper",password:personalPassword})).status,403);
});
test("enrollment is not active without confirmation; bad/reused codes rate-limit and cannot grant session",async t=>{
  const f=await fixture(t),client=f.client();f.advance();await client.request("auth/login",{login:"owner",password});
  for(let i=0;i<5;i++)assert.equal((await client.request("auth/verify",{code:"bad"})).status,403);
  assert.notEqual((await client.request("auth/verify",{code:f.current(f.secret)})).status,200);
  const anonymous=f.client();assert.equal((await anonymous.request("moderators",{action:"create"})).status,403);
  assert.equal((await anonymous.request("auth/login",{login:"owner",password},{Origin:"https://evil.example"})).status,403);
});

test("configured HTTPS proxy permits enrollment and TOTP login, requires CSRF and keeps recovery private",async t=>{
  const f=await fixture(t),created=await f.create(),mod=f.client();
  f.access.publicOrigin=f.url.replace("http:","https:");
  const headers={Origin:f.access.publicOrigin,"X-Forwarded-Proto":"https","X-Forwarded-For":"203.0.113.8"};
  const status=await mod.request("auth/status",null,headers);assert.equal(status.status,200,JSON.stringify(status.data));
  assert.equal((await mod.request("players",null,headers)).status,403);
  let r=await mod.request("auth/login",{login:"helper",password:created.temporaryPassword},headers);
  assert.equal(r.status,200);assert(r.data.enrollmentRequired);assert.match(r.headers.getSetCookie()[0],/; Secure/);
  assert.equal((await mod.request("players",null,headers)).status,403);
  r=await mod.request("auth/verify",{code:f.current(r.data.secret),newPassword:personalPassword},headers);
  assert.equal(r.status,200);assert.equal(r.data.role,"moderator");assert.match(r.headers.getSetCookie()[0],/; Secure/);
  assert.equal((await mod.request("players",null,headers)).status,200);
  assert.equal((await mod.request("moderators",null,headers)).status,403);
  assert.equal((await mod.request("recover-profile",null,headers)).status,403);
  assert.equal((await mod.request("action",f.command(),{...headers,"X-Owner-CSRF":"wrong"})).status,403);
  assert.equal((await mod.request("action",f.command(),{...headers,Origin:"https://evil.example"})).status,403);
  assert.equal((await mod.request("action",f.command(),headers)).status,200);
  assert.equal((await mod.request("players",null,{...headers,Origin:"https://other.example"})).status,403);
});
test("failed durable factor write grants no session and permits exact retry; missing key fails only admin",async t=>{
  const f=await fixture(t),client=f.client();f.advance();await client.request("auth/login",{login:"owner",password});
  const prior=structuredClone(f.access.security.load()),tmp=f.access.security.file+".tmp";fs.mkdirSync(tmp);
  assert.equal((await client.request("auth/verify",{code:f.current(f.secret)})).status,500);assert.deepEqual(f.access.security.load(),prior);
  fs.rmdirSync(tmp);assert.equal((await client.request("auth/verify",{code:f.current(f.secret)})).status,200);
  fs.renameSync(f.options.keyPath,f.options.keyPath+".saved");const recovered=new OwnerAccess(f.options);
  assert.throws(()=>recovered.security.factorPatch(f.a.profile.id,recovered.security.load().owner.factor,f.current(f.secret)),/ключ|копию/);
  assert.equal(recovered.security.ownerEnabled(),true,"never reset enabled 2FA on key loss");
});
test("owner reset revokes pending login, requires fresh password and new factor; logs never expose credentials",async t=>{
  const f=await fixture(t),created=await f.create(),mod=f.client();
  const first=await mod.request("auth/login",{login:"helper",password:created.temporaryPassword});const stale=first.data.secret;f.advance();
  const reset=await f.owner.request("moderators",{action:"reset-factor",id:created.moderators[0].id,reason:"Телефон потерян",password,code:f.current(f.secret)});assert.equal(reset.status,200);
  assert.notEqual((await mod.request("auth/verify",{code:f.current(stale),newPassword:personalPassword})).status,200);
  assert.equal((await mod.request("auth/login",{login:"helper",password:created.temporaryPassword})).status,403);
  const second=await mod.request("auth/login",{login:"helper",password:reset.data.temporaryPassword});assert(second.data.enrollmentRequired);
  assert.equal((await mod.request("auth/verify",{code:f.current(second.data.secret),newPassword:personalPassword})).status,200);
  const audit=JSON.stringify((await f.owner.request("audit")).data);
  for(const value of [f.secret,stale,second.data.secret,created.temporaryPassword,reset.data.temporaryPassword,personalPassword,password])assert(!audit.includes(value));
});
test("encrypted store and master key backup restores factors and used-code protection",async t=>{
  const f=await fixture(t),root=path.join(f.dir,"backup-root");fs.mkdirSync(path.join(root,"data"),{recursive:true});
  fs.copyFileSync(f.options.filePath,path.join(root,"data/owner-access.json"));fs.copyFileSync(f.access.security.file,path.join(root,"data/owner-access.json.security.json"));
  const destination=path.join(f.dir,"protected-backup"),{capture}=require("../../scripts/deployment/admin-security-backup.cjs");
  const report=capture(root,destination,{keyPath:f.options.keyPath});assert.equal(report.verifiedFactors,1);
  const restored=JSON.parse(fs.readFileSync(path.join(destination,"owner-access.json.security.json")));assert.equal(otp.decrypt(restored.owner.factor.secret,fs.readFileSync(path.join(destination,"admin-totp.key")),f.a.profile.id+":"+f.a.profile.id),f.secret);
  assert.equal(restored.owner.factor.lastCounter,f.access.security.load().owner.factor.lastCounter);
});

test("profile recovery requires the owner second factor even on private loopback",async t=>{
  const f=await fixture(t),stranger=f.client(f.b.token),before=f.profiles.byId(f.a.profile.id).revision;
  assert.equal((await stranger.request("recover-profile",{password})).status,403);
  assert.equal(f.profiles.byId(f.a.profile.id).revision,before);
  f.advance();const recovered=await stranger.request("recover-profile",{password,code:f.current(f.secret)});
  assert.equal(recovered.status,200);assert.equal(f.access.session,null);
  assert.equal((await stranger.request("recover-profile",{password,code:f.current(f.secret)})).status,403);
});

test("moderator password reset revokes sessions but preserves enrolled factor and requires own new password",async t=>{
  const f=await fixture(t),created=await f.create(),mod=f.client();
  const initial=await mod.request("auth/login",{login:"helper",password:created.temporaryPassword}),secret=initial.data.secret;
  assert.equal((await mod.request("auth/verify",{code:f.current(secret),newPassword:personalPassword})).status,200);
  f.advance();const reset=await f.owner.request("moderators",{action:"reset-password",id:created.moderators[0].id,reason:"Смена пароля",password,code:f.current(f.secret)});
  assert.equal(reset.status,200);assert.notEqual((await mod.request("players")).status,200);
  assert.equal((await mod.request("auth/login",{login:"helper",password:personalPassword})).status,403);
  const login=await mod.request("auth/login",{login:"helper",password:reset.data.temporaryPassword});
  assert.equal(login.data.enrollmentRequired,false);assert.equal(login.data.passwordChangeRequired,true);assert.equal(login.data.secret,undefined);
  assert.equal((await mod.request("auth/verify",{code:f.current(secret)})).status,400);
  assert.equal((await mod.request("auth/verify",{code:f.current(secret),newPassword:personalPassword+" new"})).status,200);
});
