# Recipe: Export Render Settings

Save and restore render variable configuration.

## Console Commands

### Export Current Settings

```
r_export
```

Outputs all render variables as commands:

```
r_normalmap 1
r_lightmap 1.5
r_bloom 0.8
r_anisotropy 8
...
```

### List All Variables

```
r_list
```

### Reset to Defaults

```
r_reset
```

## Code

### Export Settings

```typescript
import { RenderVars } from '../../engine/rendering/RenderVars';

function exportSettings(): string {
  const renderVars = RenderVars.getInstance();
  const lines: string[] = [];
  
  for (const [name, value] of renderVars.getAll()) {
    lines.push(`${name} ${value}`);
  }
  
  return lines.join('\n');
}

// Save to clipboard
navigator.clipboard.writeText(exportSettings());
```

### Import Settings

```typescript
import { ConsoleCommandRegistry } from '../../engine/console/ConsoleCommandRegistry';

function importSettings(config: string) {
  const registry = ConsoleCommandRegistry.getInstance();
  
  const lines = config.split('\n').filter(l => l.trim());
  for (const line of lines) {
    registry.execute(line);
  }
}

// Usage
importSettings(`
r_normalmap 2
r_lightmap 1.5
r_bloom 0.5
`);
```

### Save to localStorage

```typescript
function savePreset(name: string) {
  const config = exportSettings();
  localStorage.setItem(`render_preset_${name}`, config);
}

function loadPreset(name: string) {
  const config = localStorage.getItem(`render_preset_${name}`);
  if (config) {
    importSettings(config);
  }
}
```

## Presets

Create common presets:

```typescript
const PRESETS = {
  performance: `
r_bloom 0
r_normalmap 0
r_anisotropy 1
`,
  quality: `
r_bloom 1.5
r_normalmap 2
r_anisotropy 16
`,
  debug: `
r_wireframe 1
r_lightmap 0
`
};

function applyPreset(name: keyof typeof PRESETS) {
  importSettings(PRESETS[name]);
}
```
