"use strict";
// Optional real HTTP lobby and Atlas mirror for the isolated resident fixture.
const fs=require('node:fs'),path=require('node:path');
const {once}=require('node:events'),{randomBytes,randomUUID}=require('node:crypto');
const {fork}=require('node:child_process');
const {loadConfig,safeError}=require('../../../src/server/persistence/mongodb-config');
const {MongoState}=require('../../../src/server/persistence/mongodb-state');
async function startServices(store,root,lobbyTokens,externalBoosterQueue){
  let app,peer,mongo,config,sequence=0,closePromise,mongoClosed=false;
  const ask=payload=>new Promise((resolve,reject)=>{
    const id=++sequence,timer=setTimeout(()=>{peer.off('message',receive);reject(Error('Lobby driver timeout'));},30000);
    const receive=m=>{if(m.id!==id)return;clearTimeout(timer);peer.off('message',receive);m.error?reject(Error(m.error)):resolve(m.result);};
    peer.on('message',receive);peer.send({...payload,id});
  });
  try{
    if(process.env.ROOM_BENCH_MONGO_ROOT){
      const source=loadConfig(process.env.ROOM_BENCH_MONGO_ROOT);
      if(!source)throw Error('Missing Atlas source configuration');
      config={enabled:true,credentialsFile:source.credentialsFile,
        database:'hero_ether_test_'+randomBytes(10).toString('hex'),sourceId:randomUUID()};
      fs.mkdirSync(path.join(root,'config'),{recursive:true});
      fs.writeFileSync(path.join(root,'config/mongodb.local.json'),JSON.stringify(config),{mode:0o600});
      mongo=await require('../mongodb-load-store.cjs').attachTestMongo(root,store);
    }
    if(lobbyTokens.length){
      app=require('../../../src/server/game-server').createGameServer({profiles:store,events:store.events,autoTick:false,externalBoosterQueue,
        maxPlayers:lobbyTokens.length,testBots:{enabled:false,lobbyEnabled:false,
          configPath:path.join(root,'disabled-bots.json'),sessionsPath:path.join(root,'disabled-sessions.json')}});
      app.httpServer.listen(0,'127.0.0.1');await once(app.httpServer,'listening');
      peer=fork(path.join(__dirname,'../room-lobby-clients.cjs'),[],{execArgv:[],stdio:['ignore','ignore','pipe','ipc']});
      peer.stderr.on('data',b=>process.stderr.write(b));
      await ask({type:'setup',base:'http://127.0.0.1:'+app.httpServer.address().port,tokens:lobbyTokens,profileIds:lobbyTokens.map(token=>store.find(token).id)});
    }
    return {
      start:async()=>{if(peer)await ask({type:'phase'});},
      close(){
        return closePromise ||= (async()=>{
        let lobby;
        try{
          if(peer){await ask({type:'stop'});const until=Date.now()+20000;
            do{lobby=await ask({type:'stats'});if(!lobby.pending)break;await new Promise(r=>setTimeout(r,100));}while(Date.now()<until);
            if(lobby.pending)throw Error('Pending lobby operations at shutdown');}
          mongo?.sync.pause();
          await mongo?.sync.running;
          if(app)await app.close();else await store.close();
          let verification;
          if(mongo){await mongo.sync.close();mongoClosed=true;verification=await mongo.verify();}
          return {lobby,mongo:verification};
        }finally{
          peer?.kill();mongo?.sync.pause();
          if(app)await app.close();else if(!store.journal?.closed)await store.close();
          if(mongo&&!mongoClosed){await mongo.sync.close(false);mongoClosed=true;}
        }
        })();
      },
      async removeSyntheticDatabase(){
        if(!config)return false;
        if(!/^hero_ether_test_[a-f0-9]{20}$/.test(config.database))throw Error('Unsafe test database');
        const db=new MongoState(config);
        try{
          const manifest=await db.meta.findOne({_id:'state'});
          if(manifest?.sourceId!==config.sourceId)throw Error('Synthetic database owner mismatch');
          await db.db.dropDatabase();return true;
        }finally{await db.close();}
      }
    };
  }catch(error){peer?.kill();mongo?.sync.pause();if(app)await app.close();await mongo?.sync.close(false);
    throw Error('Isolated services: '+safeError(error));}
}
module.exports={startServices};
