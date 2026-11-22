/* Стабильная точка запуска: node server.js / npm start. */
"use strict";
// Точка запуска игры. Правила и сетевой сервер находятся в src/server.
const { createGameServer, startServer } = require("./src/server/game-server");
if (require.main === module)
  startServer().catch((error) => {
    // PostgreSQL driver/configuration errors must never reveal the connection URI.
    console.error(
      "Запуск сервера остановлен:",
      error.code === "SERVER_CONFIG" ? error.message :
        require("./src/server/persistence/postgresql-config").safeError(error),
    );
    process.exitCode = 1;
  });
module.exports = { createGameServer };
