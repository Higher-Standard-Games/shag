# Contributing

How to contribute to SHAG Engine development.

## Getting Started

1. Fork the repository
2. Clone your fork
3. Install dependencies: `npm install`
4. Create a branch: `git checkout -b feature/my-feature`

## Development Setup

```bash
# Install dependencies
npm install

# Start dev server
npm run dev

# Run linter
npm run lint

# Run tests
npm run test
```

## Code Style

We use [Biome](https://biomejs.dev/) for linting and formatting.

```bash
# Check code
npm run lint

# Auto-fix
npm run check
```

### Guidelines

- Use TypeScript strict mode
- Prefer `const` over `let`
- Use meaningful variable names
- Add JSDoc comments for public APIs
- Keep functions small and focused

## Project Structure

```
src/
├── engine/     # Core engine (reusable)
├── shared/     # Deterministic client-server contracts, no Babylon or DOM
├── games/      # Game modules; fps is a git submodule
├── lobby/      # Matchmaking, accounts, results, server spawning
├── bot/        # Bot service
└── cli/        # Headless tools
```

**Rule:** Engine code should not import from game code. Where the engine needs
something a game owns, it goes through a registry — see
[Service registries](../guides/service-registries.md).

## Pull Request Process

1. Update documentation if needed
2. Add tests for new features
3. Ensure `npm run typecheck` and `npm run test:run` pass
4. Ensure `npm run gate:biome` stays at or below its baseline — a pre-commit
   hook from `.githooks` runs it, so a commit that raises it is refused
5. Ensure `npm run build` succeeds
6. Write clear commit messages
7. Open PR with description of changes

### Commit Messages

Follow conventional commits:

```
feat: Add custom camera controller
fix: Resolve skybox loading issue
docs: Update camera system guide
refactor: Simplify BSP loader
```

## Testing

```bash
# Run all tests
npm run test

# Run specific test
npm run test -- camera

# Watch mode
npm run test -- --watch
```

## Documentation

Documentation lives in `docs/manual/`. Use Markdown.

```bash
# Serve this manual locally with hot reload
npm run docs:dev

# Build the manual
npm run docs:build

# Generate TypeDoc API reference
npm run docs:api
```

New pages must be added to the sidebar in `docs/manual/.vitepress/config.ts`,
otherwise they are unreachable in the built site.

## Roadmap

Check GitHub Issues for planned features and good first issues.

### Priority Areas

- [ ] MD3 model loading
- [ ] Skeletal animation
- [ ] Audio system
- [ ] Multiplayer networking
- [ ] Physics integration

## Code of Conduct

Be respectful and constructive. We're all here to build something cool.

## License

By contributing, you agree that your contributions will be licensed under the same license as the project.
