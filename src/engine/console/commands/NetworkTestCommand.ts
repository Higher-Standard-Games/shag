import { Command } from '../Command';
import type { IGameHost } from '../../network/core/IGameHost';
import { LocalGameHost } from '../../network/client/hosts/LocalGameHost';
import { TestSimulation, testConfig } from '../../network/test/TestSimulation';
import { MoveCommand } from '../../network/core/Command';
// Note: Old WebSocketServer was deleted. Use headless-netserver-v2.ts for server testing

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
      { name: 'network', description: 'Test networked host (mock)' },
      { name: 'server', description: 'Test server infrastructure' },
      { name: 'help', description: 'Show this help' }
    ]
  };

  async execute(args: string[]): Promise<string> {
    const subcommand = args[0]?.toLowerCase();

    switch (subcommand) {
      case 'local':
        return this.testLocalHost();

      case 'network':
        return this.testNetworked();

      case 'server':
        return this.testServer();

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

  private testNetworked(): string {
    try {
      // Mock networked host for testing
      const mockHost = new MockNetworkHost(testConfig, TestSimulation);
      mockHost.start();

      // Test prediction
      const moveCmd = new MoveCommand(
        'network-player',
        0,
        1,
        { x: 2, y: 0, z: 0 },
        0,
        0,
        0
      );

      mockHost.sendCommand(moveCmd);

      // Simulate receiving server update
      mockHost.simulateServerUpdate();

      const localState = mockHost.getLocalState();
      const entity = localState.entities.get('test-entity');
      const pos = entity?.getComponent('position') as any;

      mockHost.stop();

      return `✅ Networked host test passed\n` +
        `   Local prediction: (${pos?.x.toFixed(2)}, ${pos?.y.toFixed(2)}, ${pos?.z.toFixed(2)})\n` +
        `   Commands pending: ${mockHost.getPendingCommands()}\n` +
        `   Current tick: ${mockHost.getCurrentTick()}`;
    } catch (error) {
      return `❌ Networked host test failed: ${error}`;
    }
  }

  private testServer(): string {
    // Server testing now uses the dedicated headless server (v2 architecture)
    // The old in-process WebSocketServer was removed in favor of:
    // - Real server: npm run net:server -- --map wdm7
    // - The new server uses Simulation + WorldState + Subsystems
    return `ℹ️ Server testing moved to dedicated server process

To test the game server:
  1. Start server: npm run net:server -- --map wdm7
  2. Connect client: Open http://localhost:3000 and run 'connect localhost:7777'

The v2 server uses:
  - WebSocket transport (WebTransport ready when package available)
  - Simulation + WorldState + Subsystems architecture
  - BSP collision for physics
  - 4 subsystems: CharacterPhysics, Projectile, Weapon, Combat`;
  }

  private showHelp(): string {
    return `Network Test Commands:\n` +
      `  nettest local      - Test LocalGameHost\n` +
      `  nettest simulation - Test simulation\n` +
      `  nettest network    - Test networked host (mock)\n` +
      `  nettest server     - Test server infrastructure\n` +
      `  nettest help       - Show this help`;
  }
}

/**
 * Mock networked host for testing client prediction
 */
class MockNetworkHost implements IGameHost {
  readonly localPlayerId = 'network-player';
  currentTick = 0;

  private simulation: any;
  private pendingCommands: any[] = [];
  private localState: any;
  private isRunning = false;

  constructor(config: any, SimulationClass: any) {
    this.simulation = new SimulationClass(config);
    this.localState = this.simulation.state.clone();
  }

  sendCommand(cmd: any): void {
    // Add to pending for prediction
    this.pendingCommands.push(cmd);

    // Predict locally
    this.simulation.tick([cmd]);
    this.localState = this.simulation.state.clone();
  }

  onStateUpdate(_callback: (state: any) => void): () => void {
    // Mock implementation
    return () => { };
  }

  onEvent(_callback: (event: any) => void): () => void {
    // Mock implementation
    return () => { };
  }

  getInterpolatedEntity(entityId: string): any {
    return this.localState.entities.get(entityId);
  }

  getLocalState(): any {
    return this.localState;
  }

  isConnected(): boolean {
    return this.isRunning;
  }

  start(): void {
    this.isRunning = true;
  }

  stop(): void {
    this.isRunning = false;
  }

  simulateServerUpdate(): void {
    // Simulate server state update (would come from network)
    this.currentTick++;

    // Clear some pending commands (server acknowledged)
    if (this.pendingCommands.length > 0) {
      this.pendingCommands.shift();
    }

    // Reconcile if needed (simplified)
    const serverPos = { x: 2.5, y: 0, z: 0 }; // Where server thinks we are
    const localEntity = this.localState.entities.get('test-entity');
    const localPos = localEntity?.getComponent('position') as any;

    if (localPos && Math.abs(localPos.x - serverPos.x) > 1) {
      // Snap to server position
      localPos.x = serverPos.x;
    }
  }

  getPendingCommands(): number {
    return this.pendingCommands.length;
  }

  getCurrentTick(): number {
    return this.currentTick;
  }
}
