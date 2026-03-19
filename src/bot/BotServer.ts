/**
 * BotServer - Bot Intelligence Server
 *
 * Main server that manages bot lifecycle. Provides a control WebSocket API
 * for adding/removing/configuring bots. Game servers or clients connect
 * to this API to request bots.
 *
 * Architecture (follows LobbyServer pattern):
 *   - CLI entry point: src/cli/bot-server.ts
 *   - Control API: WebSocket JSON messages on port 9100
 *   - BotClients: Spawned on demand, connect to game servers as real clients
 *
 * Control API Messages:
 *   → { type: 'add_bot', gameServerUrl: string, options?: BotOptions }
 *   ← { type: 'bot_added', botId: string, name: string }
 *
 *   → { type: 'remove_bot', botId: string }
 *   ← { type: 'bot_removed', botId: string }
 *
 *   → { type: 'remove_all' }
 *   ← { type: 'all_removed', count: number }
 *
 *   → { type: 'set_difficulty', botId: string, difficulty: string }
 *   ← { type: 'difficulty_set', botId: string }
 *
 *   → { type: 'status' }
 *   ← { type: 'status', bots: [...] }
 */

import { WebSocketServer, WebSocket } from 'ws';
import { BotClient } from './BotClient';
import { type BotOptions, getNextBotName } from './BotConfig';
import { createBotVision, type BotVision } from './BotVision';

// ── Control API Message Types ───────────────────────────────────────────

interface ControlMessage {
    type: string;
    [key: string]: any;
}

// ── BotServer ───────────────────────────────────────────────────────────

export class BotServer {
    private _wss: WebSocketServer | null = null;
    private _bots: Map<string, BotClient> = new Map();
    private _port: number;

    // Vision cache: mapName → BotVision (shared across all bots on same map)
    private _visionCache: Map<string, BotVision> = new Map();
    // Pending vision loads to avoid duplicate BSP loading
    private _visionLoading: Map<string, Promise<BotVision | null>> = new Map();

    constructor(port: number = 9100) {
        this._port = port;
    }

    // ── Lifecycle ─────────────────────────────────────────────────────

    async start(): Promise<void> {
        this._wss = new WebSocketServer({ port: this._port });

        this._wss.on('connection', (ws: WebSocket) => {
            console.log(`[BotServer] Control client connected`);

            ws.on('message', (data: Buffer) => {
                try {
                    const msg = JSON.parse(data.toString()) as ControlMessage;
                    this._handleControlMessage(ws, msg);
                } catch (err) {
                    this._sendResponse(ws, { type: 'error', error: 'Invalid JSON' });
                }
            });

            ws.on('close', () => {
                console.log(`[BotServer] Control client disconnected`);
            });
        });

        console.log(`[BotServer] ✓ Control API listening on port ${this._port}`);
        console.log(`[BotServer] Managing ${this._bots.size} bots`);
    }

    async stop(): Promise<void> {
        console.log(`[BotServer] Shutting down...`);

        // Disconnect all bots
        const disconnectPromises: Promise<void>[] = [];
        for (const [, bot] of this._bots) {
            disconnectPromises.push(bot.disconnect());
        }
        await Promise.all(disconnectPromises);
        this._bots.clear();

        // Close control server
        if (this._wss) {
            this._wss.close();
            this._wss = null;
        }

        console.log(`[BotServer] Stopped`);
    }

    // ── Bot Management ────────────────────────────────────────────────

    /**
     * Spawn a new bot and connect it to a game server.
     */
    async addBot(gameServerUrl: string, options?: Partial<BotOptions>): Promise<BotClient> {
        const botOptions: BotOptions = {
            name: options?.name || getNextBotName(),
            difficulty: options?.difficulty || 'medium',
            team: options?.team,
        };

        const bot = new BotClient(botOptions);

        bot.on('disconnected', () => {
            console.log(`[BotServer] Bot ${bot.name} (${bot.id}) disconnected`);
            this._bots.delete(bot.id);
        });

        try {
            await bot.connect(gameServerUrl);
            this._bots.set(bot.id, bot);
            console.log(`[BotServer] Bot ${bot.name} (${bot.id}) spawned → ${gameServerUrl}`);

            // Load vision asynchronously (don't block bot from playing)
            this._loadVisionForBot(bot);

            return bot;
        } catch (err: any) {
            console.error(`[BotServer] Failed to spawn bot ${bot.name}:`, err.message);
            throw err;
        }
    }

    /**
     * Load BotVision for a bot based on its connected server's map.
     * Caches per map name so multiple bots share the same collision world.
     */
    private async _loadVisionForBot(bot: BotClient): Promise<void> {
        const mapName = bot.serverInfo?.map;
        if (!mapName) {
            console.log(`[BotServer] No map info for ${bot.name}, vision disabled`);
            return;
        }

        // Check cache first
        const cached = this._visionCache.get(mapName);
        if (cached) {
            bot.setVision(cached);
            console.log(`[BotServer] Vision (cached) → ${bot.name} on map "${mapName}"`);
            return;
        }

        // Check if already loading
        let loadPromise = this._visionLoading.get(mapName);
        if (!loadPromise) {
            console.log(`[BotServer] Loading BotVision for map "${mapName}"...`);
            loadPromise = createBotVision(mapName);
            this._visionLoading.set(mapName, loadPromise);
        }

        try {
            const vision = await loadPromise;

            if (vision) {
                this._visionCache.set(mapName, vision);
                // Delete from loading AFTER setting cache to prevent duplicate loads
                this._visionLoading.delete(mapName);
                bot.setVision(vision);
                console.log(`[BotServer] Vision loaded → ${bot.name} on map "${mapName}"`);

                // Also set vision for any other bots on the same map
                for (const [, otherBot] of this._bots) {
                    if (otherBot !== bot && otherBot.serverInfo?.map === mapName) {
                        otherBot.setVision(vision);
                    }
                }
            } else {
                this._visionLoading.delete(mapName);
                console.warn(`[BotServer] Vision unavailable for map "${mapName}"`);
            }
        } catch (err: any) {
            this._visionLoading.delete(mapName);
            console.error(`[BotServer] Vision load failed for map "${mapName}":`, err.message);
        }
    }

    /**
     * Remove a bot by ID.
     */
    async removeBot(botId: string): Promise<boolean> {
        const bot = this._bots.get(botId);
        if (!bot) return false;

        // Remove from map first to prevent the 'disconnected' handler from also deleting
        this._bots.delete(botId);
        await bot.disconnect();
        console.log(`[BotServer] Bot ${bot.name} (${botId}) removed`);
        return true;
    }

    /**
     * Remove all bots.
     */
    async removeAllBots(): Promise<number> {
        const count = this._bots.size;
        const promises: Promise<void>[] = [];
        for (const [, bot] of this._bots) {
            promises.push(bot.disconnect());
        }
        await Promise.all(promises);
        this._bots.clear();
        console.log(`[BotServer] Removed all ${count} bots`);
        return count;
    }

    /**
     * Get status of all bots.
     */
    getStatus(): any[] {
        return Array.from(this._bots.values()).map(bot => ({
            id: bot.id,
            name: bot.name,
            state: bot.state,
            brainState: bot.brainState,
            playerId: bot.playerId,
            server: bot.serverInfo?.serverName || 'unknown',
        }));
    }

    // ── Control API ───────────────────────────────────────────────────

    private async _handleControlMessage(ws: WebSocket, msg: ControlMessage): Promise<void> {
        console.log(`[BotServer] Control: ${msg.type}`);

        switch (msg.type) {
            case 'add_bot': {
                try {
                    const bot = await this.addBot(msg.gameServerUrl, msg.options);
                    this._sendResponse(ws, {
                        type: 'bot_added',
                        botId: bot.id,
                        name: bot.name,
                    });
                } catch (err: any) {
                    this._sendResponse(ws, {
                        type: 'error',
                        error: `Failed to add bot: ${err.message}`,
                    });
                }
                break;
            }

            case 'remove_bot': {
                const removed = await this.removeBot(msg.botId);
                this._sendResponse(ws, {
                    type: removed ? 'bot_removed' : 'error',
                    botId: msg.botId,
                    error: removed ? undefined : 'Bot not found',
                });
                break;
            }

            case 'remove_all': {
                const count = await this.removeAllBots();
                this._sendResponse(ws, { type: 'all_removed', count });
                break;
            }

            case 'set_difficulty': {
                const bot = this._bots.get(msg.botId);
                if (bot) {
                    bot.setDifficulty(msg.difficulty);
                    this._sendResponse(ws, { type: 'difficulty_set', botId: msg.botId });
                } else {
                    this._sendResponse(ws, { type: 'error', error: 'Bot not found' });
                }
                break;
            }

            case 'status': {
                this._sendResponse(ws, {
                    type: 'status',
                    bots: this.getStatus(),
                });
                break;
            }

            default:
                this._sendResponse(ws, {
                    type: 'error',
                    error: `Unknown command: ${msg.type}`,
                });
        }
    }

    private _sendResponse(ws: WebSocket, msg: any): void {
        if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify(msg));
        }
    }
}
