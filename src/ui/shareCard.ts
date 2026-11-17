import { FONT } from '../world/textures';

export interface ShareInfo {
  game: string;
  score: number;
  label: string;
  stars: number;
  name: string;
  rank: string;
  /** One highlight line ("Bagong best score!"). */
  line: string;
  text: string;
  url: string;
  face: string | null;
}

/**
 * Draw a 1080 x 1080 result card and share it (Web Share with a file, e.g.
 * straight to Facebook / Messenger on phones) or download it as a PNG.
 */
export async function shareResultImage(s: ShareInfo): Promise<'shared' | 'saved' | 'failed'> {
  try {
    const blob = await drawCard(s);
    const file = new File([blob], 'hari-ng-kanto.png', { type: 'image/png' });
    const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
    if (nav.share && nav.canShare?.({ files: [file] })) {
      try {
        await nav.share({ files: [file], text: `${s.text} ${s.url}` });
        return 'shared';
      } catch (e) {
        if ((e as Error).name === 'AbortError') return 'failed';
      }
    }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'hari-ng-kanto.png';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    return 'saved';
  } catch {
    return 'failed';
  }
}

async function drawCard(s: ShareInfo): Promise<Blob> {
  const W = 1080;
  const c = document.createElement('canvas');
  c.width = c.height = W;
  const g = c.getContext('2d')!;
  // night sky
  const bg = g.createLinearGradient(0, 0, 0, W);
  bg.addColorStop(0, '#0b1230');
  bg.addColorStop(0.65, '#1a1f4f');
  bg.addColorStop(1, '#3a1d3f');
  g.fillStyle = bg;
  g.fillRect(0, 0, W, W);
  for (let i = 0; i < 90; i++) {
    g.fillStyle = `rgba(255,255,255,${0.2 + Math.random() * 0.6})`;
    g.fillRect(Math.random() * W, Math.random() * W * 0.55, 3, 3);
  }
  // moon
  g.fillStyle = '#fff3c4';
  g.shadowColor = 'rgba(255,230,160,0.8)';
  g.shadowBlur = 60;
  g.beginPath();
  g.arc(890, 170, 70, 0, Math.PI * 2);
  g.fill();
  g.shadowBlur = 0;
  // string lights
  const cols = ['#ff4d6d', '#ffd166', '#06d6a0', '#4cc9f0', '#f72585'];
  for (let i = 0; i < 22; i++) {
    const x = 40 + i * 48;
    const y = 60 + Math.sin((i / 21) * Math.PI) * 50;
    g.fillStyle = cols[i % cols.length];
    g.shadowColor = cols[i % cols.length];
    g.shadowBlur = 20;
    g.beginPath();
    g.arc(x, y, 9, 0, Math.PI * 2);
    g.fill();
  }
  g.shadowBlur = 0;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  // logo
  g.fillStyle = '#ffd166';
  g.font = `800 64px ${FONT}`;
  g.fillText('♛ HARI NG KANTO', W / 2, 200);
  // game + score
  g.fillStyle = '#c9c3e6';
  g.font = `800 56px ${FONT}`;
  g.fillText(s.game, W / 2, 320);
  g.fillStyle = '#ffffff';
  g.font = `800 260px ${FONT}`;
  g.shadowColor = 'rgba(0,0,0,0.4)';
  g.shadowOffsetY = 10;
  g.fillText(String(s.score), W / 2, 520);
  g.shadowOffsetY = 0;
  g.shadowColor = 'transparent';
  g.fillStyle = '#c9c3e6';
  g.font = `700 44px ${FONT}`;
  g.fillText(s.label, W / 2, 680);
  // stars
  g.font = `800 110px ${FONT}`;
  for (let i = 0; i < 3; i++) {
    g.fillStyle = i < s.stars ? '#ffd166' : 'rgba(255,255,255,0.18)';
    g.fillText('★', W / 2 + (i - 1) * 130, 790);
  }
  if (s.line) {
    g.fillStyle = '#06d6a0';
    g.font = `800 44px ${FONT}`;
    g.fillText(s.line, W / 2, 890);
  }
  // player
  const label = s.rank ? `${s.name}  ·  ${s.rank}` : s.name;
  g.font = `800 42px ${FONT}`;
  const tw = g.measureText(label).width;
  let x = W / 2 - tw / 2;
  if (s.face) {
    try {
      const img = await loadImage(s.face);
      x += 38;
      g.save();
      g.beginPath();
      g.arc(x - 70, 975, 40, 0, Math.PI * 2);
      g.clip();
      g.drawImage(img, x - 110, 935, 80, 80);
      g.restore();
    } catch {
      /* no face */
    }
  }
  g.textAlign = 'left';
  g.fillStyle = '#ffffff';
  g.fillText(label, x, 978);
  g.textAlign = 'center';
  g.fillStyle = 'rgba(255,255,255,0.55)';
  g.font = `700 30px ${FONT}`;
  g.fillText(s.url.replace(/^https?:\/\//, '').replace(/\/$/, ''), W / 2, 1045);
  return new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('no blob'))), 'image/png'));
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((res, rej) => {
    const i = new Image();
    i.onload = () => res(i);
    i.onerror = rej;
    i.src = src;
  });
}
