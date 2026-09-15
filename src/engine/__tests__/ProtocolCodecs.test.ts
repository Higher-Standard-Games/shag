/**
 * ProtocolCodecs.test.ts — Wire-format lock-down tests
 *
 * These tests pin the binary wire format of the network protocol. They exist
 * to catch *unintentional* wire-format changes — anything that would break
 * compatibility between a client and a server built from different commits.
 *
 * Covers:
 *   - MessageCodec: every message type, round-trip + mismatch errors
 *   - BinaryProtocol: every game-event type (combat_state, damage, death, etc.)
 *   - Delta compression: each entity/player flag path, including "unchanged
 *     carries forward from baseline"
 *   - Byte-level stability: fixed-width messages have predictable sizes
 *
 * Intentionally decoupled from BinaryProtocol.test.ts (basic happy path).
 */

import { describe, expect, it } from "vitest";
import type { IComponent } from "../network/core/Component";
import { Entity } from "../network/core/Entity";
import { GameState, PlayerState } from "../network/core/GameState";
import {
  BinaryDecoder,
  BinaryEncoder,
  BinaryProtocol,
  MessageType,
  type NetworkCommand,
} from "../network/protocol/BinaryProtocol";
import { MessageCodec } from "../network/protocol/MessageCodec";
import { StateDecoder } from "../network/protocol/StateDecoder";
import { StateEncoder } from "../network/protocol/StateEncoder";

// biome-ignore lint/suspicious/noExplicitAny: test stub components need a flexible shape
type ComponentStub = IComponent & Record<string, any>;

// ── Helpers ────────────────────────────────────────────────────────

interface Vec3 {
  x: number;
  y: number;
  z: number;
}

function addPosition(entity: Entity, pos: Vec3): void {
  entity.addComponent("position", {
    ...pos,
    serialize() {},
    deserialize() {},
    clone() {
      return { ...this };
    },
  } as ComponentStub);
  entity.addComponent("transform", {
    position: { ...pos },
    rotation: { x: 0, y: 0, z: 0, w: 1 },
    serialize() {},
    deserialize() {},
    clone() {
      return {
        position: { ...this.position },
        rotation: { ...this.rotation },
        serialize: this.serialize,
        deserialize: this.deserialize,
        clone: this.clone,
      };
    },
  } as ComponentStub);
}

function addVelocity(entity: Entity, vel: Vec3, grounded: boolean): void {
  entity.addComponent("velocity", {
    x: vel.x,
    y: vel.y,
    z: vel.z,
    linear: { ...vel },
    angular: { x: 0, y: 0, z: 0 },
    grounded,
    isCrouching: false,
    isSliding: false,
    serialize() {},
    deserialize() {},
    clone() {
      return { ...this, linear: { ...this.linear }, angular: { ...this.angular } };
    },
  } as ComponentStub);
}

function addRotation(entity: Entity, pitch: number, yaw: number): void {
  const transform = entity.getComponent("transform") as unknown as
    | { position: Vec3; rotation: { x: number; y: number; z: number; w: number } }
    | undefined;
  if (transform) {
    transform.rotation = { x: pitch, y: yaw, z: 0, w: 1 };
  }
}

function addMovementState(
  entity: Entity,
  isCrouching: boolean,
  isSliding: boolean,
  wallJumpState: string = "none",
): void {
  entity.addComponent("movementState", {
    isCrouching,
    isSliding,
    wallJumpState,
    serialize() {},
    deserialize() {},
    clone() {
      return { ...this };
    },
  } as ComponentStub);
}

function addWeaponMeta(entity: Entity, weaponId: string, settled: boolean): void {
  entity.addComponent("weaponMeta", {
    weaponId,
    settled,
    serialize() {},
    deserialize() {},
    clone() {
      return { ...this };
    },
  } as ComponentStub);
}

function makePlayer(entityId: string, name: string, score = 0, deaths = 0, ping = 0, team = ""): PlayerState {
  const p = new PlayerState();
  p.entityId = entityId;
  p.name = name;
  p.team = team;
  p.score = score;
  p.deaths = deaths;
  p.ping = ping;
  return p;
}

// ── MessageCodec: full coverage ──────────────────────────────────

describe("MessageCodec — all message types", () => {
  describe("Welcome", () => {
    it("roundtrips with extreme values", () => {
      const encoded = MessageCodec.encodeWelcome("srv-id", "The Server", "map_with_underscores", 255, 255, 0);
      const decoded = MessageCodec.decodeWelcome(encoded);
      expect(decoded).toEqual({
        serverId: "srv-id",
        serverName: "The Server",
        map: "map_with_underscores",
        tickRate: 255,
        maxPlayers: 255,
        currentPlayers: 0,
      });
    });

    it("roundtrips with empty strings", () => {
      const encoded = MessageCodec.encodeWelcome("", "", "", 0, 0, 0);
      const decoded = MessageCodec.decodeWelcome(encoded);
      expect(decoded.serverId).toBe("");
      expect(decoded.serverName).toBe("");
      expect(decoded.map).toBe("");
    });

    it("roundtrips with unicode names", () => {
      const encoded = MessageCodec.encodeWelcome("srv", "Señor Server 🎮", "wdm2", 125, 16, 4);
      const decoded = MessageCodec.decodeWelcome(encoded);
      expect(decoded.serverName).toBe("Señor Server 🎮");
    });

    it("throws when decoding a non-Welcome message", () => {
      const wrong = MessageCodec.encodeAck(0);
      expect(() => MessageCodec.decodeWelcome(wrong)).toThrow(/Expected Welcome/);
    });
  });

  describe("Join", () => {
    it("roundtrips player name", () => {
      const encoded = MessageCodec.encodeJoin("Alice");
      const decoded = MessageCodec.decodeJoin(encoded);
      expect(decoded.playerName).toBe("Alice");
    });

    it("rejects messages of another type", () => {
      const wrong = MessageCodec.encodeReady();
      expect(() => MessageCodec.decodeJoin(wrong)).toThrow(/Expected Join/);
    });

    it("first byte is MessageType.Join", () => {
      const encoded = MessageCodec.encodeJoin("Alice");
      expect(encoded[0]).toBe(MessageType.Join);
    });

    it("defaults isBot to false and roundtrips the bot flag", () => {
      expect(MessageCodec.decodeJoin(MessageCodec.encodeJoin("Alice")).isBot).toBe(false);
      expect(MessageCodec.decodeJoin(MessageCodec.encodeJoin("Botty", true)).isBot).toBe(true);
    });
  });

  describe("JoinAccept", () => {
    it("roundtrips client/player/entity ids", () => {
      const encoded = MessageCodec.encodeJoinAccept("client-42", "player-42", "entity-42");
      const decoded = MessageCodec.decodeJoinAccept(encoded);
      expect(decoded).toEqual({
        clientId: "client-42",
        playerId: "player-42",
        entityId: "entity-42",
      });
    });

    it("rejects messages of another type", () => {
      const wrong = MessageCodec.encodeJoin("x");
      expect(() => MessageCodec.decodeJoinAccept(wrong)).toThrow(/Expected JoinAccept/);
    });
  });

  describe("JoinGame", () => {
    it("roundtrips without team", () => {
      const encoded = MessageCodec.encodeJoinGame();
      const decoded = MessageCodec.decodeJoinGame(encoded);
      expect(decoded.teamId).toBeUndefined();
    });

    it("roundtrips with team", () => {
      const encoded = MessageCodec.encodeJoinGame("red");
      const decoded = MessageCodec.decodeJoinGame(encoded);
      expect(decoded.teamId).toBe("red");
    });

    it("uses a 1-byte flag to signal teamId presence", () => {
      const noTeam = MessageCodec.encodeJoinGame();
      const withTeam = MessageCodec.encodeJoinGame("red");
      // 1 byte msg type + 1 byte flag = 2 bytes when no team.
      expect(noTeam.length).toBe(2);
      // With team: type + flag + string length (u16) + "red" = 2 + 2 + 3 = 7
      expect(withTeam.length).toBe(7);
    });
  });

  describe("Ready / Spectate / RequestSpawn", () => {
    it("Ready is a single MessageType byte", () => {
      const encoded = MessageCodec.encodeReady();
      expect(encoded.length).toBe(1);
      expect(encoded[0]).toBe(MessageType.Ready);
    });

    it("Spectate is a single MessageType byte", () => {
      const encoded = MessageCodec.encodeSpectate();
      expect(encoded.length).toBe(1);
      expect(encoded[0]).toBe(MessageType.Spectate);
    });

    it("RequestSpawn is a single MessageType byte", () => {
      const encoded = MessageCodec.encodeRequestSpawn();
      expect(encoded.length).toBe(1);
      expect(encoded[0]).toBe(MessageType.RequestSpawn);
    });
  });

  describe("Ack", () => {
    it("roundtrips large tick values", () => {
      const encoded = MessageCodec.encodeAck(0xfffffff0);
      const decoded = MessageCodec.decodeAck(encoded);
      expect(decoded.tick).toBe(0xfffffff0);
    });

    it("roundtrips tick zero", () => {
      expect(MessageCodec.decodeAck(MessageCodec.encodeAck(0)).tick).toBe(0);
    });

    it("has fixed size: 1 byte type + 4 bytes tick = 5", () => {
      expect(MessageCodec.encodeAck(42).length).toBe(5);
    });

    it("rejects messages of another type", () => {
      expect(() => MessageCodec.decodeAck(MessageCodec.encodeReady())).toThrow(/Expected Ack/);
    });
  });

  describe("Ping / Pong", () => {
    it("ping preserves float64 precision", () => {
      const t = 1_700_123_456_789.125;
      const encoded = MessageCodec.encodePing(t);
      const decoded = MessageCodec.decodePing(encoded);
      expect(decoded.clientSendTime).toBe(t);
    });

    it("pong preserves both timestamps exactly", () => {
      const client = 1_700_000_000_000.25;
      const server = 1_700_000_000_050.75;
      const decoded = MessageCodec.decodePong(MessageCodec.encodePong(client, server));
      expect(decoded.clientSendTime).toBe(client);
      expect(decoded.serverTime).toBe(server);
    });

    it("ping is 1 + 8 = 9 bytes", () => {
      expect(MessageCodec.encodePing(Date.now()).length).toBe(9);
    });

    it("pong is 1 + 8 + 8 = 17 bytes", () => {
      expect(MessageCodec.encodePong(1, 2).length).toBe(17);
    });

    it("ping decode rejects Pong bytes", () => {
      expect(() => MessageCodec.decodePing(MessageCodec.encodePong(1, 2))).toThrow(/Expected Ping/);
    });

    it("pong decode rejects Ping bytes", () => {
      expect(() => MessageCodec.decodePong(MessageCodec.encodePing(1))).toThrow(/Expected Pong/);
    });
  });

  describe("ServerMessage", () => {
    it("roundtrips with default type", () => {
      const encoded = MessageCodec.encodeServerMessage("hello world");
      const decoded = MessageCodec.decodeServerMessage(encoded);
      expect(decoded.type).toBe("info");
      expect(decoded.message).toBe("hello world");
    });

    it("roundtrips with explicit type", () => {
      const encoded = MessageCodec.encodeServerMessage("queued", "queue");
      const decoded = MessageCodec.decodeServerMessage(encoded);
      expect(decoded.type).toBe("queue");
      expect(decoded.message).toBe("queued");
    });

    it("rejects non-ServerMessage bytes", () => {
      expect(() => MessageCodec.decodeServerMessage(MessageCodec.encodeAck(0))).toThrow(/Expected ServerMessage/);
    });
  });

  describe("peekMessageType", () => {
    it("returns the message type without consuming bytes", () => {
      const msg = MessageCodec.encodeJoin("Alice");
      expect(MessageCodec.peekMessageType(msg)).toBe(MessageType.Join);
      // After peek, the message should still decode normally.
      expect(MessageCodec.decodeJoin(msg).playerName).toBe("Alice");
    });

    it("resolves every message type we produce", () => {
      const cases: Array<[MessageType, Uint8Array]> = [
        [MessageType.Welcome, MessageCodec.encodeWelcome("a", "b", "c", 1, 2, 3)],
        [MessageType.JoinAccept, MessageCodec.encodeJoinAccept("a", "b", "c")],
        [MessageType.Ack, MessageCodec.encodeAck(0)],
        [MessageType.ServerMessage, MessageCodec.encodeServerMessage("m")],
        [MessageType.Pong, MessageCodec.encodePong(1, 2)],
        [MessageType.Join, MessageCodec.encodeJoin("a")],
        [MessageType.Ready, MessageCodec.encodeReady()],
        [MessageType.Ping, MessageCodec.encodePing(1)],
        [MessageType.JoinGame, MessageCodec.encodeJoinGame()],
        [MessageType.Spectate, MessageCodec.encodeSpectate()],
        [MessageType.Chat, MessageCodec.encodeChat("hello")],
        [MessageType.RequestSpawn, MessageCodec.encodeRequestSpawn()],
      ];
      for (const [expectedType, bytes] of cases) {
        expect(MessageCodec.peekMessageType(bytes)).toBe(expectedType);
      }
    });

    it("throws on empty data", () => {
      expect(() => MessageCodec.peekMessageType(new Uint8Array(0))).toThrow(/Empty message/);
    });
  });

  describe("MessageType byte assignments (wire format lock)", () => {
    // These values are the wire contract with legacy clients/servers. If any
    // of these change, old builds cannot parse messages from new builds.
    it("has stable codepoints for every MessageType", () => {
      expect(MessageType.Welcome).toBe(0x01);
      expect(MessageType.JoinAccept).toBe(0x02);
      expect(MessageType.JoinReject).toBe(0x03);
      expect(MessageType.LegacySnapshot).toBe(0x04);
      expect(MessageType.Snapshot).toBe(0x0b);
      expect(MessageType.PlayerJoined).toBe(0x05);
      expect(MessageType.PlayerLeft).toBe(0x06);
      expect(MessageType.GameStart).toBe(0x07);
      expect(MessageType.Ack).toBe(0x08);
      expect(MessageType.ServerMessage).toBe(0x09);
      expect(MessageType.Pong).toBe(0x0a);
      expect(MessageType.Join).toBe(0x81);
      expect(MessageType.Ready).toBe(0x82);
      expect(MessageType.Input).toBe(0x83);
      expect(MessageType.Disconnect).toBe(0x84);
      expect(MessageType.Ping).toBe(0x85);
      expect(MessageType.JoinGame).toBe(0x86);
      expect(MessageType.Spectate).toBe(0x87);
      expect(MessageType.Chat).toBe(0x89);
      expect(MessageType.RequestSpawn).toBe(0x88);
    });
  });
});

// ── BinaryProtocol: entity delta compression ──────────────────────

describe("BinaryProtocol — entity delta flags", () => {
  function encodeDecodeRoundtrip(state: GameState, baseline?: GameState): GameState {
    return BinaryProtocol.decodeSnapshot(BinaryProtocol.encodeSnapshot(state, baseline), baseline);
  }

  function makeStateWithEntity(configure: (e: Entity) => void): GameState {
    const s = new GameState();
    s.tick = 1;
    const e = new Entity("e1");
    configure(e);
    s.entities.set("e1", e);
    return s;
  }

  it("0x04 — grounded flag flips when changed vs baseline", () => {
    const base = makeStateWithEntity((e) => {
      addPosition(e, { x: 0, y: 0, z: 0 });
      addVelocity(e, { x: 0, y: 0, z: 0 }, false);
    });
    const current = makeStateWithEntity((e) => {
      addPosition(e, { x: 0, y: 0, z: 0 }); // same
      addVelocity(e, { x: 0, y: 0, z: 0 }, true); // grounded changed
    });
    const decoded = encodeDecodeRoundtrip(current, base);
    const vel = decoded.entities.get("e1")!.getComponent("velocity") as unknown as {
      grounded: boolean;
    };
    expect(vel.grounded).toBe(true);
  });

  it("0x04 — grounded carries forward when unchanged", () => {
    const base = makeStateWithEntity((e) => {
      addPosition(e, { x: 0, y: 0, z: 0 });
      addVelocity(e, { x: 0, y: 0, z: 0 }, true);
    });
    const current = makeStateWithEntity((e) => {
      addPosition(e, { x: 1, y: 0, z: 0 }); // pos changed
      addVelocity(e, { x: 0, y: 0, z: 0 }, true); // grounded unchanged
    });
    const decoded = encodeDecodeRoundtrip(current, base);
    const vel = decoded.entities.get("e1")!.getComponent("velocity") as unknown as {
      grounded: boolean;
    };
    expect(vel.grounded).toBe(true);
  });

  it("0x08 — rotation (pitch + yaw) roundtrips via transform.rotation", () => {
    const current = makeStateWithEntity((e) => {
      addPosition(e, { x: 0, y: 0, z: 0 });
      addRotation(e, 0.25, -1.5);
    });
    const decoded = encodeDecodeRoundtrip(current);
    const rot = (
      decoded.entities.get("e1")!.getComponent("transform") as unknown as {
        rotation: { x: number; y: number; z: number; w: number };
      }
    ).rotation;
    expect(rot.x).toBeCloseTo(0.25, 3);
    expect(rot.y).toBeCloseTo(-1.5, 3);
  });

  it("0x10 — movementState roundtrips crouch/slide/walljump bits", () => {
    const cases = [
      { crouch: false, slide: false, walljump: "none" },
      { crouch: true, slide: false, walljump: "none" },
      { crouch: false, slide: true, walljump: "none" },
      { crouch: false, slide: false, walljump: "charging" },
      { crouch: true, slide: true, walljump: "charging" },
    ];
    for (const c of cases) {
      const state = makeStateWithEntity((e) => {
        addPosition(e, { x: 0, y: 0, z: 0 });
        addMovementState(e, c.crouch, c.slide, c.walljump);
      });
      const decoded = encodeDecodeRoundtrip(state);
      const ms = decoded.entities.get("e1")!.getComponent("movementState") as unknown as {
        isCrouching: boolean;
        isSliding: boolean;
        wallJumpState: string;
      };
      expect(ms.isCrouching).toBe(c.crouch);
      expect(ms.isSliding).toBe(c.slide);
      expect(ms.wallJumpState === "charging").toBe(c.walljump === "charging");
    }
  });

  it("0x20 — weaponMeta roundtrips weaponId + settled", () => {
    const state = makeStateWithEntity((e) => {
      addPosition(e, { x: 0, y: 0, z: 0 });
      addWeaponMeta(e, "rlauncher", true);
    });
    const decoded = encodeDecodeRoundtrip(state);
    const wm = decoded.entities.get("e1")!.getComponent("weaponMeta") as unknown as {
      weaponId: string;
      settled: boolean;
    };
    expect(wm.weaponId).toBe("rlauncher");
    expect(wm.settled).toBe(true);
  });

  it("0x20 — weaponMeta carries forward from baseline when unchanged", () => {
    const base = makeStateWithEntity((e) => {
      addPosition(e, { x: 0, y: 0, z: 0 });
      addWeaponMeta(e, "glauncher", false);
    });
    const current = makeStateWithEntity((e) => {
      addPosition(e, { x: 1, y: 0, z: 0 }); // pos changed, weaponMeta same
      addWeaponMeta(e, "glauncher", false);
    });
    const decoded = encodeDecodeRoundtrip(current, base);
    const wm = decoded.entities.get("e1")!.getComponent("weaponMeta") as unknown as {
      weaponId: string;
      settled: boolean;
    };
    expect(wm.weaponId).toBe("glauncher");
    expect(wm.settled).toBe(false);
  });

  it("entity added after baseline is fully encoded (no carry-forward)", () => {
    const base = new GameState();
    base.tick = 0;
    const current = makeStateWithEntity((e) => {
      addPosition(e, { x: 50, y: 25, z: -10 });
      addVelocity(e, { x: 1, y: 2, z: 3 }, true);
    });
    current.tick = 1;
    const decoded = encodeDecodeRoundtrip(current, base);
    const pos = decoded.entities.get("e1")!.getComponent("position") as unknown as Vec3;
    expect(pos.x).toBeCloseTo(50, 2);
    expect(pos.y).toBeCloseTo(25, 2);
    expect(pos.z).toBeCloseTo(-10, 2);
  });

  it("entity omitted from current snapshot is not present after decode (implicit removal)", () => {
    // "Full state with delta content" model: entities missing from the snapshot
    // are not carried forward from baseline — they are gone.
    const base = new GameState();
    base.tick = 0;
    const e = new Entity("ghost");
    addPosition(e, { x: 0, y: 0, z: 0 });
    base.entities.set("ghost", e);

    const current = new GameState();
    current.tick = 1; // no entities

    const decoded = encodeDecodeRoundtrip(current, base);
    expect(decoded.entities.has("ghost")).toBe(false);
  });
});

// ── BinaryProtocol: player delta compression ──────────────────────

describe("BinaryProtocol — player delta flags", () => {
  function roundtrip(state: GameState, baseline?: GameState): GameState {
    return BinaryProtocol.decodeSnapshot(BinaryProtocol.encodeSnapshot(state, baseline), baseline);
  }

  it("carries forward unchanged player fields from baseline", () => {
    const base = new GameState();
    base.players.set("p1", makePlayer("e1", "Alice", 10, 2, 50));

    const current = new GameState();
    current.players.set("p1", makePlayer("e1", "Alice", 11, 2, 50)); // only score changed

    const decoded = roundtrip(current, base);
    const p = decoded.players.get("p1")!;
    expect(p.entityId).toBe("e1");
    expect(p.name).toBe("Alice");
    expect(p.score).toBe(11);
    expect(p.deaths).toBe(2);
    expect(p.ping).toBe(50);
  });

  it("fresh player (no baseline) encodes every field", () => {
    const current = new GameState();
    current.players.set("p1", makePlayer("e1", "Bob", 5, 1, 75));
    const decoded = roundtrip(current);
    const p = decoded.players.get("p1")!;
    expect(p).toMatchObject({ entityId: "e1", name: "Bob", score: 5, deaths: 1, ping: 75 });
  });

  it("each field updates independently", () => {
    const base = new GameState();
    base.players.set("p1", makePlayer("e1", "Alice", 0, 0, 0));

    const a = new GameState();
    a.players.set("p1", makePlayer("e1", "Alice", 7, 0, 0)); // score only
    const decodedA = roundtrip(a, base);
    expect(decodedA.players.get("p1")!.score).toBe(7);
    expect(decodedA.players.get("p1")!.ping).toBe(0);

    const b = new GameState();
    b.players.set("p1", makePlayer("e1", "Alice", 0, 0, 123)); // ping only
    const decodedB = roundtrip(b, base);
    expect(decodedB.players.get("p1")!.ping).toBe(123);
    expect(decodedB.players.get("p1")!.score).toBe(0);
  });

  it("handles many players (u16 count, not u8)", () => {
    const state = new GameState();
    for (let i = 0; i < 300; i++) {
      state.players.set(`p${i}`, makePlayer(`e${i}`, `Bot${i}`, i, 0, 50 + i));
    }
    const decoded = roundtrip(state);
    expect(decoded.players.size).toBe(300);
    expect(decoded.players.get("p299")!.name).toBe("Bot299");
    expect(decoded.players.get("p299")!.score).toBe(299);
  });
});

// ── BinaryProtocol: event serialization (all 12 types) ────────────

describe("BinaryProtocol — event serialization", () => {
  function roundtripEvents(events: Record<string, unknown>[]): Record<string, unknown>[] {
    const s = new GameState();
    s.tick = 1;
    s.events = events as GameState["events"];
    const decoded = BinaryProtocol.decodeSnapshot(BinaryProtocol.encodeSnapshot(s));
    return decoded.events as unknown as Record<string, unknown>[];
  }

  it("combat_state: health, armor, dead", () => {
    const [ev] = roundtripEvents([{ type: "combat_state", entityId: "e1", health: 75, armor: 25, dead: false }]);
    expect(ev).toEqual({ type: "combat_state", entityId: "e1", health: 75, armor: 25, dead: false });
  });

  it("combat_state: dead flag roundtrips", () => {
    const [ev] = roundtripEvents([{ type: "combat_state", entityId: "e1", health: 0, armor: 0, dead: true }]);
    expect(ev.dead).toBe(true);
  });

  it("match_state: arbitrary JSON payload", () => {
    const payload = { phase: "warmup", timeLeft: 30, teams: { red: 0, blue: 0 } };
    const [ev] = roundtripEvents([{ type: "match_state", ...payload }]);
    expect(ev).toMatchObject({ type: "match_state", ...payload });
  });

  it("weapon_state: current weapon + arrays + ammo map", () => {
    const ev0 = {
      type: "weapon_state",
      entityId: "e1",
      currentWeapon: "rlauncher",
      weapons: ["gauntlet", "rlauncher", "shotgun"],
      ammo: { rlauncher: { clip: 10, reserve: 0 }, shotgun: { clip: 8, reserve: 12 } },
      reloading: false,
      lastFireTick: 123456,
    };
    const [ev] = roundtripEvents([ev0]);
    expect(ev.entityId).toBe("e1");
    expect(ev.currentWeapon).toBe("rlauncher");
    expect(ev.weapons).toEqual(["gauntlet", "rlauncher", "shotgun"]);
    expect(ev.ammo).toEqual({ rlauncher: { clip: 10, reserve: 0 }, shotgun: { clip: 8, reserve: 12 } });
    expect(ev.reloading).toBe(false);
    expect(ev.lastFireTick).toBe(123456);
  });

  it("weapon_fire: origin and direction vectors", () => {
    const [ev] = roundtripEvents([
      {
        type: "weapon_fire",
        entityId: "e1",
        weaponId: "rlauncher",
        originX: 10,
        originY: 20,
        originZ: 30,
        dirX: 1,
        dirY: 0,
        dirZ: 0,
      },
    ]);
    expect(ev.originX).toBeCloseTo(10);
    expect(ev.originZ).toBeCloseTo(30);
    expect(ev.dirX).toBeCloseTo(1);
  });

  it("weapon_charge: charging flag", () => {
    const [a] = roundtripEvents([{ type: "weapon_charge", entityId: "e1", weaponId: "rg", charging: true }]);
    expect(a.charging).toBe(true);
    const [b] = roundtripEvents([{ type: "weapon_charge", entityId: "e1", weaponId: "rg", charging: false }]);
    expect(b.charging).toBe(false);
  });

  it("projectile_spawn: entityId + defId", () => {
    const [ev] = roundtripEvents([{ type: "projectile_spawn", entityId: "proj_42", defId: "rlauncher" }]);
    expect(ev).toEqual({ type: "projectile_spawn", entityId: "proj_42", defId: "rlauncher" });
  });

  it("projectile_impact: position + normal", () => {
    const [ev] = roundtripEvents([
      {
        type: "projectile_impact",
        defId: "rlauncher",
        x: 1,
        y: 2,
        z: 3,
        normalX: 0,
        normalY: 1,
        normalZ: 0,
      },
    ]);
    expect(ev.x).toBeCloseTo(1);
    expect(ev.normalY).toBeCloseTo(1);
  });

  it("item_pickup: pickupId can be -1 (int16) when absent", () => {
    const [ev] = roundtripEvents([
      {
        type: "item_pickup",
        weaponId: "rlauncher",
        entityId: "e1",
        droppedWeaponId: "",
        x: 0,
        y: 0,
        z: 0,
        // pickupId omitted → encoder writes -1
      },
    ]);
    expect(ev.pickupId).toBe(-1);
    expect(ev.droppedWeaponId).toBe("");
  });

  it("item_pickup: preserves positive pickupId", () => {
    const [ev] = roundtripEvents([
      {
        type: "item_pickup",
        pickupId: 1234,
        weaponId: "rlauncher",
        entityId: "e1",
        droppedWeaponId: "rlauncher",
        x: 1,
        y: 2,
        z: 3,
      },
    ]);
    expect(ev.pickupId).toBe(1234);
  });

  it("weapon_drop: position + velocity", () => {
    const [ev] = roundtripEvents([
      {
        type: "weapon_drop",
        entityId: "e1",
        weaponId: "rlauncher",
        x: 5,
        y: 10,
        z: -3,
        velX: 0,
        velY: 4,
        velZ: 0,
      },
    ]);
    expect(ev.x).toBeCloseTo(5);
    expect(ev.velY).toBeCloseTo(4);
  });

  it("damage: attacker + damage + victim position", () => {
    const [ev] = roundtripEvents([
      {
        type: "damage",
        entityId: "victim",
        attackerId: "killer",
        damage: 50,
        weaponId: "rlauncher",
        x: 100,
        y: 50,
        z: -20,
      },
    ]);
    expect(ev.damage).toBe(50);
    expect(ev.attackerId).toBe("killer");
  });

  it("death: full kill metadata with velocity and knockback", () => {
    const [ev] = roundtripEvents([
      {
        type: "death",
        entityId: "victim",
        killerId: "killer",
        weaponId: "rlauncher",
        damageType: "splash",
        finalDamage: 120,
        x: 10,
        y: 20,
        z: 30,
        velX: 1,
        velY: 2,
        velZ: 3,
        kbDirX: 0,
        kbDirY: 0,
        kbDirZ: -1,
      },
    ]);
    expect(ev.damageType).toBe("splash");
    expect(ev.finalDamage).toBe(120);
    expect(ev.kbDirZ).toBeCloseTo(-1);
  });

  it("award: stable fields", () => {
    const [ev] = roundtripEvents([
      {
        type: "award",
        awardType: "headshot",
        playerId: "p1",
        playerName: "Alice",
        targetName: "Bob",
        value: 1,
      },
    ]);
    expect(ev).toMatchObject({
      type: "award",
      awardType: "headshot",
      playerId: "p1",
      playerName: "Alice",
      targetName: "Bob",
      value: 1,
    });
  });

  it("chat: stable fields incl. UTF-8 text (WO-C1)", () => {
    const [ev] = roundtripEvents([
      {
        type: "chat",
        senderId: "player_3",
        senderName: "washoi_dev",
        team: "udon",
        text: "nice rocket! 🚀 <script>alert(1)</script>",
      },
    ]);
    expect(ev).toMatchObject({
      type: "chat",
      senderId: "player_3",
      senderName: "washoi_dev",
      team: "udon",
      // Codec is transparent — sanitization is the server's job, escaping the renderer's
      text: "nice rocket! 🚀 <script>alert(1)</script>",
    });
  });

  it("pickup_notify: stable fields (WO-#5/#7)", () => {
    const [ev] = roundtripEvents([{ type: "pickup_notify", entityId: "player_4", label: "Green Armor" }]);
    expect(ev).toMatchObject({ type: "pickup_notify", entityId: "player_4", label: "Green Armor" });
  });

  it("knockback_state: drag age and explicit inactive state", () => {
    const events = [
      { type: "knockback_state", entityId: "player_1", ageTicks: 0 },
      { type: "knockback_state", entityId: "player_1", ageTicks: 125 },
      { type: "knockback_state", entityId: "player_1", ageTicks: null },
    ];
    expect(roundtripEvents(events)).toEqual(events);
  });

  it("knockback_state: a value that is not a byte age travels as inactive, not truncated", () => {
    const decoded = roundtripEvents([
      { type: "knockback_state", entityId: "p", ageTicks: 300 },
      { type: "knockback_state", entityId: "p", ageTicks: -1 },
      { type: "knockback_state", entityId: "p", ageTicks: 2.5 },
    ]);
    expect(decoded.map((e) => e.ageTicks)).toEqual([null, null, null]);
  });

  it("knockback_state: keeps the stream aligned for the event after it", () => {
    const [kb, combat] = roundtripEvents([
      { type: "knockback_state", entityId: "player_1", ageTicks: 7 },
      { type: "combat_state", entityId: "player_1", health: 50, armor: 10, dead: false },
    ]);
    expect(kb).toEqual({ type: "knockback_state", entityId: "player_1", ageTicks: 7 });
    expect(combat).toEqual({ type: "combat_state", entityId: "player_1", health: 50, armor: 10, dead: false });
  });

  it("preserves event order across roundtrip", () => {
    const events = [
      {
        type: "weapon_fire",
        entityId: "e1",
        weaponId: "rg",
        originX: 0,
        originY: 0,
        originZ: 0,
        dirX: 0,
        dirY: 0,
        dirZ: 1,
      },
      { type: "damage", entityId: "e2", attackerId: "e1", damage: 10, weaponId: "rg", x: 0, y: 0, z: 0 },
      {
        type: "death",
        entityId: "e2",
        killerId: "e1",
        weaponId: "rg",
        damageType: "dir",
        finalDamage: 100,
        x: 0,
        y: 0,
        z: 0,
        velX: 0,
        velY: 0,
        velZ: 0,
        kbDirX: 0,
        kbDirY: 0,
        kbDirZ: 0,
      },
    ];
    const decoded = roundtripEvents(events);
    expect(decoded.map((e) => e.type)).toEqual(["weapon_fire", "damage", "death"]);
  });

  it("encodes a lot of events without corruption (u16 count)", () => {
    const events = Array.from({ length: 500 }, (_, i) => ({
      type: "combat_state",
      entityId: `e${i}`,
      health: i % 101,
      armor: (i * 2) % 101,
      dead: i % 7 === 0,
    }));
    const decoded = roundtripEvents(events);
    expect(decoded.length).toBe(500);
    expect(decoded[499].entityId).toBe("e499");
  });
});

// ── BinaryProtocol: command edge cases ────────────────────────────

describe("BinaryProtocol — command edge cases", () => {
  it("missing optional fields default to 0", () => {
    const encoded = BinaryProtocol.encodeCommand("p1", 1, {} as NetworkCommand);
    const decoded = BinaryProtocol.decodeCommand(encoded);
    expect(decoded.command.direction).toEqual({ x: 0, y: 0, z: 0 });
    expect(decoded.command.pitch).toBe(0);
    expect(decoded.command.yaw).toBe(0);
    expect(decoded.command.buttons).toBe(0);
    expect(decoded.command.tick).toBe(0);
    expect(decoded.command.weaponSlot).toBe(0);
  });

  it("preserves weaponSlot (u8, 0..255)", () => {
    for (const slot of [0, 1, 7, 255]) {
      const encoded = BinaryProtocol.encodeCommand("p1", 1, { weaponSlot: slot });
      const decoded = BinaryProtocol.decodeCommand(encoded);
      expect(decoded.command.weaponSlot).toBe(slot);
    }
  });

  it("preserves button bitfield (u16, up to 0xFFFF)", () => {
    for (const buttons of [0, 1, 0b1010_1010, 0xffff]) {
      const encoded = BinaryProtocol.encodeCommand("p1", 1, { buttons });
      const decoded = BinaryProtocol.decodeCommand(encoded);
      expect(decoded.command.buttons).toBe(buttons);
    }
  });

  it("preserves large sequence numbers (u32)", () => {
    const encoded = BinaryProtocol.encodeCommand("p1", 0xfffffff0, { buttons: 0 });
    const decoded = BinaryProtocol.decodeCommand(encoded);
    expect(decoded.sequence).toBe(0xfffffff0);
  });

  it("MessageCodec.decodeCommand rejects non-Input bytes", () => {
    const wrong = MessageCodec.encodeAck(0);
    expect(() => MessageCodec.decodeCommand(wrong)).toThrow(/Expected Input/);
  });
});

// ── Snapshot header stability ─────────────────────────────────────

describe("BinaryProtocol — snapshot header", () => {
  it("carries tick and ackedInputSeq through encode/decode", () => {
    const s = new GameState();
    s.tick = 0xabcd1234;
    s.ackedInputSeq = 0x1122_3344;
    const decoded = BinaryProtocol.decodeSnapshot(BinaryProtocol.encodeSnapshot(s));
    expect(decoded.tick).toBe(0xabcd1234);
    expect(decoded.ackedInputSeq).toBe(0x1122_3344);
  });

  it("populates serverTimestamp with a plausible Date.now() value", () => {
    const s = new GameState();
    s.tick = 1;
    const before = Date.now();
    const decoded = BinaryProtocol.decodeSnapshot(BinaryProtocol.encodeSnapshot(s));
    const after = Date.now();
    // serverTimestamp is stamped at encode time — must fall within [before, after].
    expect(decoded.serverTimestamp).toBeGreaterThanOrEqual(before);
    expect(decoded.serverTimestamp).toBeLessThanOrEqual(after);
  });
});

// ── StateEncoder / StateDecoder re-export parity ───────────────────

describe("StateEncoder/StateDecoder — deprecated aliases", () => {
  it("StateEncoder is BinaryEncoder", () => {
    // Re-export identity check: constructing through either gets the same class.
    expect(StateEncoder).toBe(BinaryEncoder);
  });

  it("StateDecoder is BinaryDecoder", () => {
    expect(StateDecoder).toBe(BinaryDecoder);
  });

  it("StateEncoder instance behaves identically to BinaryEncoder", () => {
    const a = new StateEncoder(32);
    a.writeUint32(0xcafebabe);
    a.writeString("hi");
    const b = new BinaryEncoder(32);
    b.writeUint32(0xcafebabe);
    b.writeString("hi");
    expect(a.getData()).toEqual(b.getData());
  });
});

// ── MessageCodec.encodeSnapshot / decodeSnapshot envelope ─────────

describe("MessageCodec.encodeSnapshot — envelope", () => {
  it("prepends the Snapshot MessageType byte", () => {
    const s = new GameState();
    s.tick = 42;
    const wrapped = MessageCodec.encodeSnapshot(s);
    expect(wrapped[0]).toBe(MessageType.Snapshot);
    // type + hasBaseline + baselineTick; raw demo payload stays unchanged.
    const raw = BinaryProtocol.encodeSnapshot(s);
    expect(wrapped.length).toBe(raw.length + 6);
  });

  it("decodeSnapshot reverses encodeSnapshot with baseline", () => {
    const base = new GameState();
    base.tick = 1;
    base.players.set("p1", makePlayer("e1", "Alice", 0, 0, 0));

    const current = new GameState();
    current.tick = 2;
    current.players.set("p1", makePlayer("e1", "Alice", 3, 0, 0));

    const wrapped = MessageCodec.encodeSnapshot(current, base);
    const decoded = MessageCodec.decodeSnapshot(wrapped, base);
    expect(decoded.tick).toBe(2);
    expect(decoded.players.get("p1")!.score).toBe(3);
  });

  it("rejects non-Snapshot bytes", () => {
    expect(() => MessageCodec.decodeSnapshot(MessageCodec.encodeReady())).toThrow(/Expected Snapshot/);
  });
});
