/**
 * WebTransport Server Transport
 *
 * Server-side WebTransport using QUIC for low-latency game networking.
 * Supports both datagrams (unreliable) and streams (reliable).
 *
 * Uses @fails-components/webtransport for Node.js QUIC support.
 *
 * Installation:
 *   npm install @aspect-build/webtransport @fails-components/webtransport
 *
 * Note: WebTransport requires TLS certificates. For development, use mkcert.
 */

// ═══════════════════════════════════════════════════════════════════
// TRANSPORT INTERFACES
// ═══════════════════════════════════════════════════════════════════

export interface TransportConfig {
  port: number;
  host?: string;
  maxClients?: number;
  heartbeatIntervalMs?: number;
  connectionTimeoutMs?: number;
  /** Path to TLS certificate (required for WebTransport) */
  certPath?: string;
  /** Path to TLS private key (required for WebTransport) */
  keyPath?: string;
  /** Max datagram size in bytes (default: 1200 for QUIC) */
  maxDatagramSize?: number;
}

export interface ClientConnection {
  id: string;
  playerId?: number;
  address: string;
  connectedAt: number;
  lastMessageAt: number;
  latency: number;

  /** Send unreliable datagram (UDP-like, fast, may be lost) */
  sendDatagram(data: Uint8Array): void;

  /** Send reliable message (ordered, guaranteed delivery) */
  sendReliable(data: Uint8Array): void;

  /** Close connection */
  close(reason?: string): void;
}

export interface TransportEvents {
  onConnect?: (client: ClientConnection) => void;
  onDisconnect?: (client: ClientConnection, reason: string) => void;
  onDatagram?: (client: ClientConnection, data: Uint8Array) => void;
  onReliable?: (client: ClientConnection, data: Uint8Array) => void;
  onError?: (client: ClientConnection, error: Error) => void;
}

// ═══════════════════════════════════════════════════════════════════
// TRANSPORT INTERFACE
// ═══════════════════════════════════════════════════════════════════

export interface Transport {
  start(): Promise<void>;
  stop(): Promise<void>;

  /** Broadcast unreliable datagram to all clients */
  broadcastDatagram(data: Uint8Array, exclude?: Set<string>): void;

  /** Broadcast reliable message to all clients */
  broadcastReliable(data: Uint8Array, exclude?: Set<string>): void;

  /** Send unreliable datagram to specific client */
  sendDatagram(clientId: string, data: Uint8Array): void;

  /** Send reliable message to specific client */
  sendReliable(clientId: string, data: Uint8Array): void;

  getClients(): ReadonlyMap<string, ClientConnection>;
  getClient(id: string): ClientConnection | undefined;
  isRunning(): boolean;
}

// ═══════════════════════════════════════════════════════════════════
// WEBTRANSPORT SERVER TRANSPORT
// ═══════════════════════════════════════════════════════════════════

/**
 * WebTransport server using @fails-components/webtransport.
 *
 * Features:
 * - Datagrams for game state (unreliable, fast)
 * - Streams for auth/events (reliable, ordered)
 * - QUIC-based (UDP, no head-of-line blocking)
 */
export class WebTransportServerTransport implements Transport {
  private config: Required<TransportConfig>;
  private events: TransportEvents;
  private clients: Map<string, WebTransportClientConnection> = new Map();
  private running: boolean = false;
  // biome-ignore lint/suspicious/noExplicitAny: WebTransport server instance from optional dynamic import
  private server: any = null; // WebTransportServer instance
  private heartbeatInterval: ReturnType<typeof setInterval> | null = null;
  private nextClientId: number = 1;

  constructor(config: TransportConfig, events: TransportEvents) {
    this.config = {
      host: "0.0.0.0",
      maxClients: 64,
      heartbeatIntervalMs: 1000,
      connectionTimeoutMs: 30000,
      certPath: "",
      keyPath: "",
      maxDatagramSize: 1200,
      ...config,
    };
    this.events = events;
  }

  async start(): Promise<void> {
    if (this.running) return;

    try {
      // Try to load @fails-components/webtransport
      const { WebTransportServer } = await this.loadWebTransportModule();

      if (WebTransportServer) {
        // Real WebTransport with TLS
        this.server = await this.createRealServer(WebTransportServer);
      } else {
        // Fallback to mock mode for testing
        console.log("[WebTransport] Running in mock mode (no @fails-components/webtransport)");
      }
    } catch (e) {
      console.log("[WebTransport] Running in mock mode:", (e as Error).message);
    }

    // Start heartbeat for timeout detection
    this.heartbeatInterval = setInterval(() => {
      this.checkHeartbeats();
    }, this.config.heartbeatIntervalMs);

    this.running = true;
    console.log(`[WebTransport] Server ready on ${this.config.host}:${this.config.port}`);
  }

  // biome-ignore lint/suspicious/noExplicitAny: WebTransportServer class from optional dynamic import
  private async loadWebTransportModule(): Promise<{ WebTransportServer: any }> {
    try {
      // Dynamic import for optional dependency
      // @ts-expect-error - Optional dependency, may not be installed
      const module = await import("@aspect-build/webtransport");
      return { WebTransportServer: module.WebTransportServer };
    } catch {
      try {
        // Try @fails-components/webtransport as fallback
        // @ts-expect-error - Optional dependency, may not be installed
        const module = await import("@fails-components/webtransport");
        return { WebTransportServer: module.Http3Server };
      } catch {
        return { WebTransportServer: null };
      }
    }
  }

  // biome-ignore lint/suspicious/noExplicitAny: WebTransportServer class and return from optional dynamic import
  private async createRealServer(WebTransportServer: any): Promise<any> {
    const fs = await import("node:fs").then((m) => m.promises);

    // Load TLS certificates
    const cert = this.config.certPath ? await fs.readFile(this.config.certPath) : undefined;
    const key = this.config.keyPath ? await fs.readFile(this.config.keyPath) : undefined;

    if (!cert || !key) {
      throw new Error("WebTransport requires TLS certificates (certPath, keyPath)");
    }

    const server = new WebTransportServer({
      host: this.config.host,
      port: this.config.port,
      cert,
      key,
    });

    // Handle incoming sessions
    // biome-ignore lint/suspicious/noExplicitAny: WebTransport session from @fails-components/webtransport
    server.on("session", async (session: any) => {
      const clientId = `wt-${this.nextClientId++}`;

      if (this.clients.size >= this.config.maxClients) {
        session.close({ closeCode: 503, reason: "Server full" });
        return;
      }

      const client = new WebTransportClientConnection(clientId, session.remoteAddress || "unknown", session, (id) =>
        this.handleDisconnect(id, "Session closed"),
      );

      this.clients.set(clientId, client);
      this.events.onConnect?.(client);

      // Handle incoming datagrams
      this.handleSessionDatagrams(session, client);

      // Handle incoming streams (reliable)
      this.handleSessionStreams(session, client);

      // Handle session close
      session.once("close", () => {
        this.handleDisconnect(clientId, "Session closed");
      });
    });

    await server.listen();
    console.log(`[WebTransport] QUIC server listening on ${this.config.host}:${this.config.port}`);
    return server;
  }

  // biome-ignore lint/suspicious/noExplicitAny: WebTransport session API from optional dependency
  private async handleSessionDatagrams(session: any, client: WebTransportClientConnection): Promise<void> {
    try {
      const reader = session.datagrams.readable.getReader();

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        if (value) {
          client.lastMessageAt = Date.now();
          this.events.onDatagram?.(client, value);
        }
      }
    } catch (_e) {
      // Session closed or error
    }
  }

  // biome-ignore lint/suspicious/noExplicitAny: WebTransport session API from optional dependency
  private async handleSessionStreams(session: any, client: WebTransportClientConnection): Promise<void> {
    try {
      const reader = session.incomingBidirectionalStreams.getReader();

      while (true) {
        const { value: stream, done } = await reader.read();
        if (done) break;

        // Handle stream in background
        this.handleStream(stream, client);
      }
    } catch (_e) {
      // Session closed or error
    }
  }

  // biome-ignore lint/suspicious/noExplicitAny: WebTransport stream API from optional dependency
  private async handleStream(stream: any, client: WebTransportClientConnection): Promise<void> {
    try {
      const reader = stream.readable.getReader();

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        if (value) {
          client.lastMessageAt = Date.now();
          this.events.onReliable?.(client, value);
        }
      }
    } catch (_e) {
      // Stream error
    }
  }

  private handleDisconnect(clientId: string, reason: string): void {
    const client = this.clients.get(clientId);
    if (client) {
      this.clients.delete(clientId);
      this.events.onDisconnect?.(client, reason);
    }
  }

  async stop(): Promise<void> {
    if (!this.running) return;

    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }

    // Close all clients
    for (const client of this.clients.values()) {
      client.close("Server shutting down");
    }
    this.clients.clear();

    // Close server
    if (this.server) {
      await this.server.close?.();
      this.server = null;
    }

    this.running = false;
    console.log("[WebTransport] Server stopped");
  }

  broadcastDatagram(data: Uint8Array, exclude?: Set<string>): void {
    for (const [id, client] of this.clients) {
      if (exclude?.has(id)) continue;
      try {
        client.sendDatagram(data);
      } catch {
        // Client errored, will be cleaned up on next heartbeat
      }
    }
  }

  broadcastReliable(data: Uint8Array, exclude?: Set<string>): void {
    for (const [id, client] of this.clients) {
      if (exclude?.has(id)) continue;
      try {
        client.sendReliable(data);
      } catch {
        // Client errored
      }
    }
  }

  sendDatagram(clientId: string, data: Uint8Array): void {
    const client = this.clients.get(clientId);
    if (client) {
      try {
        client.sendDatagram(data);
      } catch {
        // Client errored
      }
    }
  }

  sendReliable(clientId: string, data: Uint8Array): void {
    const client = this.clients.get(clientId);
    if (client) {
      try {
        client.sendReliable(data);
      } catch {
        // Client errored
      }
    }
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

  // ═══════════════════════════════════════════════════════════════════
  // TEST HELPERS (for simulation without real WebTransport)
  // ═══════════════════════════════════════════════════════════════════

  /**
   * Simulate a client connecting (for testing)
   */
  simulateConnect(address: string = "127.0.0.1"): ClientConnection {
    const id = `wt-client-${this.nextClientId++}`;
    const client = new MockWebTransportClient(id, address, (clientId) => {
      this.clients.delete(clientId);
      if (this.clients.has(clientId)) {
        this.events.onDisconnect?.(this.clients.get(clientId)!, "Client closed");
      }
    });
    this.clients.set(id, client as unknown as WebTransportClientConnection);
    this.events.onConnect?.(client);
    return client;
  }

  /**
   * Simulate receiving a datagram (for testing)
   */
  simulateDatagram(clientId: string, data: Uint8Array): void {
    const client = this.clients.get(clientId);
    if (client) {
      client.lastMessageAt = Date.now();
      this.events.onDatagram?.(client, data);
    }
  }

  /**
   * Simulate receiving a reliable message (for testing)
   */
  simulateReliable(clientId: string, data: Uint8Array): void {
    const client = this.clients.get(clientId);
    if (client) {
      client.lastMessageAt = Date.now();
      this.events.onReliable?.(client, data);
    }
  }

  /**
   * Simulate a client disconnecting (for testing)
   */
  simulateDisconnect(clientId: string, reason: string = "Client disconnected"): void {
    const client = this.clients.get(clientId);
    if (client) {
      this.clients.delete(clientId);
      this.events.onDisconnect?.(client, reason);
    }
  }

  private checkHeartbeats(): void {
    const now = Date.now();
    const timeout = this.config.connectionTimeoutMs;

    for (const [id, client] of this.clients) {
      if (now - client.lastMessageAt > timeout) {
        this.clients.delete(id);
        this.events.onDisconnect?.(client, "Timeout");
      }
    }
  }
}

// ═══════════════════════════════════════════════════════════════════
// WEBTRANSPORT CLIENT CONNECTION (Real)
// ═══════════════════════════════════════════════════════════════════

class WebTransportClientConnection implements ClientConnection {
  id: string;
  playerId?: number;
  address: string;
  connectedAt: number;
  lastMessageAt: number;
  latency: number = 0;

  // biome-ignore lint/suspicious/noExplicitAny: WebTransport session from optional dependency
  private session: any;

  private onClose: (id: string) => void;

  // biome-ignore lint/suspicious/noExplicitAny: WebTransport session from optional dependency
  constructor(id: string, address: string, session: any, onClose: (id: string) => void) {
    this.id = id;
    this.address = address;
    this.session = session;
    this.connectedAt = Date.now();
    this.lastMessageAt = Date.now();
    this.onClose = onClose;
  }

  sendDatagram(data: Uint8Array): void {
    try {
      // Datagrams are sent directly (unreliable)
      this.session.datagrams.writable
        .getWriter()
        .write(data)
        .catch(() => {
          /* ignore failed writes */
        });
    } catch {
      // Session closed
    }
  }

  async sendReliable(data: Uint8Array): Promise<void> {
    try {
      // Create a unidirectional stream for reliable message
      const stream = await this.session.createUnidirectionalStream();
      const writer = stream.writable.getWriter();
      await writer.write(data);
      await writer.close();
    } catch {
      // Failed to send
    }
  }

  close(reason?: string): void {
    try {
      this.session.close({ closeCode: 1000, reason: reason || "Normal closure" });
    } catch {
      // Already closed
    }
    this.onClose(this.id);
  }
}

// ═══════════════════════════════════════════════════════════════════
// MOCK CLIENT (for testing without real WebTransport)
// ═══════════════════════════════════════════════════════════════════

class MockWebTransportClient implements ClientConnection {
  id: string;
  playerId?: number;
  address: string;
  connectedAt: number;
  lastMessageAt: number;
  latency: number = 0;

  private onClose: (id: string) => void;
  private datagramOutbox: Uint8Array[] = [];
  private reliableOutbox: Uint8Array[] = [];

  constructor(id: string, address: string, onClose: (id: string) => void) {
    this.id = id;
    this.address = address;
    this.connectedAt = Date.now();
    this.lastMessageAt = Date.now();
    this.onClose = onClose;
  }

  sendDatagram(data: Uint8Array): void {
    this.datagramOutbox.push(data);
  }

  sendReliable(data: Uint8Array): void {
    this.reliableOutbox.push(data);
  }

  close(_reason?: string): void {
    this.onClose(this.id);
  }

  /**
   * Get pending outgoing datagrams (for testing)
   */
  getDatagramOutbox(): Uint8Array[] {
    return this.datagramOutbox;
  }

  /**
   * Get pending reliable messages (for testing)
   */
  getReliableOutbox(): Uint8Array[] {
    return this.reliableOutbox;
  }

  /**
   * Clear outboxes (for testing)
   */
  clearOutboxes(): void {
    this.datagramOutbox = [];
    this.reliableOutbox = [];
  }
}
