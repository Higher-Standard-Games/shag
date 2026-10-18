# Contributing

How to contribute to SHAG Engine development.

## Getting started

```bash
git clone --recurse-submodules https://github.com/<your-fork>/shag.git
cd shag
npm install
npm run dev
```

The FPS game in `src/games/fps` is a Git submodule with its own history. A change that spans both carries the same branch name in both repositories, for example `v0.9.29-my-feature`, created from `main` in each.

Read the repository `AGENTS.md` before changing code: it records the architecture rules, the validation commands and the release process the project follows.

## Code style

[Biome](https://biomejs.dev/) lints and formats the code.

```bash
npm run lint     # report problems
npm run check    # apply safe fixes and formatting
```

- TypeScript strict mode throughout.
- Babylon.js imports are modular (`@babylonjs/core/...`), never the UMD bundle.
- Comments describe the code as it is; how it used to be belongs in the commit message.
- Remove every EventBus subscription, scene observer and timer you add when its owner is disposed.

## Project structure

```text
src/
├── engine/     # Core engine (reusable)
├── shared/     # Deterministic client-server contracts, no Babylon or DOM
├── games/      # Game modules; fps is a git submodule
├── lobby/      # Matchmaking, accounts, results, server spawning
├── bot/        # Bot service
└── cli/        # Headless tools
```

**Rule:** engine code does not import game code. Where the engine needs
something a game owns, it goes through a registry; see
[Service registries](../guides/service-registries.md).

## Before opening a pull request

1. Update the documentation the change affects, and the living changelog in `docs/changelog/`.
2. Add tests for new behavior.
3. `npm run typecheck` and `npm run test:run` pass.
4. `npm run gate:biome` stays at or below its baseline. A pre-commit hook from
   `.githooks` runs it, so a commit that raises it is refused.
5. `npm run build` succeeds.
6. Renderer and networking changes also pass the regression set in `AGENTS.md`:
   `test:simulation`, `test:physics`, `server:tick`, `server:fuzz -- --ticks 1000`
   and the headless `bsp load washoidm2` check.

### Commit messages

Commits follow conventional-commit types, with an optional scope and a
lowercase summary of what changed:

```text
feat(net): snapshots carry each player's view
fix(console): settings import counts what it applied
docs(manual): bring the engine guides up to date
refactor(bsp): share face batching between world and movers
```

## Testing

```bash
npm run test:run            # the whole suite, once
npm run test:run -- camera  # files matching "camera"
npm run test                # watch mode
```

Headless checks come before browser testing; see
[Headless testing](../tutorials/advanced/headless-testing.md).

## Documentation

This manual lives in `docs/manual/`, written in Markdown.

```bash
npm run docs:dev     # serve with hot reload
npm run docs:build   # build; fails on a dead link
npm run docs:api     # generate the TypeDoc API reference into docs/api/
```

Add new pages to the sidebar in `docs/manual/.vitepress/config.ts`, or they
are unreachable in the built site. Link files outside the manual by their
GitHub URL: the built site does not serve them.

Player-facing documentation for the FPS game is a separate manual in
`src/games/fps/docs/manual` (`npm run docs:fps:dev`).

## Issues

Report problems and look for open work in the
[GitHub issues](https://github.com/Higher-Standard-Games/shag/issues).

## Code of conduct

Be respectful and constructive in issues, reviews and discussion.

## License

By contributing, you agree that your contributions are licensed under the
project's [MIT License](https://github.com/Higher-Standard-Games/shag/blob/main/LICENSE).
