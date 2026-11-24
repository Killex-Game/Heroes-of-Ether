'use strict';
// A local review server uses its own WAL and never opens production PostgreSQL.
const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'../..'),game=path.join(root,'games/heroes-of-ether');
const data=path.join(root,'.cache/local-review-data');fs.mkdirSync(data,{recursive:true});
const {ProfileStore}=require(game+'/src/server/profiles/profile-store');
const {createGameServer}=require(game+'/src/server/game-server');
const settings=require(game+'/src/server/runtime/server-settings').loadServerSettings(game);
const port=Number(process.env.LOCAL_REVIEW_PORT||3104);
if(!Number.isInteger(port)||port<1024||port>65535)throw Error('Invalid local port');
const release=require(game+'/src/server/runtime/process-lock').acquireServerLock(path.join(data,'server.lock'));process.on('exit',release);
const app=createGameServer({publicDir:game+'/public',arenaPolicy:settings.arena,
 profiles:new ProfileStore({filePath:path.join(data,'profiles.json'),journal:true,incrementalSettlement:true,clanDailyQuests:true,
  petEvents:settings.petEvents,rouletteConfig:settings.roulette,promotionConfig:settings.promotions}),
 testBots:{enabled:false}});
let closing=false;async function close(){if(closing)return;closing=true;await app.close();release();}
process.once('SIGINT',()=>close().then(()=>process.exit(0)));process.once('SIGTERM',()=>close().then(()=>process.exit(0)));
app.httpServer.on('error',e=>{console.error(e.code);close().finally(()=>{process.exitCode=1;});});
app.httpServer.listen(port,'127.0.0.1',()=>console.log('Local review: http://localhost:'+port+'; isolated local profiles'));
