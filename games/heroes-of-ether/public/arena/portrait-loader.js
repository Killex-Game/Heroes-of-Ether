/* Load arena portraits at their actual display resolution, retaining the visible image on upgrade. */
(function(root,factory){
  if(typeof module==='object'&&module.exports)module.exports=factory();
  else root.KillexArenaPortraits=factory();
})(typeof globalThis!=='undefined'?globalThis:this,()=>{
  'use strict';
  class Portraits {
    constructor(identity,makeImage=()=>new Image()) {
      this.identity=identity;this.makeImage=makeImage;
      this.skins=new Map(identity.allSkins.map(s=>[s.id,s]));this.entries=new Map();
    }
    get(id,diameter) {
      const skin=this.skins.get(id);if(!skin)return null;
      const required=Number.isFinite(diameter)?Math.max(0,diameter)*1.2:256;
      const size=required<=256?256:required<=512?512:1024;
      let entry=this.entries.get(id);
      if(!entry){entry={ready:null,size:0,pending:new Map(),failed:new Set()};this.entries.set(id,entry);}
      if(size>entry.size&&!entry.failed.has(size)&&![...entry.pending.keys()].some(n=>n>=size)){
        const image=this.makeImage();entry.pending.set(size,image);
        image.onload=()=>{entry.pending.delete(size);if(size>entry.size&&image.naturalWidth){entry.ready=image;entry.size=size;}};
        image.onerror=()=>{entry.pending.delete(size);entry.failed.add(size);};
        image.src=this.identity.skinSource(skin,size);
      }
      return entry.ready||entry.pending.get(size)||entry.pending.values().next().value||null;
    }
  }
  return {Portraits};
});
