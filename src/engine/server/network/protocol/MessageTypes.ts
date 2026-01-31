/**
 * Network Message Types
 */

export enum MessageType {
    // ═══ Server → Client ═══
    S_Welcome = 0x01,
    S_FullSnapshot = 0x02,
    S_DeltaSnapshot = 0x03,
    S_PlayerJoined = 0x04,
    S_PlayerLeft = 0x05,
    S_GameEvent = 0x06,

    // ═══ Client → Server ═══
    C_Input = 0x80,
    C_RequestFullSnapshot = 0x81,
    C_Ack = 0x82,
    C_AckSnapshot = 0x82, // Alias for backwards compatibility
    C_Chat = 0x83,
    C_Auth = 0x84,
    C_Ping = 0x85,
    C_Pong = 0x86,
}
