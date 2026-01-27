# Server Features Checklist

**Date:** 2026-01-27  
**Status:** Brainstorming - What did we miss?

---

## Player Management

| Feature | Description | Priority |
|---------|-------------|----------|
| **maxPlayers** | Gametype defines max active players (2 for duel, 8 for TDM) | HIGH |
| **maxClients** | Server defines max connections (players + spectators) | HIGH |
| **Spectator Mode** | Chase cam, free cam, first-person view of player | HIGH |
| **Team Assignment** | Auto-assign, manual team join, team balance | MEDIUM |
| **Ready-Up System** | Players must ready before match starts (competitive) | MEDIUM |
| **Player Models** | Name, model, team colors | LOW |

---

## Spectator System

```typescript
type SpectatorMode = 
  | 'free'      // Free-flying camera
  | 'chase'     // Third-person follow player
  | 'firstperson'; // See through player's eyes

interface SpectatorState {
  mode: SpectatorMode;
  targetPlayerId?: string;  // Who we're watching
}

// Spectator controls
// LEFT/RIGHT: Cycle through players
// SPACE: Toggle mode (chase → firstperson → free → chase)
// JUMP: Switch to playing (if slot available)
```

### Client State Types
```typescript
type ClientState = 
  | 'connecting'   // Just connected, loading
  | 'spectating'   // Watching
  | 'ready'        // Ready to play (in queue or ready-up)
  | 'playing';     // Active in match
```

---

## Match Flow

| Feature | Description | Priority |
|---------|-------------|----------|
| **Warmup** | Infinite respawn, no score, waiting for players | HIGH |
| **Ready-Up** | All players must "/ready" before countdown | MEDIUM |
| **Countdown** | 3...2...1...FIGHT! | HIGH |
| **Playing** | Active match | HIGH |
| **Overtime** | Tie? Keep playing until someone leads | MEDIUM |
| **Intermission** | Scoreboard display, vote next map | HIGH |
| **Pause** | Competitive: allow match pause | LOW |

### Ready-Up Flow
```
1. Warmup starts, players join
2. When enough players: "Type /ready when ready"
3. All players ready → countdown
4. Anyone unreadies → back to waiting
5. Player disconnects during ready → cancel countdown
```

---

## Voting System

```typescript
interface VoteConfig {
  allowVote: boolean;
  voteTimeout: number;        // Seconds to vote (30)
  voteThreshold: number;      // Percentage needed (0.5 = 50%)
  voteCooldown: number;       // Seconds between failed votes
}

type VoteType = 
  | { type: 'map'; map: string }
  | { type: 'kick'; playerId: string }
  | { type: 'gametype'; gametype: string }
  | { type: 'nextmap' }
  | { type: 'restart' };

// Commands
// /callvote map wdm5
// /callvote kick PlayerName
// /vote yes | /vote no
// /ready
// /notready
```

---

## Map Rotation

```typescript
interface MapRotation {
  maps: string[];         // ["wdm2", "wdm5", "wdm7"]
  mode: 'sequential' | 'random' | 'vote';
  currentIndex: number;
}

// After match end:
// 1. Show scoreboard (intermission)
// 2. If vote enabled: show vote UI
// 3. Load next map
// 4. Return to warmup
```

---

## RCON (Remote Console)

```typescript
// Client sends
{ type: 'rcon', password: string, command: string }

// Server validates password, executes command
// Privileged commands:
// - kick <player>
// - ban <player>
// - map <mapname>
// - gametype <gt>
// - restart
// - say <message> (server announcement)
```

---

## Chat System

```typescript
type ChatMessage = 
  | { type: 'all'; from: string; message: string }
  | { type: 'team'; from: string; team: TeamId; message: string }
  | { type: 'server'; message: string };  // Server announcements

// Commands
// /say Hello everyone
// /say_team Need backup!
// /me does something (action message)
```

---

## Statistics

```typescript
interface PlayerStats {
  // Basic
  kills: number;
  deaths: number;
  suicides: number;
  
  // Detailed
  damageDealt: number;
  damageReceived: number;
  
  // Weapon accuracy (per weapon)
  weaponStats: Map<WeaponType, {
    shots: number;
    hits: number;
    kills: number;
    damage: number;
  }>;
  
  // Items
  itemsPickedUp: number;
  megaHealths: number;
  redArmors: number;
  
  // Time
  playTime: number;
  aliveTime: number;
}
```

---

## Item Drop System

When player dies:
- Drop current weapon
- Drop flag (CTF)
- Drop bomb (Bomb gametype)
- Drop powerup (optional)

```typescript
interface DropConfig {
  dropWeaponOnDeath: boolean;
  dropAmmoPercent: number;      // 0.5 = drop half ammo
  dropPowerupOnDeath: boolean;
  dropPowerupTimeRemaining: boolean;  // Keep remaining quad time
}
```

---

## Server Info

```typescript
interface ServerInfo {
  hostname: string;
  map: string;
  gametype: string;
  
  // Slots
  maxClients: number;     // Total connections
  maxPlayers: number;     // Active players (from gametype)
  currentClients: number;
  currentPlayers: number;
  spectators: number;
  
  // Match state
  matchState: MatchState;
  matchTime: number;
  fraglimit: number;
  timelimit: number;
  
  // Rules
  friendlyFire: boolean;
  respawnTime: number;
  
  // Meta
  version: string;
  motd: string;           // Message of the day
}
```

---

## Bots (Future)

For testing and filling empty servers:

```typescript
interface BotConfig {
  enabled: boolean;
  fillToPlayers: number;  // Add bots until N players
  skill: 1 | 2 | 3 | 4 | 5;
  names: string[];
}

// Commands
// /addbot [skill] [name]
// /kickbots
// /botskill <1-5>
```

---

## Demo Recording (Future)

Server-side match recording:

```typescript
interface DemoConfig {
  autoRecord: boolean;       // Record all matches
  recordPath: string;        // Where to save
  maxDemos: number;          // Rolling buffer
}

// Demo contains:
// - All entity states per tick
// - All events (kills, chat, etc)
// - Gametype state
// - Can be replayed or converted to video
```

---

## Anti-Cheat Hooks (Future)

Server-authoritative already helps, but also:

```typescript
interface AntiCheatConfig {
  maxCommandRate: number;    // Commands per second limit
  maxPing: number;           // Kick if ping too high
  verifyChecksums: boolean;  // Verify client assets
}

// Hooks
onSuspiciousActivity(player: Player, reason: string): void;
```

---

## Moderation

```typescript
// Ban list
interface BanEntry {
  identifier: string;  // IP or account ID
  reason: string;
  expires: Date | 'permanent';
  bannedBy: string;
}

// Commands
// /kick <player> [reason]
// /ban <player> <duration> [reason]
// /unban <identifier>
// /mute <player> [duration]
```

---

## Summary: What We Had vs What We Need

| Had | Need to Add |
|-----|-------------|
| ✅ maxClients | ✅ maxPlayers (gametype) |
| ✅ Basic match flow | ⬜ Ready-up system |
| ✅ Scoring | ⬜ Detailed stats |
| ✅ Kill events | ⬜ Chat system |
| ❌ | ⬜ Spectator mode |
| ❌ | ⬜ Voting system |
| ❌ | ⬜ Map rotation |
| ❌ | ⬜ RCON |
| ❌ | ⬜ Item drops |
| ❌ | ⬜ Moderation |

---

## Priority for MVP

**Must Have (Phase 1-2):**
- maxPlayers in gametype
- Spectator mode (chase cam minimum)
- Chat (all and team)
- Basic match flow (warmup → playing → intermission)

**Should Have (Phase 3):**
- Ready-up system
- Voting (map vote at least)
- Map rotation

**Nice to Have (Phase 4+):**
- Detailed stats
- RCON
- Bots
- Demo recording
