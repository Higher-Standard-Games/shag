/**
 * WebTransport Server Transport
 * 
 * Server-side WebTransport using QUIC for low-latency game networking.
 * Supports both datagrams (unreliable) and streams (reliable).
 * 
 * Note: Requires @aspect-build/webtransport or similar library in production.
 * This provides the interface and mock for testing.
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

export class WebTransportServerTransport implements Transport {
    private config: TransportConfig;
    private events: TransportEvents;
    private clients: Map<string, ClientConnection> = new Map();
    private running: boolean = false;
    private _server: unknown = null; // Would be WebTransportServer
    private heartbeatInterval: ReturnType<typeof setInterval> | null = null;
    private nextClientId: number = 1;

    constructor(config: TransportConfig, events: TransportEvents) {
        this.config = {
            host: '0.0.0.0',
            maxClients: 64,
            heartbeatIntervalMs: 1000,
            connectionTimeoutMs: 30000,
            ...config,
        };
        this.events = events;
    }

    async start(): Promise<void> {
        if (this.running) return;

        // In production with @aspect-build/webtransport or similar:
        //
        // import { WebTransportServer } from '@aspect-build/webtransport';
        // 
        // this._server = new WebTransportServer({
        //   host: this.config.host,
        //   port: this.config.port,
        //   cert: await fs.readFile(this.config.certPath!),
        //   key: await fs.readFile(this.config.keyPath!),
        // });
        //
        // this._server.on('session', (session) => {
        //   this.handleSession(session);
        // });
        //
        // await this._server.listen();

        console.log(`[WebTransport] Server starting on ${this.config.host}:${this.config.port}`);

        // Start heartbeat
        this.heartbeatInterval = setInterval(() => {
            this.checkHeartbeats();
        }, this.config.heartbeatIntervalMs);

        this.running = true;
        console.log('[WebTransport] Server ready (QUIC/UDP mode)');
    }

    async stop(): Promise<void> {
        if (!this.running) return;

        if (this.heartbeatInterval) {
            clearInterval(this.heartbeatInterval);
            this.heartbeatInterval = null;
        }

        // Close all clients
        for (const client of this.clients.values()) {
            client.close('Server shutting down');
        }
        this.clients.clear();

        // Close server
        // if (this._server) {
        //   await this._server.close();
        // }

        this.running = false;
        console.log('[WebTransport] Server stopped');
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
    simulateConnect(address: string = '127.0.0.1'): ClientConnection {
        const id = `wt-client-${this.nextClientId++}`;
        const client = new MockWebTransportClient(id, address, (clientId) => {
            this.clients.delete(clientId);
            this.events.onDisconnect?.(this.clients.get(clientId)!, 'Client closed');
        });
        this.clients.set(id, client);
        this.events.onConnect?.(client);
        return client;
    }

    /**
     * Simulate receiving a datagram (for testing)
     */
    simulateDatagram(clientId: string, data: Uint8Array): void {
        const client = this.clients.get(clientId);
        if (client) {
            (client as MockWebTransportClient).lastMessageAt = Date.now();
            this.events.onDatagram?.(client, data);
        }
    }

    /**
     * Simulate receiving a reliable message (for testing)
     */
    simulateReliable(clientId: string, data: Uint8Array): void {
        const client = this.clients.get(clientId);
        if (client) {
            (client as MockWebTransportClient).lastMessageAt = Date.now();
            this.events.onReliable?.(client, data);
        }
    }

    /**
     * Simulate a client disconnecting (for testing)
     */
    simulateDisconnect(clientId: string, reason: string = 'Client disconnected'): void {
        const client = this.clients.get(clientId);
        if (client) {
            this.clients.delete(clientId);
            this.events.onDisconnect?.(client, reason);
        }
    }

    private checkHeartbeats(): void {
        const now = Date.now();
        const timeout = this.config.connectionTimeoutMs!;

        for (const [id, client] of this.clients) {
            if (now - client.lastMessageAt > timeout) {
                this.clients.delete(id);
                this.events.onDisconnect?.(client, 'Timeout');
            }
        }
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
        // Would send via WebTransport datagram (unreliable)
        this.datagramOutbox.push(data);
    }

    sendReliable(data: Uint8Array): void {
        // Would send via WebTransport stream (reliable)
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
