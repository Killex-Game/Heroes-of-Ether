'use strict';
// Diagnostic instrumentation only. It never skips validation or changes the queue.
const {performance}=require('node:perf_hooks');
function distribution(values){
 const sorted=[...values].sort((a,b)=>a-b),at=p=>sorted.length?sorted[Math.min(sorted.length-1,Math.ceil(sorted.length*p)-1)]:0;
 return {count:sorted.length,p50:at(.5),p95:at(.95),p99:at(.99),max:sorted.at(-1)||0};
}
function install(Queue,{now=()=>performance.now(),limit=20000,detailLimit=256}={}){
 const original=Queue.prototype.use;let sequence=0;
 const fresh=()=>({started:now(),arrived:0,completed:0,pending:0,dropped:0,duplicateCompletions:0,rows:[]});
 let current=fresh();
 Queue.prototype.use=function(command){
  const window=current,arrived=now(),row={sequence:++sequence,atMs:arrived-window.started,pendingAtArrival:this.pending||0,targeted:!!command.target,attempts:0,prepareMs:0};
  window.arrived++;window.pending++;let done=false;
  function complete(status,error){
   if(done){window.duplicateCompletions++;return;}done=true;window.pending--;window.completed++;
   row.status=status;row.totalMs=now()-arrived;row.waitMs=row.firstPrepareMs??row.totalMs;
   if(error)row.error=String(error.message||error).slice(0,200);
   if(window.rows.length<limit)window.rows.push(row);else window.dropped++;
  }
  const wrapped=Object.create(command);
  wrapped.prepare=function(...args){
   const start=now();row.firstPrepareMs??=start-arrived;row.attempts++;
   try{
    const result=command.prepare.apply(command,args),finish=result.finish;
    return {...result,finish(...args){const value=finish.apply(result,args);complete('success');return value;}};
   }finally{row.prepareMs+=now()-start;}
  };
  wrapped.fail=function(error){try{return command.fail.call(command,error);}finally{complete('failure',error);}};
  return original.call(this,wrapped);
 };
 return {
  reset(){current=fresh();},
  snapshot(){
   const w=current,groups={};
   for(const row of w.rows)(groups[row.status==='success'?'success':row.error]||=[]).push(row);
   return {scope:'Diagnostic queue arrivals; no admission, order or validation changes',arrived:w.arrived,completed:w.completed,pending:w.pending,dropped:w.dropped,duplicateCompletions:w.duplicateCompletions,
    groups:Object.fromEntries(Object.entries(groups).map(([name,rows])=>[name,{count:rows.length,totalMs:distribution(rows.map(r=>r.totalMs)),waitMs:distribution(rows.map(r=>r.waitMs)),prepareMs:distribution(rows.map(r=>r.prepareMs)),attempts:distribution(rows.map(r=>r.attempts))}])),
    first:[...w.rows].sort((a,b)=>a.sequence-b.sequence).slice(0,detailLimit),slowest:[...w.rows].sort((a,b)=>b.totalMs-a.totalMs).slice(0,32)};
  },
  restore(){Queue.prototype.use=original;}
 };
}
module.exports={install,distribution};
