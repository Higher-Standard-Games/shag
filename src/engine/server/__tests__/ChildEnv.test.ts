import { describe, expect, it } from "vitest";
import { childProcessEnv } from "../ChildEnv";

describe("childProcessEnv", () => {
  it("drops secrets and stray match credentials, and keeps the rest", () => {
    expect(
      childProcessEnv({
        PATH: "/usr/bin",
        SHAG_DEBUG: "setup",
        SHAG_GAME_KEY_PATH: "/certs/key.pem",
        BOT_SECRET: "s",
        CLIENT_RELEASE_TOKEN: "t",
        db_password: "p",
        SHAG_MATCH_ADMISSION: "{}",
      }),
    ).toEqual({ PATH: "/usr/bin", SHAG_DEBUG: "setup", SHAG_GAME_KEY_PATH: "/certs/key.pem" });
  });
});
