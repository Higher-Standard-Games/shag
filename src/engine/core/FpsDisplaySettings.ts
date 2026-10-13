import { Cvar } from "./Cvar";

/** Shared preference for the console command and the game's FPS overlay. */
export function registerFpsDisplayCvar(): void {
  Cvar.init();
  Cvar.register("show_fps", 1, {
    type: "int",
    min: 0,
    max: 1,
    description: "Show the FPS counter",
  });
}
