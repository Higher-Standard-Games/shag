import { describe, it, expect, beforeEach } from "vitest";
import { ConsoleCommandRegistry } from "../debug/ConsoleCommandRegistry";

describe("ConsoleCommandRegistry", () => {
  let registry: ConsoleCommandRegistry;

  beforeEach(() => {
    // Get singleton instance
    registry = ConsoleCommandRegistry.getInstance();
  });

  describe("getInstance", () => {
    it("should return singleton instance", () => {
      const instance1 = ConsoleCommandRegistry.getInstance();
      const instance2 = ConsoleCommandRegistry.getInstance();
      expect(instance1).toBe(instance2);
    });
  });

  describe("register and execute", () => {
    it("should register and execute a command", async () => {
      let called = false;
      registry.register("testcmd_exec", () => {
        called = true;
        return "test result";
      });

      const result = await registry.execute("testcmd_exec");
      expect(called).toBe(true);
      expect(result).toBe("test result");
    });

    it("should pass arguments to command handler", async () => {
      let receivedArgs: string[] = [];
      registry.register("argtest_cmd", (args) => {
        receivedArgs = args;
        return "ok";
      });

      await registry.execute("argtest_cmd arg1 arg2 arg3");
      expect(receivedArgs).toEqual(["arg1", "arg2", "arg3"]);
    });

    it("should return error for unknown command", async () => {
      const result = await registry.execute("unknowncommand123xyz");
      expect(result).toContain("Unknown command");
    });

    it("should handle async command handlers", async () => {
      registry.register("asynctest_cmd", async () => {
        return new Promise((resolve) => {
          setTimeout(() => resolve("async result"), 10);
        });
      });

      const result = await registry.execute("asynctest_cmd");
      expect(result).toBe("async result");
    });
  });

  describe("getAutocompleteSuggestions", () => {
    it("should return matching commands for partial input", () => {
      // Register a test command first
      registry.register("helpertest", () => "ok");
      const suggestions = registry.getAutocompleteSuggestions("helper");
      expect(suggestions).toContain("helpertest");
    });

    it("should return empty array for no matches", () => {
      const suggestions = registry.getAutocompleteSuggestions("zzzznotacommand");
      expect(suggestions).toEqual([]);
    });

    it("should return subcommand suggestions when command has subcommands", () => {
      // Load a command definition with subcommands
      registry.loadDefinitionsFromJson({
        commands: [{
          name: "testweather",
          description: "Test weather",
          subcommands: [
            { name: "rain", description: "Rain" },
            { name: "snow", description: "Snow" }
          ]
        }]
      });
      registry.register("testweather", () => "ok");
      
      const suggestions = registry.getAutocompleteSuggestions("testweather ");
      expect(suggestions.length).toBeGreaterThan(0);
      expect(suggestions.some((s: string) => s.includes("rain"))).toBe(true);
    });
  });

  describe("getDefinition", () => {
    it("should return definition for registered command", () => {
      registry.loadDefinitionsFromJson({
        commands: [{
          name: "deftest",
          description: "A test command for definitions"
        }]
      });
      registry.register("deftest", () => "ok");
      
      const def = registry.getDefinition("deftest");
      expect(def).toBeDefined();
      expect(def?.name).toBe("deftest");
      expect(def?.description).toBe("A test command for definitions");
    });

    it("should return undefined for unknown command", () => {
      const def = registry.getDefinition("notarealcommand999");
      expect(def).toBeUndefined();
    });
  });

  describe("getAllDefinitions", () => {
    it("should return array of all definitions", () => {
      const defs = registry.getAllDefinitions();
      expect(Array.isArray(defs)).toBe(true);
    });
  });

  describe("loadDefinitionsFromJson", () => {
    it("should load additional definitions from JSON", () => {
      const customCommands = {
        commands: [
          {
            name: "customloadtest",
            description: "A custom test command",
            usage: "customloadtest <arg>"
          }
        ]
      };

      registry.loadDefinitionsFromJson(customCommands);
      registry.register("customloadtest", () => "loaded");
      
      const def = registry.getDefinition("customloadtest");
      expect(def).toBeDefined();
      expect(def?.description).toBe("A custom test command");
    });
  });
});
