'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {cgroupCpu,delta}=require('../../scripts/benchmarks/resource-sample.cjs');
test('load diagnostics read the current cgroup v2 instead of host totals',()=>{
 const files={'/proc/self/cgroup':'0::/system.slice/isolated.service\n',
 '/sys/fs/cgroup/system.slice/isolated.service/cpu.stat':'usage_usec 800000\nuser_usec 600000\nsystem_usec 200000\nnr_periods 20\nnr_throttled 4\nthrottled_usec 90000\n',
 '/sys/fs/cgroup/system.slice/isolated.service/cpu.max':'300000 100000\n'};
 const result=cgroupCpu({platform:'linux',read:file=>{assert(Object.hasOwn(files,file));return files[file];}});
 assert.equal(result.scope,'/sys/fs/cgroup/system.slice/isolated.service');
 assert.equal(result.cpuMax,'300000 100000');assert.equal(result.counters.throttled_usec,90000);
 assert.equal(cgroupCpu({platform:'win32',read:()=>{throw Error('must not read');}}),null);
 assert.equal(cgroupCpu({platform:'linux',read:()=>{throw Error('unavailable');}}),null);
});
test('load diagnostics separate process CPU, main thread CPU and interval throttling',()=>{
 const before={at:0,processCpu:{user:0,system:0},threadCpu:{user:0,system:0},elu:{active:0,idle:0},
 cgroup:{scope:'test',cpuMax:'300000 100000',counters:{usage_usec:100,nr_periods:10,nr_throttled:2,throttled_usec:1000}}};
 const after={at:1000,processCpu:{user:2000000,system:100000},threadCpu:{user:600000,system:10000},elu:{active:750,idle:250},
 cgroup:{scope:'test',cpuMax:'300000 100000',counters:{usage_usec:2500100,nr_periods:20,nr_throttled:5,throttled_usec:201000}}};
 const result=delta(before,after);assert.equal(result.processCpu.percent,210);assert.equal(result.mainThreadCpu.percent,61);
 assert.equal(result.cgroup.throttledPeriodFraction,.3);assert.equal(result.cgroup.counters.throttled_usec,200000);
 assert.equal(result.mainThreadElu.utilization,.75);
 assert.equal(delta(before,{...after,cgroup:{...after.cgroup,scope:'another'}}).cgroup,null);
});
