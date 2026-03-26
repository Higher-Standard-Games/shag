import { MoveCommand } from "../../network/core/Command";
import { Entity } from "../../network/core/Entity";
import { GameState } from "../../network/core/GameState";
import { BinaryProtocol } from "../../network/protocol/BinaryProtocol";
import { Command } from "../Command";

/**
 * Test command for binary protocol
 */
export default class BinaryTestCommand extends Command {
  readonly definition = {
    name: "binarytest",
    description: "Test binary protocol encoding/decoding",
    usage: "binarytest <subcommand>",
    subcommands: [
      { name: "encode", description: "Test state encoding" },
      { name: "decode", description: "Test state decoding" },
      { name: "delta", description: "Test delta compression" },
      { name: "command", description: "Test command encoding" },
      { name: "help", description: "Show this help" },
    ],
  };

  async execute(args: string[]): Promise<string> {
    const subcommand = args[0]?.toLowerCase();

    switch (subcommand) {
      case "encode":
        return this.testEncoding();

      case "decode":
        return this.testDecoding();

      case "delta":
        return this.testDeltaCompression();

      case "command":
        return this.testCommandEncoding();

      default:
        return this.showHelp();
    }
  }

  private testEncoding(): string {
    try {
      // Create test state
      const state = new GameState();
      state.tick = 100;

      // Add test entity
      const entity = new Entity("test-entity");
      entity.addComponent("position", {
        x: 1.5,
        y: 2.0,
        z: -3.5,
        serialize() {
          return {};
        },
        deserialize() {},
        clone() {
          return { ...this };
        },
      });
      entity.addComponent("velocity", {
        x: 0.1,
        y: 0.2,
        z: 0.3,
        serialize() {
          return {};
        },
        deserialize() {},
        clone() {
          return { ...this };
        },
      });
      state.entities.set("test-entity", entity);

      // Add test player
      const player = {
        entityId: "test-entity",
        name: "TestPlayer",
        team: "red",
        score: 100,
        deaths: 0,
        ping: 50,
        serialize() {
          return {};
        },
        deserialize() {},
        clone() {
          return { ...this };
        },
      };
      state.players.set("player1", player);

      // Encode state
      const encoded = BinaryProtocol.encodeSnapshot(state);

      return (
        `✅ Encoding test passed\n` +
        `   State tick: ${state.tick}\n` +
        `   Entities: ${state.entities.size}\n` +
        `   Players: ${state.players.size}\n` +
        `   Encoded size: ${encoded.length} bytes`
      );
    } catch (error) {
      return `❌ Encoding test failed: ${error}`;
    }
  }

  private testDecoding(): string {
    try {
      // Create test state
      const originalState = new GameState();
      originalState.tick = 200;

      const entity = new Entity("test-entity");
      entity.addComponent("position", {
        x: 5.0,
        y: -2.0,
        z: 10.0,
        serialize() {
          return {};
        },
        deserialize() {},
        clone() {
          return { ...this };
        },
      });
      originalState.entities.set("test-entity", entity);

      // Encode and decode
      const encoded = BinaryProtocol.encodeSnapshot(originalState);
      const decodedState = BinaryProtocol.decodeSnapshot(encoded);

      // Verify
      const decodedEntity = decodedState.entities.get("test-entity");
      const decodedPos = decodedEntity?.getComponent("position") as any;

      return (
        `✅ Decoding test passed\n` +
        `   Original tick: ${originalState.tick}\n` +
        `   Decoded tick: ${decodedState.tick}\n` +
        `   Position: (${decodedPos?.x.toFixed(2)}, ${decodedPos?.y.toFixed(2)}, ${decodedPos?.z.toFixed(2)})`
      );
    } catch (error) {
      return `❌ Decoding test failed: ${error}`;
    }
  }

  private testDeltaCompression(): string {
    try {
      // Create baseline state
      const baseline = new GameState();
      baseline.tick = 100;

      const entity = new Entity("test-entity");
      entity.addComponent("position", {
        x: 1.0,
        y: 1.0,
        z: 1.0,
        serialize() {
          return {};
        },
        deserialize() {},
        clone() {
          return { ...this };
        },
      });
      entity.addComponent("velocity", {
        x: 0.0,
        y: 0.0,
        z: 0.0,
        serialize() {
          return {};
        },
        deserialize() {},
        clone() {
          return { ...this };
        },
      });
      baseline.entities.set("test-entity", entity);

      // Create new state with changes
      const newState = new GameState();
      newState.tick = 101;

      const newEntity = new Entity("test-entity");
      newEntity.addComponent("position", {
        x: 2.0,
        y: 1.0,
        z: 1.0, // Only X changed
        serialize() {
          return {};
        },
        deserialize() {},
        clone() {
          return { ...this };
        },
      });
      // Velocity unchanged - should be delta compressed out
      newEntity.addComponent("velocity", {
        x: 0.0,
        y: 0.0,
        z: 0.0,
        serialize() {
          return {};
        },
        deserialize() {},
        clone() {
          return { ...this };
        },
      });
      newState.entities.set("test-entity", newEntity);

      // Encode with and without baseline
      const fullEncoded = BinaryProtocol.encodeSnapshot(newState);
      const deltaEncoded = BinaryProtocol.encodeSnapshot(newState, baseline);

      // Decode delta
      const decodedState = BinaryProtocol.decodeSnapshot(deltaEncoded, baseline);

      return (
        `✅ Delta compression test passed\n` +
        `   Full encoding: ${fullEncoded.length} bytes\n` +
        `   Delta encoding: ${deltaEncoded.length} bytes\n` +
        `   Compression: ${((1 - deltaEncoded.length / fullEncoded.length) * 100).toFixed(1)}%\n` +
        `   Decoded tick: ${decodedState.tick}`
      );
    } catch (error) {
      return `❌ Delta compression test failed: ${error}`;
    }
  }

  private testCommandEncoding(): string {
    try {
      // Create test command
      const command = new MoveCommand("player1", 101, 5, { x: 1.0, y: 0.0, z: 0.0 }, 0.5, 0, 0);

      // Encode
      const encoded = BinaryProtocol.encodeCommand("player1", 5, command);

      // Decode
      const decoded = BinaryProtocol.decodeCommand(encoded);

      return (
        `✅ Command encoding test passed\n` +
        `   Player ID: ${decoded.playerId}\n` +
        `   Sequence: ${decoded.sequence}\n` +
        `   Command type: ${decoded.command.type}\n` +
        `   Encoded size: ${encoded.length} bytes`
      );
    } catch (error) {
      return `❌ Command encoding test failed: ${error}`;
    }
  }

  private showHelp(): string {
    return (
      `Binary Protocol Test Commands:\n` +
      `  binarytest encode   - Test state encoding\n` +
      `  binarytest decode   - Test state decoding\n` +
      `  binarytest delta    - Test delta compression\n` +
      `  binarytest command  - Test command encoding\n` +
      `  binarytest help     - Show this help`
    );
  }
}
