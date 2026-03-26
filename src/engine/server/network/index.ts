/**
 * Server Network - Transport layer
 *
 * Provides WebSocket (and WebTransport) server transports
 * used by GameServer for client connections.
 */

// Transport (WebTransport primary, WebSocket fallback)
export {
  type ClientConnection,
  type Transport,
  type TransportConfig,
  type TransportEvents,
  WebTransportServerTransport,
} from "./transport";

// Legacy WebSocket (for fallback)
export { WebSocketServerTransport } from "./transport/WebSocketTransport";
