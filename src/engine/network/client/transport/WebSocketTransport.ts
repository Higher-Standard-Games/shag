import { devLog } from "../../../core/DevLog";
import type { Transport } from "./Transport";

/**
 * WebSocketTransport — reliable/ordered TCP-backed transport implementing Transport.
 *
 * Uses ArrayBuffer binary frames (binaryType = "arraybuffer") and delivers every
 * inbound frame as a Uint8Array to onMessage subscribers. connect() is idempotent:
 * if the socket is already OPEN it resolves immediately, and if it is CONNECTING it
 * awaits the in-flight handshake. send() is a no-op when the socket is not OPEN and
 * logs a 1% sample to avoid console spam. The `reliable` flag is ignored — WebSocket
 * is always reliable and ordered.
 */
export class WebSocketTransport implements Transport {
  readonly lossless = true;
  private ws: WebSocket | null = null;
  private messageCallbacks: ((data: Uint8Array) => void)[] = [];
  private connectCallbacks: (() => void)[] = [];
  private disconnectCallbacks: ((reason?: string) => void)[] = [];
  private errorCallbacks: ((error: Error) => void)[] = [];

  async connect(url: string): Promise<void> {
    // Already connected - return immediately (idempotent)
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      devLog("[WebSocketTransport] Already connected, skipping reconnect");
      return;
    }

    // Connection in progress
    if (this.ws && this.ws.readyState === WebSocket.CONNECTING) {
      devLog("[WebSocketTransport] Connection in progress, waiting...");
      return new Promise((resolve, reject) => {
        this.ws!.onopen = () => resolve();
        this.ws!.onerror = () => reject(new Error("Connection failed"));
      });
    }

    // Convert http/ws to websocket URL
    const wsUrl = url.replace(/^http/, "ws");

    return new Promise((resolve, reject) => {
      try {
        this.ws = new WebSocket(wsUrl);
        // IMPORTANT: Set binary type to arraybuffer for proper Uint8Array handling
        this.ws.binaryType = "arraybuffer";

        this.ws.onopen = () => {
          for (const cb of this.connectCallbacks) cb();
          resolve();
        };

        this.ws.onmessage = (event) => {
          // event.data is ArrayBuffer when binaryType is 'arraybuffer'
          const data = new Uint8Array(event.data as ArrayBuffer);
          for (const cb of this.messageCallbacks) cb(data);
        };

        this.ws.onclose = (event) => {
          for (const cb of this.disconnectCallbacks) cb(event.reason);
        };

        this.ws.onerror = (_event) => {
          const error = new Error("WebSocket connection error");
          for (const cb of this.errorCallbacks) cb(error);
          reject(error);
        };
      } catch (error) {
        reject(error);
      }
    });
  }

  async disconnect(): Promise<void> {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  send(data: Uint8Array, _reliable: boolean = true): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(data);
    } else {
      // Log once in a while to avoid spam
      if (Math.random() < 0.01) {
        console.warn(
          `[WebSocketTransport] send failed - ws: ${this.ws ? "exists" : "null"}, readyState: ${this.ws?.readyState}`,
        );
      }
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
    return this.ws?.readyState === WebSocket.OPEN;
  }

  bufferedAmount(): number {
    return this.ws?.bufferedAmount ?? 0;
  }
}
