# Recipe: Toggle Wireframe Mode

Enable wireframe for debugging geometry.

## Console Commands

```
r_wireframe 1    # Per-mesh wireframe
r_wireframe 0

r_showtris 1     # Entire scene wireframe
r_showtris 0
```

## Code

```typescript
import { RenderVars } from '../../engine/rendering/RenderVars';

const renderVars = RenderVars.getInstance();

// Toggle wireframe
function toggleWireframe() {
  const current = renderVars.get('r_wireframe');
  renderVars.set('r_wireframe', current >= 0.5 ? 0 : 1);
}

// Force scene wireframe
function toggleShowTris() {
  const current = renderVars.get('r_showtris');
  renderVars.set('r_showtris', current >= 0.5 ? 0 : 1);
}
```

## Keyboard Shortcut

```typescript
window.addEventListener('keydown', (e) => {
  if (e.key === 'F3') {
    toggleWireframe();
  }
});
```

## Note

Debug variables (`r_wireframe`, `r_showtris`) don't persist to localStorage - they reset on page reload.
