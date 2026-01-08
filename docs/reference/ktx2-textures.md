# KTX2 Texture Compression

GPU-compressed textures for better mobile performance. KTX2 files stay compressed on the GPU, reducing VRAM usage by ~75% compared to PNG/JPG.

## Quick Start

```bash
# Convert all textures to KTX2
npm run build:textures

# Clean and reconvert all
npm run build:textures:clean

# Full production build (textures + app)
npm run build:prod
```

## Requirements

### Install KTX-Software

Download from: https://github.com/KhronosGroup/KTX-Software/releases

**Windows:**
1. Download the installer (e.g., `KTX-Software-4.x.x-Windows-x64.exe`)
2. Install and add to PATH, or set `KTX_TOOLS_PATH` environment variable

**macOS:**
```bash
brew install ktx-software
```

**Linux:**
```bash
# Ubuntu/Debian
sudo apt install ktx-tools

# Or download from releases
```

## Workflow

```
public/textures/*.png     ← Source files (edit these, committed to git)
        ↓
   npm run build:textures
        ↓
public/textures-ktx2/*.ktx2  ← Compressed (gitignored, for production)
```

### Development vs Production

| Mode | Textures Used | Why |
|------|--------------|-----|
| Development (`npm run dev`) | PNG/JPG | Fast iteration, no conversion needed |
| Production (`npm run build:prod`) | KTX2 | Smaller, GPU-compressed for mobile |

## Compression Modes

The script automatically chooses the best compression:

| Mode | Used For | Quality | File Size |
|------|----------|---------|-----------|
| **ETC1S** | Color textures (albedo, sprites) | Medium | Smallest |
| **UASTC** | Normal maps, metallic/roughness | High | Larger |

### Auto-Detection

Files with these patterns use UASTC (high quality):
- `*_normal*`, `*_norm*`, `*_n.*`
- `*_metallic*`, `*_roughness*`, `*_mr.*`
- `*_ao.*`

All other textures use ETC1S (smaller files).

## Directory Structure

```
public/
├── textures/           ← Source PNGs (committed to git)
│   ├── base/
│   │   ├── wall.png
│   │   └── floor.png
│   └── sprites/
│       └── character.png
│
└── textures-ktx2/      ← Generated KTX2 (gitignored)
    ├── base/
    │   ├── wall.ktx2
    │   └── floor.ktx2
    └── sprites/
        └── character.ktx2
```

## Runtime Behavior

The `TextureManager` automatically:
1. **Production**: Tries KTX2 first, falls back to PNG if not found
2. **Development**: Uses PNG directly (no KTX2 lookup)

No code changes needed - just run `npm run build:prod` for production builds.

## Troubleshooting

### "toktx not found"

Make sure KTX-Software is installed and either:
- Added to your system PATH
- Set `KTX_TOOLS_PATH` environment variable to the bin folder

### Textures look wrong

Some textures may need different compression settings. Edit `scripts/convert-ktx2.js`:
- Add patterns to `uastcPatterns` for high-quality compression
- Adjust quality levels in the `compressionArgs`

### KTX2 not loading in browser

Ensure your browser supports the required texture formats. Most modern browsers support:
- Desktop: BC1-BC7 (DXT)
- Mobile: ASTC, ETC2

BabylonJS automatically transcodes KTX2 to the best format for the device.

## Manual Conversion

For single files:

```bash
# ETC1S (color textures)
toktx --t2 --encode etc1s --clevel 4 --qlevel 192 --genmipmap output.ktx2 input.png

# UASTC (normal maps)
toktx --t2 --encode uastc --uastc_quality 2 --zcmp 19 --genmipmap output.ktx2 input.png
```

## Benefits

| Metric | PNG | KTX2 | Improvement |
|--------|-----|------|-------------|
| VRAM Usage | 100% | ~25% | **75% less** |
| Load Time | Baseline | Faster | GPU-ready |
| Mobile Battery | Higher | Lower | Less GPU work |
