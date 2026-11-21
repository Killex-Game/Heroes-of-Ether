"use strict";
const test=require("node:test"),assert=require("node:assert/strict");
const {availableMemory}=require("../../scripts/benchmarks/available-memory.cjs");
test("load admission includes reclaimable cache but never exceeds the isolated cgroup reserve",()=>{
 const data={"/proc/meminfo":"MemFree: 200 kB\nMemAvailable: 100000 kB\n","/proc/self/cgroup":"0::/system.slice/isolated.service\n",
   "/sys/fs/cgroup/system.slice/isolated.service/memory.max":"90000000\n","/sys/fs/cgroup/system.slice/isolated.service/memory.current":"20000000\n"};
 const options={platform:"linux",read:file=>data[file],free:()=>200*1024};
 assert.equal(availableMemory(options),70000000);
 data["/sys/fs/cgroup/system.slice/isolated.service/memory.max"]="max";
 assert.equal(availableMemory(options),100000*1024);
 assert.equal(availableMemory({...options,platform:"win32"}),200*1024);
 assert.equal(availableMemory({...options,read:()=>{throw Error("unavailable");}}),200*1024);
});
