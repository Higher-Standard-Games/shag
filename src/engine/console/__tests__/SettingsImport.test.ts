import { afterEach, expect, it, vi } from "vitest";
import { Cvar } from "../../core/Cvar";
import SettingsCommand from "../commands/SettingsCommand";

afterEach(() => vi.unstubAllGlobals());

it("retains simple configs and legacy literal backslashes", () => {
  Cvar.register("test_legacy_transfer", "default");
  expect(Cvar.execConfig('test_legacy_transfer "C:\\maps\\arena"').accepted).toBe(1);
  expect(Cvar.getString("test_legacy_transfer")).toBe("C:\\maps\\arena");
  expect(Cvar.execConfig("test_legacy_transfer plain").accepted).toBe(1);
  expect(Cvar.getString("test_legacy_transfer")).toBe("plain");
});

it("reports zero imports when every input line is rejected", async () => {
  vi.stubGlobal("navigator", { clipboard: { readText: async () => "unknown_transfer 42\nbroken" } });
  expect(await new SettingsCommand().execute(["import"])).toContain("Imported 0 settings from clipboard; rejected 2");
});

it("round-trips quoted strings, escapes and empty values", () => {
  Cvar.register("test_transfer", "default");
  for (const value of ['say "hello"', "C:\\temp\\new", "one\ntwo\tthree", "", "日本語"]) {
    Cvar.set("test_transfer", value);
    const config = Cvar.exportConfig();
    Cvar.reset("test_transfer");
    expect(Cvar.execConfig(config).rejected).toEqual([]);
    expect(Cvar.getString("test_transfer")).toBe(value);
  }
});

it("counts accepted lines and identifies rejected ones without echoing their values", async () => {
  Cvar.register("test_transfer_number", 1, { type: "float" });
  Cvar.register("test_transfer_readonly", 1, { readonly: true });
  vi.stubGlobal("navigator", {
    clipboard: {
      readText: async () =>
        "# comment\n test_transfer_number 2\nunknown_transfer 42\nbroken\ntest_transfer_readonly 3\ntest_transfer_number secret",
    },
  });
  const result = await new SettingsCommand().execute(["import"]);
  expect(result).toContain("Imported 1 settings from clipboard; rejected 4");
  expect(result).toContain("Line 3: Unknown setting");
  expect(result).toContain("Line 4: Expected a setting name and value");
  expect(result).toContain("Line 5: Read-only setting");
  expect(result).toContain("Line 6: Invalid value");
  expect(result).not.toContain("secret");
  expect(Cvar.getNumber("test_transfer_number")).toBe(2);
});

it("distinguishes comment-only input and clipboard failures", async () => {
  vi.stubGlobal("navigator", { clipboard: { readText: async () => "  // comment\n# comment" } });
  expect(await new SettingsCommand().execute(["import"])).toBe("No settings found in clipboard");
  vi.stubGlobal("navigator", {
    clipboard: {
      readText: async () => {
        throw new Error("denied");
      },
    },
  });
  expect(await new SettingsCommand().execute(["import"])).toContain("Failed to read clipboard");
});
