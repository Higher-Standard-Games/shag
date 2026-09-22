// @vitest-environment jsdom

/**
 * What `bind` and `unbind` say back. The pair used to answer "not yet
 * implemented"; now the answer has to be the truth about what is bound.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { CommandBindings } from "../../input/CommandBindings";
import BindCommand from "../commands/BindCommand";
import UnbindCommand from "../commands/UnbindCommand";

const bind = (...args: string[]) => new BindCommand().execute(args);
const unbind = (...args: string[]) => new UnbindCommand().execute(args);

beforeEach(() => {
  localStorage.clear();
  CommandBindings.resetForTests();
});

describe("bind", () => {
  it("says so when nothing is bound", async () => {
    await expect(bind()).resolves.toContain("No keys are bound");
  });

  it("binds a key to a command with arguments", async () => {
    await expect(bind("f", "give", "all")).resolves.toBe("f → give all");
    expect(CommandBindings.get("f")).toBe("give all");
  });

  it("reports one key, and lists them all", async () => {
    await bind("f", "screenshot");
    await bind("g", "give all");

    await expect(bind("f")).resolves.toContain("screenshot");
    const listing = (await bind()) as string;
    expect(listing).toContain("2 bound keys");
    expect(listing).toContain("screenshot");
    expect(listing).toContain("give all");
  });

  it("says a key is not bound rather than inventing one", async () => {
    await expect(bind("q")).resolves.toBe("q is not bound");
  });

  it("fails on something that is not a key", async () => {
    const result = await bind("   ", "screenshot");
    expect(result).toMatchObject({ ok: false });
  });
});

describe("unbind", () => {
  it("removes one key and says what it ran", async () => {
    await bind("f", "screenshot");
    await expect(unbind("f")).resolves.toBe("f no longer runs: screenshot");
    expect(CommandBindings.get("f")).toBeUndefined();
  });

  it("is honest about a key that was not bound", async () => {
    await expect(unbind("q")).resolves.toBe("q was not bound");
  });

  it("clears everything on all", async () => {
    await bind("f", "screenshot");
    await bind("g", "give all");
    await expect(unbind("all")).resolves.toBe("Unbound 2 keys");
    expect(CommandBindings.all().size).toBe(0);
  });

  it("needs an argument", async () => {
    expect(await unbind()).toMatchObject({ ok: false });
  });
});
