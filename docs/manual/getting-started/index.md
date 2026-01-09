# Getting Started

This guide will help you set up SHAG Engine for development.

## Requirements

- **Node.js** 18+ (recommended: 22 LTS)
- **npm** 9+ or **pnpm**
- **Git**
- Modern browser with WebGL2 support

## Installation

### 1. Clone the Repository

```bash
git clone https://github.com/user/shag-engine.git
cd shag-engine
```

### 2. Install Dependencies

```bash
npm install
```

### 3. Run Development Server

```bash
npm run dev
```

Open [http://localhost:5173](http://localhost:5173) in your browser.

## Project Structure

```
shag-engine/
├── src/
│   ├── engine/           # Core engine code
│   │   ├── camera/       # Camera controllers
│   │   ├── console/      # Console system
│   │   ├── core/         # Core systems
│   │   ├── debug/        # Debug commands
│   │   ├── loader/       # Asset loaders (BSP, PK3, textures)
│   │   └── rendering/    # Render variables
│   ├── game/             # Game-specific code
│   ├── cli/              # Headless CLI tools
│   └── main.ts           # Entry point
├── public/
│   ├── engine.json       # Engine configuration (required)
│   ├── engine/           # Shared engine assets (fonts, textures)
│   └── game/             # Game assets and PK3 files
├── docs/                 # Documentation
└── package.json
```

## Available Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start development server |
| `npm run build` | Build for production |
| `npm run preview` | Preview production build |
| `npm run cli:game` | Run headless game CLI |
| `npm run cli:bsp` | Run headless BSP loader |
| `npm run lint` | Run Biome linter |
| `npm run docs` | Generate API documentation |

## Next Steps

- [Configuration](../guides/configuration.md) - Set up engine.json
- [Your First Map Load](../tutorials/beginner/first-map-load.md) - Load and explore a map
- [Project Structure](./project-structure.md) - Detailed structure explanation
- [Building for Production](./building.md) - Create production builds
