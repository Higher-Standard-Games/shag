/** Child-side durable final report. Keep this outside the public demo archive. */

import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { RESULT_PREFIX } from "../engine/server/network/MatchResultReport";

export function persistFinalResult(file: string, line: string): void {
  if (!path.isAbsolute(file) || !line.startsWith(RESULT_PREFIX) || line.length > 16384 || /[\r\n]/.test(line))
    throw new Error("Invalid final result outbox entry");
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const temporary = `${file}.${randomBytes(8).toString("hex")}.tmp`;
  const fd = fs.openSync(temporary, "wx", 0o600);
  try {
    try {
      fs.writeFileSync(fd, line, "utf8");
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    // An exclusive hard link publishes the complete flushed file atomically.
    // A second result can never overwrite the first report under this match ID.
    try {
      fs.linkSync(temporary, file);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST" || fs.readFileSync(file, "utf8") !== line) throw error;
    }
  } finally {
    fs.unlinkSync(temporary);
  }
}
