/**
 * WebSocket Server Transport
 *
 * Server-side WebSocket transport for game networking.
 * Uses the ws package for Node.js WebSocket support.
 *
 * This provides the same Transport interface as WebTransportTransport,
 * allowing easy swapping between protocols.
 */

import { WebSocket, WebSocketServer } from "ws";
import type { ClientConnection, Transport, TransportConfig, TransportEvents } from "./WebTransportTransport";

// Re-export interfaces for convenience
export type { ClientConnection, Transport, TransportConfig, TransportEvents };

// ═══════════════════════════════════════════════════════════════════
// WEBSOCKET CLIENT CONNECTION
// ═══════════════════════════════════════════════════════════════════

class WebSocketClientConnection implements ClientConnection {
  id: string;
  playerId?: number;
  address: string;
  connectedAt: number;
  lastMessageAt: number;
  latency: number = 0;

  private ws: WebSocket;

  constructor(id: string, ws: WebSocket, address: string, _events: TransportEvents) {
    this.id = id;
    this.ws = ws;
    this.address = address;
    this.connectedAt = Date.now();
    this.lastMessageAt = Date.now();
  }

  sendDatagram(data: Uint8Array): void {
    // WebSocket doesn't distinguish - treat as regular message
    if (this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(data);
    }
  }

  sendReliable(data: Uint8Array): void {
    // WebSocket is always reliable
    if (this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(data);
    }
  }

  close(reason?: string): void {
    this.ws.close(1000, reason || "Server closed connection");
  }

  updateLastMessage(): void {
    this.lastMessageAt = Date.now();
  }
}

// ═══════════════════════════════════════════════════════════════════
// WEBSOCKET SERVER TRANSPORT
// ═══════════════════════════════════════════════════════════════════

/**
 * WebSocket server transport with same interface as WebTransportTransport.
 *
 * Since WebSocket doesn't have true datagrams, both sendDatagram and
 * sendReliable use the same WebSocket send. The distinction is kept
 * for protocol compatibility with WebTransport.
 */
export class WebSocketServerTransport implements Transport {
  private config: Required<TransportConfig>;
  private events: TransportEvents;
  private clients: Map<string, WebSocketClientConnection> = new Map();
  private running: boolean = false;
  private wss: WebSocketServer | null = null;
  private nextClientId: number = 1;

  constructor(config: TransportConfig, events: TransportEvents = {}) {
    this.config = {
      port: config.port,
      host: config.host ?? "0.0.0.0",
      maxClients: config.maxClients ?? 16,
      heartbeatIntervalMs: config.heartbeatIntervalMs ?? 5000,
      connectionTimeoutMs: config.connectionTimeoutMs ?? 30000,
      certPath: config.certPath ?? "",
      keyPath: config.keyPath ?? "",
      maxDatagramSize: config.maxDatagramSize ?? 1200,
    };
    this.events = events;
  }

  async start(): Promise<void> {
    if (this.running) return;

    return new Promise((resolve, reject) => {
      try {
        this.wss = new WebSocketServer({
          port: this.config.port,
          host: this.config.host,
        });

        this.wss.on("connection", (ws, req) => {
          this.handleConnection(ws, req);
        });

        this.wss.on("error", (error) => {
          console.error("[WebSocket] Server error:", error);
          reject(error);
        });

        this.wss.on("listening", () => {
          this.running = true;
          console.log(`[WebSocket] Server ready on ${this.config.host}:${this.config.port}`);
          resolve();
        });
      } catch (error) {
        reject(error);
      }
    });
  }

  async stop(): Promise<void> {
    if (!this.running || !this.wss) return;

    return new Promise((resolve) => {
      // Close all clients
      for (const client of this.clients.values()) {
        client.close("Server shutting down");
      }
      this.clients.clear();

      // Close WebSocket server
      this.wss!.close(() => {
        this.running = false;
        this.wss = null;
        console.log("[WebSocket] Server stopped");
        resolve();
      });
    });
  }

  private handleConnection(ws: WebSocket, req: import("http").IncomingMessage): void {
    console.log(`[WebSocket] New connection from ${req.socket.remoteAddress}`);

    // Check max clients
    if (this.clients.size >= this.config.maxClients) {
      console.log(`[WebSocket] Server full, rejecting`);
      ws.close(1013, "Server full");
      return;
    }

    const clientId = `ws-${this.nextClientId++}`;
    const address = req.socket.remoteAddress || "unknown";
    const client = new WebSocketClientConnection(clientId, ws, address, this.events);

    this.clients.set(clientId, client);
    console.log(`[WebSocket] Client ${clientId} registered from ${address}`);

    // Set up message handler - use onDatagram for all game messages
    let messageCount = 0;
    ws.on("message", (data: Buffer) => {
      client.updateLastMessage();
      const bytes = new Uint8Array(data);
      messageCount++;
      // Only log occasionally to avoid spam
      if (messageCount % 1000 === 0) {
        console.log(`[WebSocket] Client ${clientId}: ${messageCount} messages received`);
      }
      this.events.onDatagram?.(client, bytes);
    });

    ws.on("close", (code, reason) => {
      console.log(`[WebSocket] Client ${clientId} disconnected: ${reason || code}`);
      this.clients.delete(clientId);
      this.events.onDisconnect?.(client, reason?.toString() || `Code: ${code}`);
    });

    ws.on("error", (error) => {
      console.log(`[WebSocket] Client ${clientId} error:`, error);
      this.events.onError?.(client, error);
    });

    // Notify connection
    this.events.onConnect?.(client);
  }

  broadcastDatagram(data: Uint8Array, exclude?: Set<string>): void {
    for (const [id, client] of this.clients) {
      if (exclude?.has(id)) continue;
      client.sendDatagram(data);
    }
  }

  broadcastReliable(data: Uint8Array, exclude?: Set<string>): void {
    for (const [id, client] of this.clients) {
      if (exclude?.has(id)) continue;
      client.sendReliable(data);
    }
  }

  sendDatagram(clientId: string, data: Uint8Array): void {
    this.clients.get(clientId)?.sendDatagram(data);
  }

  sendReliable(clientId: string, data: Uint8Array): void {
    this.clients.get(clientId)?.sendReliable(data);
  }

  getClients(): ReadonlyMap<string, ClientConnection> {
    return this.clients;
  }

  getClient(id: string): ClientConnection | undefined {
    return this.clients.get(id);
  }

  isRunning(): boolean {
    return this.running;
  }
}
