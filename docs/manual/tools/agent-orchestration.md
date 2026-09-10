# Agent Orchestration

Run a low-friction multi-agent research pass against a single document from the local CLI setup.

## Quick Start

Check which agent CLIs are available:

```powershell
npm run dev:research:agents-list
```

Recommended interactive flow:

```powershell
npm run dev:research:wizard
```

The wizard:

1. shows an arrow-key file picker for `docs/research`
2. asks for a goal
3. runs the research command for you

Picker controls:

- `Up` / `Down` move through the list
- `Left` / `Right` move across columns on wide terminals
- `PageUp` / `PageDown` jump faster through long lists
- `/` starts filename filtering
- the first row is `Create new research...`, which scaffolds a new file in `docs/research/` and then runs the agents against that starter document

Safe first direct run:

```powershell
npm run dev:research:doc --doc=docs/research/DEMO_PLAYER.md --goal="Summarize implementation risks and next steps" --dry-run=true
```

Direct real run:

```powershell
npm run dev:research:doc --doc=docs/research/DEMO_PLAYER.md --goal="Summarize implementation risks and next steps"
```

Then open `.agent/runs/<timestamp>/synthesis.md`.

## Overview

SHAG includes a lightweight TypeScript orchestrator in `scripts/dev-agents.ts`. It is intentionally simple:

- one default task shape for research
- cheap workers first
- one synthesis step
- outputs written to `.agent/runs/`

Default research policy:

- `gemini` is the preferred first research worker when available
- `opencode` and `claude` are fallback research workers
- `codex` synthesizes the final answer
- provider-level failures are cached in `.agent/agent-health.json`, so unavailable agents are skipped automatically

This keeps token usage biased toward cheaper workers instead of splitting work evenly across every model.

## Requirements

Before running the workflow, make sure:

- Node.js is installed and `npm run dev:agents:list` works
- Node.js is installed and `npm run dev:research:agents-list` works
- the relevant agent CLIs are installed and available on `PATH`
- each CLI is already authenticated on this machine

Check what the orchestrator can currently see:

```powershell
npm run dev:research:agents-list
```

If a CLI is missing, fix that installation first. The orchestrator only routes work; it does not install or configure providers for you.

If only one compatible worker is available, the orchestrator still runs with the workers it can detect and continues to synthesis if a synthesis agent is available.

## Single Document Workflow

List available CLIs first:

```powershell
npm run dev:research:agents-list
```

Run the default research flow against one target document:

```powershell
npm run dev:research:doc --doc=docs/research/DEMO_PLAYER.md --goal="Summarize implementation risks and next steps"
```

This command:

1. loads the default research task template
2. replaces the target path and goal
3. applies the built-in routing policy
4. writes worker and synthesis outputs under `.agent/runs/<timestamp>/`

Advanced users can inspect the defaults in `scripts/agents/default-research-task.json` and the routing logic in `scripts/dev-agents.ts`.

Use `dev:research:doc` when you want the opinionated single-document path. Use `dev:research` when you want to provide the task text and agent selection yourself.
Use `dev:research:wizard` when you want the same single-document path with an interactive file picker and goal prompt.

## Dry Run

Validate the command path without calling live models:

```powershell
npm run dev:research:doc --doc=docs/research/DEMO_PLAYER.md --goal="Summarize implementation risks and next steps" --dry-run=true
```

Dry run still writes the run directory and per-agent output files, but those files contain the resolved command previews instead of model responses.

## Useful Options

| Option | Meaning |
|--------|---------|
| `--doc=...` | Target document path |
| `--goal="..."` | Task instruction for the workers |
| `--title="..."` | Optional task title override |
| `--risk=low|medium|high` | Adjust routing policy |
| `--timeout-ms=120000` | Override the per-agent timeout in milliseconds |
| `--dry-run=true` | Preview commands without executing models |

Worker and synthesis overrides are not exposed on this shortcut command. If you need to pin specific agents such as Claude for a single run, use the task JSON flow instead.

## Risk Levels

`--risk` changes how aggressively the orchestrator spends model budget:

| Risk | Behavior |
|------|----------|
| `low` | Prefer the lightest default path |
| `medium` | Use the standard default routing policy |
| `high` | Allow a stronger review or synthesis path when the task JSON or policy calls for it |

For custom worker selection such as Claude-inclusive runs, switch to a task JSON file.

## Output Layout

Each run creates a timestamped directory:

```text
.agent/runs/2026-04-01T11-40-26-441Z/
|- gemini.md
|- opencode.md
|- synthesis.md
`- task.json
```

Typical run summary:

```text
Created run directory: C:\...\shag\.agent\runs\2026-04-01T11-40-26-441Z

policy: research workers=opencode, gemini
policy: synthesis=codex
opencode: ok
gemini: ok
synthesis: codex
```

If a worker fails, its `.md` file still captures stderr output so you can diagnose the failure after the run.

Workers run in parallel, so a run may still contain useful outputs from other workers even if one worker fails.

## Troubleshooting

`CLI missing`

Run `npm run dev:research:agents-list` and fix the missing installation or PATH entry before retrying.

`Worker exits with an error`

Open the corresponding file in `.agent/runs/<timestamp>/`. The orchestrator writes stderr there when a worker fails.

`Dry run works but live run fails`

That usually means the CLI is installed but not authenticated, or the provider behind it is unavailable.

`Only one worker is available`

The orchestrator degrades gracefully and runs with the compatible workers it can detect.

`Need Claude or custom workers on one run`

Use the task-file flow instead of `dev:research:doc`:

```powershell
npm run dev:task:init -- --type=research --out=.agent\task-research.json
```

Then edit the task JSON to set `workerAgents` or `synthAgent` explicitly.

## When To Use Task JSON Directly

If you need to override the defaults, use the task-based flow instead:

```powershell
npm run dev:task:init -- --type=research --out=.agent\task-research.json
node --experimental-strip-types scripts/dev-agents.ts task --task-file=.agent\task-research.json
```

That path is useful when you want to pin specific worker agents or change the built-in policy.
