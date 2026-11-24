"use strict";
const fs=require('node:fs'),path=require('node:path');
// Only immutable, atomically replaced checkpoint files. Active WAL reads must
// never use this cache. A file moving during a read is deliberately not cached.
class CheckpointCache {
  constructor(directory,read) { this.directory=directory;this.read=read;this.files=['profiles.json','game-events.json','clan-chat.json']; }
  signature(profileSnapshot) {
    const files=profileSnapshot
      ? [profileSnapshot.file,...require('../profiles/profile-read-snapshot').filesFor(profileSnapshot),...this.files.slice(1).map(name=>path.join(this.directory,name))]
      : this.files.map(name=>path.join(this.directory,name));
    return String(profileSnapshot?.revision ?? '')+'|'+files.map((file,index)=>{
      // Creating/releasing a hard link changes ctime, not immutable contents.
      const pinned=profileSnapshot && index<files.length-(this.files.length-1);
      try {const s=fs.statSync(file,{bigint:true});return [s.dev,s.ino,s.size,s.mtimeNs,...(pinned?[]:[s.ctimeNs])].join(':');}
      catch(e){if(e.code==='ENOENT')return 'missing';throw e;}
    }).join('|');
  }
  snapshot(profileSnapshot) {
    const before=this.signature(profileSnapshot);if(before===this.key&&this.value)return this.value;
    const value=this.read(this.directory,false,profileSnapshot).snapshot,after=this.signature(profileSnapshot);
    if(before===after){this.key=after;this.value=value;}else{this.key=null;this.value=null;}
    return value;
  }
}
module.exports={CheckpointCache};
