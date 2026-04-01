import { spawn } from "node:child_process";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import readline from "node:readline";
import readlinePromises from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

interface ParsedArgs {
  options: Map<string, string | boolean>;
}

interface PickerItem {
  kind: "create" | "file";
  label: string;
  value: string;
}

interface WizardState {
  filter: string;
  selectedIndex: number;
  lastSelected?: string;
}

const WIZARD_STATE_PATH = path.resolve(".agent", "research-wizard.json");

function resolveEnvPlaceholder(value: string): string {
  if (!value.startsWith("$")) {
    return value;
  }

  return process.env[value.slice(1)] ?? value;
}

function parseArgs(argv: string[]): ParsedArgs {
  const normalized = argv.filter((token, index) => !(index === 0 && token === "--"));
  const options = new Map<string, string | boolean>();

  for (let i = 0; i < normalized.length; i++) {
    const token = normalized[i];
    if (!token.startsWith("--")) {
      continue;
    }

    const stripped = token.slice(2);
    const [key, inlineValue] = stripped.split("=", 2);
    if (inlineValue !== undefined) {
      options.set(key, inlineValue);
      continue;
    }

    const next = normalized[i + 1];
    if (next && !next.startsWith("--")) {
      options.set(key, next);
      i += 1;
      continue;
    }

    options.set(key, true);
  }

  return { options };
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

async function loadResearchDocs(): Promise<string[]> {
  const researchDir = path.resolve("docs", "research");
  const entries = await readdir(researchDir, { withFileTypes: true });

  return entries
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".md"))
    .map((entry) => path.posix.join("docs", "research", entry.name))
    .sort((left, right) => left.localeCompare(right));
}

async function loadWizardState(): Promise<WizardState> {
  try {
    return JSON.parse(await readFile(WIZARD_STATE_PATH, "utf8")) as WizardState;
  } catch {
    return {
      filter: "",
      selectedIndex: 0,
    };
  }
}

async function saveWizardState(state: WizardState): Promise<void> {
  await mkdir(path.dirname(WIZARD_STATE_PATH), { recursive: true });
  await writeFile(WIZARD_STATE_PATH, JSON.stringify(state, null, 2), "utf8");
}

function slugifyFileName(value: string): string {
  const normalized = value
    .trim()
    .replace(/\.md$/i, "")
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

  return normalized.length > 0 ? `${normalized}.md` : "NEW_RESEARCH.md";
}

function titleFromFileName(fileName: string): string {
  return fileName
    .replace(/\.md$/i, "")
    .split(/[_-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");
}

function buildNewResearchTemplate(fileName: string, about: string): string {
  const title = titleFromFileName(fileName);

  return [
    `# ${title}`,
    "",
    "## Summary",
    "",
    about.trim(),
    "",
    "## Goals",
    "",
    "- Clarify the problem and scope",
    "- Capture implementation options",
    "- Record risks, tradeoffs, and open questions",
    "",
    "## Notes",
    "",
    "- Initial draft created by `dev:research:wizard`",
    "",
    "## Open Questions",
    "",
    "- What are the main constraints?",
    "- Which systems are affected?",
    "- What should happen first?",
    "",
  ].join("\n");
}

function buildCreateResearchGoal(about: string): string {
  return [
    "Improve this starter research document.",
    "Turn the rough brief into a stronger research base with concrete findings, implementation implications, alternatives, risks, and next steps.",
    `Topic brief: ${about.trim()}`,
  ].join(" ");
}

function padRight(value: string, width: number): string {
  if (value.length >= width) {
    return value;
  }

  return `${value}${" ".repeat(width - value.length)}`;
}

function truncateMiddle(value: string, maxWidth: number): string {
  if (value.length <= maxWidth) {
    return value;
  }

  if (maxWidth <= 3) {
    return value.slice(0, maxWidth);
  }

  const left = Math.ceil((maxWidth - 3) / 2);
  const right = Math.floor((maxWidth - 3) / 2);
  return `${value.slice(0, left)}...${value.slice(value.length - right)}`;
}

function getVisibleStart(selectedIndex: number, windowSize: number, total: number): number {
  if (total <= windowSize) {
    return 0;
  }

  const half = Math.floor(windowSize / 2);
  const minStart = 0;
  const maxStart = total - windowSize;
  return Math.max(minStart, Math.min(selectedIndex - half, maxStart));
}

function getColumnMode(totalItems: number): { useTwoColumns: boolean; rowCount: number; columnWidth: number } {
  const terminalWidth = output.columns ?? 100;
  const terminalHeight = output.rows ?? 24;
  const headerLines = 8;
  const footerLines = 3;
  const availableRows = Math.max(6, terminalHeight - headerLines - footerLines);
  const useTwoColumns = terminalWidth >= 120 && totalItems > availableRows;
  const rowCount = useTwoColumns ? Math.max(4, Math.floor(availableRows)) : Math.max(6, Math.floor(availableRows));
  const columnWidth = useTwoColumns ? Math.max(30, Math.floor((terminalWidth - 6) / 2)) : terminalWidth - 4;

  return { useTwoColumns, rowCount, columnWidth };
}

function filterItems(files: string[], filter: string): PickerItem[] {
  const normalizedFilter = filter.trim().toLowerCase();
  const createItem: PickerItem = {
    kind: "create",
    label: normalizedFilter.length > 0 ? `Create new research: ${normalizedFilter}` : "Create new research...",
    value: "__create__",
  };

  const fileItems = files
    .filter((file) => file.toLowerCase().includes(normalizedFilter))
    .map<PickerItem>((file) => ({
      kind: "file",
      label: file,
      value: file,
    }));

  return [createItem, ...fileItems];
}

function renderMenu(items: PickerItem[], selectedIndex: number, filter: string): void {
  const { useTwoColumns, rowCount, columnWidth } = getColumnMode(items.length);
  const selectedRow = useTwoColumns ? selectedIndex % rowCount : selectedIndex;
  const totalRows = useTwoColumns ? Math.ceil(items.length / 2) : items.length;
  const visibleStart = getVisibleStart(selectedRow, rowCount, totalRows);

  output.write("\x1Bc");
  console.log("Research Wizard");
  console.log("");
  console.log("Select a document from docs/research.");
  console.log("Use Up/Down arrows, Enter to confirm, / to filter, PageUp/PageDown to jump, q to cancel.");
  console.log(`Filter: ${filter || "(none)"}`);
  console.log(`Showing ${useTwoColumns ? "2 columns" : "1 column"} | ${selectedIndex + 1}/${items.length}`);
  console.log("");

  for (let row = 0; row < rowCount; row++) {
    const absoluteRow = visibleStart + row;
    if (absoluteRow >= totalRows) {
      break;
    }

    if (!useTwoColumns) {
      const index = absoluteRow;
      const prefix = index === selectedIndex ? ">" : " ";
      const label = items[index].kind === "create" ? `[${items[index].label}]` : items[index].label;
      console.log(`${prefix} ${truncateMiddle(label, columnWidth)}`);
      continue;
    }

    const leftIndex = absoluteRow;
    const rightIndex = absoluteRow + rowCount;
    const leftItem = leftIndex < items.length ? items[leftIndex] : undefined;
    const rightItem = rightIndex < items.length ? items[rightIndex] : undefined;

    const leftLabel = leftItem
      ? `${leftIndex === selectedIndex ? ">" : " "} ${truncateMiddle(leftItem.kind === "create" ? `[${leftItem.label}]` : leftItem.label, columnWidth - 2)}`
      : "";
    const rightLabel = rightItem
      ? `${rightIndex === selectedIndex ? ">" : " "} ${truncateMiddle(rightItem.kind === "create" ? `[${rightItem.label}]` : rightItem.label, columnWidth - 2)}`
      : "";

    console.log(`${padRight(leftLabel, columnWidth)}  ${rightLabel}`);
  }

  if (visibleStart > 0 || visibleStart + rowCount < totalRows) {
    console.log("");
    console.log("More items above/below...");
  }
}

function moveVertical(currentIndex: number, direction: -1 | 1, totalItems: number): number {
  const { useTwoColumns, rowCount } = getColumnMode(totalItems);
  if (!useTwoColumns) {
    if (direction === -1) {
      return currentIndex === 0 ? totalItems - 1 : currentIndex - 1;
    }

    return currentIndex === totalItems - 1 ? 0 : currentIndex + 1;
  }

  let nextIndex = currentIndex + direction;
  if (nextIndex < 0) {
    return totalItems - 1;
  }
  if (nextIndex >= totalItems) {
    return 0;
  }

  const currentColumn = Math.floor(currentIndex / rowCount);
  const nextColumn = Math.floor(nextIndex / rowCount);
  if (direction === -1 && nextColumn < currentColumn && currentIndex % rowCount === 0) {
    const previousColumnLast = Math.min(totalItems - 1, currentIndex + rowCount - 1);
    return previousColumnLast;
  }
  if (direction === 1 && nextColumn > currentColumn && currentIndex % rowCount === rowCount - 1) {
    return Math.max(0, currentIndex - rowCount + 1);
  }

  return nextIndex;
}

function moveHorizontal(currentIndex: number, direction: -1 | 1, totalItems: number): number {
  const { useTwoColumns, rowCount } = getColumnMode(totalItems);
  if (!useTwoColumns) {
    return currentIndex;
  }

  const nextIndex = currentIndex + direction * rowCount;
  if (nextIndex < 0 || nextIndex >= totalItems) {
    return currentIndex;
  }

  return nextIndex;
}

function movePage(currentIndex: number, direction: -1 | 1, totalItems: number): number {
  const { rowCount } = getColumnMode(totalItems);
  const nextIndex = currentIndex + direction * rowCount;
  if (nextIndex < 0) {
    return 0;
  }
  if (nextIndex >= totalItems) {
    return totalItems - 1;
  }
  return nextIndex;
}

async function promptForFile(files: string[]): Promise<PickerItem> {
  if (!input.isTTY) {
    throw new Error("Interactive file selection requires a TTY.");
  }

  const initialState = await loadWizardState();

  return new Promise<PickerItem>((resolve, reject) => {
    let filter = initialState.filter ?? "";
    let items = filterItems(files, filter);
    let selectedIndex = items.findIndex((item) => item.value === initialState.lastSelected);
    if (selectedIndex < 0) {
      selectedIndex = Math.min(initialState.selectedIndex ?? 0, items.length - 1);
    }
    selectedIndex = Math.max(0, selectedIndex);
    let filterMode = false;

    readline.emitKeypressEvents(input);
    input.setRawMode(true);

    const cleanup = () => {
      input.removeListener("keypress", onKeypress);
      input.setRawMode(false);
    };

    const refresh = () => {
      items = filterItems(files, filter);
      if (selectedIndex >= items.length) {
        selectedIndex = Math.max(0, items.length - 1);
      }
      renderMenu(items, selectedIndex, filterMode ? `${filter}_` : filter);
    };

    const persist = async () => {
      const selected = items[selectedIndex];
      await saveWizardState({
        filter,
        selectedIndex,
        lastSelected: selected?.kind === "file" ? selected.value : undefined,
      });
    };

    const onKeypress = async (text: string, key: readline.Key) => {
      if (filterMode) {
        if (key.name === "return") {
          filterMode = false;
          refresh();
          return;
        }

        if (key.name === "escape") {
          filterMode = false;
          refresh();
          return;
        }

        if (key.name === "backspace") {
          filter = filter.slice(0, -1);
          selectedIndex = 0;
          refresh();
          return;
        }

        if (text && !key.ctrl && !key.meta) {
          filter += text;
          selectedIndex = 0;
          refresh();
        }
        return;
      }

      if (key.name === "slash") {
        filterMode = true;
        refresh();
        return;
      }

      if (key.name === "up") {
        selectedIndex = moveVertical(selectedIndex, -1, items.length);
        refresh();
        return;
      }

      if (key.name === "down") {
        selectedIndex = moveVertical(selectedIndex, 1, items.length);
        refresh();
        return;
      }

      if (key.name === "left") {
        selectedIndex = moveHorizontal(selectedIndex, -1, items.length);
        refresh();
        return;
      }

      if (key.name === "right") {
        selectedIndex = moveHorizontal(selectedIndex, 1, items.length);
        refresh();
        return;
      }

      if (key.name === "pageup") {
        selectedIndex = movePage(selectedIndex, -1, items.length);
        refresh();
        return;
      }

      if (key.name === "pagedown") {
        selectedIndex = movePage(selectedIndex, 1, items.length);
        refresh();
        return;
      }

      if (key.name === "return") {
        const selected = items[selectedIndex];
        cleanup();
        output.write("\x1Bc");
        await persist();
        resolve(selected);
        return;
      }

      if (key.name === "q" || (key.ctrl && key.name === "c")) {
        cleanup();
        output.write("\x1Bc");
        reject(new Error("Wizard cancelled."));
      }
    };

    refresh();
    input.on("keypress", (text, key) => {
      void onKeypress(text, key);
    });
  });
}

async function promptForGoal(defaultGoal: string): Promise<string> {
  const rl = readlinePromises.createInterface({ input, output });

  try {
    const answer = await rl.question(`Goal [${defaultGoal}]: `);
    return answer.trim() || defaultGoal;
  } finally {
    rl.close();
  }
}

async function promptForNewResearch(defaultFileName: string): Promise<{ documentPath: string; goal: string }> {
  const rl = readlinePromises.createInterface({ input, output });

  try {
    const rawFileName = await rl.question(`Filename [${defaultFileName}]: `);
    const fileName = slugifyFileName(rawFileName.trim() || defaultFileName);
    const about = await rl.question("What is this research about? ");
    if (!about.trim()) {
      throw new Error("Research topic is required.");
    }

    const documentPath = path.posix.join("docs", "research", fileName);
    const absolutePath = path.resolve(documentPath);
    await mkdir(path.dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, buildNewResearchTemplate(fileName, about), "utf8");

    return {
      documentPath,
      goal: buildCreateResearchGoal(about),
    };
  } finally {
    rl.close();
  }
}

async function runResearchCommand(
  documentPath: string,
  goal: string,
  dryRun: boolean,
  timeoutMs?: string,
): Promise<void> {
  const args = [
    "--experimental-strip-types",
    "scripts/dev-agents.ts",
    "default-research",
    `--doc=${documentPath}`,
    `--goal=${goal}`,
  ];

  if (dryRun) {
    args.push("--dry-run=true");
  }

  if (timeoutMs) {
    args.push(`--timeout-ms=${timeoutMs}`);
  }

  await new Promise<void>((resolve, reject) => {
    const child = spawn(process.execPath, args, {
      cwd: process.cwd(),
      stdio: "inherit",
      windowsHide: true,
    });

    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(`Research command exited with code ${code ?? "unknown"}.`));
    });
  });
}

async function main(): Promise<void> {
  const parsed = parseArgs(process.argv.slice(2));
  const files = await loadResearchDocs();
  const selectedFile = getStringOption(parsed.options, "doc");
  const createNew = getBooleanOption(parsed.options, "create-new");
  const about = getStringOption(parsed.options, "about");
  const filename = getStringOption(parsed.options, "filename");
  const dryRun = getBooleanOption(parsed.options, "dry-run");
  const timeoutMs = getStringOption(parsed.options, "timeout-ms");

  let documentPath: string;
  let goal: string;

  if (createNew) {
    if (!about) {
      throw new Error("Usage: --create-new=true requires --about=\"...\".");
    }

    const generatedFileName = slugifyFileName(filename ?? about);
    const absolutePath = path.resolve("docs", "research", generatedFileName);
    await mkdir(path.dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, buildNewResearchTemplate(generatedFileName, about), "utf8");
    documentPath = path.posix.join("docs", "research", generatedFileName);
    goal = getStringOption(parsed.options, "goal") ?? buildCreateResearchGoal(about);
  } else if (selectedFile) {
    documentPath = selectedFile;
    goal =
      getStringOption(parsed.options, "goal") ??
      (await promptForGoal("Summarize implementation risks and next steps"));
  } else {
    const pickedItem = await promptForFile(files);

    if (pickedItem.kind === "create") {
      const created = await promptForNewResearch(slugifyFileName(pickedItem.label.replace(/^Create new research:\s*/i, "")));
      documentPath = created.documentPath;
      goal = created.goal;
    } else {
      documentPath = pickedItem.value;
      goal = await promptForGoal("Summarize implementation risks and next steps");
    }
  }

  console.log("");
  console.log(`Selected document: ${documentPath}`);
  console.log(`Goal: ${goal}`);
  console.log(`Mode: ${dryRun ? "dry-run" : "live"}`);
  console.log("");

  await runResearchCommand(documentPath, goal, dryRun, timeoutMs);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
