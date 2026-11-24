"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const { FoodTransferEncoder, FoodTransferDecoder } = require("../../src/server/arena/worker-food-transfer");

test('unchanged membership reuses the ordinal index without mutating older lookup tables', () => {
  for (const packed of [false,true]) {
    const encoder=new FoodTransferEncoder({packed}),decoder=new FoodTransferDecoder();
    let rows=Array.from({length:80},(_,i)=>({id:'e'+i,x:i,y:i/7,value:5,radius:3,color:'gold'}));
    const round=()=>assert.deepEqual(decoder.decode(structuredClone(encoder.encode(rows))),rows);
    round();const original=encoder.index, saved=[...original];
    for(let tick=0;tick<15;tick++){
      rows=rows.map((row,i)=>({...row,x:row.x+(i%3?.1:0),color:tick===5&&i===4?'blue':row.color}));
      round();assert.strictEqual(encoder.index,original);
    }
    rows=[rows[2],rows[1],rows[0],...rows.slice(3)];round();
    assert.notStrictEqual(encoder.index,original);assert.deepEqual([...original],saved);
    rows.pop();round();rows.push({...rows[1],x:999});round();
    rows=rows.map(row=>({...row,y:row.y+1}));round();
    assert.equal(encoder.index.get(rows[1].id),rows.length-1);
  }
});

test('food ordinal cache retains exact references through reorder and duplicate IDs', () => {
  for (const packed of [false,true]) {
    const encoder=new FoodTransferEncoder({packed}),decoder=new FoodTransferDecoder();
    const a={id:'a',x:1,y:2},b={id:'a',x:5,y:6},c={id:'c',x:10,y:10};
    const saved=[];
    for(const rows of [[a,c],[a,c],[a,b,c],[a,b,c],[b,a,c],[c],[c],[],[a,c],[c,a],[a,c]]) {
      const actual=decoder.decode(structuredClone(encoder.encode(rows)));
      assert.deepEqual(actual,rows);
      for(const old of saved)assert.deepEqual(old.actual,old.copy);
      saved.push({actual,copy:structuredClone(actual)});
      assert.equal(encoder.index.size,new Set(rows.map(row=>row.id)).size);
      rows.forEach((row,i)=>{if(!rows.slice(i+1).some(other=>other.id===row.id))assert.equal(encoder.index.get(row.id),i);});
    }
  }
});

test('frozen food identity is reused only when its whole public value is immutable', () => {
  for (const packed of [false, true]) {
    const encoder = new FoodTransferEncoder({packed}), decoder = new FoodTransferDecoder();
    const fixed = Object.freeze({id:'fixed',x:1,y:2,value:5,radius:3,color:'gold'});
    const nested = Object.freeze({id:'nested',x:4,y:5,extension:{value:1}});
    let coordinate = 6;
    const getter = Object.freeze({id:'getter',get x(){return coordinate;},y:7});
    const round = rows => decoder.decode(structuredClone(encoder.encode(rows)));
    assert.deepEqual(round([fixed,nested,getter]),[fixed,nested,getter]);
    assert.strictEqual(encoder.rows[0].source,fixed);
    assert.equal(encoder.rows[1].source,null);
    assert.equal(encoder.rows[2].source,null);
    assert.equal(encoder.encode([fixed,nested,getter]),null);
    nested.extension.value++;
    coordinate++;
    assert.deepEqual(round([fixed,nested,getter]),[fixed,nested,getter]);
    const replacement = Object.freeze({...fixed,color:'red'});
    assert.deepEqual(round([getter,replacement]),[getter,replacement]);
    assert.deepEqual(round([fixed]),[fixed]);
    assert.equal(encoder.rows.length,1);
  }
});

test('shared frozen launch metadata stays exact across positional snapshots and replacements', () => {
  for (const packed of [false,true]) {
    const encoder = new FoodTransferEncoder({packed}), decoder = new FoodTransferDecoder();
    let birth = Object.freeze({tick:1,x:2,y:3});
    const saved=[];
    for(let tick=0;tick<24;tick++) {
      if(tick===8) birth=Object.freeze({...birth,x:20});
      if(tick===16) birth=Object.freeze({...birth,extension:{nested:1}});
      if(tick===20) birth.extension.nested++;
      const row={id:'moving',x:tick/10,y:tick/3,value:5,radius:5,color:'gold',artValue:3,ejected:true,birth};
      const actual=decoder.decode(structuredClone(encoder.encode([row])));
      assert.deepEqual(actual,[row]);
      for(const item of saved) assert.deepEqual(item.actual,item.copy);
      saved.push({actual,copy:structuredClone(actual)});
    }
  }
});
test('canonical food fast path observes metadata, key order and every nested mutation', () => {
  for (const packed of [false, true]) {
    const encoder=new FoodTransferEncoder({packed}),decoder=new FoodTransferDecoder();
    const row={id:'canonical',x:1,y:2,value:3,radius:4,color:'gold',artValue:5,ejected:true,birth:{at:6,origin:{x:7}}};
    const history=[];
    function check(){
      const result=decoder.decode(structuredClone(encoder.encode([row])));
      assert.deepEqual(result,[row]);
      for(const old of history)assert.deepEqual(old.result,old.copy);
      history.push({result,copy:structuredClone(result)});
    }
    check();check();
    for(const key of ['value','radius','artValue']){row[key]++;check();row[key]=-0;check();row[key]=0;check();}
    row.color='blue';check();row.ejected=false;check();row.birth.origin.x++;check();
    row.birth=null;check();delete row.birth;check();row.color={shade:1};check();row.color.shade++;check();
    row.extra='extension';check();delete row.extra;check();const color=row.color;delete row.color;row.color=color;check();
  }
});
test("food transport preserves exact rows, reorder/removal and mutable nested metadata", () => {
  const encoder = new FoodTransferEncoder(), decoder = new FoodTransferDecoder();
  const a = { id: "a", x: 1.123456, y: 2, value: 5, radius: 3, birth: { origin: { x: 1 }, at: 10 } };
  const b = { id: "b", x: 3, y: 4, value: 50, ejected: true };
  const saved = [];
  function round(rows) {
    const source = structuredClone(rows), packet = structuredClone(encoder.encode(rows));
    const result = decoder.decode(packet);
    assert.deepEqual(result, source);
    for (const old of saved) assert.deepEqual(old.actual, old.expected, "published baselines remain immutable");
    saved.push({ actual: result, expected: source });
    return packet;
  }
  assert.equal(round([a, b]).length, 2);
  assert.equal(round([structuredClone(a), structuredClone(b)]), null);
  a.x += 0.00001;
  assert.deepEqual(round([a, b]), [[0, a.x, a.y], 1]);
  assert.deepEqual(round([b, a]), [1, 0]);
  a.birth.origin.x = 50;
  assert.equal(typeof round([b, a])[1], "object");
  delete a.radius; a.color = "gold";
  round([a]);
  round([]); round([b]);
  assert.equal(encoder.rows.length, 1);
  assert.deepEqual([...encoder.index.keys()], ["b"], "removed food must leave the transport cache");
});
test("invalid transport reference fails without changing a published list", () => {
  const decoder = new FoodTransferDecoder();
  const old = decoder.decode([{ id: "a", x: 0, y: 1 }]);
  assert.throws(() => decoder.decode([4]), /Invalid worker food reference/);
  assert.strictEqual(decoder.rows, old);
});

test("packed food buffers transfer exact coordinates and keep older snapshots intact", () => {
  const encoder = new FoodTransferEncoder({ packed: true }), decoder = new FoodTransferDecoder();
  const legacy = new FoodTransferEncoder(), legacyDecoder = new FoodTransferDecoder();
  let food = Array.from({ length: 200 }, (_, i) => ({ id: `e${i}`, x: i + 0.00000001, y: -i,
    value: 5, birth: { at: 1, origin: { x: i, y: 0 } } }));
  const previous = [];
  for (let tick = 0; tick < 100; tick++) {
    if (tick % 7 === 0) food.reverse();
    if (tick % 5 === 0) food.shift();
    if (tick % 9 === 0) food.push({ id: `n${tick}`, x: -0, y: Number.MIN_VALUE, value: 50 });
    for (let i = 0; i < food.length; i++) {
      if (i % 3 === 0) food[i].x += 0.0000001;
      if (i % 13 === 0 && food[i].birth) food[i].birth.origin.x++;
      if (i % 17 === 0) { delete food[i].value; food[i].value = tick; }
    }
    const packet = encoder.encode(food);
    const copied = packet === null ? null : structuredClone(packet,
      { transfer: [packet.refs.buffer, packet.positions.buffer] });
    if (packet) assert.equal(packet.refs.byteLength, 0, "sender does not retain transferred buffers");
    const rows = decoder.decode(copied);
    assert.deepEqual(rows, food);
    assert.deepEqual(rows, legacyDecoder.decode(structuredClone(legacy.encode(food))));
    for (const item of previous) assert.deepEqual(item.rows, item.saved);
    previous.push({ rows, saved: structuredClone(rows) });
  }
  const old = decoder.rows;
  for (const packet of [
    { refs: new Int32Array([0, 1]), positions: new Float64Array(1), added: [] },
    { refs: new Int32Array([-1]), positions: new Float64Array(0), added: [] },
    { refs: new Int32Array([0]), positions: new Float64Array(2), added: [] },
  ]) {
    assert.throws(() => decoder.decode(packet), /Invalid worker food/);
    assert.strictEqual(decoder.rows, old);
  }
});
