import type { MoveCommand } from "../core/Command";
import type { IComponent } from "../core/Component";
import { Entity } from "../core/Entity";
import { GameState } from "../core/GameState";
import { GameSystem, Simulation, type SimulationConfig } from "../core/Simulation";

// Simple position component for testing
class PositionComponent implements IComponent {
  x: number = 0;
  y: number = 0;
  z: number = 0;

  serialize(encoder: any): void {
    encoder.writeFloat32(this.x);
    encoder.writeFloat32(this.y);
    encoder.writeFloat32(this.z);
  }

  deserialize(decoder: any): void {
    this.x = decoder.readFloat32();
    this.y = decoder.readFloat32();
    this.z = decoder.readFloat32();
  }

  clone(): PositionComponent {
    const c = new PositionComponent();
    c.x = this.x;
    c.y = this.y;
    c.z = this.z;
    return c;
  }
}

// Simple velocity component
class VelocityComponent implements IComponent {
  x: number = 0;
  y: number = 0;
  z: number = 0;

  serialize(encoder: any): void {
    encoder.writeFloat32(this.x);
    encoder.writeFloat32(this.y);
    encoder.writeFloat32(this.z);
  }

  deserialize(decoder: any): void {
    this.x = decoder.readFloat32();
    this.y = decoder.readFloat32();
    this.z = decoder.readFloat32();
  }

  clone(): VelocityComponent {
    const c = new VelocityComponent();
    c.x = this.x;
    c.y = this.y;
    c.z = this.z;
    return c;
  }
}

// Movement system
class MovementSystem extends GameSystem {
  update(state: GameState, deltaTime: number): void {
    for (const entity of state.entities.values()) {
      const pos = entity.getComponent<PositionComponent>("position");
      const vel = entity.getComponent<VelocityComponent>("velocity");

      if (pos && vel) {
        pos.x += vel.x * deltaTime;
        pos.y += vel.y * deltaTime;
        pos.z += vel.z * deltaTime;
      }
    }
  }
}

// Test simulation implementation
class TestSimulation extends Simulation {
  protected createInitialState(): GameState {
    const state = new GameState();

    // Create test entity
    const entity = new Entity("test-entity");
    entity.addComponent("position", new PositionComponent());
    entity.addComponent("velocity", new VelocityComponent());
    state.entities.set("test-entity", entity);

    return state;
  }

  protected registerSystems(): void {
    this.addSystem(new MovementSystem());
  }

  protected registerCommandHandlers(): void {
    this.onCommand("move", (state, cmd) => {
      const moveCmd = cmd as MoveCommand;
      const entity = state.entities.get("test-entity");
      if (entity) {
        const vel = entity.getComponent("velocity") as VelocityComponent;
        if (vel) {
          vel.x = moveCmd.direction.x * 100;
          vel.y = moveCmd.direction.y * 100;
          vel.z = moveCmd.direction.z * 100;
        }
      }
    });
  }
}

// Test configuration
const testConfig: SimulationConfig = {
  tickRate: 20,
  tickDuration: 50,
  maxPlayers: 16,
  gameRules: {},
};

// Export for testing
export { TestSimulation, testConfig, PositionComponent, VelocityComponent };
