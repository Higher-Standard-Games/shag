import { access } from "node:fs/promises";
import path from "node:path";

export type AgentId = "codex" | "claude" | "gemini" | "opencode";
export type AgentCapability = "research" | "code" | "review" | "synthesis";
export type AgentCostTier = "free" | "cheap" | "mid" | "high";

export interface AgentCommandTemplate {
  executable: string;
  args: string[];
}

export interface AgentDefinition {
  id: AgentId;
  label: string;
  description: string;
  envPrefix: string;
  capabilities: AgentCapability[];
  costTier: AgentCostTier;
  detectExecutables: string[];
  defaultCommand: AgentCommandTemplate;
}

export interface ResolvedAgentCommand extends AgentCommandTemplate {
  source: "default" | "override";
}

export interface DetectedAgent {
  definition: AgentDefinition;
  executablePath: string | null;
  available: boolean;
  command: ResolvedAgentCommand;
}

const AGENT_DEFINITIONS: AgentDefinition[] = [
  {
    id: "codex",
    label: "Codex",
    description: "Strong code execution and repo-local implementation",
    envPrefix: "SHAG_AGENT_CODEX",
    capabilities: ["code", "review", "synthesis", "research"],
    costTier: "mid",
    detectExecutables: ["codex"],
    defaultCommand: {
      executable: "codex",
      args: ["exec", "--cd", "{cwd}", "--sandbox", "read-only"],
    },
  },
  {
    id: "claude",
    label: "Claude CLI",
    description: "Useful for review and architecture passes",
    envPrefix: "SHAG_AGENT_CLAUDE",
    capabilities: ["review", "synthesis", "research"],
    costTier: "high",
    detectExecutables: ["claude"],
    defaultCommand: {
      executable: "claude",
      args: ["-p", "{prompt}"],
    },
  },
  {
    id: "gemini",
    label: "Gemini CLI",
    description: "Preferred low-cost research worker when the account is eligible",
    envPrefix: "SHAG_AGENT_GEMINI",
    capabilities: ["research", "synthesis"],
    costTier: "cheap",
    detectExecutables: ["gemini"],
    defaultCommand: {
      executable: "gemini",
      args: ["-p", "{prompt}"],
    },
  },
  {
    id: "opencode",
    label: "OpenCode",
    description: "Extra worker pool with headless run support",
    envPrefix: "SHAG_AGENT_OPENCODE",
    capabilities: ["research", "code"],
    costTier: "free",
    detectExecutables: ["opencode"],
    defaultCommand: {
      executable: "opencode",
      args: ["run", "{prompt}"],
    },
  },
];

function getOverride(definition: AgentDefinition): ResolvedAgentCommand | null {
  const executable = process.env[`${definition.envPrefix}_EXECUTABLE`]?.trim();
  const rawArgs = process.env[`${definition.envPrefix}_ARGS_JSON`]?.trim();

  if (!executable && !rawArgs) {
    return null;
  }

  let args = definition.defaultCommand.args;
  if (rawArgs) {
    const parsed = JSON.parse(rawArgs) as unknown;
    if (!Array.isArray(parsed) || parsed.some((item) => typeof item !== "string")) {
      throw new Error(`${definition.envPrefix}_ARGS_JSON must be a JSON string array`);
    }
    args = parsed;
  }

  return {
    executable: executable || definition.defaultCommand.executable,
    args,
    source: "override",
  };
}

function resolveCommand(definition: AgentDefinition): ResolvedAgentCommand {
  const override = getOverride(definition);
  if (override) {
    return override;
  }

  return {
    ...definition.defaultCommand,
    source: "default",
  };
}

async function resolveExecutablePath(command: string): Promise<string | null> {
  if (path.isAbsolute(command)) {
    try {
      await access(command);
      return command;
    } catch {
      return null;
    }
  }

  const pathEntries = (process.env.PATH ?? "")
    .split(path.delimiter)
    .map((entry) => entry.trim())
    .filter(Boolean);
  const hasExtension = /\.[^\\/]+$/.test(command);
  const preferredExtensions = [".exe", ".ps1", ".cmd", ".bat", ".com"];
  const candidates = hasExtension ? [command] : [...preferredExtensions.map((extension) => `${command}${extension}`), command];

  for (const entry of pathEntries) {
    for (const candidate of candidates) {
      const fullPath = path.join(entry, candidate);
      try {
        await access(fullPath);
        return fullPath;
      } catch {
        // Continue scanning PATH entries.
      }
    }
  }

  return null;
}

export async function detectAgents(): Promise<DetectedAgent[]> {
  const detected: DetectedAgent[] = [];

  for (const definition of AGENT_DEFINITIONS) {
    const command = resolveCommand(definition);
    let executablePath: string | null = null;

    for (const candidate of [command.executable, ...definition.detectExecutables]) {
      executablePath = await resolveExecutablePath(candidate);
      if (executablePath) {
        break;
      }
    }

    detected.push({
      definition,
      executablePath,
      available: executablePath !== null,
      command,
    });
  }

  return detected;
}

export function listAgentDefinitions(): AgentDefinition[] {
  return [...AGENT_DEFINITIONS];
}
