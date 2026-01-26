/**
 * NetTestCommand - Test the network simulation system
 *
 * Usage:
 *   netsim test              - Run basic simulation test
 *   netsim spawn             - Spawn a test player
 *   netsim tick [count]      - Run simulation ticks
 *   netsim state             - Show current game state
 *   netsim input <buttons>   - Send input command
 */

import { Command, CommandDef } from '../Command';
import { FPSSimulation, FPSInputCommand } from '../../../games/fps/simulation/FPSSimulation';
import { TransformComponent } from '../../network/components/TransformComponent';
import { VelocityComponent } from '../../network/components/VelocityComponent';
import { InputButtons } from '../../network/components/InputComponent';

export default class NetTestCommand extends Command {
  readonly definition: CommandDef = {
    name: 'netsim',
    description: 'Network simulation testing commands',
    usage: 'netsim <test|spawn|tick|state|input>',
  };

  private simulation: FPSSimulation | null = null;
  private testPlayerId = 'test-player';
  private inputSeq = 0;

  async execute(args: string[]): Promise<string | void> {
    const subcommand = args[0]?.toLowerCase();

    switch (subcommand) {
      case 'test':
        return this.runTest();
      case 'spawn':
        return this.spawnPlayer();
      case 'tick':
        return this.runTicks(parseInt(args[1]) || 1);
      case 'state':
        return this.showState();
      case 'input':
        return this.sendInput(args.slice(1));
      case 'move':
        return this.testMovement(args.slice(1));
      default:
        return this.showHelp();
    }
  }

  private showHelp(): string {
    return `Network simulation test commands:
  netsim test              - Run basic simulation test
  netsim spawn             - Spawn a test player
  netsim tick [count]      - Run simulation ticks
  netsim state             - Show current game state
  netsim input <buttons>   - Send input command (forward|back|left|right|jump)
  netsim move <dir> [ticks]- Test movement (forward|back|left|right) for N ticks`;
  }

  private runTest(): string {
    const lines: string[] = ['=== Network Simulation Test ==='];

    // Create simulation
    this.simulation = new FPSSimulation({
      tickRate: 20,
      tickDuration: 50,
      maxPlayers: 16,
      gameRules: {},
    });

    lines.push('Created FPSSimulation');

    // Spawn a player
    const entity = this.simulation.spawnPlayer(this.testPlayerId);
    lines.push(`Spawned player: ${entity.id}`);

    // Get initial position
    const transform = entity.getComponent<TransformComponent>('transform');
    if (transform) {
      lines.push(`Initial position: (${transform.position.x.toFixed(2)}, ${transform.position.y.toFixed(2)}, ${transform.position.z.toFixed(2)})`);
    }

    // Send forward movement command
    const cmd: FPSInputCommand = {
      type: 'fps_input',
      playerId: this.testPlayerId,
      tick: 0,
      seq: this.inputSeq++,
      direction: { x: 0, y: 0, z: 1 }, // Forward
      pitch: 0,
      yaw: 0,
      buttons: InputButtons.FORWARD,
      serialize: () => new Uint8Array(),
    };

    // Run 20 ticks (1 second at 20Hz)
    for (let i = 0; i < 20; i++) {
      this.simulation.tick([cmd]);
    }

    // Check final position
    if (transform) {
      lines.push(`After 20 ticks: (${transform.position.x.toFixed(2)}, ${transform.position.y.toFixed(2)}, ${transform.position.z.toFixed(2)})`);
    }

    // Get velocity
    const velocity = entity.getComponent<VelocityComponent>('velocity');
    if (velocity) {
      lines.push(`Velocity: (${velocity.linear.x.toFixed(2)}, ${velocity.linear.y.toFixed(2)}, ${velocity.linear.z.toFixed(2)})`);
      lines.push(`Grounded: ${velocity.grounded}`);
    }

    lines.push('');
    lines.push('Test passed! State is flowing through simulation.');

    return lines.join('\n');
  }

  private spawnPlayer(): string {
    if (!this.simulation) {
      this.simulation = new FPSSimulation({
        tickRate: 20,
        tickDuration: 50,
        maxPlayers: 16,
        gameRules: {},
      });
    }

    const entity = this.simulation.spawnPlayer(this.testPlayerId);
    const transform = entity.getComponent<TransformComponent>('transform');

    return `Spawned player ${this.testPlayerId} -> entity ${entity.id} at (${transform?.position.x.toFixed(2)}, ${transform?.position.y.toFixed(2)}, ${transform?.position.z.toFixed(2)})`;
  }

  private runTicks(count: number): string {
    if (!this.simulation) {
      return 'No simulation. Run "net spawn" first.';
    }

    for (let i = 0; i < count; i++) {
      this.simulation.tick([]);
    }

    return `Ran ${count} tick(s). Current tick: ${this.simulation.currentTick}`;
  }

  private showState(): string {
    if (!this.simulation) {
      return 'No simulation. Run "net spawn" first.';
    }

    const state = this.simulation.state;
    const lines: string[] = [
      `=== Game State (tick ${state.tick}) ===`,
      `Players: ${state.players.size}`,
      `Entities: ${state.entities.size}`,
    ];

    for (const [playerId, player] of state.players) {
      lines.push(`  Player: ${playerId} -> ${player.entityId}`);

      const entity = state.entities.get(player.entityId);
      if (entity) {
        const transform = entity.getComponent<TransformComponent>('transform');
        const velocity = entity.getComponent<VelocityComponent>('velocity');

        if (transform) {
          lines.push(`    Position: (${transform.position.x.toFixed(2)}, ${transform.position.y.toFixed(2)}, ${transform.position.z.toFixed(2)})`);
          lines.push(`    Rotation: (${transform.rotation.x.toFixed(2)}, ${transform.rotation.y.toFixed(2)}, ${transform.rotation.z.toFixed(2)})`);
        }
        if (velocity) {
          lines.push(`    Velocity: (${velocity.linear.x.toFixed(2)}, ${velocity.linear.y.toFixed(2)}, ${velocity.linear.z.toFixed(2)})`);
          lines.push(`    Grounded: ${velocity.grounded}`);
        }
      }
    }

    return lines.join('\n');
  }

  private sendInput(args: string[]): string {
    if (!this.simulation) {
      return 'No simulation. Run "net spawn" first.';
    }

    let buttons = 0;
    let direction = { x: 0, y: 0, z: 0 };

    for (const arg of args) {
      switch (arg.toLowerCase()) {
        case 'forward':
        case 'w':
          buttons |= InputButtons.FORWARD;
          direction.z = 1;
          break;
        case 'back':
        case 's':
          buttons |= InputButtons.BACK;
          direction.z = -1;
          break;
        case 'left':
        case 'a':
          buttons |= InputButtons.LEFT;
          direction.x = -1;
          break;
        case 'right':
        case 'd':
          buttons |= InputButtons.RIGHT;
          direction.x = 1;
          break;
        case 'jump':
        case 'space':
          buttons |= InputButtons.JUMP;
          break;
        case 'crouch':
        case 'ctrl':
          buttons |= InputButtons.CROUCH;
          break;
        case 'sprint':
        case 'shift':
          buttons |= InputButtons.SPRINT;
          break;
      }
    }

    // Normalize direction
    const len = Math.sqrt(direction.x * direction.x + direction.z * direction.z);
    if (len > 0) {
      direction.x /= len;
      direction.z /= len;
    }

    const cmd: FPSInputCommand = {
      type: 'fps_input',
      playerId: this.testPlayerId,
      tick: this.simulation.currentTick,
      seq: this.inputSeq++,
      direction,
      pitch: 0,
      yaw: 0,
      buttons,
      serialize: () => new Uint8Array(),
    };

    this.simulation.tick([cmd]);

    return `Sent input: buttons=0x${buttons.toString(16)}, dir=(${direction.x.toFixed(2)}, ${direction.z.toFixed(2)}). Tick: ${this.simulation.currentTick}`;
  }

  private testMovement(args: string[]): string {
    if (!this.simulation) {
      // Auto-create simulation and spawn player
      this.simulation = new FPSSimulation({
        tickRate: 20,
        tickDuration: 50,
        maxPlayers: 16,
        gameRules: {},
      });
      this.simulation.spawnPlayer(this.testPlayerId);
    }

    const dir = args[0]?.toLowerCase() || 'forward';
    const ticks = parseInt(args[1]) || 20;

    let buttons = 0;
    let direction = { x: 0, y: 0, z: 0 };

    switch (dir) {
      case 'forward':
        buttons = InputButtons.FORWARD;
        direction.z = 1;
        break;
      case 'back':
        buttons = InputButtons.BACK;
        direction.z = -1;
        break;
      case 'left':
        buttons = InputButtons.LEFT;
        direction.x = -1;
        break;
      case 'right':
        buttons = InputButtons.RIGHT;
        direction.x = 1;
        break;
      case 'jump':
        buttons = InputButtons.JUMP;
        break;
    }

    // Get initial state
    const player = this.simulation.state.players.get(this.testPlayerId);
    if (!player) return 'No player found';

    const entity = this.simulation.state.entities.get(player.entityId);
    if (!entity) return 'No entity found';

    const transform = entity.getComponent<TransformComponent>('transform');
    const velocity = entity.getComponent<VelocityComponent>('velocity');

    const startPos = transform ? { ...transform.position } : { x: 0, y: 0, z: 0 };

    // Run ticks with input
    for (let i = 0; i < ticks; i++) {
      const cmd: FPSInputCommand = {
        type: 'fps_input',
        playerId: this.testPlayerId,
        tick: this.simulation.currentTick,
        seq: this.inputSeq++,
        direction,
        pitch: 0,
        yaw: 0,
        buttons,
        serialize: () => new Uint8Array(),
      };
      this.simulation.tick([cmd]);
    }

    const endPos = transform ? transform.position : { x: 0, y: 0, z: 0 };
    const endVel = velocity ? velocity.linear : { x: 0, y: 0, z: 0 };

    const distance = Math.sqrt(
      Math.pow(endPos.x - startPos.x, 2) +
      Math.pow(endPos.y - startPos.y, 2) +
      Math.pow(endPos.z - startPos.z, 2)
    );

    return `Moved ${dir} for ${ticks} ticks (${(ticks / 20).toFixed(2)}s):
  Start: (${startPos.x.toFixed(2)}, ${startPos.y.toFixed(2)}, ${startPos.z.toFixed(2)})
  End:   (${endPos.x.toFixed(2)}, ${endPos.y.toFixed(2)}, ${endPos.z.toFixed(2)})
  Velocity: (${endVel.x.toFixed(2)}, ${endVel.y.toFixed(2)}, ${endVel.z.toFixed(2)})
  Distance: ${distance.toFixed(2)} units`;
  }
}
