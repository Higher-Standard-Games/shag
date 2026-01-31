/**
 * WebSocket Transport
 * 
 * Server-side WebSocket transport using Node's ws library.
 */

// Note: This file contains the interface and a mock implementation.
// The actual ws dependency would be installed in production.

// ═══════════════════════════════════════════════════════════════════
// TRANSPORT INTERFACES
// ═══════════════════════════════════════════════════════════════════

export interface TransportConfig {
    port: number;
    maxClients?: number;
    heartbeatIntervalMs?: number;
    connectionTimeoutMs?: number;
}

export interface ClientConnection {
    id: string;
    playerId?: number;
    address: string;
    connectedAt: number;
    lastMessageAt: number;
    latency: number;
    send(data: Uint8Array): void;
    close(reason?: string): void;
}

export interface TransportEvents {
    onConnect?: (client: ClientConnection) => void;
    onDisconnect?: (client: ClientConnection, reason: string) => void;
    onMessage?: (client: ClientConnection, data: Uint8Array) => void;
    onError?: (client: ClientConnection, error: Error) => void;
}

// ═══════════════════════════════════════════════════════════════════
// TRANSPORT INTERFACE
// ═══════════════════════════════════════════════════════════════════

export interface Transport {
    start(): Promise<void>;
    stop(): Promise<void>;
    broadcast(data: Uint8Array, exclude?: Set<string>): void;
    send(clientId: string, data: Uint8Array): void;
    getClients(): ReadonlyMap<string, ClientConnection>;
    getClient(id: string): ClientConnection | undefined;
    isRunning(): boolean;
}

// ═══════════════════════════════════════════════════════════════════
// WEBSOCKET TRANSPORT (Node.js implementation)
// ═══════════════════════════════════════════════════════════════════

export class WebSocketTransport implements Transport {
    private config: TransportConfig;
    private events: TransportEvents;
    private clients: Map<string, ClientConnection> = new Map();
    private running: boolean = false;
    private _server: unknown = null; // Would be WebSocketServer from 'ws'
    private heartbeatInterval: ReturnType<typeof setInterval> | null = null;
    private nextClientId: number = 1;

    constructor(config: TransportConfig, events: TransportEvents) {
        this.config = {
            maxClients: 64,
            heartbeatIntervalMs: 1000,
            connectionTimeoutMs: 30000,
            ...config,
        };
        this.events = events;
    }

    async start(): Promise<void> {
        if (this.running) return;

        // In production, this would use the 'ws' library:
        //
        // const WebSocket = await import('ws');
        // this.server = new WebSocket.WebSocketServer({ port: this.config.port });
        //
        // this.server.on('connection', (socket, req) => {
        //   this.handleConnection(socket, req);
        // });

        console.log(`[WebSocket] Server starting on port ${this.config.port}`);

        // Start heartbeat
        this.heartbeatInterval = setInterval(() => {
            this.checkHeartbeats();
        }, this.config.heartbeatIntervalMs);

        this.running = true;
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
        // if (this.server) {
        //   await new Promise<void>(resolve => this.server.close(resolve));
        // }

        this.running = false;
        console.log('[WebSocket] Server stopped');
    }

    broadcast(data: Uint8Array, exclude?: Set<string>): void {
        for (const [id, client] of this.clients) {
            if (exclude?.has(id)) continue;
            try {
                client.send(data);
            } catch {
                // Client errored, will be cleaned up on next heartbeat
            }
        }
    }

    send(clientId: string, data: Uint8Array): void {
        const client = this.clients.get(clientId);
        if (client) {
            try {
                client.send(data);
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

    /**
     * Simulate a client connecting (for testing)
     */
    simulateConnect(address: string = '127.0.0.1'): ClientConnection {
        const id = `client-${this.nextClientId++}`;
        const client = this.createMockClient(id, address);
        this.clients.set(id, client);
        this.events.onConnect?.(client);
        return client;
    }

    /**
     * Simulate receiving a message (for testing)
     */
    simulateMessage(clientId: string, data: Uint8Array): void {
        const client = this.clients.get(clientId);
        if (client) {
            (client as MockClient).lastMessageAt = Date.now();
            this.events.onMessage?.(client, data);
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

    private createMockClient(id: string, address: string): ClientConnection {
        return new MockClient(id, address, (clientId) => {
            this.clients.delete(clientId);
            this.events.onDisconnect?.(this.clients.get(clientId)!, 'Client closed');
        });
    }
}

// ═══════════════════════════════════════════════════════════════════
// MOCK CLIENT (for testing without real WebSocket)
// ═══════════════════════════════════════════════════════════════════

class MockClient implements ClientConnection {
    id: string;
    playerId?: number;
    address: string;
    connectedAt: number;
    lastMessageAt: number;
    latency: number = 0;

    private onClose: (id: string) => void;
    private outbox: Uint8Array[] = [];

    constructor(id: string, address: string, onClose: (id: string) => void) {
        this.id = id;
        this.address = address;
        this.connectedAt = Date.now();
        this.lastMessageAt = Date.now();
        this.onClose = onClose;
    }

    send(data: Uint8Array): void {
        // Would send via WebSocket, stores for testing
        this.outbox.push(data);
    }

    close(_reason?: string): void {
        this.onClose(this.id);
    }

    /**
     * Get pending outgoing messages (for testing)
     */
    getOutbox(): Uint8Array[] {
        return this.outbox;
    }

    /**
     * Clear outbox (for testing)
     */
    clearOutbox(): void {
        this.outbox = [];
    }
}
