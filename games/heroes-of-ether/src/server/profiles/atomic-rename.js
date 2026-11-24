"use strict";
const fs = require("node:fs");

// Windows may briefly refuse replacement while another reader closes its
// handle. Retry the same atomic rename; never unlink the acknowledged file.
// Other platforms and permanent errors preserve their original failure path.
function renameAtomic(source, destination, { platform = process.platform } = {}) {
  let pause;
  for (let attempt = 0; ; attempt++) {
    try { fs.renameSync(source, destination); return; }
    catch (error) {
      if (platform !== "win32" || attempt >= 4 ||
          !["EPERM", "EACCES", "EBUSY"].includes(error.code)) throw error;
      if (attempt) {
        pause ||= new Int32Array(new SharedArrayBuffer(4));
        Atomics.wait(pause, 0, 0, 2 ** attempt);
      }
    }
  }
}

module.exports = { renameAtomic };
