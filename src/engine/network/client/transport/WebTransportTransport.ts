import type { Transport } from "./Transport";

/**
 * WebTransportTransport — QUIC-based Transport using the browser WebTransport API.
 *
 * Supports both delivery modes over a single connection:
 * - reliable=false: writes to the `datagrams.writable` writer (unordered, unreliable,
 *   low-latency — used for input commands and snapshots)
 * - reliable=true:  opens a unidirectional stream per message for ordered, guaranteed
 *   delivery (used for auth, welcome, and game events)
 *
 * Inbound traffic comes from two sources: `datagrams.readable` (read in a long-lived
 * loop by readMessages()) and `incomingUnidirectionalStreams` (each stream is drained
 * to completion and reassembled into a single Uint8Array before delivery).
 * connect() requires an https URL and will throw if WebTransport is unavailable.
 */
export class WebTransportTransport implements Transport {
  // biome-ignore lint/suspicious/noExplicitAny: browser WebTransport API (experimental, not in TS dom lib)
  private transport: any = null;
  // biome-ignore lint/suspicious/noExplicitAny: browser WritableStreamDefaultWriter for WebTransport datagrams
  private writer: any = null;
  // biome-ignore lint/suspicious/noExplicitAny: browser ReadableStreamDefaultReader for WebTransport datagrams
  private reader: any = null;
  private messageCallbacks: ((data: Uint8Array) => void)[] = [];
  private connectCallbacks: (() => void)[] = [];
  private disconnectCallbacks: ((reason?: string) => void)[] = [];
  private errorCallbacks: ((error: Error) => void)[] = [];

  async connect(url: string): Promise<void> {
    if (!("WebTransport" in globalThis)) {
      throw new Error("WebTransport not supported in this browser");
    }

    try {
      // Convert http to https for WebTransport
      const httpsUrl = url.replace(/^http/, "https");
      // biome-ignore lint/suspicious/noExplicitAny: WebTransport constructor not in TS dom lib
      this.transport = new (globalThis as any).WebTransport(httpsUrl);

      await this.transport.ready;

      this.writer = this.transport.datagrams.writable.getWriter();
      this.reader = this.transport.datagrams.readable.getReader();

      // Start reading messages from datagrams (unreliable channel)
      this.readMessages();
      // Start reading messages from incoming streams (reliable channel)
      this.readIncomingStreams();

      for (const cb of this.connectCallbacks) cb();
    } catch (error) {
      for (const cb of this.errorCallbacks) cb(error as Error);
      throw error;
    }
  }

  async disconnect(): Promise<void> {
    if (this.transport) {
      await this.transport.close();
      this.transport = null;
      this.writer = null;
      this.reader = null;
    }
  }

  send(data: Uint8Array, reliable: boolean = false): void {
    if (reliable && this.transport) {
      // Reliable: use a unidirectional stream for guaranteed, ordered delivery
      this.transport
        .createUnidirectionalStream()
        .then((stream: WritableStream) => {
          const writer = stream.getWriter();
          writer.write(data);
          writer.close();
        })
        .catch((err: Error) => {
          console.warn("[WebTransportTransport] Reliable send failed:", err);
          for (const cb of this.errorCallbacks) cb(err);
        });
    } else if (this.writer) {
      // Unreliable: fast QUIC datagrams (game input, snapshots)
      this.writer.write(data);
    }
  }

  private async readMessages(): Promise<void> {
    if (!this.reader) return;

    try {
      while (true) {
        const { value, done } = await this.reader.read();
        if (done) break;

        if (value) {
          for (const cb of this.messageCallbacks) cb(value);
        }
      }
    } catch (error) {
      for (const cb of this.errorCallbacks) cb(error as Error);
    }
  }

  /**
   * Read incoming reliable streams from the server.
   * Server uses sendReliable() for auth, welcome, and game events.
   */
  private async readIncomingStreams(): Promise<void> {
    if (!this.transport) return;

    try {
      const reader = this.transport.incomingUnidirectionalStreams.getReader();
      while (true) {
        const { value: stream, done } = await reader.read();
        if (done) break;

        // Read each stream to completion
        const streamReader = stream.getReader();
        const chunks: Uint8Array[] = [];
        while (true) {
          const { value, done: streamDone } = await streamReader.read();
          if (streamDone) break;
          if (value) chunks.push(value);
        }

        // Concatenate chunks and deliver as a single message
        if (chunks.length === 1) {
          for (const cb of this.messageCallbacks) cb(chunks[0]);
        } else if (chunks.length > 1) {
          const total = chunks.reduce((acc, c) => acc + c.length, 0);
          const merged = new Uint8Array(total);
          let offset = 0;
          for (const chunk of chunks) {
            merged.set(chunk, offset);
            offset += chunk.length;
          }
          for (const cb of this.messageCallbacks) cb(merged);
        }
      }
    } catch (_error) {
      // Transport closed — expected during disconnect
    }
  }

  onMessage(callback: (data: Uint8Array) => void): () => void {
    this.messageCallbacks.push(callback);
    return () => {
      const index = this.messageCallbacks.indexOf(callback);
      if (index >= 0) {
        this.messageCallbacks.splice(index, 1);
      }
    };
  }

  onConnect(callback: () => void): () => void {
    this.connectCallbacks.push(callback);
    return () => {
      const index = this.connectCallbacks.indexOf(callback);
      if (index >= 0) {
        this.connectCallbacks.splice(index, 1);
      }
    };
  }

  onDisconnect(callback: (reason?: string) => void): () => void {
    this.disconnectCallbacks.push(callback);
    return () => {
      const index = this.disconnectCallbacks.indexOf(callback);
      if (index >= 0) {
        this.disconnectCallbacks.splice(index, 1);
      }
    };
  }

  onError(callback: (error: Error) => void): () => void {
    this.errorCallbacks.push(callback);
    return () => {
      const index = this.errorCallbacks.indexOf(callback);
      if (index >= 0) {
        this.errorCallbacks.splice(index, 1);
      }
    };
  }

  isConnected(): boolean {
    return this.transport?.state === "connected";
  }
}
