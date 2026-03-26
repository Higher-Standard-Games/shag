/**
 * Headless Network Client CLI
 *
 * Test client for validating the networking stack.
 * Connects to a server, receives snapshots, and logs game state.
 *
 * Usage:
 *   npm run net:client -- --connect ws://localhost:7777
 *   npm run net:client -- --connect ws://localhost:7777 --name Player1
 */

import { WebSocket } from "ws";
import { BinaryEncoder } from "../engine/network/protocol/BinaryProtocol";
import { MessageCodec, MessageType } from "../engine/network/protocol/MessageCodec";

// Parse command line arguments
const args = process.argv.slice(2);
let serverUrl = "ws://localhost:7777";
let playerName = `Player_${Math.random().toString(36).substring(7)}`;

for (let i = 0; i < args.length; i++) {
  if (args[i] === "--connect" && args[i + 1]) {
    serverUrl = args[i + 1];
    i++;
  } else if (args[i] === "--name" && args[i + 1]) {
    playerName = args[i + 1];
    i++;
  } else if (args[i] === "--help" || args[i] === "-h") {
    console.log(`
Headless Network Client

Usage:
  npx vite-node src/cli/headless-netclient.ts [options]

Options:
  --connect <url>   Server URL (default: ws://localhost:7777)
  --name <name>     Player name (default: random)
  --help, -h        Show this help
`);
    process.exit(0);
  }
}

console.log(`[Client] Connecting to ${serverUrl}...`);
console.log(`[Client] Player name: ${playerName}`);

// State tracking
let clientId: string | null = null;
let playerId: string | null = null;
let entityId: string | null = null;
let tickCount = 0;
let lastSnapshotTime = 0;

// Connect to server
const ws = new WebSocket(serverUrl);
ws.binaryType = "arraybuffer";

ws.on("open", () => {
  console.log("[Client] Connected! Waiting for welcome...");
});

ws.on("message", (data: Buffer) => {
  const uint8 = new Uint8Array(data);
  handleMessage(uint8);
});

ws.on("close", (code, reason) => {
  console.log(`[Client] Disconnected: ${code} - ${reason}`);
  process.exit(0);
});

ws.on("error", (error) => {
  console.error("[Client] Connection error:", error.message);
  process.exit(1);
});

/**
 * Handle incoming message from server
 */
function handleMessage(data: Uint8Array): void {
  try {
    const messageType = MessageCodec.peekMessageType(data);

    switch (messageType) {
      case MessageType.Welcome: {
        const welcome = MessageCodec.decodeWelcome(data);
        console.log(`[Client] Received welcome:`);
        console.log(`         Server: ${welcome.serverName}`);
        console.log(`         Map: ${welcome.map}`);
        console.log(`         Tick rate: ${welcome.tickRate} Hz`);
        console.log(`         Players: ${welcome.currentPlayers}/${welcome.maxPlayers}`);

        // Send join request
        sendJoin();
        break;
      }

      case MessageType.JoinAccept: {
        const accept = MessageCodec.decodeJoinAccept(data);
        clientId = accept.clientId;
        playerId = accept.playerId;
        entityId = accept.entityId;
        console.log(`[Client] Join accepted:`);
        console.log(`         Client ID: ${clientId}`);
        console.log(`         Player ID: ${playerId}`);
        console.log(`         Entity ID: ${entityId}`);
        break;
      }

      case MessageType.JoinReject: {
        console.log("[Client] Join rejected!");
        ws.close();
        break;
      }

      case MessageType.Snapshot: {
        const snapshot = MessageCodec.decodeSnapshot(data);
        tickCount++;
        const now = Date.now();
        const delta = lastSnapshotTime > 0 ? now - lastSnapshotTime : 0;
        lastSnapshotTime = now;

        // Log every 20th snapshot (once per second at 20Hz)
        if (tickCount % 20 === 0) {
          console.log(
            `[Client] Tick ${snapshot.tick}: ${snapshot.entities.size} entities, ${snapshot.players.size} players (${delta}ms)`,
          );
        }

        // Send acknowledgment
        sendAck(snapshot.tick);
        break;
      }

      case MessageType.PlayerJoined: {
        console.log("[Client] Another player joined");
        break;
      }

      case MessageType.PlayerLeft: {
        console.log("[Client] A player left");
        break;
      }

      case MessageType.GameStart: {
        console.log("[Client] Game started!");
        break;
      }

      default:
        console.log(`[Client] Unknown message type: 0x${messageType.toString(16)}`);
    }
  } catch (error) {
    console.error("[Client] Failed to handle message:", error);
  }
}

/**
 * Send join request to server
 */
function sendJoin(): void {
  console.log(`[Client] Sending join request...`);
  const data = MessageCodec.encodeJoin(playerName);
  ws.send(data);
}

/**
 * Send acknowledgment for received snapshot
 */
function sendAck(tick: number): void {
  const data = MessageCodec.encodeAck(tick);
  ws.send(data);
}

/**
 * Send a test input command
 */
function sendTestInput(): void {
  if (!playerId) return;

  const encoder = new BinaryEncoder();
  encoder.writeUint8(MessageType.Input);
  encoder.writeString(playerId);
  encoder.writeUint16(tickCount); // sequence
  encoder.writeString(
    JSON.stringify({
      type: "move",
      direction: { x: 1, y: 0, z: 0 },
      pitch: 0,
      yaw: 0,
      buttons: 0,
    }),
  );

  ws.send(encoder.getData());
}

// Send periodic test inputs (every 50ms)
setInterval(() => {
  if (playerId) {
    sendTestInput();
  }
}, 50);

// Graceful shutdown
process.on("SIGINT", () => {
  console.log("\n[Client] Shutting down...");
  ws.close();
  process.exit(0);
});

console.log("[Client] Press Ctrl+C to exit");
