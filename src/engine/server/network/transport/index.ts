/**
 * Transport module - WebTransport primary, WebSocket fallback
 */

// Legacy WebSocket for fallback
export { WebSocketServerTransport } from "./WebSocketTransport";
export {
  type ClientConnection,
  type Transport,
  type TransportConfig,
  type TransportEvents,
  WebTransportServerTransport,
} from "./WebTransportTransport";
