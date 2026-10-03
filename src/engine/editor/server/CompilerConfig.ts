import { access, constants } from "node:fs/promises";
import path from "node:path";
import { type BuildQuality, isBuildQuality } from "./BuildRecipe";

export interface CompilerConfig {
  makebspBin: string | null;
  makelightBin: string | null;
  mediaRoot: string;
  toolchainRoot: string | null;
  defaultQuality: BuildQuality;
  available: boolean;
  reason: string | null;
}

export interface CompilerOverrides {
  makebspBin?: string;
  makelightBin?: string;
  mediaRoot?: string;
  toolchainRoot?: string;
  defaultQuality?: string;
}

const COMPILER_FLAGS: Record<string, keyof CompilerOverrides> = {
  "--makebsp-bin": "makebspBin",
  "--makelight-bin": "makelightBin",
  "--media-root": "mediaRoot",
  "--toolchain-root": "toolchainRoot",
  "--default-quality": "defaultQuality",
};

export function splitCompilerOptions(args: string[]): { overrides: CompilerOverrides; remaining: string[] } {
  const overrides: CompilerOverrides = {};
  const remaining: string[] = [];
  for (let index = 0; index < args.length; index++) {
    const key = COMPILER_FLAGS[args[index]];
    if (!key) {
      remaining.push(args[index]);
      continue;
    }
    const value = args[++index];
    if (!value || value.startsWith("--")) throw new Error(`Missing value for ${args[index - 1]}`);
    overrides[key] = value;
  }
  return { overrides, remaining };
}

async function executable(name: string, env: NodeJS.ProcessEnv, cwd: string): Promise<string | null> {
  const paths =
    path.isAbsolute(name) || name.includes("/") || name.includes("\\")
      ? [path.resolve(cwd, name)]
      : (env.PATH ?? env.Path ?? "")
          .split(path.delimiter)
          .filter(Boolean)
          .map((directory) => path.join(directory, name));
  const extensions = process.platform === "win32" && !path.extname(name) ? [".exe", ""] : [""];
  for (const candidate of paths) {
    for (const extension of extensions) {
      const filename = candidate + extension;
      try {
        await access(filename, constants.X_OK);
        return filename;
      } catch {
        // Try the next PATH entry.
      }
    }
  }
  return null;
}

/** Server-only resolution. Browser requests never supply these paths. */
export async function resolveCompilerConfig(
  overrides: CompilerOverrides = {},
  env: NodeJS.ProcessEnv = process.env,
  cwd = process.cwd(),
): Promise<CompilerConfig> {
  const quality = overrides.defaultQuality ?? env.SHAGGED_DEFAULT_QUALITY ?? "fast";
  if (!isBuildQuality(quality)) throw new Error(`Invalid SHAGGED default quality: ${quality}`);
  const makebspBin = await executable(overrides.makebspBin ?? env.SHAGGED_MAKEBSP_BIN ?? "makebsp", env, cwd);
  const makelightBin = await executable(overrides.makelightBin ?? env.SHAGGED_MAKELIGHT_BIN ?? "makelight", env, cwd);
  const mediaRoot = path.resolve(cwd, overrides.mediaRoot ?? env.SHAGGED_MEDIA_ROOT ?? "public/data");
  const toolchainValue = overrides.toolchainRoot ?? env.SHAGGED_TOOLCHAIN_ROOT;
  const toolchainRoot = toolchainValue
    ? path.resolve(cwd, toolchainValue)
    : makebspBin
      ? path.dirname(makebspBin)
      : null;
  let reason: string | null = null;
  if (!makebspBin) reason = "MakeBSP executable was not found";
  else if (!makelightBin) reason = "MakeLight executable was not found";
  else if (!toolchainRoot) reason = "MakeBSP toolchain root was not found";
  else {
    try {
      await access(path.join(toolchainRoot, "makebspdata", "washoi.json"), constants.R_OK);
      await access(mediaRoot, constants.R_OK);
    } catch {
      reason = "Washoi toolchain profile or media root is missing";
    }
  }
  return { makebspBin, makelightBin, mediaRoot, toolchainRoot, defaultQuality: quality, available: !reason, reason };
}
