import { beforeEach, describe, expect, it } from "vitest";
import { ActionSystem } from "../core/ActionSystem";

describe("ActionSystem", () => {
  beforeEach(() => {
    // Clear all registered actions between tests
    ActionSystem.clear();
  });

  describe("register and execute", () => {
    it("should register and execute an action", async () => {
      let executed = false;
      ActionSystem.register("test_action", (payload) => {
        executed = true;
        return payload;
      });

      const result = await ActionSystem.execute("test_action", { value: 42 });
      expect(executed).toBe(true);
      expect(result.success).toBe(true);
      expect(result.result).toEqual({ value: 42 });
    });

    it("should return error for unknown action", async () => {
      const result = await ActionSystem.execute("unknown_action", {});
      expect(result.success).toBe(false);
      expect(result.error).toContain("Unknown action");
    });

    it("should handle async action handlers", async () => {
      ActionSystem.register("async_action", async (payload: unknown) => {
        return new Promise((resolve) => {
          setTimeout(() => resolve((payload as { value: number }).value * 2), 10);
        });
      });

      const result = await ActionSystem.execute("async_action", { value: 21 });
      expect(result.success).toBe(true);
      expect(result.result).toBe(42);
    });
  });

  describe("validation", () => {
    it("should validate action before execution", async () => {
      ActionSystem.register(
        "validated_action",
        () => "executed",
        (payload) => (payload as { valid: boolean }).valid === true,
      );

      const validResult = await ActionSystem.execute("validated_action", { valid: true });
      expect(validResult.success).toBe(true);

      const invalidResult = await ActionSystem.execute("validated_action", { valid: false });
      expect(invalidResult.success).toBe(false);
    });

    it("should return custom validation error message", async () => {
      ActionSystem.register(
        "custom_error_action",
        () => "executed",
        (payload) => {
          if ((payload as { amount: number }).amount < 0) {
            return "Amount cannot be negative";
          }
          return true;
        },
      );

      const result = await ActionSystem.execute("custom_error_action", { amount: -5 });
      expect(result.success).toBe(false);
      expect(result.error).toBe("Amount cannot be negative");
    });

    it("canExecute should check validation without executing", () => {
      let executed = false;
      ActionSystem.register(
        "canexec_test",
        () => {
          executed = true;
          return "done";
        },
        (payload) => (payload as { ok: boolean }).ok,
      );

      const canExec = ActionSystem.canExecute("canexec_test", { ok: true });
      expect(canExec).toBe(true);
      expect(executed).toBe(false); // Should not have executed

      const cannotExec = ActionSystem.canExecute("canexec_test", { ok: false });
      expect(cannotExec).not.toBe(true);
    });
  });

  describe("unregister", () => {
    it("should unregister an action", async () => {
      ActionSystem.register("temp_action", () => "result");

      const result1 = await ActionSystem.execute("temp_action", {});
      expect(result1.success).toBe(true);

      ActionSystem.unregister("temp_action");

      const result2 = await ActionSystem.execute("temp_action", {});
      expect(result2.success).toBe(false);
    });
  });

  describe("middleware", () => {
    it("should run middleware before action", async () => {
      const middlewareLog: string[] = [];

      ActionSystem.use(async (context, next) => {
        middlewareLog.push(`before:${context.type}`);
        const result = await next();
        middlewareLog.push(`after:${context.type}`);
        return result;
      });

      ActionSystem.register("middleware_test", () => {
        middlewareLog.push("handler");
        return "done";
      });

      await ActionSystem.execute("middleware_test", {});

      expect(middlewareLog).toEqual(["before:middleware_test", "handler", "after:middleware_test"]);
    });
  });

  describe("history", () => {
    it("should track action history", async () => {
      ActionSystem.register("history_test", (p) => p);

      await ActionSystem.execute("history_test", { step: 1 });
      await ActionSystem.execute("history_test", { step: 2 });

      const history = ActionSystem.getHistory();
      expect(history.length).toBeGreaterThanOrEqual(2);

      const lastTwo = history.slice(-2);
      expect(lastTwo[0].type).toBe("history_test");
      expect(lastTwo[1].type).toBe("history_test");
    });

    it("should clear history", async () => {
      ActionSystem.register("clear_test", () => "ok");
      await ActionSystem.execute("clear_test", {});

      ActionSystem.clearHistory();

      const history = ActionSystem.getHistory();
      expect(history.length).toBe(0);
    });
  });
});
