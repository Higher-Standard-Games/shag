
/**
 * Transport layer interface for network communication
 */
export interface Transport {
  /** Connect to server */
  connect(url: string): Promise<void>;

  /** Disconnect from server */
  disconnect(): Promise<void>;

  /** Send data */
  send(data: Uint8Array, reliable?: boolean): void;

  /** Subscribe to messages */
  onMessage(callback: (data: Uint8Array) => void): () => void;

  /** Subscribe to connection events */
  onConnect(callback: () => void): () => void;

  /** Subscribe to disconnection events */
  onDisconnect(callback: (reason?: string) => void): () => void;

  /** Subscribe to error events */
  onError(callback: (error: Error) => void): () => void;

  /** Check if connected */
  isConnected(): boolean;
}

/**
 * Transport factory for selecting best available transport
 */
export class TransportFactory {
  /**
   * Create transport for given URL
   */
  static async create(url: string): Promise<Transport> {
    // Try WebTransport first (if available)
    if ('WebTransport' in globalThis) {
      try {
        const { WebTransportTransport } = await import('./WebTransportTransport');
        const transport = new WebTransportTransport();
        await transport.connect(url);
        return transport;
      } catch (error) {
        console.warn('WebTransport failed, falling back to WebSocket:', error);
      }
    }

    // Fallback to WebSocket
    const { WebSocketTransport } = await import('./WebSocketTransport');
    const transport = new WebSocketTransport();
    await transport.connect(url);
    return transport;
  }
}
