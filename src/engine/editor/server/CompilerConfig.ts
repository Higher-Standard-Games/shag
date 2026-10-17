import { randomUUID } from "node:crypto";
import { access, constants, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { type BuildQuality, isBuildQuality } from "./BuildRecipe";

const REPOSITORY_ROOT = fileURLToPath(new URL("../../../../", import.meta.url));

/** The local tool directory has .exe files on Windows and unsuffixed binaries on Linux. */
export function localCompilerBin(repoRoot: string, name: "makebsp" | "makelight", platform = process.platform): string {
  return path.join(repoRoot, "tools", "makebsp", `${name}${platform === "win32" ? ".exe" : ""}`);
}

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
  repoRoot = REPOSITORY_ROOT,
): Promise<CompilerConfig> {
  const quality = overrides.defaultQuality ?? env.SHAGGED_DEFAULT_QUALITY ?? "fast";
  if (!isBuildQuality(quality)) throw new Error(`Invalid SHAGGED default quality: ${quality}`);
  const configuredMakebsp = overrides.makebspBin ?? env.SHAGGED_MAKEBSP_BIN;
  const makebspBin = await executable(configuredMakebsp ?? localCompilerBin(repoRoot, "makebsp"), env, cwd);
  const makelightBin = await executable(
    overrides.makelightBin ?? env.SHAGGED_MAKELIGHT_BIN ?? localCompilerBin(repoRoot, "makelight"),
    env,
    cwd,
  );
  const mediaRoot = path.resolve(
    cwd,
    overrides.mediaRoot ?? env.SHAGGED_MEDIA_ROOT ?? path.join(repoRoot, "public", "data"),
  );
  const toolchainValue = overrides.toolchainRoot ?? env.SHAGGED_TOOLCHAIN_ROOT;
  const toolchainRoot = toolchainValue
    ? path.resolve(cwd, toolchainValue)
    : makebspBin && path.dirname(makebspBin) !== path.join(repoRoot, "tools", "makebsp")
      ? path.dirname(makebspBin)
      : path.join(repoRoot, "editor");
  let reason: string | null = null;
  if (!makebspBin) reason = "MakeBSP executable was not found";
  else if (!makelightBin) reason = "MakeLight executable was not found";
  else if (!toolchainRoot) reason = "MakeBSP toolchain root was not found";
  else {
    try {
      await access(path.join(toolchainRoot, "makebspdata", "washoi.json"), constants.R_OK);
      await access(mediaRoot, constants.R_OK);
      // Native tools resolve profiles beside the executable, independently of cwd.
      // Install our tracked profile only into repository-local tools; external
      // installations must provide their own adjacent profile.
      for (const binary of [makebspBin, makelightBin]) {
        const directory = path.dirname(binary);
        if (directory === path.join(repoRoot, "tools", "makebsp")) {
          const profileDirectory = path.join(directory, "makebspdata");
          await mkdir(profileDirectory, { recursive: true });
          const profile = path.join(profileDirectory, "washoi.json");
          const contents = await readFile(path.join(toolchainRoot, "makebspdata", "washoi.json"), "utf8");
          const current = await readFile(profile, "utf8").catch((error) => {
            if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
            throw error;
          });
          if (current !== contents) {
            const temporary = `${profile}.${randomUUID()}.tmp`;
            try {
              await writeFile(temporary, contents, "utf8");
              await rename(temporary, profile);
            } finally {
              await rm(temporary, { force: true });
            }
          }
        }
        await access(path.join(directory, "makebspdata", "washoi.json"), constants.R_OK);
      }
    } catch {
      reason =
        "Washoi toolchain profile or media root is missing, or the executable-adjacent profile could not be prepared";
    }
  }
  return { makebspBin, makelightBin, mediaRoot, toolchainRoot, defaultQuality: quality, available: !reason, reason };
}
