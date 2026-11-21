"use strict";
const fs=require('node:fs'),path=require('node:path');
// Only immutable, atomically replaced checkpoint files. Active WAL reads must
// never use this cache. A file moving during a read is deliberately not cached.
class CheckpointCache {
  constructor(directory,read) { this.directory=directory;this.read=read;this.files=['profiles.json','game-events.json','clan-chat.json']; }
  signature() {
    return this.files.map(name=>{
      try {const s=fs.statSync(path.join(this.directory,name),{bigint:true});return [s.dev,s.ino,s.size,s.mtimeNs,s.ctimeNs].join(':');}
      catch(e){if(e.code==='ENOENT')return 'missing';throw e;}
    }).join('|');
  }
  snapshot() {
    const before=this.signature();if(before===this.key&&this.value)return this.value;
    const value=this.read(this.directory).snapshot,after=this.signature();
    if(before===after){this.key=after;this.value=value;}else{this.key=null;this.value=null;}
    return value;
  }
}
module.exports={CheckpointCache};
