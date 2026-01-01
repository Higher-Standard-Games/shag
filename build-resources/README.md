# Build Resources

This directory contains assets used by electron-builder for creating native installers.

## Required Files

### Windows
- `icon.ico` - Application icon (256x256 recommended, multi-resolution)

### Linux  
- `icons/` - Directory containing PNG icons at various sizes:
  - `16x16.png`
  - `32x32.png`
  - `48x48.png`
  - `64x64.png`
  - `128x128.png`
  - `256x256.png`
  - `512x512.png`

### macOS (optional)
- `icon.icns` - macOS icon bundle

## Generating Icons

You can use tools like:
- [electron-icon-builder](https://www.npmjs.com/package/electron-icon-builder)
- [png2icons](https://www.npmjs.com/package/png2icons)
- Online converters

Start with a 1024x1024 PNG source image for best quality.
