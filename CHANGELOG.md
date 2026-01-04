# Changelog

## v0.8.8 (in progress)

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
