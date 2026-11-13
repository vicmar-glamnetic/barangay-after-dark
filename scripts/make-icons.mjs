// Generates the PWA icons (PNG) with no dependencies: pixels are drawn with
// simple signed-distance shapes and encoded with node:zlib.
// Usage: node scripts/make-icons.mjs
import { writeFileSync, mkdirSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const OUT = new URL('../public/icons/', import.meta.url);
mkdirSync(OUT, { recursive: true });

function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(size, rgba) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

/** Scene in unit space (0..1). Returns [r,g,b,a] 0..255. `pad` shrinks art for maskable safe zone. */
function shade(u, v, pad, rounded) {
  // rounded-square mask
  if (rounded) {
    const r = 0.22, dx = Math.max(Math.abs(u - 0.5) - (0.5 - r), 0), dy = Math.max(Math.abs(v - 0.5) - (0.5 - r), 0);
    if (Math.hypot(dx, dy) > r) return [0, 0, 0, 0];
  }
  // art coordinates
  const x = (u - 0.5) / (1 - pad * 2) + 0.5, y = (v - 0.5) / (1 - pad * 2) + 0.5;
  let c = mix([18, 20, 62], [74, 40, 92], clamp(y * 1.1, 0, 1));
  c = mix(c, [200, 96, 63], clamp((y - 0.62) * 2.2, 0, 1) * 0.6);
  // stars
  const sx = Math.floor(x * 23), sy = Math.floor(y * 23);
  const h = Math.sin(sx * 127.1 + sy * 311.7) * 43758.5;
  if (y < 0.55 && h - Math.floor(h) > 0.93 && Math.hypot((x * 23) % 1 - 0.5, (y * 23) % 1 - 0.5) < 0.12) c = [255, 248, 220];
  // moon + glow
  const dm = Math.hypot(x - 0.7, y - 0.27);
  c = mix(c, [255, 230, 170], clamp(0.16 - dm, 0, 0.16) * 2.2);
  if (dm < 0.13) c = mix([255, 243, 209], [240, 220, 170], clamp((x - 0.62) * 3, 0, 1));
  // lamp glow bottom-left
  const dl = Math.hypot(x - 0.2, y - 0.5);
  c = mix(c, [255, 160, 74], clamp(0.25 - dl, 0, 0.25) * 2.4);
  // ground
  if (y > 0.83) c = [28, 22, 30];
  // house body
  const inBody = x > 0.3 && x < 0.74 && y > 0.58 && y < 0.84;
  // GI roof (triangle with corrugation)
  const roofY = 0.58 - (0.2 - Math.abs(x - 0.52)) * 0.85;
  const inRoof = x > 0.25 && x < 0.79 && y < 0.6 && y > roofY && Math.abs(x - 0.52) < 0.27;
  if (inRoof) c = Math.floor(x * 60) % 2 ? [150, 160, 168] : [120, 128, 136];
  if (inBody) c = [214, 196, 150];
  // windows: warm capiz glow + door
  const win = (x0, y0, w, hh) => x > x0 && x < x0 + w && y > y0 && y < y0 + hh;
  if (win(0.36, 0.63, 0.12, 0.1)) c = Math.floor(x * 80) % 3 === 0 || Math.floor(y * 80) % 3 === 0 ? [120, 70, 30] : [255, 200, 110];
  if (win(0.56, 0.66, 0.1, 0.18)) c = [92, 56, 32];
  // lamp post
  if (Math.abs(x - 0.2) < 0.012 && y > 0.5 && y < 0.84) c = [40, 40, 50];
  if (Math.hypot(x - 0.2, y - 0.5) < 0.025) c = [255, 220, 150];
  return [c[0], c[1], c[2], 255];
}

function render(size, { pad = 0, rounded = false } = {}) {
  const buf = Buffer.alloc(size * size * 4);
  const ss = 3;
  for (let py = 0; py < size; py++)
    for (let px = 0; px < size; px++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let j = 0; j < ss; j++)
        for (let i = 0; i < ss; i++) {
          const [cr, cg, cb, ca] = shade((px + (i + 0.5) / ss) / size, (py + (j + 0.5) / ss) / size, pad, rounded);
          r += cr * ca; g += cg * ca; b += cb * ca; a += ca;
        }
      const o = (py * size + px) * 4;
      buf[o] = a ? Math.round(r / a) : 0;
      buf[o + 1] = a ? Math.round(g / a) : 0;
      buf[o + 2] = a ? Math.round(b / a) : 0;
      buf[o + 3] = Math.round(a / (ss * ss));
    }
  return png(size, buf);
}

const files = {
  'icon-192.png': render(192, { rounded: true }),
  'icon-512.png': render(512, { rounded: true }),
  'maskable-512.png': render(512, { pad: 0.1 }),
  'apple-touch-icon.png': render(180),
};
for (const [name, data] of Object.entries(files)) writeFileSync(new URL(name, OUT), data);

writeFileSync(
  new URL('favicon.svg', OUT),
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#12143e"/><stop offset="1" stop-color="#4a285c"/></linearGradient></defs><rect width="64" height="64" rx="14" fill="url(#g)"/><circle cx="45" cy="17" r="8" fill="#fff3d1"/><path d="M16 37 L33 25 L50 37 Z" fill="#9aa3aa"/><rect x="19" y="37" width="28" height="17" fill="#d6c496"/><rect x="23" y="40" width="8" height="7" fill="#ffc86e"/><rect x="36" y="42" width="6" height="12" fill="#5c3820"/></svg>\n`,
);
console.log('icons written:', Object.keys(files).join(', '), '+ favicon.svg');
