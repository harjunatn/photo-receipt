/**
 * Draws a photo-like scene of two people against a soft sky. It stands in for a
 * real photo in the demo camera, the print-quality preview and the test page:
 * skin gradients and a smooth background are exactly what is hard to print well.
 */
export function drawDemoScene(ctx: CanvasRenderingContext2D, width: number, height: number, time: number): void {
  const unit = Math.min(width, height) / 960;

  const sky = ctx.createLinearGradient(0, 0, width, height);
  sky.addColorStop(0, '#f6d7a8');
  sky.addColorStop(0.5, '#c9a0c4');
  sky.addColorStop(1, '#4b6aa8');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, width, height);

  for (let i = 0; i < 6; i++) {
    ctx.fillStyle = `rgba(255,255,255,${0.1 + 0.05 * i})`;
    ctx.beginPath();
    ctx.arc(
      width * (0.12 + i * 0.16) + Math.sin(time + i) * 30 * unit,
      height * 0.16 + Math.cos(time * 0.7 + i * 2) * 50 * unit,
      (46 + i * 7) * unit,
      0,
      Math.PI * 2,
    );
    ctx.fill();
  }

  const person = (cx: number, cy: number, size: number, skin: string, shirt: string) => {
    const body = ctx.createLinearGradient(0, cy + size * 0.6, 0, height);
    body.addColorStop(0, shirt);
    body.addColorStop(1, '#1d2433');
    ctx.fillStyle = body;
    ctx.beginPath();
    ctx.ellipse(cx, cy + size * 2.1, size * 1.35, size * 1.5, 0, 0, Math.PI * 2);
    ctx.fill();

    const face = ctx.createRadialGradient(cx - size * 0.25, cy - size * 0.3, size * 0.1, cx, cy, size);
    face.addColorStop(0, '#fff1e0');
    face.addColorStop(0.6, skin);
    face.addColorStop(1, '#6d4630');
    ctx.fillStyle = face;
    ctx.beginPath();
    ctx.arc(cx, cy, size, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#2a1c14';
    ctx.beginPath();
    ctx.arc(cx, cy - size * 0.35, size * 1.02, Math.PI * 1.05, Math.PI * 1.95);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(cx - size * 0.35, cy - size * 0.05, size * 0.09, 0, Math.PI * 2);
    ctx.arc(cx + size * 0.35, cy - size * 0.05, size * 0.09, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = '#7a2b22';
    ctx.lineWidth = size * 0.07;
    ctx.beginPath();
    ctx.arc(cx, cy + size * 0.2, size * 0.42, Math.PI * 0.15, Math.PI * 0.85);
    ctx.stroke();
  };

  person(
    width * 0.33 + Math.sin(time * 1.3) * 16 * unit,
    height * 0.45 + Math.cos(time * 1.1) * 10 * unit,
    150 * unit,
    '#e0ac84',
    '#d9543d',
  );
  person(
    width * 0.67 + Math.sin(time * 0.9 + 2) * 16 * unit,
    height * 0.49 + Math.cos(time * 1.4 + 1) * 10 * unit,
    135 * unit,
    '#c98d68',
    '#2f8f83',
  );
}

/** A still of the demo scene at the given aspect ratio, used wherever a sample photo is needed. */
export function samplePhoto(aspect: number, time = 0, longSide = 960): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(aspect >= 1 ? longSide : longSide * aspect);
  canvas.height = Math.round(aspect >= 1 ? longSide / aspect : longSide);
  drawDemoScene(canvas.getContext('2d')!, canvas.width, canvas.height, time);
  return canvas;
}
