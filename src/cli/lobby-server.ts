/**
 * Lobby Server CLI
 *
 * Starts the WebSocket lobby server.
 *
 * Usage:
 *   npm run lobby:server
 *   npm run lobby:server -- --port 9001
 */

import { LobbyServer } from "../lobby/LobbyServer";

// Parse arguments
const args = process.argv.slice(2);
let port = 9000;

for (let i = 0; i < args.length; i++) {
  if (args[i] === "--port" && args[i + 1]) {
    port = parseInt(args[i + 1], 10);
    i++;
  }
  if (args[i] === "--help" || args[i] === "-h") {
    console.log(`
Washoi Lobby Server

Usage:
  npm run lobby:server [options]

Options:
  --port <number>   Port to listen on (default: 9000)
  --help, -h        Show this help
`);
    process.exit(0);
  }
}

// Banner
console.log("═══════════════════════════════════════════════════════");
console.log("  🎮 Washoi Lobby Server");
console.log("═══════════════════════════════════════════════════════");
console.log();

const server = new LobbyServer(port);

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
    process.exit(1);
  });

// Graceful shutdown
process.on("SIGINT", async () => {
  console.log("\n[LobbyServer] Shutting down...");
  await server.stop();
  process.exit(0);
});

process.on("SIGTERM", async () => {
  await server.stop();
  process.exit(0);
});
