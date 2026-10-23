import { InputSystem } from "../input/InputSystem";
import type { ActionDefinition } from "../input/InputTypes";

export interface FreeflyActions {
  readonly forward: string;
  readonly backward: string;
  readonly left: string;
  readonly right: string;
  readonly up: string;
  readonly down: string;
  readonly sprint: string;
}

/** The selected game supplies its action IDs and idempotent input registration. */
export interface FreeflyInput {
  readonly actions: FreeflyActions;
  prepare(): void;
}

const actions: FreeflyActions = {
  forward: "freefly_forward",
  backward: "freefly_backward",
  left: "freefly_left",
  right: "freefly_right",
  up: "freefly_up",
  down: "freefly_down",
  sprint: "freefly_sprint",
};

const defaults: ActionDefinition[] = [
  { id: actions.forward, type: "button", defaultBindings: [{ key: "KeyW" }], lockInFullscreen: true },
  { id: actions.backward, type: "button", defaultBindings: [{ key: "KeyS" }], lockInFullscreen: true },
  { id: actions.left, type: "button", defaultBindings: [{ key: "KeyA" }], lockInFullscreen: true },
  { id: actions.right, type: "button", defaultBindings: [{ key: "KeyD" }], lockInFullscreen: true },
  { id: actions.up, type: "button", defaultBindings: [{ key: "Space" }] },
  {
    id: actions.down,
    type: "button",
    defaultBindings: [{ mouseButton: "middle" }, { key: "KeyC" }, { key: "ControlLeft" }, { key: "ControlRight" }],
  },
  { id: actions.sprint, type: "button", defaultBindings: [{ key: "ShiftLeft" }, { key: "ShiftRight" }] },
];

let defaultsRegistered = false;
const defaultInput: FreeflyInput = {
  actions,
  prepare() {
    const input = InputSystem.getInstance();
    if (!defaultsRegistered) {
      for (const action of defaults) input.registerAction(action);
      input.registerContext({ id: "freefly", blocking: false, actions: Object.values(actions) });
      defaultsRegistered = true;
    }
    if (!input.isContextActive("freefly")) input.pushContext("freefly");
  },
};

let registered: FreeflyInput | null = null;

/** Register at application boot, before attaching a game camera. */
export function registerFreeflyInput(input: FreeflyInput): void {
  registered = input;
}

/** Without a game, engine scene tools use their own actions and context. */
export function getFreeflyInput(): FreeflyInput {
  return registered ?? defaultInput;
}

/** Clear game registration; defaults are prepared lazily by the next attach. */
export function clearFreeflyInput(): void {
  registered = null;
}
