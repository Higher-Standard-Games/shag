/**
 * The music a match plays: the game playlist, unless the game names another
 * for the match it is about to join (a campaign mission's own song). The
 * network host starts it when a match is joined and again after its post-game.
 */
export const GAME_PLAYLIST = "data/game.playlist.json";

let matchPlaylistUrl: string | null = null;

/** Name the playlist for the match being joined; null for the game playlist. */
export function setMatchPlaylist(url: string | null): void {
  matchPlaylistUrl = url;
}

/** The playlist the current match plays. */
export function matchPlaylist(): string {
  return matchPlaylistUrl ?? GAME_PLAYLIST;
}
