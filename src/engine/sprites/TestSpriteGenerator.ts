/**
 * Generates simple test sprite sheets programmatically.
 * Useful for testing before real art assets are available.
 */
export class TestSpriteGenerator {
  /**
   * Generate a simple colored character sprite sheet as a data URL.
   * Creates an 8-direction, 4-frame walk cycle.
   * 
   * @param frameWidth - Width of each frame
   * @param frameHeight - Height of each frame
   * @param bodyColor - Main body color (CSS color string)
   * @param accentColor - Accent color for details
   * @returns Data URL of the generated sprite sheet
   */
  public static generateCharacterSheet(
    frameWidth = 32,
    frameHeight = 32,
    bodyColor = "#4488ff",
    accentColor = "#ffcc00"
  ): string {
    const directions = 8;
    const framesPerDirection = 4;
    const width = frameWidth * framesPerDirection;
    const height = frameHeight * directions;

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d")!;

    // Clear with transparency
    ctx.clearRect(0, 0, width, height);

    for (let dir = 0; dir < directions; dir++) {
      for (let frame = 0; frame < framesPerDirection; frame++) {
        const x = frame * frameWidth;
        const y = dir * frameHeight;

        // Draw a simple character
        this.drawCharacter(ctx, x, y, frameWidth, frameHeight, bodyColor, accentColor, dir, frame);
      }
    }

    return canvas.toDataURL("image/png");
  }

  /**
   * Draw a simple pixel character
   */
  private static drawCharacter(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    width: number,
    height: number,
    bodyColor: string,
    accentColor: string,
    direction: number,
    frame: number
  ): void {
    const cx = x + width / 2;
    const cy = y + height / 2;

    // Animation offset for walk cycle
    const walkOffset = Math.sin((frame / 4) * Math.PI * 2) * 2;
    const legOffset = frame % 2 === 0 ? 2 : -2;

    ctx.save();

    // Body (oval)
    ctx.fillStyle = bodyColor;
    ctx.beginPath();
    ctx.ellipse(cx, cy + walkOffset, width * 0.25, height * 0.3, 0, 0, Math.PI * 2);
    ctx.fill();

    // Head
    ctx.beginPath();
    ctx.arc(cx, cy - height * 0.2 + walkOffset, width * 0.2, 0, Math.PI * 2);
    ctx.fill();

    // Direction indicator (shows which way character faces)
    ctx.fillStyle = accentColor;
    const angleMap = [
      Math.PI,        // S - facing down/camera
      Math.PI * 0.75, // SW
      Math.PI * 0.5,  // W
      Math.PI * 0.25, // NW
      0,              // N - facing up/away
      -Math.PI * 0.25,// NE
      -Math.PI * 0.5, // E
      -Math.PI * 0.75,// SE
    ];
    const angle = angleMap[direction];
    
    // Draw "eye" or indicator showing direction
    const eyeDistance = width * 0.1;
    const eyeX = cx + Math.sin(angle) * eyeDistance;
    const eyeY = cy - height * 0.2 + walkOffset - Math.cos(angle) * eyeDistance * 0.5;
    ctx.beginPath();
    ctx.arc(eyeX, eyeY, width * 0.06, 0, Math.PI * 2);
    ctx.fill();

    // Legs (simple lines showing walk)
    ctx.strokeStyle = bodyColor;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(cx - 4, cy + height * 0.15 + walkOffset);
    ctx.lineTo(cx - 4 + legOffset, cy + height * 0.35);
    ctx.moveTo(cx + 4, cy + height * 0.15 + walkOffset);
    ctx.lineTo(cx + 4 - legOffset, cy + height * 0.35);
    ctx.stroke();

    ctx.restore();
  }

  /**
   * Generate a simple static object sprite (like a plant or item)
   */
  public static generateObjectSheet(
    frameWidth = 32,
    frameHeight = 32,
    color = "#22aa22",
    frames = 1
  ): string {
    const canvas = document.createElement("canvas");
    canvas.width = frameWidth * frames;
    canvas.height = frameHeight;
    const ctx = canvas.getContext("2d")!;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    for (let frame = 0; frame < frames; frame++) {
      const x = frame * frameWidth;
      const cx = x + frameWidth / 2;
      const cy = frameHeight / 2;

      // Simple swaying animation
      const sway = Math.sin((frame / frames) * Math.PI * 2) * 3;

      // Draw a simple plant/object
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.ellipse(cx + sway, cy - 5, frameWidth * 0.3, frameHeight * 0.35, 0, 0, Math.PI * 2);
      ctx.fill();

      // Stem
      ctx.strokeStyle = "#886633";
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(cx, cy + frameHeight * 0.3);
      ctx.lineTo(cx + sway * 0.5, cy);
      ctx.stroke();
    }

    return canvas.toDataURL("image/png");
  }
}
