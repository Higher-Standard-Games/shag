import { spawn } from "node:child_process";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  detectAgents,
  listAgentDefinitions,
  type AgentCapability,
  type AgentId,
  type DetectedAgent,
} from "./agent-registry.ts";

interface ParsedArgs {
  command: string;
  options: Map<string, string | boolean>;
}

interface AgentResult {
  agentId: string;
  exitCode: number | null;
  timedOut: boolean;
  stdout: string;
  stderr: string;
  outputFile: string;
}

interface ProgressHandle {
  stop: () => void;
}

interface ProgressTracker {
  stop: () => void;
  tick: (message: string) => void;
}

interface AgentHealthRecord {
  state: "healthy" | "unavailable";
  reason?: string;
  updatedAt: string;
}

type AgentHealthMap = Partial<Record<AgentId, AgentHealthRecord>>;

interface TaskFile {
  version: 1;
  type: "research" | "code";
  title: string;
  goal: string;
  target: {
    kind: "document" | "files";
    path?: string;
    files?: string[];
  };
  risk?: "low" | "medium" | "high";
  primaryAgent?: AgentId;
  reviewerAgent?: AgentId;
  synthAgent?: AgentId;
  workerAgents?: AgentId[];
  constraints?: string[];
}

const DEFAULT_RESEARCH_TASK_PATH = path.resolve("scripts", "agents", "default-research-task.json");
const DEFAULT_CODE_TASK_PATH = path.resolve("scripts", "agents", "default-code-task.json");
const AGENT_HEALTH_PATH = path.resolve(".agent", "agent-health.json");

function resolveEnvPlaceholder(value: string): string {
  if (!value.startsWith("$")) {
    return value;
  }

  return process.env[value.slice(1)] ?? value;
}

function parseArgs(argv: string[]): ParsedArgs {
  const normalized = argv.filter((token, index) => !(index === 0 && token === "--"));
  const [command = "list", ...rest] = normalized;
  const options = new Map<string, string | boolean>();

  for (let i = 0; i < rest.length; i++) {
    const token = rest[i];
    if (!token.startsWith("--")) {
      continue;
    }

    const stripped = token.slice(2);
    const [key, inlineValue] = stripped.split("=", 2);
    if (inlineValue !== undefined) {
      options.set(key, inlineValue);
      continue;
    }

    const next = rest[i + 1];
    if (next && !next.startsWith("--")) {
      options.set(key, next);
      i += 1;
      continue;
    }

    options.set(key, true);
  }

  return { command, options };
}

function getStringOption(options: Map<string, string | boolean>, key: string): string | undefined {
  const value = options.get(key);
  if (typeof value !== "string") {
    return undefined;
  }

  const resolved = resolveEnvPlaceholder(value);
  return resolved === value && value.startsWith("$") ? undefined : resolved;
}

function getBooleanOption(options: Map<string, string | boolean>, key: string): boolean {
  const value = options.get(key);
  if (value === true) {
    return true;
  }

  if (typeof value !== "string") {
    return false;
  }

  const resolved = resolveEnvPlaceholder(value);
  return resolved === "true" || resolved === "1";
}

function formatTemplate(args: string[], values: Record<string, string>): string[] {
  return args.map((arg) =>
    arg.replace(/\{(\w+)\}/g, (_, key: string) => {
      return values[key] ?? "";
    }),
  );
}

async function pathExists(target: string): Promise<boolean> {
  try {
    await access(target);
    return true;
  } catch {
    return false;
  }
}

async function resolveLaunchCommand(
  agent: DetectedAgent,
  args: string[],
): Promise<{ command: string; args: string[]; stdinPrompt: boolean }> {
  const executable = agent.executablePath ?? agent.command.executable;
  const baseDir = path.dirname(executable);

  if (process.platform === "win32") {
    if (agent.definition.id === "codex") {
      const nodeExecutable = (await pathExists(path.join(baseDir, "node.exe"))) ? path.join(baseDir, "node.exe") : "node";
      const scriptPath = path.join(baseDir, "node_modules", "@openai", "codex", "bin", "codex.js");
      if (await pathExists(scriptPath)) {
        return {
          command: nodeExecutable,
          args: [scriptPath, ...args],
          stdinPrompt: true,
        };
      }
    }

    if (agent.definition.id === "gemini") {
      const nodeExecutable = (await pathExists(path.join(baseDir, "node.exe"))) ? path.join(baseDir, "node.exe") : "node";
      const scriptPath = path.join(baseDir, "node_modules", "@google", "gemini-cli", "dist", "index.js");
      if (await pathExists(scriptPath)) {
        return {
          command: nodeExecutable,
          args: ["--no-warnings=DEP0040", scriptPath, ...args],
          stdinPrompt: false,
        };
      }
    }

    if (agent.definition.id === "opencode") {
      const nodeExecutable = (await pathExists(path.join(baseDir, "node.exe"))) ? path.join(baseDir, "node.exe") : "node";
      const scriptPath = path.join(baseDir, "node_modules", "opencode-ai", "bin", "opencode");
      if (await pathExists(scriptPath)) {
        return {
          command: nodeExecutable,
          args: [scriptPath, ...args],
          stdinPrompt: false,
        };
      }
    }
  }

  return {
    command: executable,
    args,
    stdinPrompt: agent.definition.id === "codex",
  };
}

function parseCsvIds(value: string | undefined): AgentId[] {
  if (!value) {
    return [];
  }

  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean) as AgentId[];
}

async function ensureOutputDir(baseDir: string): Promise<string> {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const outputDir = path.join(baseDir, ".agent", "runs", stamp);
  await mkdir(outputDir, { recursive: true });
  return outputDir;
}

async function loadTaskFile(taskPath: string): Promise<TaskFile> {
  return JSON.parse(await readFile(taskPath, "utf8")) as TaskFile;
}

async function loadAgentHealth(): Promise<AgentHealthMap> {
  try {
    return JSON.parse(await readFile(AGENT_HEALTH_PATH, "utf8")) as AgentHealthMap;
  } catch {
    return {};
  }
}

async function saveAgentHealth(health: AgentHealthMap): Promise<void> {
  await mkdir(path.dirname(AGENT_HEALTH_PATH), { recursive: true });
  await writeFile(AGENT_HEALTH_PATH, JSON.stringify(health, null, 2), "utf8");
}

function classifyAgentFailure(result: AgentResult): string | null {
  const combined = `${result.stdout}\n${result.stderr}`.toLowerCase();

  if (
    combined.includes("permission_denied") ||
    combined.includes("not eligible") ||
    combined.includes("forbidden") ||
    combined.includes("unauthorized") ||
    combined.includes("authentication") ||
    combined.includes("api key")
  ) {
    return "provider unavailable or account not eligible";
  }

  return null;
}

function shouldTreatAsUnavailable(record: AgentHealthRecord | undefined): boolean {
  if (!record || record.state !== "unavailable") {
    return false;
  }

  const retryableReasons = ["capacity", "rate limit"];
  const lowerReason = (record.reason ?? "").toLowerCase();
  return !retryableReasons.some((reason) => lowerReason.includes(reason));
}

async function updateAgentHealthFromResults(results: AgentResult[]): Promise<void> {
  const health = await loadAgentHealth();
  let changed = false;

  for (const result of results) {
    const reason = classifyAgentFailure(result);
    if (reason) {
      health[result.agentId] = {
        state: "unavailable",
        reason,
        updatedAt: new Date().toISOString(),
      };
      changed = true;
      continue;
    }

    if (result.exitCode === 0 && health[result.agentId]?.state === "unavailable") {
      health[result.agentId] = {
        state: "healthy",
        updatedAt: new Date().toISOString(),
      };
      changed = true;
    }
  }

  if (changed) {
    await saveAgentHealth(health);
  }
}

function startProgressHeartbeat(label: string): ProgressTracker {
  const startedAt = Date.now();
  const frames = ["|", "/", "-", "\\"];
  let frameIndex = 0;
  const timer = setInterval(() => {
    const elapsedSeconds = Math.max(1, Math.floor((Date.now() - startedAt) / 1000));
    const frame = frames[frameIndex % frames.length];
    frameIndex += 1;
    console.log(`[progress] ${frame} ${label} still running (${elapsedSeconds}s elapsed)`);
  }, 4000);

  return {
    stop: () => clearInterval(timer),
    tick: (message: string) => {
      const elapsedSeconds = Math.max(0, Math.floor((Date.now() - startedAt) / 1000));
      console.log(`[progress] ${message} (${elapsedSeconds}s elapsed)`);
    },
  };
}

function buildResearchPrompt(documentPath: string, task: string, workerCount: number): string {
  return [
    "You are a worker in a local multi-agent research pipeline.",
    'Read "AGENTS.md" in the project root first and follow its guidance.',
    `Read the file at "${documentPath}" from the current workspace.`,
    "Inspect related code, scripts, and docs before making concrete claims. Do not rely on memory when the source can be checked.",
    "Use exact file names, API names, and command names from source where relevant.",
    `Task: ${task}`,
    `There are ${workerCount} parallel worker(s) on this task. Focus on signal over breadth.`,
    "Treat this as improving the target research document: identify gaps, missing source-backed details, risks, and better structure.",
    "Return plain Markdown with these sections:",
    "1. Findings",
    "2. Recommendations",
    "3. Open Questions",
    "Keep the answer concise and concrete.",
  ].join("\n");
}

function buildCodePrompt(files: string[], task: TaskFile): string {
  const constraints = (task.constraints ?? []).map((item) => `- ${item}`).join("\n");
  return [
    "You are the primary coding worker in a local multi-agent pipeline.",
    `Task title: ${task.title}`,
    `Goal: ${task.goal}`,
    `Risk: ${task.risk ?? "medium"}`,
    "Focus on implementation approach, likely change points, and test/validation advice.",
    "Do not assume full repo context; stay anchored to the listed files.",
    `Files: ${files.join(", ")}`,
    constraints ? `Constraints:\n${constraints}` : "",
    "Return plain Markdown with these sections:",
    "1. Plan",
    "2. Likely Files To Change",
    "3. Risks",
    "4. Validation",
  ]
    .filter(Boolean)
    .join("\n");
}

function buildReviewPrompt(files: string[], task: TaskFile, primaryOutput: string): string {
  const constraints = (task.constraints ?? []).map((item) => `- ${item}`).join("\n");
  return [
    "You are the reviewer in a local multi-agent pipeline.",
    `Task title: ${task.title}`,
    `Goal: ${task.goal}`,
    `Risk: ${task.risk ?? "medium"}`,
    `Files: ${files.join(", ")}`,
    constraints ? `Constraints:\n${constraints}` : "",
    "Review the primary worker output below for bugs, missing edge cases, and testing gaps.",
    "Return plain Markdown with these sections:",
    "1. Findings",
    "2. Gaps",
    "3. Suggested Next Step",
    "",
    "## Primary Output",
    primaryOutput.trim(),
  ]
    .filter(Boolean)
    .join("\n");
}

function buildSynthesisPrompt(documentPath: string, task: string, workerOutputs: string[]): string {
  const joinedOutputs = workerOutputs
    .map((output, index) => [`## Worker ${index + 1}`, output.trim()].join("\n\n"))
    .join("\n\n");

  return [
    "You are the synthesis agent in a local multi-agent research pipeline.",
    `The task was run against "${documentPath}".`,
    `Task: ${task}`,
    "Combine the worker outputs below into one final answer.",
    "De-duplicate repeated points, preserve disagreements, and call out weak assumptions.",
    "Return plain Markdown with these sections:",
    "1. Consensus",
    "2. Important Disagreements",
    "3. Recommended Next Steps",
    "",
    joinedOutputs,
  ].join("\n");
}

async function runAgent(
  agent: DetectedAgent,
  prompt: string,
  cwd: string,
  outputDir: string,
  timeoutMs: number,
  dryRun: boolean,
): Promise<AgentResult> {
  const resolvedArgs = formatTemplate(agent.command.args, {
    cwd,
    prompt,
  });
  const launch = await resolveLaunchCommand(agent, resolvedArgs);

  const outputFile = path.join(outputDir, `${agent.definition.id}.md`);

  console.log(`[start] ${agent.definition.id}: launching worker`);

  if (dryRun) {
    const preview = [
      `# ${agent.definition.label}`,
      "",
      `Executable: ${launch.command}`,
      `Args: ${JSON.stringify(launch.args)}`,
      "",
      "Dry run only. No agent process was started.",
    ].join("\n");

    await writeFile(outputFile, preview, "utf8");
    return {
      agentId: agent.definition.id,
      exitCode: 0,
      timedOut: false,
      stdout: preview,
      stderr: "",
      outputFile,
    };
  }

  return new Promise<AgentResult>((resolve, reject) => {
    const child = spawn(launch.command, launch.args, {
      cwd,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });

    if (launch.stdinPrompt) {
      child.stdin.write(prompt);
      child.stdin.end();
    } else {
      child.stdin.end();
    }

    let stdout = "";
    let stderr = "";
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) {
        return;
      }

      settled = true;
      child.kill();
      void writeFile(outputFile, stdout || stderr || "Timed out with no output.", "utf8");
      resolve({
        agentId: agent.definition.id,
        exitCode: null,
        timedOut: true,
        stdout,
        stderr,
        outputFile,
      });
    }, timeoutMs);

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("error", (error) => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timer);
      reject(error);
    });

    child.on("close", async (code) => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timer);

      const finalOutput = stdout.trim() || stderr.trim() || `Process exited with code ${code ?? "unknown"}.`;
      await writeFile(outputFile, finalOutput, "utf8");

      resolve({
        agentId: agent.definition.id,
        exitCode: code,
        timedOut: false,
        stdout,
        stderr,
        outputFile,
      });
    });
  });
}

async function runAgentsWithProgress(
  agents: DetectedAgent[],
  prompt: string,
  cwd: string,
  outputDir: string,
  timeoutMs: number,
  dryRun: boolean,
  tracker: ProgressTracker,
): Promise<AgentResult[]> {
  return Promise.all(
    agents.map(async (agent) => {
      const result = await runAgent(agent, prompt, cwd, outputDir, timeoutMs, dryRun);
      const status = result.timedOut ? "timed out" : result.exitCode === 0 ? "finished" : `exit ${result.exitCode}`;
      tracker.tick(`${agent.definition.id} ${status}`);
      return result;
    }),
  );
}

async function runList(): Promise<void> {
  const agents = await detectAgents();
  const health = await loadAgentHealth();

  console.log("Detected agent CLIs");
  console.log("");
  for (const agent of agents) {
    console.log(`${agent.definition.id}: ${agent.available ? "available" : "missing"}`);
    console.log(`  label: ${agent.definition.label}`);
    console.log(`  path: ${agent.executablePath ?? "not found"}`);
    console.log(`  command source: ${agent.command.source}`);
    console.log(`  executable: ${agent.command.executable}`);
    console.log(`  args: ${JSON.stringify(agent.command.args)}`);
    console.log(`  cost tier: ${agent.definition.costTier}`);
    console.log(`  capabilities: ${agent.definition.capabilities.join(", ")}`);
    if (health[agent.definition.id]?.state === "unavailable") {
      console.log(`  health: unavailable (${health[agent.definition.id]?.reason ?? "unknown reason"})`);
    }
  }
}

function selectPreferredAgent(
  agents: DetectedAgent[],
  capability: AgentCapability,
  preferredIds: AgentId[],
): DetectedAgent | undefined {
  const available = agents.filter(
    (agent) => agent.available && agent.definition.capabilities.includes(capability),
  );

  for (const id of preferredIds) {
    const match = available.find((agent) => agent.definition.id === id);
    if (match) {
      return match;
    }
  }

  return undefined;
}

function chooseTaskPolicy(task: TaskFile, available: DetectedAgent[], health: AgentHealthMap): {
  workers: DetectedAgent[];
  primary?: DetectedAgent;
  reviewer?: DetectedAgent;
  synth?: DetectedAgent;
} {
  const healthyAvailable = available.filter(
    (agent) => !shouldTreatAsUnavailable(health[agent.definition.id]),
  );

  if (task.type === "research") {
    const preferredWorkers = task.workerAgents ?? ["gemini", "opencode", "claude", "codex"];
    const synth = selectPreferredAgent(
      healthyAvailable,
      "synthesis",
      task.synthAgent ? [task.synthAgent] : task.risk === "high" ? ["claude", "codex", "gemini"] : ["codex", "gemini", "claude"],
    );
    const workers = preferredWorkers
      .map((id) => healthyAvailable.find((agent) => agent.definition.id === id && agent.available))
      .filter((agent): agent is DetectedAgent => Boolean(agent))
      .filter((agent) => agent.definition.id !== synth?.definition.id);

    return { workers, synth };
  }

  const primary = selectPreferredAgent(
    healthyAvailable,
    "code",
    task.primaryAgent ? [task.primaryAgent] : task.risk === "high" ? ["codex", "opencode"] : ["opencode", "codex"],
  );
  const reviewer =
    (task.risk ?? "medium") === "low"
      ? undefined
      : selectPreferredAgent(
          healthyAvailable,
          "review",
          task.reviewerAgent
            ? [task.reviewerAgent]
            : task.risk === "high"
              ? ["claude", "codex"]
              : ["codex", "claude"],
        );

  return {
    workers: primary ? [primary] : [],
    primary,
    reviewer,
  };
}

async function runResearch(options: Map<string, string | boolean>): Promise<void> {
  const cwd = process.cwd();
  const documentPathInput = getStringOption(options, "doc") ?? process.env.SHAG_AGENT_DOC;
  const task = getStringOption(options, "task") ?? process.env.SHAG_AGENT_TASK;
  const outputRoot = path.resolve(cwd, getStringOption(options, "out-dir") ?? process.env.SHAG_AGENT_OUT_DIR ?? ".");
  const timeoutMs = Number.parseInt(
    getStringOption(options, "timeout-ms") ?? process.env.SHAG_AGENT_TIMEOUT_MS ?? "120000",
    10,
  );
  const dryRun = getBooleanOption(options, "dry-run") || ["true", "1"].includes(process.env.SHAG_AGENT_DRY_RUN ?? "");

  if (!documentPathInput || !task) {
    throw new Error('Usage: research --doc <path> --task "<task>" [--agents codex,claude] [--synth codex] [--dry-run]');
  }

  const documentPath = path.resolve(cwd, documentPathInput);
  await readFile(documentPath, "utf8");

  const detected = await detectAgents();
  const available = detected.filter((agent) => agent.available);
  const health = await loadAgentHealth();
  const requestedAgents = (getStringOption(options, "agents") ?? process.env.SHAG_AGENT_AGENTS ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  const synthId = getStringOption(options, "synth") ?? process.env.SHAG_AGENT_SYNTH;

  const workers = (
    requestedAgents.length > 0 ? available.filter((agent) => requestedAgents.includes(agent.definition.id)) : available
  ).filter((agent) => agent.definition.id !== synthId);

  if (workers.length === 0) {
    throw new Error("No worker agents available for the research run.");
  }

  const outputDir = await ensureOutputDir(outputRoot);
  const prompt = buildResearchPrompt(path.relative(cwd, documentPath), task, workers.length);
  console.log(`Created run directory: ${outputDir}`);
  console.log("");
  console.log(`[progress] starting ${workers.length} worker(s)`);
  const workerHeartbeat = startProgressHeartbeat("research workers");
  const workerResults = await runAgentsWithProgress(
    workers,
    prompt,
    cwd,
    outputDir,
    timeoutMs,
    dryRun,
    workerHeartbeat,
  );
  workerHeartbeat.stop();
  await updateAgentHealthFromResults(workerResults);
  console.log("");

  for (const result of workerResults) {
    const status = result.timedOut ? "timed out" : result.exitCode === 0 ? "ok" : `exit ${result.exitCode}`;
    console.log(`${result.agentId}: ${status}`);
    console.log(`  output: ${path.relative(cwd, result.outputFile)}`);
  }

  if (!synthId) {
    return;
  }

  const synthesisAgent = available.find((agent) => agent.definition.id === synthId);
  if (!synthesisAgent) {
    throw new Error(`Synthesis agent "${synthId}" is not available.`);
  }

  const synthesisPrompt = buildSynthesisPrompt(
    path.relative(cwd, documentPath),
    task,
    workerResults.map((result) => result.stdout || result.stderr),
  );
  console.log("");
  console.log(`[progress] starting synthesis with ${synthesisAgent.definition.id}`);
  const synthesisHeartbeat = startProgressHeartbeat(`synthesis ${synthesisAgent.definition.id}`);

  const synthesisResult = await runAgent(
    synthesisAgent,
    synthesisPrompt,
    cwd,
    outputDir,
    timeoutMs,
    dryRun,
  );
  synthesisHeartbeat.stop();
  synthesisHeartbeat.tick(`${synthesisAgent.definition.id} finished synthesis`);
  await updateAgentHealthFromResults([synthesisResult]);

  const synthesisOutput = path.join(outputDir, "synthesis.md");
  await writeFile(synthesisOutput, synthesisResult.stdout || synthesisResult.stderr, "utf8");

  const synthesisStatus = synthesisResult.timedOut
    ? "timed out"
    : synthesisResult.exitCode === 0
      ? "ok"
      : `exit ${synthesisResult.exitCode}`;

  console.log("");
  console.log(`synthesis (${synthId}): ${synthesisStatus}`);
  console.log(`  output: ${path.relative(cwd, synthesisOutput)}`);
  console.log(`  open next: ${path.relative(cwd, synthesisOutput)}`);
}

async function runTask(options: Map<string, string | boolean>): Promise<void> {
  const cwd = process.cwd();
  const taskPathInput = getStringOption(options, "task-file") ?? process.env.SHAG_AGENT_TASK_FILE;
  const outputRoot = path.resolve(cwd, getStringOption(options, "out-dir") ?? process.env.SHAG_AGENT_OUT_DIR ?? ".");
  const timeoutMs = Number.parseInt(
    getStringOption(options, "timeout-ms") ?? process.env.SHAG_AGENT_TIMEOUT_MS ?? "120000",
    10,
  );
  const dryRun = getBooleanOption(options, "dry-run") || ["true", "1"].includes(process.env.SHAG_AGENT_DRY_RUN ?? "");

  if (!taskPathInput) {
    throw new Error('Usage: task --task-file <path> [--dry-run]');
  }

  const taskPath = path.resolve(cwd, taskPathInput);
  const task = await loadTaskFile(taskPath);
  await executeTask(task, outputRoot, timeoutMs, dryRun);
}

async function executeTask(task: TaskFile, outputRoot: string, timeoutMs: number, dryRun: boolean): Promise<void> {
  const cwd = process.cwd();
  const detected = (await detectAgents()).filter((agent) => agent.available);
  const health = await loadAgentHealth();
  const policy = chooseTaskPolicy(task, detected, health);
    const outputDir = await ensureOutputDir(outputRoot);

  await writeFile(path.join(outputDir, "task.json"), JSON.stringify(task, null, 2), "utf8");

  if (task.type === "research") {
    const documentPath = task.target.path;
    if (!documentPath) {
      throw new Error("Research task target.path is required.");
    }

    const resolvedDocument = path.resolve(cwd, documentPath);
    await readFile(resolvedDocument, "utf8");

    if (policy.workers.length === 0) {
      throw new Error("No research workers available for task policy.");
    }

    const prompt = buildResearchPrompt(path.relative(cwd, resolvedDocument), task.goal, policy.workers.length);
    console.log(`Created run directory: ${outputDir}`);
    console.log("");
    console.log(`[progress] starting ${policy.workers.length} worker(s)`);
    const workerHeartbeat = startProgressHeartbeat("research workers");
    const workerResults = await runAgentsWithProgress(
      policy.workers,
      prompt,
      cwd,
      outputDir,
      timeoutMs,
      dryRun,
      workerHeartbeat,
    );
    workerHeartbeat.stop();
    await updateAgentHealthFromResults(workerResults);
    console.log("");
    console.log(`policy: research workers=${policy.workers.map((agent) => agent.definition.id).join(", ")}`);
    if (policy.synth) {
      console.log(`policy: synthesis=${policy.synth.definition.id}`);
    }

    for (const result of workerResults) {
      const status = result.timedOut ? "timed out" : result.exitCode === 0 ? "ok" : `exit ${result.exitCode}`;
      console.log(`${result.agentId}: ${status}`);
      console.log(`  output: ${path.relative(cwd, result.outputFile)}`);
    }

    if (!policy.synth) {
      return;
    }

    const synthesisPrompt = buildSynthesisPrompt(
      path.relative(cwd, resolvedDocument),
      task.goal,
      workerResults.map((result) => result.stdout || result.stderr),
    );
    console.log("");
    console.log(`[progress] starting synthesis with ${policy.synth.definition.id}`);
    const synthesisHeartbeat = startProgressHeartbeat(`synthesis ${policy.synth.definition.id}`);
    const synthesisResult = await runAgent(policy.synth, synthesisPrompt, cwd, outputDir, timeoutMs, dryRun);
    synthesisHeartbeat.stop();
    synthesisHeartbeat.tick(`${policy.synth.definition.id} finished synthesis`);
    await updateAgentHealthFromResults([synthesisResult]);
    const synthesisOutput = path.join(outputDir, "synthesis.md");
    await writeFile(synthesisOutput, synthesisResult.stdout || synthesisResult.stderr, "utf8");
    console.log(`synthesis: ${policy.synth.definition.id}`);
    console.log(`  output: ${path.relative(cwd, synthesisOutput)}`);
    console.log(`  open next: ${path.relative(cwd, synthesisOutput)}`);
    return;
  }

  const files = task.target.files ?? [];
  if (files.length === 0) {
    throw new Error("Code task target.files must contain at least one file.");
  }

  if (!policy.primary) {
    throw new Error("No primary coding agent available for task policy.");
  }

  const primaryPrompt = buildCodePrompt(files, task);
  const primaryResult = await runAgent(policy.primary, primaryPrompt, cwd, outputDir, timeoutMs, dryRun);
  await updateAgentHealthFromResults([primaryResult]);

  console.log(`Created run directory: ${outputDir}`);
  console.log("");
  console.log(`policy: primary=${policy.primary.definition.id}`);
  if (policy.reviewer) {
    console.log(`policy: reviewer=${policy.reviewer.definition.id}`);
  }
  console.log(`${primaryResult.agentId}: ${primaryResult.timedOut ? "timed out" : primaryResult.exitCode === 0 ? "ok" : `exit ${primaryResult.exitCode}`}`);
  console.log(`  output: ${path.relative(cwd, primaryResult.outputFile)}`);

  if (!policy.reviewer) {
    return;
  }

  const reviewPrompt = buildReviewPrompt(files, task, primaryResult.stdout || primaryResult.stderr);
  const reviewResult = await runAgent(policy.reviewer, reviewPrompt, cwd, outputDir, timeoutMs, dryRun);
  await updateAgentHealthFromResults([reviewResult]);
  const reviewOutput = path.join(outputDir, "review.md");
  await writeFile(reviewOutput, reviewResult.stdout || reviewResult.stderr, "utf8");
  console.log(`review: ${policy.reviewer.definition.id}`);
  console.log(`  output: ${path.relative(cwd, reviewOutput)}`);
}

async function runDefaultResearch(options: Map<string, string | boolean>): Promise<void> {
  const cwd = process.cwd();
  const documentPathInput = getStringOption(options, "doc") ?? process.env.SHAG_AGENT_DOC;
  const goal = getStringOption(options, "goal") ?? process.env.SHAG_AGENT_GOAL;
  const title = getStringOption(options, "title") ?? process.env.SHAG_AGENT_TITLE;
  const risk = getStringOption(options, "risk") ?? process.env.SHAG_AGENT_RISK;
  const outputRoot = path.resolve(cwd, getStringOption(options, "out-dir") ?? process.env.SHAG_AGENT_OUT_DIR ?? ".");
  const timeoutMs = Number.parseInt(
    getStringOption(options, "timeout-ms") ?? process.env.SHAG_AGENT_TIMEOUT_MS ?? "120000",
    10,
  );
  const dryRun = getBooleanOption(options, "dry-run") || ["true", "1"].includes(process.env.SHAG_AGENT_DRY_RUN ?? "");

  if (!documentPathInput) {
    throw new Error('Usage: default-research --doc <path> [--goal "<task>"] [--dry-run]');
  }

  const task = await loadTaskFile(DEFAULT_RESEARCH_TASK_PATH);
  task.target.path = documentPathInput;
  if (goal) {
    task.goal = goal;
  }
  if (title) {
    task.title = title;
  }
  if (risk === "low" || risk === "medium" || risk === "high") {
    task.risk = risk;
  }

  await executeTask(task, outputRoot, timeoutMs, dryRun);
}

async function runInitTask(options: Map<string, string | boolean>): Promise<void> {
  const cwd = process.cwd();
  const kind = getStringOption(options, "type") ?? "research";
  const outputPath = path.resolve(cwd, getStringOption(options, "out") ?? path.join(".agent", `task-${kind}.json`));
  const definitions = listAgentDefinitions();
  const defaultTask = await loadTaskFile(kind === "code" ? DEFAULT_CODE_TASK_PATH : DEFAULT_RESEARCH_TASK_PATH);

  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, JSON.stringify(defaultTask, null, 2), "utf8");

  console.log(`Wrote task template: ${outputPath}`);
  console.log("");
  console.log(
    `Available agents: ${definitions.map((definition) => `${definition.id}[${definition.costTier}]`).join(", ")}`,
  );
}

async function main(): Promise<void> {
  const parsed = parseArgs(process.argv.slice(2));

  if (parsed.command === "list") {
    await runList();
    return;
  }

  if (parsed.command === "research") {
    await runResearch(parsed.options);
    return;
  }

  if (parsed.command === "task") {
    await runTask(parsed.options);
    return;
  }

  if (parsed.command === "init-task") {
    await runInitTask(parsed.options);
    return;
  }

  if (parsed.command === "default-research") {
    await runDefaultResearch(parsed.options);
    return;
  }

  throw new Error(`Unknown command "${parsed.command}". Use "list", "research", "task", "init-task", or "default-research".`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
