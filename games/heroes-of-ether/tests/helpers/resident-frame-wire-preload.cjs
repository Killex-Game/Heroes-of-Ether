'use strict';
// Explicit test-only adapter: exercise existing deadline/failure scenarios
// through the bounded serialized receiver, without changing production defaults.
const {RoomProfileLedger}=require('../../src/server/arena/resident/room-profile-ledger');
RoomProfileLedger.prototype.accept=function(child,entry){
 return this.acceptSerialized(child,JSON.stringify(entry)).then(result=>result.ack);
};
