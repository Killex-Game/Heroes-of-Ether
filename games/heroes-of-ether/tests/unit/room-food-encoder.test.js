"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const { ArenaStateStream, RoomFoodEncoder, STATE_PROTOCOL } = require("../../src/server/arena/state-stream");
const wire = require("../../public/shared/arena-wire");
function client(protocol, foodEncoder) {
  const packets = [], decoded = [], decoder = new wire.Decoder();
  const ws = { readyState: 1, bufferedAmount: 0, protocol, playerId: "owner" };
  const stream = new ArenaStateStream(ws, (_, data) => {
    packets.push(String(data));
    decoded.push(decoder.decode(JSON.parse(data)));
  }, () => 0, foodEncoder);
  return { stream, ws, packets, decoded, decoder };
}
function frame(tick, ether) {
  return { type: "state", tick, world: {width:6000,height:4000},
    players:[{id:"owner",x:500,y:500,radius:20,mass:100,parts:[]}], ether,
    projectiles:[],hazards:[],events:[],audioEvents:[],visualEvents:[] };
}

test("unchanged camera sees sub-pixel food crossings, radius changes, removals and rebirths", () => {
  for (const protocol of [wire.PROTOCOL, wire.HUD_PROTOCOL, wire.LEGACY_PROTOCOL]) {
    const c = client(protocol, new RoomFoodEncoder());
    c.stream.viewport = { x: 1000, y: 1000, width: 400, height: 400 };
    // Padded quantized left edge is 256. Both X values round to 251 on the wire.
    const frames = [
      [{ id: "edge", x: 250.99, y: 1000, radius: 5, value: 1 }],
      [{ id: "edge", x: 251.01, y: 1000, radius: 5, value: 1 }],
      [{ id: "edge", x: 250.99, y: 1000, radius: 5, value: 1 }],
      [{ id: "edge", x: 250.99, y: 1000, radius: 5.02, value: 1 }],
      [],
      [{ id: "edge", x: 500, y: 1000, radius: 5, value: 10 }],
    ];
    const expected = [false, true, false, true, false, true];
    for (let tick = 0; tick < frames.length; tick++) {
      c.stream.publish(frame(tick, frames[tick]));
      c.stream.acknowledge(c.stream.sequence);
      assert.equal(c.decoder.food.has("edge"), expected[tick], protocol + " tick " + tick);
    }
  }
});

test("canonical food fast path preserves scalar, nested, shape and key-order changes", () => {
  const cached = client(wire.PROTOCOL, new RoomFoodEncoder()), plain = client(wire.PROTOCOL);
  let row = {id:"e1",x:15,y:20,value:5,radius:7,color:"gold",artValue:5,ejected:true,birth:Object.freeze({x:1,y:2})};
  const edits = [
    r => { r.x += 1; }, r => { r.color = "blue"; }, r => { r.value = 9; },
    r => { r.radius = 10; }, r => { r.artValue = undefined; }, r => { r.ejected = false; },
    r => { r.birth = { x:3 }; }, r => { r.birth.x++; }, r => { r.birth = undefined; },
    r => { delete r.birth; }, r => { delete r.ejected; delete r.artValue; },
    r => { r.color = {value:"pink"}; }, r => { r.color.value = "red"; },
    r => { r.color = undefined; }, r => { r.extra = {n:1}; },
    r => { delete r.extra; }, r => { const value=r.value; delete r.value; r.value=value; },
  ];
  for (let tick=0;tick<=edits.length;tick++) {
    if (tick) edits[tick-1](row);
    for (const c of [cached,plain]) { c.stream.publish(frame(tick,[{...row}])); c.stream.acknowledge(c.stream.sequence); }
    assert.deepEqual(cached.packets,plain.packets,"edit "+tick);
    assert.deepEqual(cached.decoded,plain.decoded);
  }
});
test("room food encoding survives cloned/mutated metadata, skipped ACKs and viewport changes byte-for-byte", () => {
  for (const protocol of [wire.PROTOCOL, wire.HUD_PROTOCOL, wire.ENTITY_PROTOCOL, wire.LEGACY_PROTOCOL, STATE_PROTOCOL]) {
    const encoder = new RoomFoodEncoder(), a = client(protocol, encoder), b = client(protocol);
    const ether = [
      {id:"natural",x:510,y:500,value:1,radius:5,color:"gold"},
      {id:"e1",x:530,y:500,value:5,radius:7.5,ejected:true,artValue:5,birth:{x:500,y:500}},
      {id:"e2",x:550,y:510,value:5,radius:7.5,ejected:true,extension:undefined},
    ];
    for (let tick = 1; tick <= 36; tick++) {
      if (ether[1]) ether[1].x += 0.17;
      if (tick === 4) ether[1].birth.x += 1;
      if (tick === 7) { ether[2].extension = {a:[1,2],b:"new"}; ether[0].value = 2; }
      if (tick === 9) ether[2].extension.a.push(3);
      if (tick === 12) ether[2].extension = undefined;
      if (tick === 13) delete ether[1].birth;
      if (tick === 14) ether.reverse();
      if (tick === 16) ether.splice(0,1);
      if (tick === 18) ether.push({id:"e2",x:50,y:50,value:100,radius:30,ejected:true});
      if (tick === 25) ether.length = 0;
      if (tick === 28) ether.push({id:"natural",x:510,y:500,value:8,radius:10,color:"blue"});
      for (const c of [a,b]) {
        c.ws.bufferedAmount = tick >= 19 && tick <= 22 ? 100000 : 0;
        c.stream.viewport = tick < 10 ? {x:500,y:500,width:400,height:400} :
          tick < 15 ? {x:1800,y:1700,width:400,height:400} : null;
        if (tick % 7 === 0 || tick > 30) c.stream.acknowledge(c.stream.sequence);
        // Different graphs emulate delivery through structured clone.
        c.stream.publish(structuredClone(frame(tick, ether)));
      }
      assert.deepEqual(a.packets,b.packets,protocol + " tick " + tick);
      assert.deepEqual(a.decoded,b.decoded);
      assert.ok(encoder.previous.size <= 3, "cache does not retain removed food");
    }
  }
});
test("food cache retains only current records and never mutates an older presentation baseline", () => {
  const encoder = new RoomFoodEncoder(), otherRoom = new RoomFoodEncoder();
  const source = {id:"e1",x:10,y:20,value:5,radius:7.5,ejected:true,birth:{x:0,y:0}};
  const first = encoder.encode([structuredClone(source)])[0];
  const unchanged = encoder.encode([structuredClone(source)])[0];
  assert.equal(first, unchanged);
  source.x = 30;
  const moved = encoder.encode([source])[0];
  assert.notEqual(first,moved);
  assert.equal(first.px,10);
  assert.equal(moved.meta,first.meta);
  source.birth.x = 42;
  assert.notEqual(encoder.encode([source])[0].meta,first.meta);
  const other = otherRoom.encode([{...source,value:100}])[0];
  assert.notEqual(other.meta,encoder.previous.get("e1").row.meta);
  for (let generation=0; generation<10; generation++) {
    encoder.encode(Array.from({length:500}, (_,i)=>({id:`f${generation}-${i}`,x:i,y:0,radius:5,value:1})));
    assert.equal(encoder.previous.size,500);
  }
  encoder.encode([]);
  assert.equal(encoder.previous.size,0);
  assert.equal(otherRoom.previous.size,1);
});

test("frozen launch metadata can be reused, but frozen accessors and nested mutations stay observable", () => {
  const encoder = new RoomFoodEncoder();
  const base = { id: "e1", x: 10, y: 20, ejected: true, value: 5, radius: 7 };
  const birth = Object.freeze({ x: 1, y: 2, at: 3 });
  const first = encoder.encode([{ ...base, birth }])[0];
  assert.equal(encoder.encode([{ ...base, birth }])[0], first);
  const nested = Object.freeze({ detail: { x: 1 } });
  const before = encoder.encode([{ ...base, birth: nested }])[0].meta;
  nested.detail.x++;
  assert.notEqual(encoder.encode([{ ...base, birth: nested }])[0].meta, before);
  let x = 1;
  const getter = Object.freeze({ get x() { return x; } });
  const previous = encoder.encode([{ ...base, birth: getter }])[0].meta;
  x++;
  assert.notEqual(encoder.encode([{ ...base, birth: getter }])[0].meta, previous);
});
