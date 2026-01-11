import { Command } from '../Command';
import { LocalGameHost } from '../../network/client/hosts/LocalGameHost';
import { TestSimulation, testConfig } from '../../network/test/TestSimulation';
import { MoveCommand } from '../../network/core/Command';

/**
 * Test command for networking infrastructure
 */
export default class NetworkTestCommand extends Command {
  readonly definition = {
    name: 'nettest',
    description: 'Test networking infrastructure',
    usage: 'nettest <subcommand>',
    subcommands: [
      { name: 'local', description: 'Test LocalGameHost' },
      { name: 'simulation', description: 'Test simulation' },
      { name: 'help', description: 'Show this help' }
    ]
  };

  async execute(args: string[]): Promise<string> {
    const subcommand = args[0]?.toLowerCase();

    switch (subcommand) {
      case 'local':
        return this.testLocalHost();
      
      case 'simulation':
        return this.testSimulation();
      
      default:
        return this.showHelp();
    }
  }

  private testLocalHost(): string {
    try {
      const host = new LocalGameHost(testConfig, TestSimulation);
      host.start();
      
      // Send a test command
      const moveCmd = new MoveCommand(
        'test-player',
        0,
        1,
        { x: 1, y: 0, z: 0 },
        0,
        0,
        0
      );
      
      host.sendCommand(moveCmd);
      
      const state = host.getLocalState();
      const entity = state.entities.get('test-entity');
      const pos = entity?.getComponent('position') as any;
      
      host.stop();
      
      return `✅ LocalGameHost test passed\n` +
             `   Entity count: ${state.entities.size}\n` +
             `   Position: (${pos?.x.toFixed(2)}, ${pos?.y.toFixed(2)}, ${pos?.z.toFixed(2)})`;
    } catch (error) {
      return `❌ LocalGameHost test failed: ${error}`;
    }
  }

  private testSimulation(): string {
    try {
      const simulation = new TestSimulation(testConfig);
      
      // Send a move command
      const moveCmd = new MoveCommand(
        'test-player',
        0,
        1,
        { x: 1, y: 0, z: 0 },
        0,
        0,
        0
      );
      
      simulation.tick([moveCmd]);
      
      const state = simulation.state;
      const entity = state.entities.get('test-entity');
      const pos = entity?.getComponent('position') as any;
      const vel = entity?.getComponent('velocity') as any;
      
      return `✅ Simulation test passed\n` +
             `   Tick: ${simulation.currentTick}\n` +
             `   Position: (${pos?.x.toFixed(2)}, ${pos?.y.toFixed(2)}, ${pos?.z.toFixed(2)})\n` +
             `   Velocity: (${vel?.x.toFixed(2)}, ${vel?.y.toFixed(2)}, ${vel?.z.toFixed(2)})`;
    } catch (error) {
      return `❌ Simulation test failed: ${error}`;
    }
  }

  private showHelp(): string {
    return `Network Test Commands:\n` +
           `  nettest local      - Test LocalGameHost\n` +
           `  nettest simulation - Test simulation\n` +
           `  nettest help       - Show this help`;
  }
}
