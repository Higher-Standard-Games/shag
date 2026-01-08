# FAQ & Troubleshooting

Common questions and solutions.

## General

### What is SHAG Engine?

SHAG Engine is a TypeScript/WebGL game engine built on Babylon.js with full Quake 3/Warsow BSP map compatibility.

### What can I build with it?

- Arena shooters
- Map explorers
- Isometric strategy games
- Sidescrollers
- Any game using Q3/Warsow assets

### Is it free?

Yes, SHAG Engine is open source.

## Installation

### "npm install" fails

Ensure Node.js 18+ is installed:

```bash
node --version  # Should be 18+
```

### "Cannot find module" errors

Delete `node_modules` and reinstall:

```bash
rm -rf node_modules
npm install
```

## Runtime Issues

### Black screen after loading map

Check console for errors. Try:

```
r_lightmap 1
r_apply
```

### Map not found

List available maps:

```
pk3 list maps/
```

### Textures missing

Ensure texture PK3s are loaded:

```
pk3 list textures/
shader count
```

### Sky not rendering

Check if skybox loaded:

```
bsp info
shader info textures/<mapname>/sky
```

### Low FPS

Try:

```
pvs toggle          # Enable PVS culling
r_anisotropy 1      # Reduce filtering
```

## Camera Issues

### Camera stuck / can't move

Check collision:

```
freefly_collision 0
```

### Camera spawns in wrong place

Manually position:

```
camera target 0 100 0
```

## Console

### Command not found

Check spelling and use `help`:

```
help
help map
```

### Console won't open

Try both `~` (tilde) and `F1`.

## Build Issues

### Build fails with TypeScript errors

Run type check:

```bash
npx tsc --noEmit
```

### Bundle too large

Ensure tree-shaking is working. Check `dist/stats.html` after build.

## Mobile

### Touch controls not working

Ensure Capacitor is synced:

```bash
npx cap sync
```

### App crashes on startup

Check device logs in Android Studio or Xcode.

## Performance Tips

1. **Enable PVS culling**: `pvs toggle`
2. **Lower anisotropy**: `r_anisotropy 4`
3. **Disable post-processing**: `r_bloom 0`
4. **Use KTX2 textures**: `npm run build:textures`

## Getting Help

- Check existing [GitHub Issues](https://github.com/user/shag-engine/issues)
- Open a new issue with:
  - Browser/OS version
  - Console error messages
  - Steps to reproduce
