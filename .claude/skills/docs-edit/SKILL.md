---
name: docs-edit
description: Write or revise SHAG documentation - the engine manual in docs/manual, the game manual in src/games/fps/docs/manual, the living changelog in docs/changelog, research notes in docs/research, and AGENTS.md - so that every claim matches the code. Use this whenever you add or change a feature that the docs describe, when the user asks to update, check, proofread or "make professional" the manual or changelog, and before writing any command, cvar, default value, script or API name into documentation.
---

# Editing SHAG documentation

The docs drift: a cycle of feature work leaves pages describing removed
commands, old defaults and APIs that were renamed. A wrong page costs more than
a missing one, because agents and players act on it. So documentation here is
written against the source, one claim at a time.

## Where things go

| Content | Location |
| --- | --- |
| Engine systems, APIs, tools, deployment | `docs/manual/` (VitePress, `npm run docs:dev`) |
| Player-facing game manual | `src/games/fps/docs/manual/` (`npm run docs:fps:dev`) |
| What changed this cycle | `docs/changelog/v<version>.md` (now `v1.0.0-alpha.md`), the living changelog |
| Investigations, plans, status | `docs/research/` |
| Rules every agent follows | `AGENTS.md` (keep it short; procedures belong in skills) |

## Verify every claim

Before a fact goes on the page, find it in the source:

- **Commands:** the `CommandDef` in `src/engine/console/commands/` or
  `src/games/fps/console/commands/`: `name`, `aliases`, `developer`, `usage`,
  and the `case` branches for subcommands. Check `developer: true` before saying
  a command works without `developer 1`.
- **Cvars and defaults:** `Cvar.register` calls, `src/engine/rendering/RenderVars.ts`
  (`DEFAULT_VARS`) and `src/engine/movement/MovementVars.ts`. Movement defaults
  that matter to play live in `DEFAULT_FPS_MOVEMENT_CONFIG`
  (`src/games/fps/simulation/MovementProfile.ts`).
- **Scripts and flags:** `package.json`, and the CLI's own argument parsing and
  `--help` text in `src/cli/`.
- **APIs:** the exported class and method signatures. Write examples that would
  compile; there is no `@/` import alias.
- **Environment variables:** `process.env.*` / `import.meta.env.*` in source,
  and `.env.example`, which should list every one.
- **Protocol and formats:** `src/shared/net/BinaryProtocol.ts` (message types,
  snapshot layout) and the demo version in `src/games/fps/server/DemoRecorder.ts`.

When the code and the page disagree, the code wins; fix the page. If the code
looks wrong (a help string, a usage line, a misleading description), fix that
too when it is a string-only change, and mention it.

## Write it for the reader

- Describe what the system does now. Drop sentences that exist only to say what
  used to be there ("the old `r_list`", "there is no `loadFromPK3()`", "now
  uses"); history belongs in the changelog and commit messages.
- No hedging filler ("currently", "for now", "at present") unless the limit is
  real and worth stating, and then state the limit plainly.
- Prefer a table for flags, cvars and options; keep defaults and ranges in it.
- Professional and direct: no marketing tone, no jokes in reference pages.
- Keep internal tracking codes (QA ledgers, work-order numbers) out of the
  manuals; they mean nothing to a reader.

## Links

The built site serves only the manual. Link pages inside it relatively
(`./networking.md#snapshot-format`), and link anything else in the repository by
its GitHub URL:
`https://github.com/Higher-Standard-Games/shag/blob/main/<path>`. A relative
link out of `docs/manual` is either a dead-link build failure or a 404 on the
published site. New pages must be added to the sidebar in
`docs/manual/.vitepress/config.ts`.

## The changelog

Add an entry to the current `docs/changelog/v<version>.md` under `## Changes` for
any user- or developer-visible change. Write what changed and what was wrong
before, for someone reading later; not the list of files touched. If another
agent has uncommitted hunks in the same file, add yours as a separate section
and stage only your hunk.

## Check before finishing

```bash
npm run docs:build        # fails on a dead link
npm run docs:fps:build    # when the game manual changed
```

Report which pages changed and which facts you corrected, and list anything you
could not verify rather than guessing.
