/**
 * A connection to the lobby inside its own process: two ends that pass text
 * frames to each other as a WebSocket pair would. The lobby takes its end as
 * it takes any socket (LobbyServer.handleConnection), so a bot seated through
 * one (LobbyBotSeats) joins, readies and is rated exactly as one that
 * connected over the network.
 *
 * Only what the lobby and the bot's lobby client use: `send`, `close`,
 * `readyState`, and the `open`, `message`, `close` and `error` events.
 * Frames arrive on a later turn of the event loop, as from a socket, so
 * neither side handles a message inside its own `send`.
 */

import { EventEmitter } from "node:events";

const CONNECTING = 0;
const OPEN = 1;
const CLOSED = 3;

export class LocalSocket extends EventEmitter {
  readyState = CONNECTING;
  private peer: LocalSocket | null = null;

  /** Two connected ends; each opens on the next turn of the event loop. */
  static pair(): { client: LocalSocket; server: LocalSocket } {
    const client = new LocalSocket();
    const server = new LocalSocket();
    client.peer = server;
    server.peer = client;
    for (const end of [client, server]) {
      setImmediate(() => {
        if (end.readyState !== CONNECTING) return;
        end.readyState = OPEN;
        end.emit("open");
      });
    }
    return { client, server };
  }

  send(data: string | Uint8Array): void {
    const peer = this.peer;
    if (this.readyState === CLOSED || !peer) return;
    const frame = Buffer.from(typeof data === "string" ? data : new Uint8Array(data));
    setImmediate(() => {
      if (peer.readyState !== CLOSED) peer.emit("message", frame, false);
    });
  }

  close(_code?: number, _reason?: string): void {
    if (this.readyState === CLOSED) return;
    this.readyState = CLOSED;
    const peer = this.peer;
    this.peer = null;
    setImmediate(() => this.emit("close"));
    if (peer) peer.close();
  }

  /** As `ws`, for the lobby's shutdown path. */
  terminate(): void {
    this.close();
  }
}
