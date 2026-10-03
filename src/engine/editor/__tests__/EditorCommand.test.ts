import { afterEach, describe, expect, it } from "vitest";
import EditorCommand from "../../console/commands/EditorCommand";
import { registerEditorLauncher } from "../EditorLauncher";

afterEach(() => registerEditorLauncher(null));

describe("editor console command", () => {
  it("fails clearly without a browser host", async () => {
    expect(await new EditorCommand().execute(["open"])).toEqual({
      ok: false,
      output: "Editor unavailable in this composition",
    });
  });

  it("opens, reports status, and closes through the registered host", async () => {
    let open = false;
    registerEditorLauncher({
      async open() {
        open = true;
        return this.status();
      },
      async close() {
        open = false;
        return this.status();
      },
      status() {
        return open ? { open, draftId: "draft", revision: 3 } : { open };
      },
    });
    const command = new EditorCommand();
    expect(await command.execute([])).toContain("Editor open: draft");
    expect(await command.execute(["status"])).toContain("revision 3");
    expect(await command.execute(["close"])).toBe("Editor closed");
    expect(await command.execute(["unknown"])).toEqual({ ok: false, output: "Usage: editor [open|close|status]" });
  });
});
