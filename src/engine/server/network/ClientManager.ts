/**
 * Client Manager
 * 
 * Manages all connected clients, handles authentication, and routes messages.
 * Uses WebTransport for low-latency game networking with:
 * - Datagrams (unreliable) for game state snapshots
 * - Reliable streams for critical messages (auth, events)
 */

import type { Transport, ClientConnection, TransportConfig } from './transport/WebTransportTransport';
import { WebTransportServerTransport } from './transport/WebTransportTransport';
import { snapshotEncoder } from './protocol/SnapshotProtocol';
import { inputDecoder, type InputCommand } from './protocol/InputProtocol';
import { MessageType } from './protocol/MessageTypes';
import { BinaryEncoder, BinaryDecoder } from './protocol/BinaryEncoder';
import type { WorldState } from '../core/WorldState';
import type { PlayerId, TickNumber } from '../ecs/types';
import { playerId, tickNumber } from '../ecs/types';

// ═══════════════════════════════════════════════════════════════════
// CLIENT INFO
// ═══════════════════════════════════════════════════════════════════

export interface ClientInfo {
    connection: ClientConnection;
    playerId: PlayerId;
    name: string;
    authenticated: boolean;
    lastInputTick: TickNumber;
    lastAckedTick: TickNumber;
    pendingInputs: InputCommand[];
    rttMs: number;
}

// ═══════════════════════════════════════════════════════════════════
// CLIENT MANAGER EVENTS
// ═══════════════════════════════════════════════════════════════════

export interface ClientManagerEvents {
    onPlayerJoin?: (info: ClientInfo) => void;
    onPlayerLeave?: (info: ClientInfo, reason: string) => void;
    onInputReceived?: (playerId: PlayerId, inputs: InputCommand[]) => void;
}

// ═══════════════════════════════════════════════════════════════════
// CLIENT MANAGER
// ═══════════════════════════════════════════════════════════════════

export class ClientManager {
    private transport: Transport;
    private clients: Map<string, ClientInfo> = new Map();
    private playerIdToClient: Map<PlayerId, string> = new Map();
    private events: ClientManagerEvents;
    private nextPlayerId: number = 1;
    private stateBaselines: Map<PlayerId, WorldState> = new Map();

    constructor(
        transportConfig: TransportConfig,
        events: ClientManagerEvents = {}
    ) {
        this.events = events;

        // Use WebTransport (QUIC/UDP) as primary transport
        this.transport = new WebTransportServerTransport(transportConfig, {
            onConnect: (conn) => this.handleConnect(conn),
            onDisconnect: (conn, reason) => this.handleDisconnect(conn, reason),
            // Datagrams for game state (unreliable, low latency)
            onDatagram: (conn, data) => this.handleDatagram(conn, data),
            // Reliable stream for auth, events (ordered, guaranteed)
            onReliable: (conn, data) => this.handleReliable(conn, data),
            onError: (conn, error) => console.error(`[ClientManager] Error from ${conn.id}:`, error),
        });
    }

    /**
     * Start listening for connections
     */
    async start(): Promise<void> {
        await this.transport.start();
        console.log('[ClientManager] Started (WebTransport/QUIC mode)');
    }

    /**
     * Stop and disconnect all clients
     */
    async stop(): Promise<void> {
        await this.transport.stop();
        this.clients.clear();
        this.playerIdToClient.clear();
        this.stateBaselines.clear();
        console.log('[ClientManager] Stopped');
    }

    /**
     * Collect all pending inputs from clients
     */
    collectInputs(): Map<PlayerId, InputCommand[]> {
        const allInputs = new Map<PlayerId, InputCommand[]>();

        for (const client of this.clients.values()) {
            if (client.pendingInputs.length > 0) {
                allInputs.set(client.playerId, [...client.pendingInputs]);
                client.pendingInputs = [];
            }
        }

        return allInputs;
    }

    /**
     * Get latest input for each player (for simulation)
     */
    getLatestInputs(): Map<PlayerId, InputCommand> {
        const inputs = new Map<PlayerId, InputCommand>();

        for (const client of this.clients.values()) {
            if (client.pendingInputs.length > 0) {
                // Take the most recent input
                inputs.set(client.playerId, client.pendingInputs[client.pendingInputs.length - 1]);
            }
        }

        return inputs;
    }

    /**
     * Broadcast snapshot to all clients (via datagrams - fast, unreliable)
     */
    broadcastSnapshot(state: Readonly<WorldState>): void {
        for (const client of this.clients.values()) {
            if (!client.authenticated) continue;

            const baseline = this.stateBaselines.get(client.playerId);
            let bytes: Uint8Array;

            if (baseline && (state.tick as number) - (baseline.tick as number) < 128) {
                // Send delta
                bytes = snapshotEncoder.encodeDeltaSnapshot(state as WorldState, baseline);
            } else {
                // Send full snapshot
                bytes = snapshotEncoder.encodeFullSnapshot(state);
            }

            // Use datagram for snapshots (unreliable, low latency)
            this.transport.sendDatagram(client.connection.id, bytes);

            // Update baseline (will be confirmed by client ack)
            this.stateBaselines.set(client.playerId, (state as WorldState).clone());
        }
    }

    /**
     * Send snapshot to specific client
     */
    sendSnapshotToClient(clientId: string, state: Readonly<WorldState>): void {
        const bytes = snapshotEncoder.encodeFullSnapshot(state);
        this.transport.sendDatagram(clientId, bytes);
    }

    /**
     * Send reliable message to specific client
     */
    sendReliableToClient(clientId: string, data: Uint8Array): void {
        this.transport.sendReliable(clientId, data);
    }

    /**
     * Broadcast reliable message to all clients (for events, chat, etc.)
     */
    broadcastReliable(data: Uint8Array, exclude?: Set<string>): void {
        this.transport.broadcastReliable(data, exclude);
    }

    /**
     * Get all connected players
     */
    getConnectedPlayers(): ReadonlyMap<PlayerId, ClientInfo> {
        const result = new Map<PlayerId, ClientInfo>();
        for (const client of this.clients.values()) {
            if (client.authenticated) {
                result.set(client.playerId, client);
            }
        }
        return result;
    }

    /**
     * Get client count
     */
    get clientCount(): number {
        return this.clients.size;
    }

    /**
     * Get authenticated player count
     */
    get playerCount(): number {
        let count = 0;
        for (const client of this.clients.values()) {
            if (client.authenticated) count++;
        }
        return count;
    }

    /**
     * Kick a player
     */
    kickPlayer(pid: PlayerId, reason: string = 'Kicked by server'): void {
        const clientId = this.playerIdToClient.get(pid);
        if (clientId) {
            const client = this.clients.get(clientId);
            if (client) {
                client.connection.close(reason);
            }
        }
    }

    /**
     * Handle new connection
     */
    private handleConnect(conn: ClientConnection): void {
        const pid = playerId(this.nextPlayerId++);

        const info: ClientInfo = {
            connection: conn,
            playerId: pid,
            name: `Player${pid}`,
            authenticated: false,
            lastInputTick: tickNumber(0),
            lastAckedTick: tickNumber(0),
            pendingInputs: [],
            rttMs: 0,
        };

        this.clients.set(conn.id, info);
        this.playerIdToClient.set(pid, conn.id);

        console.log(`[ClientManager] Client connected: ${conn.id} (Player ${pid})`);

        // Send welcome message via reliable stream
        const encoder = new BinaryEncoder(64);
        encoder.writeUint8(MessageType.S_Welcome);
        encoder.writeVarUint(pid as number);
        encoder.writeString('Welcome to the server!');
        conn.sendReliable(encoder.toBytes());

        // For now, auto-authenticate
        info.authenticated = true;
        this.events.onPlayerJoin?.(info);
    }

    /**
     * Handle disconnection
     */
    private handleDisconnect(conn: ClientConnection, reason: string): void {
        const info = this.clients.get(conn.id);
        if (!info) return;

        console.log(`[ClientManager] Client disconnected: ${conn.id} (${reason})`);

        this.clients.delete(conn.id);
        this.playerIdToClient.delete(info.playerId);
        this.stateBaselines.delete(info.playerId);

        if (info.authenticated) {
            this.events.onPlayerLeave?.(info, reason);
        }
    }

    /**
     * Handle incoming datagram (unreliable - for inputs)
     */
    private handleDatagram(conn: ClientConnection, data: Uint8Array): void {
        const info = this.clients.get(conn.id);
        if (!info) return;

        const decoder = new BinaryDecoder(data);
        const msgType = decoder.readUint8();

        // Only input messages come via datagram
        if (msgType === MessageType.C_Input) {
            this.handleInputMessage(info, data);
        }
    }

    /**
     * Handle incoming reliable message (for auth, acks, pong)
     */
    private handleReliable(conn: ClientConnection, data: Uint8Array): void {
        const info = this.clients.get(conn.id);
        if (!info) return;

        const decoder = new BinaryDecoder(data);
        const msgType = decoder.readUint8();

        switch (msgType) {
            case MessageType.C_Ack:
                this.handleAckMessage(info, decoder);
                break;
            case MessageType.C_Auth:
                this.handleAuthMessage(info, decoder);
                break;
            case MessageType.C_Pong:
                this.handlePongMessage(info, decoder);
                break;
            default:
                console.warn(`[ClientManager] Unknown reliable message type: ${msgType}`);
        }
    }

    private handleInputMessage(info: ClientInfo, data: Uint8Array): void {
        const batch = inputDecoder.decode(data);

        // Update RTT from client timestamp if available
        if (batch.commands.length > 0) {
            const lastCmd = batch.commands[batch.commands.length - 1];
            info.lastInputTick = tickNumber(lastCmd.sequence);
        }

        // Add to pending inputs
        info.pendingInputs.push(...batch.commands);

        // Notify callback
        this.events.onInputReceived?.(info.playerId, batch.commands);
    }

    private handleAckMessage(info: ClientInfo, decoder: BinaryDecoder): void {
        const tick = tickNumber(decoder.readUint32());
        info.lastAckedTick = tick;
    }

    private handleAuthMessage(info: ClientInfo, decoder: BinaryDecoder): void {
        const name = decoder.readString();
        info.name = name || `Player${info.playerId}`;
        info.authenticated = true;

        console.log(`[ClientManager] Player authenticated: ${info.name}`);
        this.events.onPlayerJoin?.(info);
    }

    private handlePongMessage(info: ClientInfo, decoder: BinaryDecoder): void {
        const clientTime = decoder.readUint32();
        const serverTime = Date.now();
        info.rttMs = serverTime - clientTime;
        info.connection.latency = info.rttMs;
    }
}
