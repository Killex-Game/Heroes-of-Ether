"use strict";
const fs=require('node:fs'),path=require('node:path');
function read(dataDir){
  const file=path.join(dataDir,'admin-control.json');if(!fs.existsSync(file))return null;
  const config=JSON.parse(fs.readFileSync(file,'utf8'));
  if(config?.version!==1||config.enabled!==true||!Number.isInteger(config.port)||config.port<1024||config.port>65535)
    throw Error('Invalid independent admin configuration');
  const directory=path.join(fs.realpathSync(dataDir),'..','admin-control'),key=fs.readFileSync(path.join(directory,'transport.key'));
  if(key.length!==32)throw Error('Invalid independent admin transport key');
  return{directory,key,url:'http://127.0.0.1:'+config.port,port:config.port};
}
module.exports={read};
