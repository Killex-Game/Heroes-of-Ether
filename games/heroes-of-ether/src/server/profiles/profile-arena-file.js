"use strict";
const fs = require('node:fs');
// This file is unpublished and excluded from WAL recovery until the writer
// atomically promotes it to a numeric segment after checking the base revision.
async function writePending(file, buffer) {
  const handle = await fs.promises.open(file, 'w', 0o600);
  try {
    let offset = 0;
    while (offset < buffer.length) {
      const {bytesWritten} = await handle.write(buffer, offset, buffer.length - offset, offset);
      if (!bytesWritten) throw Error('Incomplete pending arena journal write');
      offset += bytesWritten;
    }
    await handle.sync();
  } finally {
    await handle.close();
  }
}
module.exports = {writePending};
