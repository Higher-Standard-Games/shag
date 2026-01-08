# SHAG Engine - Feature Matrix

A comprehensive TypeScript/WebGL game engine built on Babylon.js with full Quake 3/Warsow compatibility.

---

## 🎮 Core Engine

| Feature | Description |
|---------|-------------|
| **Babylon.js Foundation** | Built on Babylon.js 8.x with ES6 modules |
| **Tree-Shaken Bundle** | 8MB → 3.4MB (-58%) through aggressive tree-shaking |
| **TypeScript Native** | 100% TypeScript codebase with strict typing |
| **Singleton Architecture** | Clean service-based architecture with dependency injection |

---

## 🗺️ BSP Map System

| Feature | Description |
|---------|-------------|
| **IBSP/FBSP Support** | Full Quake 3 (IBSP) and Warsow (FBSP) BSP format support |
| **Lightmap Rendering** | Pre-baked lightmaps with configurable intensity |
| **Entity Parsing** | Full entity lump parsing (spawn points, lights, triggers) |
| **Face Types** | Polygons, patches (Bezier curves), meshes, billboards |
| **Collision Detection** | BSP-based collision for camera and entities |
| **Auto-Spawn** | Automatic camera placement at spawn points |

---

## 🌌 Skybox System

| Feature | Description |
|---------|-------------|
| **Cubemap Skyboxes** | 6-face cubemap loading from `skyparms` directive |
| **Textured Sky Sphere** | Fallback for shaders with `surfaceparm sky` but no cubemap |
| **Q3 Coordinate Mapping** | Proper Q3→Babylon.js coordinate system conversion |
| **TGA/JPG/PNG Support** | Multiple texture format support for skybox faces |

---

## 📦 PK3 Virtual Filesystem

| Feature | Description |
|---------|-------------|
| **ZIP-based Archives** | Full PK3 (ZIP) archive loading via JSZip |
| **Priority System** | Numbered priority for mod loading order |
| **Virtual Path Resolution** | Unified path lookup across all loaded archives |
| **Lazy Loading** | On-demand file extraction for memory efficiency |
| **94+ PK3 Support** | Tested with full Warsow 2.1 asset library |

---

## 🎨 Q3 Shader System

| Feature | Description |
|---------|-------------|
| **1700+ Shaders** | Parses and applies Warsow's complete shader library |
| **Blend Functions** | `blendFunc` support (add, blend, filter, etc.) |
| **Texture Coordinate Mods** | `tcMod` scroll, scale, rotate, turb, stretch |
| **Vertex Deformations** | `deformVertexes` wave, move, autosprite |
| **Surface Parameters** | `surfaceparm` sky, trans, alphashadow, etc. |
| **Cull Modes** | Front, back, disable culling |
| **Sort Orders** | Proper render order for transparency |
| **Animated Textures** | `animMap` and `animClampMap` support |
| **Filter Blend Material** | Custom shader for Q3 multiply-blend decals |

---

## 🎥 Camera System

| Feature | Description |
|---------|-------------|
| **Freefly Controller** | FPS-style WASD + mouse look |
| **Collision Detection** | Optional camera-world collision |
| **Isometric Controller** | Top-down RTS/RPG perspective |
| **Sidescroll Controller** | 2.5D platformer camera |
| **Follow Controller** | Third-person character tracking |
| **Runtime Switching** | Change camera mode via console commands |
| **Orthographic Mode** | True orthographic projection option |
| **Height Control** | Adjustable camera height for all modes |

---

## 🖥️ Console Command System

| Feature | Description |
|---------|-------------|
| **45+ Commands** | Comprehensive command library |
| **Q3-Style Syntax** | Familiar `command arg1 arg2` format |
| **Tab Completion** | Auto-complete for commands and arguments |
| **Command History** | Up/down arrow navigation |
| **Help System** | `help <command>` for detailed usage |
| **Subcommands** | Nested command structure (e.g., `bsp info`, `bsp render`) |

### Command Categories:
- **Map Commands**: `map`, `bsp`, `scene`
- **Camera Commands**: `camera`, `freefly_speed`, `freefly_collision`
- **Render Commands**: `r_*` variables (see below)
- **Debug Commands**: `debug`, `shader`, `pvs`
- **System Commands**: `version`, `help`, `quit`

---

## 🔧 Render Variables (r_*)

Runtime-configurable rendering parameters with localStorage persistence:

| Variable | Range | Description |
|----------|-------|-------------|
| `r_normalmap` | 0-4 | Normal/bump map intensity |
| `r_glossmap` | 0-4 | Specular/gloss intensity |
| `r_lightmap` | 0-4 | Lightmap intensity |
| `r_ambient` | 0-4 | Ambient light intensity |
| `r_emissive` | 0-4 | Emissive/glow intensity |
| `r_anisotropy` | 1-16 | Anisotropic filtering level |
| `r_wireframe` | 0/1 | Wireframe mode toggle |
| `r_showtris` | 0/1 | Force scene wireframe |
| `r_bloom` | 0-3 | Bloom intensity |
| `r_exposure` | 0-3 | Exposure multiplier |
| `r_contrast` | 0-3 | Contrast multiplier |
| `r_lightintensity` | 0-4 | Global light intensity |

Utility commands: `r_list`, `r_reset`, `r_export`, `r_apply`

---

## 🖥️ Headless Mode

| Feature | Description |
|---------|-------------|
| **NullEngine Support** | Run without GPU/WebGL |
| **CLI Interface** | `npm run cli:game` and `npm run cli:bsp` |
| **Full Command Access** | All 45+ console commands available |
| **BSP Validation** | Parse and validate maps without rendering |
| **Shader Testing** | Load and parse shaders headlessly |
| **CI/CD Ready** | Automated testing in pipelines |

---

## ⚡ Performance Optimizations

| Feature | Description |
|---------|-------------|
| **PVS Culling** | Potentially Visible Set for occlusion |
| **Cluster-Based Visibility** | BSP cluster visibility checks |
| **Texture Atlasing** | Efficient texture memory usage |
| **Mesh Merging** | Combine faces by texture for draw call reduction |
| **Lazy Texture Loading** | Load textures on demand |
| **KTX2 Support** | GPU-compressed textures (optional) |

---

## 🌐 Cross-Platform

| Platform | Technology |
|----------|------------|
| **Web** | Vite + vanilla deployment |
| **Mobile** | Capacitor (iOS/Android) |
| **Desktop** | Electron (Windows/Mac/Linux) |

---

## 🛠️ Developer Experience

| Feature | Description |
|---------|-------------|
| **Hot Module Reload** | Vite HMR for rapid iteration |
| **Bundle Analyzer** | `dist/stats.html` visualization |
| **Biome Linting** | Fast, modern linting and formatting |
| **Vitest Testing** | Unit test support |
| **Comprehensive Docs** | Markdown documentation in `/docs` |

---

## 🎯 Debug Tools

| Feature | Description |
|---------|-------------|
| **Shader Inspector** | `shader info` - inspect surface under crosshair |
| **Shader Highlight** | `shader aim 1` - highlight aimed surface |
| **BSP Info** | `bsp info` - map statistics and structure |
| **Entity Dump** | `bsp entities` - list all map entities |
| **Memory Stats** | `mem` - runtime memory usage |
| **FPS Display** | `show_fps 1` - performance metrics overlay |

---

## 📊 Statistics (Warsow 2.1 Assets)

| Metric | Value |
|--------|-------|
| PK3 Archives | 94 files |
| Total Files Indexed | 4,000+ |
| Shaders Parsed | 1,741 |
| Console Commands | 45+ |
| Source Files | 74+ TypeScript modules |
| Bundle Size (gzip) | ~755 KB |

---

## 🚀 Roadmap / Planned Features

- [ ] MD3 model loading
- [ ] Skeletal animation
- [ ] Audio system (positional)
- [ ] Multiplayer networking
- [ ] Physics integration
- [ ] Particle systems
- [ ] Post-processing pipeline

---

*SHAG Engine - Bringing arena FPS to the modern web*
