import type { Transport } from './Transport';

/**
 * WebSocket transport implementation
 */
export class WebSocketTransport implements Transport {
  private ws: WebSocket | null = null;
  private messageCallbacks: ((data: Uint8Array) => void)[] = [];
  private connectCallbacks: (() => void)[] = [];
  private disconnectCallbacks: ((reason?: string) => void)[] = [];
  private errorCallbacks: ((error: Error) => void)[] = [];

  async connect(url: string): Promise<void> {
    // Convert http/ws to websocket URL
    const wsUrl = url.replace(/^http/, 'ws');

    return new Promise((resolve, reject) => {
      try {
        this.ws = new WebSocket(wsUrl);
        // IMPORTANT: Set binary type to arraybuffer for proper Uint8Array handling
        this.ws.binaryType = 'arraybuffer';

        this.ws.onopen = () => {
          this.connectCallbacks.forEach(cb => cb());
          resolve();
        };

        this.ws.onmessage = (event) => {
          // event.data is ArrayBuffer when binaryType is 'arraybuffer'
          const data = new Uint8Array(event.data as ArrayBuffer);
          this.messageCallbacks.forEach(cb => cb(data));
        };

        this.ws.onclose = (event) => {
          this.disconnectCallbacks.forEach(cb => cb(event.reason));
        };

        this.ws.onerror = (_event) => {
          const error = new Error('WebSocket connection error');
          this.errorCallbacks.forEach(cb => cb(error));
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
}
