/**
 * InputComponent - Player input state
 */

/** A single queued input from a client command */
export interface QueuedInput {
  forward: number;
  right: number;
  pitch: number;
  yaw: number;
  buttons: number;
  sequence: number;
  /** Weapon slot the player wants to switch to (1-based, 0 = no change) */
  weaponSlot: number;
  /**
   * Server snapshot tick the client was looking at when it aimed this command.
   * Server-clamped on arrival. Absent or 0 means "no view reported" — a bot, a
   * replayed demo, or a client yet to see its first snapshot — and is not rewound.
   *
   * Optional on purpose: this steers hit registration only, never movement, so
   * it stays out of the deterministic usercmd contract that re-sim bundles and
   * recorded demos are verified against.
   */
  viewTick?: number;
}

export interface InputComponent {
  /** Movement input (-1 to 1 for analog, -1/0/1 for digital) */
  forward: number;
  right: number;

  /** View angles in degrees */
  pitch: number;
  yaw: number;

  /** Button states (individual booleans for backward compat) */
  jump: boolean;
  crouch: boolean;
  attack: boolean;
  altAttack: boolean;
  use: boolean;

  /** Raw button bitmask (InputButtons flags — preserves ALL button states) */
  buttons: number;

  /** Current weapon slot (1-9) */
  weaponSlot: number;

  /** Sequence number for reconciliation */
  sequence: number;

  /** View tick of the command currently being simulated (see QueuedInput.viewTick). */
  viewTick: number;

  /** Queued inputs waiting to be processed (FIFO — oldest at front, newest at end) */
  inputQueue: QueuedInput[];

  /**
   * Sequence of the last command the SERVER actually consumed into physics.
   * This — not the last command *received* — is what the client is acked with,
   * so reconciliation stays correct under the one-command-per-tick model.
   */
  lastProcessedSeq: number;

  /** Set by server when client sends RequestSpawn (cleared on actual respawn) */
  wantsRespawn: boolean;
}

/** Create default input */
export function createInput(): InputComponent {
  return {
    forward: 0,
    right: 0,
    pitch: 0,
    yaw: 0,
    jump: false,
    crouch: false,
    attack: false,
    altAttack: false,
    use: false,
    buttons: 0,
    weaponSlot: 1,
    sequence: 0,
    viewTick: 0,
    inputQueue: [],
    lastProcessedSeq: 0,
    wantsRespawn: false,
  };
}

/** Clone input (for COW) */
export function cloneInput(i: InputComponent): InputComponent {
  return { ...i, inputQueue: [...i.inputQueue] };
}
