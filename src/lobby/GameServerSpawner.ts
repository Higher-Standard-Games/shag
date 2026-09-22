/**
 * GameServerSpawner — Spawns game server instances as child processes
 *
 * Used by the lobby server to start game servers when all players are ready.
 * Runs `npx vite-node src/cli/headless-netserver-v2.ts` with lobby-decided parameters.
 *
 * Handles:
 *   - Port allocation (7777, 7778, ...)
 *   - Process lifecycle (spawn, ready detection, shutdown)
 *   - Stdout monitoring for ready signal
 */

import { type ChildProcess, spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { issueMatchAdmission, type MatchSeat } from "../engine/server/network/MatchAdmission";
import { type MatchResultReport, RESULT_PREFIX, verifyMatchResult } from "../engine/server/network/MatchResultReport";

// ============================================================================
// Types
// ============================================================================

export interface SpawnConfig {
  map: string;
  gametype: string;
  maxClients?: number;
  /** Auto-exit when all clients disconnect. Defaults to true. */
  shutdown?: boolean;
  /** One match per server: post-game is terminal and players return to the
   *  lobby (docs/research/single_game_server_lobby.md). Defaults to true —
   *  every lobby/dev spawn is per-match during alpha. */
  singleMatch?: boolean;
  /** Verified lobby roster. Omitted for standalone/dev servers. */
  admissionSeats?: MatchSeat[];
}

export interface SpawnedServer {
  matchId: string;
  process: ChildProcess;
  port: number;
  map: string;
  gametype: string;
  url: string; // e.g. 'ws://localhost:7777'
  startedAt: number;
  /** Private tickets to deliver individually; never broadcast with server listings. */
  admissionTickets?: Map<string, string>;
}

export function buildPublicGameServerUrl(port: number): string {
  const protocol = (process.env.SHAG_PUBLIC_GAME_PROTOCOL || "ws").trim().replace(/:\/?\/?$/, "");
  const host = (process.env.SHAG_PUBLIC_GAME_HOST || "localhost")
    .trim()
    .replace(/^wss?:\/\//, "")
    .replace(/\/+$/, "");
  return `${protocol}://${host}:${port}`;
}

// ============================================================================
// GameServerSpawner
// ============================================================================

export class GameServerSpawner {
  /** Kept outside public SpawnedServer listings, removed on delivery or exit. */
  private readonly recoveryByMatch = new Map<
    string,
    Map<number, { ticket: string; availableAt: number; expiresAt: number }>
  >();
  private nextPort: number;
  private activeServers: Map<string, SpawnedServer> = new Map();
  private projectRoot: string;

  constructor(startPort: number = 7777) {
    this.nextPort = startPort;
    this.projectRoot = process.cwd();
  }

  /** Spawn a new game server with the given config. Resolves when server is ready. */
  async spawn(config: SpawnConfig): Promise<SpawnedServer> {
    const port = this.allocatePort();
    const matchId = this.generateMatchId();
    const admission = config.admissionSeats
      ? issueMatchAdmission(matchId, config.admissionSeats, Date.now(), 2 * 60_000, 30 * 60_000)
      : null;
    const resultSecret = admission ? randomBytes(32).toString("base64url") : null;

    console.log(`[Spawner] Starting game server: map=${config.map} gametype=${config.gametype} port=${port}`);

    const args = [
      "vite-node",
      "src/cli/headless-netserver-v2.ts",
      "--map",
      config.map,
      "--gametype",
      config.gametype,
      "--port",
      String(port),
    ];

    if (config.shutdown ?? true) {
      args.push("--shutdown");
    }

    if (config.singleMatch ?? true) {
      args.push("--single-match");
    }

    if (config.maxClients) {
      args.push("--max", String(config.maxClients));
    }

    const childEnv = { ...process.env };
    delete childEnv.SHAG_MATCH_ADMISSION;
    delete childEnv.SHAG_MATCH_RESULT_SECRET;
    if (admission) childEnv.SHAG_MATCH_ADMISSION = JSON.stringify(admission.manifest);
    if (resultSecret) childEnv.SHAG_MATCH_RESULT_SECRET = resultSecret;
    const child = spawn("npx", args, {
      cwd: this.projectRoot,
      stdio: ["pipe", "pipe", "pipe"],
      shell: true,
      env: childEnv,
    });

    const server: SpawnedServer = {
      matchId,
      process: child,
      port,
      map: config.map,
      gametype: config.gametype,
      url: buildPublicGameServerUrl(port),
      startedAt: Date.now(),
      admissionTickets: admission?.tickets,
    };

    // Wait for ready signal in stdout
    await this.waitForReady(child, matchId, port, (line) => {
      if (!admission || !resultSecret || !this.activeServers.has(matchId)) return;
      const report = verifyMatchResult(line, resultSecret, {
        matchId,
        map: config.map,
        gametype: config.gametype,
        startedAt: server.startedAt,
        admission: admission.manifest,
      });
      if (report) this.onServerResult?.(report);
      else console.warn(`[Spawner] Rejected result for match ${matchId}`);
    });

    this.activeServers.set(matchId, server);
    if (admission) this.recoveryByMatch.set(matchId, admission.recoveryTickets);
    console.log(`[Spawner] Server ready: ${server.url} (match: ${matchId})`);

    // Monitor process exit
    child.on("exit", (code, signal) => {
      console.log(`[Spawner] Server exited: match=${matchId} code=${code} signal=${signal}`);
      this.activeServers.delete(matchId);
      this.recoveryByMatch.delete(matchId);
      this.onServerExit?.(matchId, code);
    });

    return server;
  }

  /** Shutdown a specific game server */
  async shutdown(matchId: string): Promise<void> {
    const server = this.activeServers.get(matchId);
    if (!server) {
      this.recoveryByMatch.delete(matchId);
      console.log(`[Spawner] No server found for match: ${matchId}`);
      return;
    }

    console.log(`[Spawner] Shutting down server: match=${matchId} port=${server.port}`);

    return new Promise((resolve) => {
      server.process.on("exit", () => {
        this.activeServers.delete(matchId);
        this.recoveryByMatch.delete(matchId);
        resolve();
      });

      // Send SIGTERM for graceful shutdown
      server.process.kill("SIGTERM");

      // Force kill after 5 seconds
      setTimeout(() => {
        if (this.activeServers.has(matchId)) {
          console.warn(`[Spawner] Force-killing server: match=${matchId}`);
          server.process.kill("SIGKILL");
          this.activeServers.delete(matchId);
          this.recoveryByMatch.delete(matchId);
          resolve();
        }
      }, 5000);
    });
  }

  /** Shutdown all running game servers */
  async shutdownAll(): Promise<void> {
    const shutdowns = [...this.activeServers.keys()].map((id) => this.shutdown(id));
    await Promise.all(shutdowns);
  }

  /** Get list of active servers */
  getActiveServers(): SpawnedServer[] {
    return [...this.activeServers.values()];
  }

  /** Privately release one reserved credential to its original verified account. */
  reissueUnclaimedSeat(
    matchId: string,
    accountId: number,
    now = Date.now(),
  ): { admissionTicket: string; serverUrl: string } | null {
    const server = this.activeServers.get(matchId);
    const byAccount = this.recoveryByMatch.get(matchId);
    const reserved = byAccount?.get(accountId);
    if (!server || !reserved || now < reserved.availableAt || now > reserved.expiresAt) return null;
    byAccount!.delete(accountId);
    return { admissionTicket: reserved.ticket, serverUrl: server.url };
  }

  /** Callback when a server exits (set by LobbyServer) */
  onServerExit: ((matchId: string, code: number | null) => void) | null = null;
  /** Only authenticated reports with an exact issued-seat roster reach the lobby. */
  onServerResult: ((result: MatchResultReport) => void) | null = null;

  // ── Internal ─────────────────────────────────────────────────

  private allocatePort(): number {
    const port = this.nextPort;
    this.nextPort++;
    // Skip ports already in use
    while ([...this.activeServers.values()].some((s) => s.port === this.nextPort)) {
      this.nextPort++;
    }
    return port;
  }

  private generateMatchId(): string {
    return `m_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
  }

  private waitForReady(
    child: ChildProcess,
    matchId: string,
    port: number,
    onResult?: (line: string) => void,
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error(`[Spawner] Server start timed out (match: ${matchId})`));
      }, 30000); // 30s timeout

      let pending = "";

      const onData = (data: Buffer) => {
        pending += data.toString();
        // Child writes can split a result across chunks; cap an unfinished line.
        if (pending.length > 16_384) pending = "";
        let end = pending.indexOf("\n");
        while (end >= 0) {
          const line = pending.slice(0, end).trim();
          pending = pending.slice(end + 1);
          if (line.startsWith(RESULT_PREFIX)) onResult?.(line);
          else if (line) console.log(`  [Server:${port}] ${line}`);
          if (line.includes("Ready for connections") || line.includes("Server ready on")) {
            clearTimeout(timeout);
            resolve();
          }
          end = pending.indexOf("\n");
        }
      };

      child.stdout?.on("data", onData);
      child.stderr?.on("data", (data: Buffer) => {
        const text = data.toString();
        for (const line of text.split("\n")) {
          if (line.trim()) {
            console.error(`  [Server:${port}:err] ${line.trim()}`);
          }
        }
      });

      child.on("error", (err) => {
        clearTimeout(timeout);
        reject(new Error(`[Spawner] Failed to start server: ${err.message}`));
      });

      child.on("exit", (code) => {
        clearTimeout(timeout);
        if (code !== 0 && code !== null) {
          reject(new Error(`[Spawner] Server exited prematurely with code ${code}`));
        }
      });
    });
  }
}
