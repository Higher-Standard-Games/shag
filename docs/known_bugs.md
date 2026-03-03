# Known Bugs

## CRITICAL

### Walljump causes collision/rendering desync

- **Severity**: Critical
- **Reproducibility**: Every time
- **Date reported**: 2025-03-03
- **Steps to reproduce**: Perform a walljump in multiplayer
- **Behavior**: Player position drops further and further into the map after walljumping. Collisions still exist but no longer match the rendered position — the collision world and visual rendering go out of sync. Repeatable every time walljump is used.
- **Likely cause**: Client prediction of walljump movement diverges from server-authoritative position, and reconciliation/visual smoothing doesn't correct it properly. The offset accumulates with each walljump.
- **Files to investigate**: `V2NetworkClient.ts` (prediction + reconciliation), `FPSMovementProfile.ts` (walljump physics), `FPSController.ts` (visual smoothing / offset decay)
