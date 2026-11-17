import * as THREE from 'three';

/**
 * All textures are drawn at runtime on canvases: no image files to load.
 * Brand-free on purpose: signs use generic text only.
 */
export const FONT = '"Baloo 2", "Rubik", system-ui, -apple-system, "Segoe UI", sans-serif';

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')!];
}

function tex(c: HTMLCanvasElement, repeat = false): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 2;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.needsUpdate = true;
  return t;
}

function roundRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

/** Capiz window: wooden frame holding a grid of pearly translucent squares. */
export function capizTexture(): THREE.CanvasTexture {
  const [c, g] = canvas(128, 128);
  g.fillStyle = '#5a3a22';
  g.fillRect(0, 0, 128, 128);
  const n = 5;
  const pad = 8;
  const cell = (128 - pad * 2) / n;
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) {
      const v = 225 + Math.random() * 25;
      g.fillStyle = `rgb(${v},${v - 8},${v - 30})`;
      g.fillRect(pad + x * cell + 2, pad + y * cell + 2, cell - 4, cell - 4);
    }
  g.strokeStyle = '#3e2615';
  g.lineWidth = 4;
  g.beginPath();
  g.moveTo(64, 0);
  g.lineTo(64, 128);
  g.stroke();
  return tex(c);
}

/** Sari-sari store window: lit shelves, hanging sachets, and the iron grill. */
export function storeWindowTexture(): THREE.CanvasTexture {
  const [c, g] = canvas(512, 256);
  const grad = g.createLinearGradient(0, 0, 0, 256);
  grad.addColorStop(0, '#ffdca0');
  grad.addColorStop(1, '#b8743a');
  g.fillStyle = grad;
  g.fillRect(0, 0, 512, 256);
  // shelves with products
  const colors = ['#e63946', '#f1c40f', '#2a9d8f', '#e76f51', '#457b9d', '#ffffff', '#8e44ad', '#f4a261'];
  for (let s = 0; s < 3; s++) {
    const y = 90 + s * 55;
    g.fillStyle = '#6b4226';
    g.fillRect(0, y + 40, 512, 8);
    for (let x = 6; x < 506; ) {
      const w = 14 + Math.random() * 22;
      const h = 20 + Math.random() * 20;
      g.fillStyle = colors[Math.floor(Math.random() * colors.length)];
      g.fillRect(x, y + 40 - h, w - 3, h);
      x += w;
    }
  }
  // hanging sachet strips across the top
  for (let x = 10; x < 500; x += 22) {
    const col = colors[Math.floor(Math.random() * colors.length)];
    for (let k = 0; k < 4; k++) {
      g.fillStyle = col;
      g.fillRect(x, 6 + k * 16, 16, 13);
      g.fillStyle = 'rgba(255,255,255,0.35)';
      g.fillRect(x + 2, 8 + k * 16, 5, 9);
    }
  }
  // grill
  g.strokeStyle = '#2a2f36';
  g.lineWidth = 5;
  for (let x = 0; x <= 512; x += 32) {
    g.beginPath();
    g.moveTo(x, 0);
    g.lineTo(x, 256);
    g.stroke();
  }
  g.lineWidth = 7;
  for (const y of [4, 128, 252]) {
    g.beginPath();
    g.moveTo(0, y);
    g.lineTo(512, y);
    g.stroke();
  }
  // small serving opening
  g.fillStyle = 'rgba(40,20,10,0.4)';
  g.fillRect(200, 150, 112, 70);
  return tex(c);
}

/** Generic painted sign. */
export function signTexture(lines: { text: string; size: number; color: string }[], bg: string, w = 512, h = 128, opts: { border?: string; badge?: string } = {}): THREE.CanvasTexture {
  const [c, g] = canvas(w, h);
  g.fillStyle = bg;
  g.fillRect(0, 0, w, h);
  if (opts.border) {
    g.strokeStyle = opts.border;
    g.lineWidth = 8;
    g.strokeRect(6, 6, w - 12, h - 12);
  }
  let left = 0;
  if (opts.badge) {
    // generic round "COLA" badge on the left, like the sponsored store signs
    const r = h * 0.38;
    g.fillStyle = '#ffffff';
    g.beginPath();
    g.arc(h * 0.55, h / 2, r, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = bg;
    g.font = `800 ${Math.round(r * 0.62)}px ${FONT}`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(opts.badge, h * 0.55, h / 2 + 2);
    left = h * 1.05;
  }
  const total = lines.reduce((s, l) => s + l.size * 1.05, 0);
  let y = (h - total) / 2;
  for (const l of lines) {
    g.fillStyle = l.color;
    g.font = `800 ${l.size}px ${FONT}`;
    g.textAlign = 'center';
    g.textBaseline = 'top';
    g.fillText(l.text, left + (w - left) / 2, y + l.size * 0.05, w - left - 16);
    y += l.size * 1.05;
  }
  return tex(c);
}

/** Basketball court with chalked Patintero grid. 16 x 10 m mapped to 1024 x 640. */
export function courtTexture(): THREE.CanvasTexture {
  const W = 1024, H = 640;
  const [c, g] = canvas(W, H);
  const s = W / 16;
  g.fillStyle = '#4f6b5c';
  g.fillRect(0, 0, W, H);
  // wear and stains
  for (let i = 0; i < 260; i++) {
    g.fillStyle = `rgba(${Math.random() < 0.5 ? '0,0,0' : '255,255,255'},${Math.random() * 0.05})`;
    g.beginPath();
    g.arc(Math.random() * W, Math.random() * H, 10 + Math.random() * 60, 0, Math.PI * 2);
    g.fill();
  }
  g.fillStyle = '#7a4b33';
  g.fillRect(s * 0.6, s * 0.6, W - s * 1.2, H - s * 1.2);
  g.fillStyle = '#4f6b5c';
  g.fillRect(s * 0.75, s * 0.75, W - s * 1.5, H - s * 1.5);
  g.strokeStyle = '#f2efe6';
  g.lineWidth = 5;
  g.strokeRect(s * 0.75, s * 0.75, W - s * 1.5, H - s * 1.5);
  g.beginPath();
  g.moveTo(W / 2, s * 0.75);
  g.lineTo(W / 2, H - s * 0.75);
  g.stroke();
  g.beginPath();
  g.arc(W / 2, H / 2, s * 1.4, 0, Math.PI * 2);
  g.stroke();
  // keys and arcs on both ends
  for (const side of [0, 1]) {
    const x0 = side ? W - s * 0.75 : s * 0.75;
    const dir = side ? -1 : 1;
    g.fillStyle = 'rgba(160,60,40,0.55)';
    g.fillRect(Math.min(x0, x0 + dir * s * 4.2), H / 2 - s * 1.6, s * 4.2, s * 3.2);
    g.strokeRect(Math.min(x0, x0 + dir * s * 4.2), H / 2 - s * 1.6, s * 4.2, s * 3.2);
    g.beginPath();
    g.arc(x0 + dir * s * 4.2, H / 2, s * 1.6, side ? Math.PI / 2 : -Math.PI / 2, side ? -Math.PI / 2 : Math.PI / 2, side === 1);
    g.stroke();
    g.beginPath();
    g.arc(x0 + dir * s * 0.9, H / 2, s * 4.6, side ? Math.PI / 2 + 0.25 : -Math.PI / 2 - 0.25, side ? -Math.PI / 2 - 0.25 : Math.PI / 2 + 0.25, side === 1);
    g.stroke();
  }
  // barangay name painted mid-court
  g.fillStyle = 'rgba(242,239,230,0.75)';
  g.font = `800 ${Math.round(s * 0.9)}px ${FONT}`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText('BRGY. TIBAY', W / 2, H / 2);
  // chalk patintero grid (rough, hand drawn)
  g.strokeStyle = 'rgba(255,250,215,0.8)';
  g.lineWidth = 4;
  const chalk = (x1: number, y1: number, x2: number, y2: number) => {
    g.beginPath();
    const n = 14;
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const x = x1 + (x2 - x1) * t + (Math.random() - 0.5) * 3;
      const y = y1 + (y2 - y1) * t + (Math.random() - 0.5) * 3;
      if (i) g.lineTo(x, y);
      else g.moveTo(x, y);
    }
    g.stroke();
  };
  // matches GRID in games/patintero.ts (12 x 7.6 m centered on the 16 x 10 m court)
  const gx0 = s * 2, gx1 = W - s * 2, gy0 = s * 1.2, gy1 = H - s * 1.2;
  chalk(gx0, gy0, gx1, gy0);
  chalk(gx0, gy1, gx1, gy1);
  chalk(gx0, (gy0 + gy1) / 2, gx1, (gy0 + gy1) / 2);
  for (let i = 0; i <= 4; i++) {
    const x = gx0 + ((gx1 - gx0) * i) / 4;
    chalk(x, gy0, x, gy1);
  }
  return tex(c);
}

/** Soft radial glow for lamp halos, light pools and blob shadows. */
export function radialTexture(inner = 'rgba(255,255,255,1)', outer = 'rgba(255,255,255,0)', size = 128, stops?: [number, string][]): THREE.CanvasTexture {
  const [c, g] = canvas(size, size);
  const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, inner);
  if (stops) for (const [o, col] of stops) grad.addColorStop(o, col);
  grad.addColorStop(1, outer);
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  const t = tex(c);
  t.colorSpace = THREE.NoColorSpace;
  return t;
}

/** Can label for Tumbang Preso. Generic "GATAS" (milk). */
export function canTexture(): THREE.CanvasTexture {
  const [c, g] = canvas(256, 128);
  g.fillStyle = '#c9ccd2';
  g.fillRect(0, 0, 256, 128);
  g.fillStyle = '#1f6fb2';
  g.fillRect(0, 22, 256, 84);
  g.fillStyle = '#ffffff';
  g.font = `800 44px ${FONT}`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText('GATAS', 128, 66);
  g.fillStyle = '#e63946';
  g.fillRect(0, 96, 256, 10);
  g.fillStyle = '#9aa0a8';
  for (let y = 4; y < 20; y += 6) g.fillRect(0, y, 256, 2);
  for (let y = 110; y < 128; y += 6) g.fillRect(0, y, 256, 2);
  return tex(c);
}

/**
 * Floating NPC label: "Tumbang Preso - Laro tayo!" style.
 * Returns the canvas texture plus its aspect so the sprite can be scaled.
 */
/** Label canvas size. Tall enough for a title plus a sub line that wraps to two pills. */
export const LABEL_W = 512, LABEL_H = 212;
/** Where the title's middle sits (px from the top): the sprite anchors there. */
export const LABEL_ANCHOR_Y = 80;

export function labelTexture(title: string, sub: string, accent: string, existing?: THREE.CanvasTexture): { tex: THREE.CanvasTexture; aspect: number } {
  const W = LABEL_W, H = LABEL_H;
  const c = (existing?.image as HTMLCanvasElement | undefined) ?? canvas(W, H)[0];
  const g = c.getContext('2d')!;
  g.clearRect(0, 0, W, H);
  g.font = `800 52px ${FONT}`;
  const tw = Math.min(W - 40, Math.max(g.measureText(title).width, 220) + 60);
  const x = (W - tw) / 2;
  g.fillStyle = 'rgba(12,16,38,0.78)';
  roundRect(g, x, 8, tw, 96, 26);
  g.fill();
  g.strokeStyle = accent;
  g.lineWidth = 4;
  roundRect(g, x, 8, tw, 96, 26);
  g.stroke();
  g.fillStyle = '#ffffff';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(title, W / 2, 58, tw - 30);

  // status pill(s) under the title: shrink to fit, then wrap at the "·" so nothing is cut off
  const maxText = W - 48;
  const fit = (text: string): number => {
    let size = 34;
    g.font = `800 ${size}px ${FONT}`;
    while (size > 24 && g.measureText(text).width > maxText) {
      size -= 2;
      g.font = `800 ${size}px ${FONT}`;
    }
    return size;
  };
  let lines = [sub];
  if (sub && fit(sub) <= 24 && g.measureText(sub).width > maxText) {
    const parts = sub.split(/\s+·\s+/);
    if (parts.length > 1) {
      // balance the two lines by length
      let best = 1, bestDiff = Infinity;
      for (let i = 1; i < parts.length; i++) {
        const a = parts.slice(0, i).join('  ·  ').length, b = parts.slice(i).join('  ·  ').length;
        if (Math.abs(a - b) < bestDiff) {
          bestDiff = Math.abs(a - b);
          best = i;
        }
      }
      lines = [parts.slice(0, best).join('  ·  '), parts.slice(best).join('  ·  ')];
    }
  }
  lines.forEach((line, i) => {
    if (!line) return;
    const size = fit(line);
    const sw = Math.min(W - 8, g.measureText(line).width + 40);
    const y = 108 + i * 50;
    g.fillStyle = accent;
    roundRect(g, (W - sw) / 2, y, sw, 46, 23);
    g.fill();
    g.fillStyle = '#1a1230';
    g.font = `800 ${size}px ${FONT}`;
    g.fillText(line, W / 2, y + 24, maxText);
  });
  if (existing) {
    existing.needsUpdate = true;
    return { tex: existing, aspect: W / H };
  }
  return { tex: tex(c), aspect: W / H };
}
