import { getEditorLauncher } from "../../editor/EditorLauncher";
import { Command, type CommandDef, type CommandOutput, fail } from "../Command";

export default class EditorCommand extends Command {
  readonly definition: CommandDef = {
    name: "editor",
    description: "Open or close the SHAGGED map editor",
    usage: "editor [open|close|status|return]",
    developer: true,
    subcommands: [
      { name: "open", description: "Open or resume the editor" },
      { name: "close", description: "Save draft and return to the lobby" },
      { name: "status", description: "Report editor and draft state" },
      { name: "return", description: "Return from a playtest to the editor" },
    ],
  };

  async execute(args: string[]): Promise<CommandOutput> {
    const sub = args[0]?.toLowerCase() ?? "open";
    if (!["open", "close", "status", "return"].includes(sub) || args.length > 1)
      return fail("Usage: editor [open|close|status|return]");
    const launcher = getEditorLauncher();
    if (!launcher) return fail("Editor unavailable in this composition");
    try {
      if (sub === "return") {
        if (!launcher.returnToEditor) return fail("Editor return is unavailable");
        await launcher.returnToEditor();
        return "Returning to editor";
      }
      const status = sub === "status" ? launcher.status() : await launcher[sub as "open" | "close"]();
      return status.open ? `Editor open: ${status.draftId} (revision ${status.revision})` : "Editor closed";
    } catch (error) {
      return fail(`Editor: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}
