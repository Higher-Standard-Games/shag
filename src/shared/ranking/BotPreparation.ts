/** One bounded budget shared by the bot service and its lobby control client. */
export const BOT_PREPARATION_TIMEOUT_MS = 60_000;
export const BOT_LOBBY_JOIN_TIMEOUT_MS = 10_000;
export const BOT_INVITE_PREPARATION_TIMEOUT_MS = BOT_PREPARATION_TIMEOUT_MS + BOT_LOBBY_JOIN_TIMEOUT_MS + 5_000;
