'use strict';
function progressBackend(value='canonical') {
  if(value==='canonical')return {name:value,profileWorker:false,environment:{}};
  if(value==='clan-shards-3')return {name:value,profileWorker:true,environment:{LOAD_PROFILE_CLAN_SHARDS:'3'}};
  throw Error('Unsupported experimental progress backend');
}
module.exports={progressBackend};
