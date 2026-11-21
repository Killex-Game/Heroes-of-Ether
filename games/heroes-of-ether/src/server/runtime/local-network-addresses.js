/* Адреса этого сервера для игроков в той же локальной сети. */
"use strict";
const { networkInterfaces } = require("node:os");
function localNetworkUrls(port, interfaces = networkInterfaces()) {
  const addresses = Object.values(interfaces)
    .flat()
    .filter(
      (item) =>
        item && !item.internal && item.family === "IPv4" && !item.address.startsWith("169.254."),
    );
  return [...new Set(addresses.map((item) => `http://${item.address}:${port}/`))];
}
module.exports = { localNetworkUrls };
