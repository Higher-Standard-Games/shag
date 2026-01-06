# Changelog

## v0.8.10

### Render Variables (r_*)
- Added Q3/Warsow-style runtime renderer configuration:
  - `r_normalmap` - Normal/bump map intensity (0-4)
  - `r_glossmap` - Specular/gloss intensity (0-4)
  - `r_lightmap` - Lightmap intensity (0-4)
  - `r_ambient` - Ambient light intensity (0-4)
  - `r_emissive` - Emissive/glow intensity (0-4)
  - `r_anisotropy` - Texture anisotropic filtering (1-16)
  - `r_wireframe` - Wireframe mode toggle (0/1)
  - `r_bloom` - Bloom intensity multiplier (0-3)
  - `r_exposure` - Exposure multiplier (0-3)
  - `r_contrast` - Contrast multiplier (0-3)
  - `r_list`, `r_reset`, `r_export`, `r_apply` utility commands
- Values persist to localStorage and apply live to scene materials
- See [docs/RENDER_VARS.md](docs/RENDER_VARS.md) for full documentation

### Debug Console Enhancements
- Added shader aim debugging helpers:
  - `shader info` (no args) prints info for the surface under the crosshair (material + bound textures)
  - `shader aim 1` highlights the surface under the crosshair (outline/edges)

---

## v0.8.9

### CLI Tools
- Headless game runner now uses all engine commands (26 commands vs 10 before)
- Fixed vite-node dynamic import issues with static imports for command system
- Added `help` command to headless mode
- Fixed `localStorage` errors in PK3Index for Node.js headless mode
- Updated CLI_TOOLS.md documentation with accurate commands and examples

### Engine Improvements
- EngineCommands now uses lazy imports for DOM-dependent modules (supports headless mode)
- PK3Index gracefully handles missing localStorage in Node.js environments

---

## v0.8.8

### Engine Features
- Added `freefly_speed` console command for configuring camera flight speed

### Engine Improvements
- Console now dismisses loading screen when opened (unlocks audio)
- Console releases pointer lock when opened for free typing
- Auto-enable PVS culling when loading BSP maps

---

## v0.8.7

### Engine Features
- Added `show_fps` console command (0/1 toggle) for displaying FPS and performance metrics
- Added `pvs` console command for PVS (Potentially Visible Set) culling control
- PVS culling system for BSP maps - reduces overdraw by hiding geometry not visible from camera

### Engine Improvements
- Focus on making engine features more solid and reliable

---

## v0.8.6

### Features
- PK3 indexing system for efficient asset discovery
- Unified map loading from PK3 archives
- Shader parsing and material fixes

### Improvements
- Glow overlay shader support for fullbright lamp effects

---

## v0.8.5

### Features
- Glow overlay shader support
- Fullbright lamp shader improvements

---

(See git history for earlier versions)
