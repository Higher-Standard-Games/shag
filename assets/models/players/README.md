# Player Models

This directory contains player character models.

## Directory Structure

Each player model should have its own subdirectory:

```
assets/models/players/
├── README.md (this file)
├── default/
│   ├── model.fbx       # Full character model (Mixamo-rigged)
│   ├── arms.fbx        # First-person arms (optional)
│   └── player.json     # Model metadata
└── {character_name}/
    ├── model.fbx
    ├── arms.fbx
    └── player.json
```

## Model Requirements

1. **Rigging**: Must be rigged through Mixamo auto-rigger
2. **Pose**: T-pose or A-pose
3. **Scale**: 1 unit = 1 meter (approximately 1.8m tall for humanoid)
4. **Format**: FBX Binary or GLB

## player.json Format

```json
{
  "name": "Default Soldier",
  "scale": 1.0,
  "heightOffset": 0,
  "boundingBox": {
    "width": 0.6,
    "height": 1.8,
    "depth": 0.6
  }
}
```

## Creating a New Player Model

1. **Generate/Create Model**
   - Use Layer.ai, Meshy, or 3D software
   - Export as FBX or OBJ (T-posed)

2. **Auto-Rig with Mixamo**
   - Upload to [Mixamo](https://www.mixamo.com/)
   - Place rig markers (chin, wrists, elbows, knees, groin)
   - Download rigged model with skin

3. **Add to Assets**
   - Create subdirectory: `assets/models/players/{name}/`
   - Place rigged model as `model.fbx`
   - Create `player.json` with metadata

4. **Test in Engine**
   - Model will automatically use shared animations
   - Verify bone mapping works correctly
