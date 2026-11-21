"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const { Sender } = require("ws");
const { coalesceServerFrames, stateFramePayload, MAX_CONTIGUOUS_FRAME } = require("../../src/server/arena/socket-frames");
function socket(error) {
  return { writes: [], corks: 0, callbacks: 0,
    cork() { this.corks++; }, uncork() { this.corks--; },
    write(data, callback) { this.writes.push(Buffer.from(data)); callback?.(error); return false; },
  };
}
function peer(io) { return { _isServer: true, _socket: io, _sender: new Sender(io) }; }

test("transferred state headroom preserves all frame bytes and isolates adjacent queued packets", () => {
  for (const length of [0, 1, 125, 126, 1024, 16000, 65520, 65536, 100000]) {
    const bytes = Buffer.alloc((length + 10) * 2, 0);
    bytes.fill(91, 10, length + 10);
    bytes.fill(92, length + 20);
    const io = socket(), held = [], write = io.write;
    io.write = function(data, callback) { held.push(data); return write.call(this, data, callback); };
    const ws = peer(io); coalesceServerFrames(ws, 'win32');
    const expected = [];
    for (let i=0;i<2;i++) {
      const payload = stateFramePayload(bytes, 10 + i*(length+10), length, 10);
      const frame = Sender.frame(payload, {fin:true, opcode:2, mask:false, readOnly:true});
      expected.push(Buffer.concat(frame));
      ws._sender.sendFrame(frame);
      assert.deepEqual(payload, Buffer.alloc(length, 91+i));
    }
    assert.deepEqual(Buffer.concat(held), Buffer.concat(expected));
    if (length > 0 && length + 4 <= MAX_CONTIGUOUS_FRAME)
      assert.equal(held[0].buffer, bytes.buffer, 'no full-payload copy on the main thread');
  }
});

test("a repeated send cannot overwrite a queued header; invalid headroom uses the safe copy", () => {
  for (const headroom of [10, 1, -1, 11, NaN, 3.5]) {
    const bytes = Buffer.alloc(40, 7), payload = stateFramePayload(bytes, 10, 30, headroom);
    const io = socket(), held = [];
    io.write = data => { held.push(data); return false; };
    const ws = peer(io); coalesceServerFrames(ws, 'win32');
    const first = Sender.frame(payload, {fin:true, opcode:1, mask:false, readOnly:true});
    const expected = Buffer.concat(first);
    ws._sender.sendFrame(first);
    ws._sender.sendFrame(Sender.frame(payload, {fin:true, opcode:2, mask:false, readOnly:true}));
    assert.deepEqual(held[0], expected);
    assert.equal(held[1][0], 0x82);
    assert.deepEqual(payload, Buffer.alloc(30, 7));
  }
});
test("coalescing preserves frame bytes, input buffers, callback and ordering", () => {
  for (const length of [0, 1, 125, 126, 1024, 16000, 65520, 65536, 100000]) {
    const payload = Buffer.alloc(length, 91);
    const original = socket(), compact = socket();
    const ws = peer(compact);
    assert.equal(coalesceServerFrames(ws, "win32"), true);
    let oldCallbacks = 0, newCallbacks = 0;
    for (const opcode of [1, 2]) {
      const frame = Sender.frame(payload, { fin: true, opcode, mask: false, readOnly: true });
      const copies = frame.map(data => Buffer.from(data));
      new Sender(original).sendFrame(frame, () => oldCallbacks++);
      ws._sender.sendFrame(frame, () => newCallbacks++);
      assert.deepEqual(frame, copies);
    }
    assert.deepEqual(Buffer.concat(compact.writes), Buffer.concat(original.writes));
    assert.equal(newCallbacks, oldCallbacks);
    assert.equal(compact.corks, 0);
    assert.equal(compact.writes.length, length + 4 <= MAX_CONTIGUOUS_FRAME ? 2 : 4);
  }
});
test("socket errors retain the send callback; control frames and text fallback are intact", () => {
  const error = Error("closed"), io = socket(error), ws = peer(io);
  coalesceServerFrames(ws, "win32");
  let received;
  ws._sender.sendFrame([Buffer.from([0x89, 1]), Buffer.from("x")], e => received = e);
  assert.equal(received, error);
  assert.deepEqual(io.writes[0], Buffer.from([0x89, 1, 120]));
  ws._sender.sendFrame([Buffer.from([0x81, 2]), "ok"], () => {});
  assert.equal(io.writes.length, 3);
});
test("unknown senders, clients, masked frames and unmeasured platforms keep the standard path", () => {
  const io = socket(), ws = peer(io), original = ws._sender.sendFrame;
  assert.equal(coalesceServerFrames(ws, "linux"), false);
  ws._isServer = false;
  assert.equal(coalesceServerFrames(ws, "win32"), false);
  ws._isServer = true;
  ws._sender.sendFrame = () => {};
  assert.equal(coalesceServerFrames(ws, "win32"), false);
  ws._sender.sendFrame = original;
  coalesceServerFrames(ws, "win32");
  const frame = Sender.frame(Buffer.from("mask"), { fin: true, opcode: 2, mask: true, readOnly: false });
  ws._sender.sendFrame(frame);
  assert.equal(io.writes.length, frame.length);
  assert.deepEqual(Buffer.concat(io.writes), Buffer.concat(frame));
});
