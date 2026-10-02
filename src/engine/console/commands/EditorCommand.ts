import { getEditorLauncher } from "../../editor/EditorLauncher";
import { Command, type CommandDef, type CommandOutput, fail } from "../Command";

export default class EditorCommand extends Command {
  readonly definition: CommandDef = {
    name: "editor",
    description: "Open or close the SHAGGED map editor",
    usage: "editor [open|close|status]",
    developer: true,
    subcommands: [
      { name: "open", description: "Open or resume the editor" },
      { name: "close", description: "Save draft and return to the lobby" },
      { name: "status", description: "Report editor and draft state" },
    ],
  };

  async execute(args: string[]): Promise<CommandOutput> {
    const sub = args[0]?.toLowerCase() ?? "open";
    if (!["open", "close", "status"].includes(sub) || args.length > 1) return fail("Usage: editor [open|close|status]");
    const launcher = getEditorLauncher();
    if (!launcher) return fail("Editor unavailable in this composition");
    try {
      const status = sub === "status" ? launcher.status() : await launcher[sub as "open" | "close"]();
      return status.open ? `Editor open: ${status.draftId} (revision ${status.revision})` : "Editor closed";
    } catch (error) {
      return fail(`Editor: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}
