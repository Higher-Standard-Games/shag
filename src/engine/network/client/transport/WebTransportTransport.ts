import type { Transport } from './Transport';

/**
 * WebTransport implementation (placeholder for future use)
 * Note: WebTransport is still experimental and not widely supported
 */
export class WebTransportTransport implements Transport {
  private transport: any = null;
  private writer: any = null;
  private reader: any = null;
  private messageCallbacks: ((data: Uint8Array) => void)[] = [];
  private connectCallbacks: (() => void)[] = [];
  private disconnectCallbacks: ((reason?: string) => void)[] = [];
  private errorCallbacks: ((error: Error) => void)[] = [];

  async connect(url: string): Promise<void> {
    if (!('WebTransport' in globalThis)) {
      throw new Error('WebTransport not supported in this browser');
    }

    try {
      // Convert http to https for WebTransport
      const httpsUrl = url.replace(/^http/, 'https');
      this.transport = new (globalThis as any).WebTransport(httpsUrl);
      
      await this.transport.ready;
      
      this.writer = this.transport.datagrams.writable.getWriter();
      this.reader = this.transport.datagrams.readable.getReader();
      
      // Start reading messages
      this.readMessages();
      
      this.connectCallbacks.forEach(cb => cb());
    } catch (error) {
      this.errorCallbacks.forEach(cb => cb(error as Error));
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

  send(data: Uint8Array, _reliable: boolean = true): void {
    if (this.writer) {
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
          this.messageCallbacks.forEach(cb => cb(value));
        }
      }
    } catch (error) {
      this.errorCallbacks.forEach(cb => cb(error as Error));
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
    return this.transport?.state === 'connected';
  }
}
