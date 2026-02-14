/**
 * InputComponent - Player input state
 */

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
    };
}

/** Clone input (for COW) */
export function cloneInput(i: InputComponent): InputComponent {
    return { ...i };
}
