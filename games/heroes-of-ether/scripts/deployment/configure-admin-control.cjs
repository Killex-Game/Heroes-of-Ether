"use strict";
// Run once during a graceful game stop, before starting either service.
const fs=require('node:fs'),path=require('node:path'),{randomBytes}=require('node:crypto');
const root=path.resolve(__dirname,'../..'),data=fs.realpathSync(path.join(root,'data'));
const config=path.join(data,'admin-control.json'),directory=path.join(path.dirname(data),'admin-control');
if(fs.existsSync(path.join(data,'server.lock')))throw Error('Stop the game gracefully before configuring independent administration');
if(fs.existsSync(config))throw Error('Independent administration already configured; inspect rather than overwrite');
if(!fs.existsSync(path.join(data,'owner-access.json')))throw Error('Existing owner credentials required');
fs.mkdirSync(directory,{recursive:true,mode:0o700});
if(fs.existsSync(path.join(directory,'editor-outbox.json')))throw Error('An editor outbox already exists; preserve and inspect it');
const world=require('../../src/server/persistence/mongodb-state').readLocal(data,true).world;
const events=new(require('../../src/server/events/event-manager').EventManager)({filePath:path.join(data,'game-events.json')});
const content=require('../../src/server/admin/control-content'),now=Date.now();
new content.ContentOutbox({file:path.join(directory,'editor-outbox.json'),access:{}}).refresh(
  content.snapshot({data:world,now:()=>now},require('../../src/server/admin/news-sources').sources(events,now)));
const file=path.join(directory,'transport.key'),fd=fs.openSync(file,'wx',0o600);
try{fs.writeFileSync(fd,randomBytes(32));fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
require('../../src/server/admin/control-content').atomic(config,{version:1,enabled:true,port:3103});
console.log(JSON.stringify({configured:true,port:3103}));
