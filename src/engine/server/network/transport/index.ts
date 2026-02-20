/**
 * Transport module - WebTransport primary, WebSocket fallback
 */
export {
    WebTransportServerTransport,
    type Transport,
    type TransportConfig,
    type TransportEvents,
    type ClientConnection,
} from './WebTransportTransport';

// Legacy WebSocket for fallback
export { WebSocketServerTransport } from './WebSocketTransport';
