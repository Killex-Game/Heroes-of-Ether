'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { RoomFixture } = require('../../scripts/benchmarks/resident-room-processes/room-fixture.cjs');
const wire = require('../../public/shared/arena-wire');

class Socket extends EventEmitter {
  constructor() { super(); this.protocol = wire.PROTOCOL; this.readyState = 1; this.bufferedAmount = 0; }
  close(code) { this.closeCode = code; }
}
function fixture() {
  return Object.assign(Object.create(RoomFixture.prototype), {
    players: [{ id: 'a' }, { id: 'b' }], clients: new Set(), connectionsByPlayer: new Map(),
    metrics: { reconnections: 0 }
  });
}
test('reconnection starts a new baseline; late close and ACK from replaced socket cannot affect it', () => {
  const room = fixture(), old = new Socket(), next = new Socket();
  room.connect(old, 0);
  const previous = room.connectionsByPlayer.get('a');
  previous.sequence = 8; previous.acknowledgedSequence = 6;
  room.connect(next, 0);
  const current = room.connectionsByPlayer.get('a');
  assert.notEqual(previous, current);
  assert.equal(current.sequence, 0);
  assert.equal(current.acknowledgedSequence, 0);
  assert.equal(old.closeCode, 1000);
  old.emit('message', Buffer.from('{"type":"stateAck","sequence":8}'));
  assert.equal(previous.acknowledgedSequence, 6);
  old.emit('close');
  assert.equal(room.connectionsByPlayer.get('a'), current);
  assert.equal(room.clients.size, 1);
  next.emit('close');
  assert.equal(room.connectionsByPlayer.size, 0);
  assert.equal(room.clients.size, 0);
});
test('invalid player indices cannot alias another player', () => {
  const room = fixture();
  for (const index of [-1, 2, 0.5, NaN, Infinity, '0']) {
    const socket = new Socket();
    assert.equal(room.connect(socket, index), false);
    assert.equal(socket.closeCode, 1008);
  }
  assert.equal(room.clients.size, 0);
});
