"use strict";
const path=require('node:path');
const settings=require('./src/server/runtime/server-settings').loadServerSettings(__dirname);
const config=require('./src/server/admin/control-config').read(settings.dataDir);
if(!config)throw Error('Independent administration is not configured');
const release=require('./src/server/runtime/process-lock').acquireServerLock(path.join(config.directory,'control.lock'));
process.on('exit',release);
const access=new(require('./src/server/admin/owner-access').OwnerAccess)({...settings.owner,
  filePath:path.join(settings.dataDir,'owner-access.json'),bootstrapPath:path.join(settings.dataDir,'owner-first-login.json')});
const control=require('./src/server/admin/control-server').createControlServer({access,key:config.key,directory:config.directory,
  gameUrl:'http://127.0.0.1:'+settings.port,publicDir:process.env.ADMIN_PUBLIC_DIR||settings.publicDir,mediaDirectory:path.join(settings.dataDir,'news-media')});
control.server.listen(config.port,'127.0.0.1');
let closing=false;const close=async()=>{if(closing)return;closing=true;await control.close();release();};
process.on('SIGTERM',close);process.on('SIGINT',close);
