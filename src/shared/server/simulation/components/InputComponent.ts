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

    /** Queued inputs waiting to be processed (newest at end) */
    inputQueue: QueuedInput[];
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
        inputQueue: [],
    };
}

/** Clone input (for COW) */
export function cloneInput(i: InputComponent): InputComponent {
    return { ...i, inputQueue: [...i.inputQueue] };
}
