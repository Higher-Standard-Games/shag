import path from "node:path";
import { fileURLToPath } from "node:url";

const REPOSITORY_ROOT = fileURLToPath(new URL("../../../../", import.meta.url));

export interface ShaggedServerConfig {
  mapsRoot: string;
  publishRoot: string;
  port: number;
  uiOrigins: string[];
}

/** CLI flags override environment values, which override local development defaults. */
export function resolveServerConfig(
  args: string[],
  env: NodeJS.ProcessEnv = process.env,
  cwd = process.cwd(),
): ShaggedServerConfig {
  const flags = new Map<string, string[]>();
  for (let index = 0; index < args.length; index++) {
    const flag = args[index];
    if (!["--maps-root", "--publish-root", "--port", "--ui-origin"].includes(flag))
      throw new Error(`Unknown SHAGGED server option: ${flag}`);
    const value = args[++index];
    if (!value || value.startsWith("--")) throw new Error(`Missing value for ${flag}`);
    flags.set(flag, [...(flags.get(flag) ?? []), value]);
  }
  const value = (flag: string, environment: string, fallback: string) =>
    flags.get(flag)?.at(-1) ?? env[environment] ?? fallback;
  const portText = value("--port", "SHAGGED_PORT", "9010");
  if (!/^\d+$/.test(portText)) throw new Error("SHAGGED port must be an integer from 1 to 65535");
  const port = Number(portText);
  if (port < 1 || port > 65535) throw new Error("SHAGGED port must be an integer from 1 to 65535");
  const mapsRoot = path.resolve(cwd, value("--maps-root", "SHAGGED_MAPS_ROOT", "server-data/shagged/maps"));
  const publishRoot = path.resolve(
    cwd,
    value("--publish-root", "SHAGGED_PUBLISH_ROOT", path.join(REPOSITORY_ROOT, "public", "data")),
  );
  const originValues = flags.get("--ui-origin") ??
    env.SHAGGED_UI_ORIGIN?.split(",") ?? ["http://localhost:3000", "http://127.0.0.1:3000"];
  const uiOrigins = originValues.map((origin) => {
    const trimmed = origin.trim();
    const parsed = new URL(trimmed);
    if (parsed.origin !== trimmed || !["http:", "https:"].includes(parsed.protocol))
      throw new Error(`Invalid SHAGGED UI origin: ${origin}`);
    return trimmed;
  });
  if (!uiOrigins.length) throw new Error("At least one SHAGGED UI origin is required");
  return { mapsRoot, publishRoot, port, uiOrigins };
}
