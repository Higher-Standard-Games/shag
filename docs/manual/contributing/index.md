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
├── game/       # Game-specific code
└── cli/        # Headless tools
```

**Rule:** Engine code should not import from game code.

## Pull Request Process

1. Update documentation if needed
2. Add tests for new features
3. Ensure `npm run lint` passes
4. Ensure `npm run build` succeeds
5. Write clear commit messages
6. Open PR with description of changes

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
# Generate API docs
npm run docs
```

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
