/**
 * Lobby Server CLI
 *
 * Starts the WebSocket lobby server.
 *
 * Usage:
 *   npm run lobby:server
 *   npm run lobby:server -- --port 9001
 *   npm run lobby:server -- --data-dir /srv/washoi
 */

import { LobbyServer } from "../lobby/LobbyServer";
import { MatchResultStore } from "../lobby/MatchResultStore";
import { PlayerStore } from "../lobby/PlayerStore";
import { loadBotSecret, resolveDataDir } from "../lobby/ServerData";

// Parse arguments
const args = process.argv.slice(2);
let port = 9000;
let dataDirArg: string | undefined;

for (let i = 0; i < args.length; i++) {
  if (args[i] === "--port" && args[i + 1]) {
    port = parseInt(args[i + 1], 10);
    i++;
  }
  if (args[i] === "--data-dir" && args[i + 1]) {
    dataDirArg = args[i + 1];
    i++;
  }
  if (args[i] === "--help" || args[i] === "-h") {
    console.log(`
Washoi Lobby Server

Usage:
  npm run lobby:server [options]

Options:
  --port <number>     Port to listen on (default: 9000)
  --data-dir <dir>    Server data directory: player accounts (players.db) and
                      the secret shared with the bot server
                      (default: SERVER_DATA_DIR, else ./server-data)
  --help, -h          Show this help
`);
    process.exit(0);
  }
}

// Banner
console.log("═══════════════════════════════════════════════════════");
console.log("  🎮 Washoi Lobby Server");
console.log("═══════════════════════════════════════════════════════");
console.log();

const dataDir = resolveDataDir(dataDirArg);
const players = PlayerStore.open(dataDir);
const results = MatchResultStore.open(dataDir);
const server = new LobbyServer(port, undefined, {
  botSecret: loadBotSecret(dataDir),
  players,
  results,
});
console.log(`  Data directory: ${dataDir}`);

server
  .start()
  .then(() => {
    console.log();
    console.log(`  Clients can connect to: ws://localhost:${port}`);
    console.log("  Press Ctrl+C to stop");
    console.log();
  })
  .catch((err) => {
    console.error("Failed to start lobby server:", err);
    results.close();
    players.close();
    process.exit(1);
  });

// Graceful shutdown
process.on("SIGINT", async () => {
  console.log("\n[LobbyServer] Shutting down...");
  await server.stop();
  results.close();
  players.close();
  process.exit(0);
});

process.on("SIGTERM", async () => {
  await server.stop();
  results.close();
  players.close();
  process.exit(0);
});
