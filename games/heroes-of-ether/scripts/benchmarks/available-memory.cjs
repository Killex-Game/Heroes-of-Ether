"use strict";
const fs=require("node:fs"),os=require("node:os"),path=require("node:path");
// Linux MemFree excludes reclaimable page cache. Respect the benchmark's own
// cgroup budget as well, so a large host does not hide its process-group limit.
function availableMemory({platform=process.platform,read=file=>fs.readFileSync(file,"utf8"),free=os.freemem}={}){
 let bytes=free();
 if(platform!=="linux")return bytes;
 try{const match=/^MemAvailable:\s+(\d+)\s+kB$/m.exec(read("/proc/meminfo"));if(match)bytes=Number(match[1])*1024;}catch{}
 try{
   const group=/^0::(\/[^\r\n]*)$/m.exec(read("/proc/self/cgroup"))?.[1];
   if(group){
     const directory=path.posix.resolve("/sys/fs/cgroup","."+group);
     if(directory!=="/sys/fs/cgroup"&&!directory.startsWith("/sys/fs/cgroup/"))throw Error("Invalid cgroup");
     const max=read(directory+"/memory.max").trim(),used=Number(read(directory+"/memory.current").trim());
     if(/^\d+$/.test(max)&&Number.isFinite(used)&&used>=0)bytes=Math.min(bytes,Math.max(0,Number(max)-used));
   }
 }catch{}
 return bytes;
}
module.exports={availableMemory};
