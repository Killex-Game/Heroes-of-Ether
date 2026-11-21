"use strict";
// Administrative secrets are independent from the gameplay database. Never log their bytes.
const fs=require("node:fs"),path=require("node:path"),assert=require("node:assert/strict");
const {AdminSecurity}=require("../../src/server/admin/admin-security"),otp=require("../../src/server/admin/admin-otp");
function captureControl(data,destination){
  let controlFiles=0;
  if(fs.existsSync(path.join(data,'admin-control.json'))){
    const control=path.join(path.dirname(data),'admin-control');
    for(const [name,source] of [['admin-control.json',path.join(data,'admin-control.json')],['transport.key',path.join(control,'transport.key')],['editor-outbox.json',path.join(control,'editor-outbox.json')],['feedback.wal',path.join(control,'feedback.wal')]]){
      if(['editor-outbox.json','feedback.wal'].includes(name)&&!fs.existsSync(source))continue;
      let bytes=fs.readFileSync(source);
      if(name==='feedback.wal')bytes=bytes.subarray(0,bytes.lastIndexOf(10)+1); // Only complete records from a live append-only journal.
      const output=path.join(destination,'control',name);fs.mkdirSync(path.dirname(output),{recursive:true,mode:0o700});
      const fd=fs.openSync(output,'wx',0o600);try{fs.writeFileSync(fd,bytes);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
      assert.deepEqual(fs.readFileSync(output),bytes);
      if(name==='feedback.wal')void new(require('../../src/server/admin/feedback-store').FeedbackStore)({file:output}).close();
      controlFiles++;
    }
  }
  return controlFiles;
}
function capture(root,destination,{keyPath}={}) {
  const data=fs.realpathSync(path.join(root,"data")),file=path.join(data,"owner-access.json");
  if(!fs.existsSync(file+".security.json"))return{included:false,controlFiles:captureControl(data,destination)};
  const ownerId=JSON.parse(fs.readFileSync(file,"utf8")).ownerId,security=new AdminSecurity({ownerId,filePath:file,keyPath,now:Date.now});
  const state=security.load(),factors=[[ownerId,state.owner.factor],...state.moderators.map(m=>[m.id,m.factor])].filter(([,f])=>f);
  const key=factors.length?security.key():null;
  for(const [id,f] of factors)assert.match(otp.decrypt(f.secret,key,ownerId+":"+id),/^[A-Z2-7]{32}$/);
  fs.mkdirSync(destination,{recursive:true,mode:0o700});
  for(const [name,bytes] of [["owner-access.json.security.json",Buffer.from(JSON.stringify(state)+"\n")],...(key?[["admin-totp.key",key]]:[])]){
    const output=path.join(destination,name);const fd=fs.openSync(output,"wx",0o600);try{fs.writeFileSync(fd,bytes);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
    assert.deepEqual(fs.readFileSync(output),bytes);
  }
  const controlFiles=captureControl(data,destination);
  return{included:true,moderators:state.moderators.length,verifiedFactors:factors.length,controlFiles};
}
if(require.main===module){if(!process.argv[2])throw Error("Укажи отдельный каталог защищённой резервной копии.");console.log(JSON.stringify(capture(path.resolve(__dirname,"../.."),path.resolve(process.argv[2]))));}
module.exports={capture};
