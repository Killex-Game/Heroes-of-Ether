'use strict';
const {RoomOutbox}=require('../../src/server/arena/resident/room-outbox');
(async()=>{
  const box=await RoomOutbox.open({file:process.argv[2],roomId:'room-a',epoch:'epoch-a'});
  const keep=setInterval(()=>{},1000);
  process.on('message',async m=>{
    try{
      if(m==='append'){
        const entry=await box.append({at:1000,progress:[{type:'massPeak',profileId:'profile-a',mass:123}],
          applied:[{txId:'cast-a',profileId:'profile-a',lifeId:'life-a',boosterId:'meat'}]},()=>{});
        process.send({type:'durable',entry});
      }else if(m?.type==='ack'){
        box.acknowledge(m.value);process.send({type:'acked'});
      }else if(m==='close'){
        await box.close();clearInterval(keep);process.disconnect();
      }
    }catch(e){process.send({type:'error',error:e.stack});}
  });
  process.send({type:'ready'});
})().catch(e=>{console.error(e);process.exitCode=1;});
