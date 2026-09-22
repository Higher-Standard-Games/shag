/**
 * Splitting a batch of console commands.
 *
 * Commands are separated by semicolons or newlines, except inside double
 * quotes: an argument may carry semicolons of its own, as `sim replay
 * "W 60; JUMP 1"` does. Quotes are left in place for the registry's own
 * argument parser to strip.
 */

export function splitCommandBatch(input: string): string[] {
  const commands: string[] = [];
  let current = "";
  let inQuotes = false;

  for (const char of input) {
    if (char === '"') {
      inQuotes = !inQuotes;
      current += char;
    } else if (!inQuotes && (char === ";" || char === "\n" || char === "\r")) {
      commands.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  commands.push(current);

  return commands.map((command) => command.trim()).filter(Boolean);
}
