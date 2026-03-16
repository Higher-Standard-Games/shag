/**
 * Server Network - Transport layer
 * 
 * Provides WebSocket (and WebTransport) server transports
 * used by GameServer for client connections.
 */

// Transport (WebTransport primary, WebSocket fallback)
export {
    WebTransportServerTransport,
    type Transport,
    type TransportConfig,
    type TransportEvents,
    type ClientConnection,
} from './transport';

// Legacy WebSocket (for fallback)
export { WebSocketServerTransport } from './transport/WebSocketTransport';
