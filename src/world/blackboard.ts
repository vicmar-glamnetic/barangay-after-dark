import * as THREE from 'three';
import type { Physics } from '../core/physics';
import { FONT } from './textures';
import { L as tr, getLang } from '../core/i18n';

/** Everything the board shows (filled by the game manager). */
export interface BoardData {
  date: string;
  rank: string;
  tropa: number;
  barya: number;
  streak: number;
  daily: { name: string; target: number; reward: number; done: boolean };
  quests: { text: string; prog: number; goal: number; done: boolean }[];
  event: string | null;
  /** This week's top 3 for the daily game (null = offline / not loaded yet). */
  top: { game: string; rows: { name: string; score: number }[] | null };
  badges: { got: number; total: number };
}

const W = 1024, H = 640;
/** Board face size in meters. */
const BW = 3.0, BH = 1.875;

/**
 * Big chalkboard in the plaza showing the Libro ng Barangay: today's Hamon,
 * the 3 Gawain with progress, the running night event and this week's top 3.
 * It is a canvas texture redrawn only when the data changes. Walk up to it
 * and press interact to open the full Libro.
 */
export class Blackboard {
  readonly pos: THREE.Vector3;
  /** Where the player stands to use it (in front of the board). */
  readonly front: THREE.Vector3;
  private canvas = document.createElement('canvas');
  private tex: THREE.CanvasTexture;
  private last = '';
  private smudges: [number, number, number, number][] = [];

  constructor(scene: THREE.Scene, phys: Physics, x: number, z: number, rotY: number) {
    this.canvas.width = W;
    this.canvas.height = H;
    this.tex = new THREE.CanvasTexture(this.canvas);
    this.tex.colorSpace = THREE.SRGBColorSpace;
    this.tex.anisotropy = 4;
    for (let i = 0; i < 40; i++) this.smudges.push([Math.random() * W, Math.random() * H, 30 + Math.random() * 120, Math.random() * 0.05]);

    const root = new THREE.Group();
    root.position.set(x, 0, z);
    root.rotation.y = rotY;
    const wood = new THREE.MeshLambertMaterial({ color: 0x6b4226 });
    const dark = new THREE.MeshLambertMaterial({ color: 0x3e2716 });
    const bottom = 0.85;
    // face (unlit so the chalk stays readable at night)
    const face = new THREE.Mesh(new THREE.PlaneGeometry(BW, BH), new THREE.MeshBasicMaterial({ map: this.tex, color: 0xeeeeee }));
    face.position.set(0, bottom + BH / 2, 0.06);
    root.add(face);
    // back panel, frame, chalk tray, legs
    const back = new THREE.Mesh(new THREE.BoxGeometry(BW + 0.1, BH + 0.1, 0.08), dark);
    back.position.set(0, bottom + BH / 2, 0);
    root.add(back);
    const bar = (w: number, h: number, px: number, py: number) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.14), wood);
      m.position.set(px, py, 0.04);
      root.add(m);
    };
    bar(BW + 0.3, 0.12, 0, bottom + BH + 0.06);
    bar(BW + 0.3, 0.12, 0, bottom - 0.06);
    bar(0.12, BH + 0.24, -BW / 2 - 0.09, bottom + BH / 2);
    bar(0.12, BH + 0.24, BW / 2 + 0.09, bottom + BH / 2);
    const tray = new THREE.Mesh(new THREE.BoxGeometry(BW * 0.8, 0.04, 0.16), wood);
    tray.position.set(0, bottom - 0.1, 0.14);
    root.add(tray);
    for (const [cx, col] of [[-0.6, 0xffffff], [-0.45, 0xffd166], [-0.32, 0x8ecae6]] as const) {
      const chalk = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.09, 6).rotateZ(Math.PI / 2), new THREE.MeshBasicMaterial({ color: col }));
      chalk.position.set(cx, bottom - 0.065, 0.16);
      root.add(chalk);
    }
    for (const sx of [-1, 1]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.1, bottom + BH + 0.2, 0.1), wood);
      leg.position.set(sx * (BW / 2 + 0.09), (bottom + BH + 0.2) / 2, -0.06);
      root.add(leg);
      const foot = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.08, 0.7), dark);
      foot.position.set(sx * (BW / 2 + 0.09), 0.04, -0.06);
      root.add(foot);
    }
    // little lamp on top so it reads as "lit" from afar
    const hood = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.08, 0.25), dark);
    hood.position.set(0, bottom + BH + 0.32, 0.2);
    const bulb = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.03, 0.18), new THREE.MeshBasicMaterial({ color: 0xffe2a8 }));
    bulb.position.set(0, bottom + BH + 0.27, 0.2);
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.2, 0.04), dark);
    arm.position.set(0, bottom + BH + 0.2, 0.06);
    root.add(hood, bulb, arm);
    scene.add(root);

    // collider: a thin box the size of the board
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rotY);
    phys.addBox(x, (bottom + BH + 0.2) / 2, z, BW / 2 + 0.2, (bottom + BH + 0.2) / 2, 0.12, q);

    this.pos = new THREE.Vector3(x, 0, z);
    this.front = new THREE.Vector3(Math.sin(rotY) * 1.6 + x, 0, Math.cos(rotY) * 1.6 + z);
  }

  /** Redraw if anything changed. Cheap to call often. */
  draw(d: BoardData): void {
    const key = getLang() + JSON.stringify(d);
    if (key === this.last) return;
    this.last = key;
    const g = this.canvas.getContext('2d')!;
    // slate
    g.fillStyle = '#1f3a2c';
    g.fillRect(0, 0, W, H);
    for (const [x, y, r, a] of this.smudges) {
      g.fillStyle = `rgba(255,255,255,${a})`;
      g.beginPath();
      g.ellipse(x, y, r, r * 0.4, 0.3, 0, Math.PI * 2);
      g.fill();
    }
    const chalk = (text: string, x: number, y: number, size: number, color = '#f4f1e6', align: CanvasTextAlign = 'left', maxW?: number) => {
      g.font = `800 ${size}px ${FONT}`;
      g.textAlign = align;
      g.textBaseline = 'alphabetic';
      g.fillStyle = color;
      g.globalAlpha = 0.92;
      g.fillText(text, x, y, maxW);
      g.globalAlpha = 0.25; // a faint double stroke reads like chalk
      g.fillText(text, x + 1.5, y + 1, maxW);
      g.globalAlpha = 1;
    };
    const line = (x0: number, y0: number, x1: number, y1: number, color = 'rgba(244,241,230,0.6)') => {
      g.strokeStyle = color;
      g.lineWidth = 3;
      g.beginPath();
      g.moveTo(x0, y0);
      g.lineTo(x1, y1);
      g.stroke();
    };
    const box = (x: number, y: number, done: boolean) => {
      g.strokeStyle = '#f4f1e6';
      g.lineWidth = 3;
      g.strokeRect(x, y - 24, 26, 26);
      if (done) chalk('✓', x + 2, y - 1, 34, '#8be8b9');
    };

    // header
    chalk(tr('LIBRO NG BARANGAY', 'BARANGAY BOOK'), W / 2, 62, 50, '#ffd166', 'center');
    chalk(d.date, W / 2, 96, 24, 'rgba(244,241,230,0.75)', 'center');
    line(60, 112, W - 60, 112);

    // left column: hamon + gawain
    const L = 56;
    chalk(tr('Hamon ng Araw', 'Daily Challenge'), L, 160, 32, '#8ecae6');
    if (d.daily.done) chalk(tr(`${d.daily.name}: TAPOS NA! ✓`, `${d.daily.name}: DONE! ✓`), L, 200, 30, '#8be8b9', 'left', 520);
    else chalk(tr(`${d.daily.name}: ${d.daily.target}+ puntos  (+${d.daily.reward} Tropa)`, `${d.daily.name}: score ${d.daily.target}+  (+${d.daily.reward} Tropa)`), L, 200, 28, '#f4f1e6', 'left', 540);
    chalk(d.streak > 0 ? tr(`Streak: ${d.streak} araw`, `Streak: ${d.streak} days`) : tr('Simulan ang streak mo!', 'Start your streak today!'), L, 234, 24, 'rgba(244,241,230,0.75)');

    chalk(tr('Gawain ngayon', "Today's quests"), L, 290, 32, '#8ecae6');
    d.quests.forEach((q, i) => {
      const y = 334 + i * 62;
      box(L, y, q.done);
      chalk(q.text, L + 40, y, 25, q.done ? 'rgba(244,241,230,0.55)' : '#f4f1e6', 'left', 470);
      // progress dashes
      const n = Math.min(q.goal, 10);
      const filled = q.done ? n : Math.floor((Math.min(q.prog, q.goal) / q.goal) * n);
      for (let k = 0; k < n; k++) {
        g.fillStyle = k < filled ? '#ffd166' : 'rgba(244,241,230,0.25)';
        g.fillRect(L + 40 + k * 26, y + 12, 18, 6);
      }
      if (q.done) line(L + 40, y - 8, L + 40 + Math.min(470, g.measureText(q.text).width), y - 8, 'rgba(139,232,185,0.8)');
    });

    // divider
    line(W * 0.6, 135, W * 0.6, H - 70, 'rgba(244,241,230,0.35)');

    // right column: event + top 3 + you
    const R = W * 0.6 + 34;
    chalk(tr('Ngayong gabi', 'Tonight'), R, 160, 30, '#8ecae6');
    chalk(d.event ?? tr('Walang event. Abangan!', 'No event yet. Stay tuned!'), R, 198, d.event ? 26 : 24, d.event ? '#ffd166' : 'rgba(244,241,230,0.7)', 'left', 360);

    chalk(`Top ${d.top.game}`, R, 258, 30, '#8ecae6', 'left', 360);
    chalk(tr('ngayong linggo', 'this week'), R, 286, 22, 'rgba(244,241,230,0.7)');
    const rows = d.top.rows;
    if (!rows) chalk('(offline)', R, 330, 24, 'rgba(244,241,230,0.6)');
    else if (!rows.length) chalk(tr('Wala pa. Ikaw na!', 'Nobody yet. Be first!'), R, 330, 26, '#f4f1e6');
    else
      rows.slice(0, 3).forEach((r, i) => {
        const y = 330 + i * 40;
        chalk(`${i + 1}.`, R, y, 26, i === 0 ? '#ffd166' : '#f4f1e6');
        chalk(r.name, R + 38, y, 26, '#f4f1e6', 'left', 230);
        chalk(String(r.score), W - 50, y, 26, '#f4f1e6', 'right');
      });

    line(R, 468, W - 50, 468, 'rgba(244,241,230,0.35)');
    chalk(d.rank, R, 508, 28, '#ffd166', 'left', 360);
    chalk(`${d.tropa} Tropa  ·  ${d.barya} Barya`, R, 542, 24, '#f4f1e6', 'left', 360);
    chalk(`Badges: ${d.badges.got}/${d.badges.total}`, R, 574, 24, '#f4f1e6');

    // footer
    chalk(tr('Lumapit at pindutin para buksan ang buong Libro', 'Walk up and press to open the full book'), W / 2, H - 22, 22, 'rgba(244,241,230,0.6)', 'center');
    this.tex.needsUpdate = true;
  }
}
