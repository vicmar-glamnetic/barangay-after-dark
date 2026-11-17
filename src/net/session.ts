import Peer, { type DataConnection } from 'peerjs';
import { isValidFace } from './face';

/*
 * Peer-to-peer lobby session (WebRTC via PeerJS).
 *
 * Topology: star. The player who creates the lobby is the HOST; everyone
 * else connects to the host only. The host:
 *   - owns the roster and starts games,
 *   - relays everyone's pose (position + yaw + anim) at POSE_HZ,
 *   - runs the authoritative game logic (see games/*), broadcasting state.
 *
 * Matchmaking: the free PeerJS cloud server only introduces peers. The host
 * registers the peer id `bad1-<CODE>`; joiners connect to that id.
 * If the host leaves, the lobby ends.
 */

export interface PlayerInfo {
  id: string;
  name: string;
  color: number;
  /** Optional custom face (small JPEG data URL, see net/face.ts). */
  face?: string;
  /** Rank or title shown under the name tag. */
  sub?: string;
}

/** [x, y, z, yaw, anim] where anim: 0 idle, 1 run, 2 cheer, 3 crouch */
export type Pose = [number, number, number, number, number];

type Msg =
  | { t: 'hello'; name: string; face?: string | null; sub?: string }
  | { t: 'face'; face: string | null }
  | { t: 'sub'; sub: string }
  | { t: 'roster'; players: PlayerInfo[]; game: string; host: string }
  | { t: 'pose'; p: Pose }
  | { t: 'poses'; p: Record<string, Pose> }
  | { t: 'start'; game: string; seed: number; opts: Record<string, unknown> }
  | { t: 'g'; d: GameData }
  | { t: 'bye'; reason: string };

/** Payload on the game channel. Each game defines its own `k` kinds. */
export type GameData = { k: string; [key: string]: unknown };

export interface RemotePose {
  x: number;
  y: number;
  z: number;
  yaw: number;
  anim: number;
  /** performance.now() when received */
  at: number;
}

const ID_PREFIX = 'bad1-';
const POSE_HZ = 15;
const MAX_PLAYERS = 6;
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; // no I or O
const COLORS = [0xe63946, 0x2a9d8f, 0xffb703, 0x4361ee, 0xf72585, 0x8ac926];

export function makeCode(): string {
  let s = '';
  for (let i = 0; i < 4; i++) s += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  return s;
}

export function cleanCode(raw: string): string {
  return raw.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4);
}

function peerError(e: unknown): string {
  const type = (e as { type?: string })?.type ?? '';
  if (type === 'peer-unavailable') return 'Walang lobby na may ganyang code.';
  if (type === 'unavailable-id') return 'Gamit na ang code na yan. Subukan ulit.';
  if (type === 'network' || type === 'server-error' || type === 'socket-error') return 'Walang koneksyon sa server. Check ang internet mo.';
  if (type === 'browser-incompatible') return 'Hindi suportado ng browser na ito ang multiplayer.';
  return 'Hindi makakonekta. Subukan ulit.';
}

export class Session {
  readonly isHost: boolean;
  selfId = '';
  hostId = '';
  gameId: string;
  players: PlayerInfo[] = [];
  readonly poses = new Map<string, RemotePose>();
  /** True while a game started by this lobby is running. */
  inGame = false;

  onRoster: (() => void) | null = null;
  onStart: ((game: string, seed: number, opts: Record<string, unknown>) => void) | null = null;
  onGame: ((from: string, d: GameData) => void) | null = null;
  onClosed: ((reason: string) => void) | null = null;

  private peer: Peer;
  private conns = new Map<string, DataConnection>(); // host: all clients. client: just the host.
  private poseT = 0;
  private localPose: Pose = [0, 0, 0, 0, 0];
  private closed = false;

  private constructor(peer: Peer, isHost: boolean, readonly code: string, gameId: string, private myName: string) {
    this.peer = peer;
    this.isHost = isHost;
    this.gameId = gameId;
  }

  // ------------------------------------------------------------------ create / join

  /** Create a lobby for `gameId`. Retries with new codes if one is taken. */
  static async host(gameId: string, name: string, face: string | null = null, sub = ''): Promise<Session> {
    let lastErr: unknown;
    for (let attempt = 0; attempt < 4; attempt++) {
      const code = makeCode();
      try {
        const peer = await openPeer(ID_PREFIX + code);
        const s = new Session(peer, true, code, gameId, name);
        s.selfId = peer.id;
        s.hostId = peer.id;
        s.players = [{ id: peer.id, name, color: COLORS[0], sub: cleanSub(sub), ...(isValidFace(face) ? { face } : {}) }];
        peer.on('connection', (c) => s.acceptClient(c));
        peer.on('disconnected', () => peer.reconnect());
        return s;
      } catch (e) {
        lastErr = e;
        if ((e as { type?: string })?.type !== 'unavailable-id') break;
      }
    }
    throw new Error(peerError(lastErr));
  }

  /** Join an existing lobby by code. Resolves once the roster arrives. */
  static async join(rawCode: string, name: string, face: string | null = null, sub = ''): Promise<Session> {
    const code = cleanCode(rawCode);
    if (code.length !== 4) throw new Error('Apat na letra ang code.');
    let peer: Peer;
    try {
      peer = await openPeer();
    } catch (e) {
      throw new Error(peerError(e));
    }
    const s = new Session(peer, false, code, '', name);
    s.selfId = peer.id;
    s.hostId = ID_PREFIX + code;
    return new Promise<Session>((resolve, reject) => {
      const conn = peer.connect(s.hostId, { serialization: 'json', reliable: true });
      const timer = window.setTimeout(() => {
        peer.destroy();
        reject(new Error('Walang sumagot. Tama ba ang code?'));
      }, 12000);
      peer.on('error', (e) => {
        clearTimeout(timer);
        peer.destroy();
        reject(new Error(peerError(e)));
      });
      conn.on('open', () => {
        s.conns.set(s.hostId, conn);
        conn.send({ t: 'hello', name, face: isValidFace(face) ? face : null, sub: cleanSub(sub) } satisfies Msg);
      });
      conn.on('data', (raw) => {
        const m = raw as Msg;
        if (m.t === 'roster' && !s.players.length) {
          clearTimeout(timer);
          s.handleFromHost(m);
          resolve(s);
          return;
        }
        if (m.t === 'bye' && !s.players.length) {
          clearTimeout(timer);
          peer.destroy();
          reject(new Error(m.reason));
          return;
        }
        s.handleFromHost(m);
      });
      conn.on('close', () => s.close('Umalis ang host. Tapos na ang lobby.'));
    });
  }

  // ------------------------------------------------------------------ host side

  private acceptClient(c: DataConnection): void {
    c.on('open', () => {
      if (this.players.length >= MAX_PLAYERS || this.inGame) {
        c.send({ t: 'bye', reason: this.inGame ? 'May laro pang tumatakbo. Hintayin matapos.' : 'Puno na ang lobby.' } satisfies Msg);
        setTimeout(() => c.close(), 300);
        return;
      }
      this.conns.set(c.peer, c);
    });
    c.on('data', (raw) => {
      const m = raw as Msg;
      switch (m.t) {
        case 'hello': {
          if (this.players.some((p) => p.id === c.peer)) return;
          const used = new Set(this.players.map((p) => p.color));
          const color = COLORS.find((x) => !used.has(x)) ?? COLORS[this.players.length % COLORS.length];
          this.players.push({ id: c.peer, name: sanitizeName(m.name), color, sub: cleanSub(m.sub), ...(isValidFace(m.face) ? { face: m.face } : {}) });
          this.sendRoster();
          break;
        }
        case 'face': {
          const p = this.players.find((x) => x.id === c.peer);
          if (!p) return;
          if (isValidFace(m.face)) p.face = m.face;
          else delete p.face;
          this.sendRoster();
          break;
        }
        case 'sub': {
          const p = this.players.find((x) => x.id === c.peer);
          if (!p) return;
          p.sub = cleanSub(m.sub);
          this.sendRoster();
          break;
        }
        case 'pose':
          this.poses.set(c.peer, toRemote(m.p));
          break;
        case 'g':
          this.onGame?.(c.peer, m.d);
          break;
      }
    });
    const drop = () => {
      if (!this.conns.has(c.peer)) return;
      this.conns.delete(c.peer);
      this.poses.delete(c.peer);
      this.players = this.players.filter((p) => p.id !== c.peer);
      this.sendRoster();
    };
    c.on('close', drop);
    c.on('error', drop);
  }

  private sendRoster(): void {
    this.toClients({ t: 'roster', players: this.players, game: this.gameId, host: this.selfId });
    this.onRoster?.();
  }

  private toClients(m: Msg): void {
    for (const c of this.conns.values()) if (c.open) c.send(m);
  }

  /** Host: start (or restart) the lobby's game for everyone. */
  startGame(opts: Record<string, unknown> = {}): void {
    if (!this.isHost) return;
    const seed = Math.floor(Math.random() * 1e9);
    this.inGame = true;
    this.toClients({ t: 'start', game: this.gameId, seed, opts });
    this.onStart?.(this.gameId, seed, opts);
  }

  setGame(gameId: string): void {
    if (!this.isHost) return;
    this.gameId = gameId;
    this.sendRoster();
  }

  // ------------------------------------------------------------------ client side

  private handleFromHost(m: Msg): void {
    switch (m.t) {
      case 'roster':
        this.players = m.players.map((p) => {
          const base = { id: p.id, name: p.name, color: p.color, sub: cleanSub(p.sub) };
          return isValidFace(p.face) ? { ...base, face: p.face } : base;
        });
        this.gameId = m.game;
        this.hostId = m.host;
        for (const id of [...this.poses.keys()]) if (!m.players.some((p) => p.id === id)) this.poses.delete(id);
        this.onRoster?.();
        break;
      case 'poses':
        for (const [id, p] of Object.entries(m.p)) if (id !== this.selfId) this.poses.set(id, toRemote(p));
        break;
      case 'start':
        this.gameId = m.game;
        this.inGame = true;
        this.onStart?.(m.game, m.seed, m.opts);
        break;
      case 'g':
        this.onGame?.(this.hostId, m.d);
        break;
      case 'bye':
        this.close(m.reason);
        break;
    }
  }

  // ------------------------------------------------------------------ game channel

  /** Client -> host. On the host this is delivered locally. */
  sendGame(d: GameData): void {
    if (this.isHost) this.onGame?.(this.selfId, d);
    else this.conns.get(this.hostId)?.send({ t: 'g', d } satisfies Msg);
  }

  /** Host -> everyone (including the host itself). */
  broadcastGame(d: GameData): void {
    if (!this.isHost) return;
    this.toClients({ t: 'g', d });
    this.onGame?.(this.selfId, d);
  }

  /** Mark the current game as finished (host lets new players join again). */
  gameOver(): void {
    this.inGame = false;
  }

  // ------------------------------------------------------------------ poses

  setLocalPose(x: number, y: number, z: number, yaw: number, anim: number): void {
    this.localPose = [round(x), round(y), round(z), round(yaw), anim];
  }

  /** Call every frame. Sends poses at POSE_HZ. */
  update(dt: number): void {
    if (this.closed) return;
    this.poseT -= dt;
    if (this.poseT > 0) return;
    this.poseT = 1 / POSE_HZ;
    if (this.isHost) {
      const all: Record<string, Pose> = { [this.selfId]: this.localPose };
      for (const [id, p] of this.poses) all[id] = [p.x, p.y, p.z, p.yaw, p.anim];
      this.toClients({ t: 'poses', p: all });
    } else {
      const c = this.conns.get(this.hostId);
      if (c?.open) c.send({ t: 'pose', p: this.localPose } satisfies Msg);
    }
  }

  /** Change my face for everyone in the lobby (null removes it). */
  setFace(face: string | null): void {
    const f = isValidFace(face) ? face : null;
    if (this.isHost) {
      const me = this.players.find((p) => p.id === this.selfId);
      if (!me) return;
      if (f) me.face = f;
      else delete me.face;
      this.sendRoster();
    } else {
      this.conns.get(this.hostId)?.send({ t: 'face', face: f } satisfies Msg);
    }
  }

  /** Change my rank/title line for everyone in the lobby. */
  setSub(sub: string): void {
    const v = cleanSub(sub);
    if (this.isHost) {
      const me = this.players.find((p) => p.id === this.selfId);
      if (!me || me.sub === v) return;
      me.sub = v;
      this.sendRoster();
    } else {
      this.conns.get(this.hostId)?.send({ t: 'sub', sub: v } satisfies Msg);
    }
  }

  nameOf(id: string): string {
    return this.players.find((p) => p.id === id)?.name ?? 'Tropa';
  }

  colorOf(id: string): number {
    return this.players.find((p) => p.id === id)?.color ?? 0xffffff;
  }

  // ------------------------------------------------------------------ teardown

  leave(): void {
    if (this.isHost) this.toClients({ t: 'bye', reason: 'Isinara ng host ang lobby.' });
    this.close('');
  }

  private close(reason: string): void {
    if (this.closed) return;
    this.closed = true;
    setTimeout(() => this.peer.destroy(), 200);
    this.onClosed?.(reason);
  }

  get isClosed(): boolean {
    return this.closed;
  }
}

function openPeer(id?: string): Promise<Peer> {
  return new Promise((resolve, reject) => {
    const peer = id ? new Peer(id, { debug: 1 }) : new Peer({ debug: 1 });
    const fail = (e: unknown) => {
      peer.destroy();
      reject(e);
    };
    peer.once('open', () => {
      peer.off('error', fail);
      resolve(peer);
    });
    peer.once('error', fail);
  });
}

function toRemote(p: Pose): RemotePose {
  return { x: p[0], y: p[1], z: p[2], yaw: p[3], anim: p[4], at: performance.now() };
}

const round = (v: number) => Math.round(v * 100) / 100;

function cleanSub(raw: unknown): string {
  return String(raw ?? '').replace(/[^\p{L}\p{N} ._'-]/gu, '').trim().slice(0, 22);
}

export function sanitizeName(raw: string): string {
  const s = String(raw ?? '').replace(/[^\p{L}\p{N} ._-]/gu, '').trim().slice(0, 14);
  return s || 'Tropa';
}
