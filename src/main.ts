import './ui/styles.css';
import * as THREE from 'three';
import { AudioSys } from './core/audio';
import { device } from './core/device';
import { Input } from './core/input';
import { Loop } from './core/loop';
import { PerfGovernor } from './core/perf';
import { checkBadges, rollQuests, slipperChoices, type Badge } from './core/meta';
import { dailyReward } from './core/progression';
import { slipperColors } from './player/tsinelas';
import { Physics } from './core/physics';
import { Renderer } from './core/renderer';
import { SaveStore, type Settings } from './core/save';
import { GameManager } from './games/gameManager';
import { Avatars } from './net/avatars';
import { Player } from './player/controller';
import { Hand } from './player/hand';
import { Hud } from './ui/hud';
import { Menus } from './ui/menus';
import { MobileControls } from './ui/mobileControls';
import { Overlays } from './ui/overlays';
import { buildBarangay, type World } from './world/barangay';
import { Lighting } from './world/lighting';
import { BlobShadows } from './world/shadows';
import { Sky } from './world/sky';
import { Ambient } from './world/ambient';
import { Traffic } from './world/traffic';
import { FONT } from './world/textures';
import { NightEvents } from './world/nightEvents';
import { escapeInAppBrowser } from './ui/inAppEscape';
import { L, onLang } from './core/i18n';

type AppState = 'loading' | 'title' | 'play';
const FAR_AWAY = new THREE.Vector3(0, 50, 0);

/**
 * App: boots the engine, builds the barangay, and runs the state machine
 * (loading -> title -> play) plus pause / end-card handling.
 */
class App {
  private canvas = document.getElementById('game') as HTMLCanvasElement;
  private ui = document.getElementById('ui') as HTMLElement;
  private save = new SaveStore(device.forceQuality ?? 'high');
  private r = new Renderer(this.canvas, this.save.data.settings.quality, this.save.data.settings.glow);
  private input = new Input(this.canvas);
  private audio = new AudioSys();
  private loop = new Loop((dt, t) => this.tick(dt, t), () => !!this.games?.networked);
  private overlays: Overlays;
  private hud: Hud;
  private touch: MobileControls;
  private menus: Menus;

  private physics!: Physics;
  private lighting!: Lighting;
  private sky!: Sky;
  private world!: World;
  private blobs!: BlobShadows;
  private player!: Player;
  private hand!: Hand;
  private games!: GameManager;
  private avatars!: Avatars;
  private ambient!: Ambient;
  private traffic!: Traffic;
  private events!: NightEvents;
  private eventChipT = 0;
  /** A board game has the mouse (no pointer lock, no joystick). */
  private pointerFree = false;
  private perf = new PerfGovernor(
    (fx) => this.applyPerf(fx),
    () => this.r.gpuMs >= 0 && this.r.gpuMs < 7 && this.loop.cpuMs < 7,
  );

  private state: AppState = 'loading';
  private paused = false;
  private titleT = 0;

  constructor() {
    if (device.forceQuality) this.save.data.settings.quality = device.forceQuality;
    this.touch = new MobileControls(this.ui, this.input);
    this.hud = new Hud(this.ui, () => this.pause());
    this.menus = new Menus(this.ui, this.save, {
      onStart: () => this.startPlay(),
      onResume: () => this.resume(),
      onQuitGame: () => {
        this.games.quitMidGame();
        this.resume();
      },
      onSettings: (s) => this.applySettings(s),
      onResetProgress: () => {
        this.save.resetProgress();
        this.games.refreshLabels();
        this.hud.setPoints(0);
        if (!this.games.playing) this.hud.setObjective(this.games.hubObjective());
      },
      onUiSound: () => this.audio.play('ui'),
      onFace: (face) => this.games?.session?.setFace(face),
      onSlipper: (i) => this.applySlipper(i),
      bookInfo: () => {
        rollQuests(this.save.data);
        const d = this.games.daily();
        return {
          games: this.games.games.filter((g) => g.implemented).map((g) => ({ id: g.id, name: g.name })),
          quests: this.games.quests(),
          daily: { name: this.games.gameById(d.gameId)?.name ?? d.gameId, target: d.target, done: this.games.dailyDoneToday(), streak: this.save.data.streak, reward: dailyReward(this.save.data.streak) },
          rival: (id: string) => this.games.rivalText(id),
        };
      },
      onShop: () => {
        this.applySlipper(this.save.data.slipper);
        this.games.session?.setSub(this.games.myTag);
        this.showBadges(checkBadges(this.save.data, null));
        this.save.persist();
      },
    }, () => this.input.usingTouch);
    this.overlays = new Overlays(this.ui);
    this.setTouchMode(this.input.usingTouch);
    this.touch.setVisible(false);

    this.input.onModeChange((t) => this.setTouchMode(t));
    this.input.onLockChange((locked) => {
      // Esc releases pointer lock in the browser: treat it as pause.
      if (!locked && this.state === 'play' && !this.paused && !this.menus.isOpen && !this.input.usingTouch && !this.pointerFree) this.pause();
    });
    this.canvas.addEventListener('click', () => {
      if (this.state === 'play' && !this.paused && !this.menus.isOpen && !this.pointerFree) this.input.requestLock();
    });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        if (this.state === 'play' && !this.menus.isOpen) this.pause();
        this.audio.suspend();
      } else this.audio.resume();
    });
    this.preventBrowserGestures();
    escapeInAppBrowser(this.ui);
    onLang(() => {
      this.menus.refreshTitle();
      this.games?.onLanguage();
    });
    // keep the game fullscreen: any tap while playing re-enters it if the browser dropped out
    document.addEventListener('click', () => {
      if (this.state === 'play') this.goFullscreen();
    }, true);
    this.boot().catch((e) => {
      console.error(e);
      document.querySelector('.start-btn')!.textContent = L('May error. I-refresh ang page.', 'Something went wrong. Please refresh the page.');
    });
  }

  private async boot(): Promise<void> {
    // Fonts are used in canvas textures (signs, labels): wait briefly for them.
    await Promise.race([
      Promise.all([document.fonts.load(`800 40px ${FONT}`), document.fonts.load(`700 40px ${FONT}`)]).catch(() => {}),
      new Promise((r) => setTimeout(r, 1500)),
    ]);
    this.physics = await Physics.create();
    const scene = this.r.scene;
    const q = this.save.data.settings.quality;
    this.lighting = new Lighting(scene);
    this.world = buildBarangay(scene, this.physics, this.lighting, q);
    this.sky = new Sky(scene, this.lighting.moonDir, q);
    const groundAt = (x: number, z: number) => this.physics.groundAt(x, z, 3);
    this.blobs = new BlobShadows(scene, (x, z, fromY) => this.physics.groundAt(x, z, fromY));
    this.player = new Player(this.physics, this.r.camera, this.input, this.save.data.settings, this.audio);
    this.hand = new Hand(this.r.handScene);
    this.avatars = new Avatars(scene, this.blobs, this.audio);
    this.ambient = new Ambient(scene, this.world.lampHeads, q);
    this.traffic = new Traffic(scene, this.blobs, this.audio);
    this.events = new NightEvents(scene, this.lighting, (k) => this.world.setPower(k), this.audio, this.blobs, q);
    this.events.onChange = (ev) => {
      if (this.state !== 'play') return;
      if (ev) {
        this.hud.toast(ev.start, 'good', 2600);
        this.audio.play(ev.id === 'sorbetero' ? 'bell' : 'perfect');
      } else this.hud.toast(L('Tapos na ang event. Abangan ang susunod!', 'Event over. Watch for the next one!'), 'small', 1800);
    };
    this.perf.setEnabled(this.save.data.settings.autoFps);
    this.games = new GameManager(
      {
        scene,
        camera: this.r.camera,
        physics: this.physics,
        player: this.player,
        hand: this.hand,
        input: this.input,
        audio: this.audio,
        hud: this.hud,
        touch: this.touch,
        overlays: this.overlays,
        blobs: this.blobs,
        avatars: this.avatars,
        isTouch: () => this.input.usingTouch,
        groundAt,
        freePointer: (on) => {
          this.pointerFree = on;
          if (on) {
            this.input.exitLock();
            this.touch.setVisible(false);
          } else if (!this.menus.isOpen) {
            this.touch.setVisible(this.input.usingTouch);
            this.input.requestLock();
          }
        },
      },
      this.save,
      this.menus,
      {
        event: () => this.events?.current ?? null,
        onBadges: (b) => this.showBadges(b),
        onModal: (open) => {
          if (open) {
            this.input.clearAll();
            this.input.exitLock();
            this.touch.setVisible(false);
          } else {
            this.paused = false;
            this.input.enabled = true;
            if (!this.pointerFree) {
              this.touch.setVisible(this.input.usingTouch);
              this.input.requestLock();
            }
          }
        },
      },
    );
    const sp = this.world.spawn;
    this.player.teleport(sp.pos.x, sp.pos.y, sp.pos.z, sp.yaw);
    this.physics.step(1 / 60);
    this.audio.setVolume(this.save.data.settings.volume);
    this.hud.setPoints(this.save.data.tropaPoints);
    this.hud.setRank(this.games.progressText());
    this.applySlipper(this.save.data.slipper);

    this.state = 'title';
    this.menus.setTitleReady();
    this.loop.start();

    if (import.meta.env.DEV) (window as unknown as { __barangay: App }).__barangay = this;
  }

  // ------------------------------------------------------------------ state changes

  private startPlay(): void {
    this.audio.unlock();
    this.audio.setVolume(this.save.data.settings.volume);
    this.goFullscreen();
    this.state = 'play';
    this.menus.showTitle(false);
    this.hud.show(true);
    this.touch.setVisible(this.input.usingTouch);
    const sp = this.world.spawn;
    this.player.teleport(sp.pos.x, sp.pos.y, sp.pos.z, sp.yaw);
    this.hud.setObjective(this.games.hubObjective());
    this.hud.toast(this.input.usingTouch ? L('Joystick para lumakad, drag para tumingin', 'Joystick to walk, drag to look') : L('WASD para lumakad, mouse para tumingin', 'WASD to walk, mouse to look'), 'small', 3200);
    // iPhone Safari has no fullscreen API: the home-screen app is the only way
    if (device.isIOS && !device.isStandalone && !device.inApp && !document.fullscreenEnabled)
      window.setTimeout(() => this.hud.toast(L('Para full screen: Share → Add to Home Screen', 'For full screen: Share → Add to Home Screen'), 'small', 4000), 3600);
    this.input.requestLock();
  }

  private pause(): void {
    if (this.state !== 'play' || this.menus.isOpen) return;
    this.paused = true;
    this.input.clearAll();
    this.input.enabled = false;
    this.input.exitLock();
    this.touch.setVisible(false);
    this.menus.showPause(this.games.playing, {
      inLobby: !!this.games.session,
      inNetGame: this.games.networked,
      onJoin: () => {
        this.paused = false;
        this.games.showJoin();
      },
      onLobby: () => {
        this.paused = false;
        this.games.showLobby();
      },
    });
  }

  private resume(): void {
    this.menus.close();
    this.paused = false;
    this.input.enabled = true;
    if (this.pointerFree) return;
    this.touch.setVisible(this.input.usingTouch);
    this.input.requestLock();
  }

  /** New badges: one toast each, a little apart. */
  private showBadges(list: Badge[]): void {
    list.forEach((b, i) => window.setTimeout(() => {
      this.hud.toast(`Badge: ${b.name}! +${b.barya} Barya`, 'good', 2200);
      this.audio.play('badge');
    }, 2300 * i + 400));
  }

  /** Tsinelas color (only colors unlocked by rank or bought are allowed). */
  private applySlipper(i: number): void {
    const all = slipperChoices(this.save.data);
    const s = all[i]?.unlocked ? all[i] : all[0];
    this.hand.setSlipperColors(s.strap, s.top);
    slipperColors.strap = s.strap;
    slipperColors.top = s.top;
  }

  /** Auto FPS level changed: resolution, bloom, clouds + fireflies. */
  private applyPerf(fx: { bloom: boolean; resScale: number; extras: boolean }): void {
    this.r.setPerf(fx.resScale, fx.bloom);
    this.sky?.setExtras(fx.extras);
    this.ambient?.setVisible(fx.extras);
  }

  private applySettings(s: Settings): void {
    if (s.autoFps !== this.perf.enabled) this.perf.setEnabled(s.autoFps);
    if (s.glow !== this.r.glow) {
      this.r.glow = s.glow;
      this.r.setQuality(this.r.quality);
    }
    if (!s.showFps && !device.showFps) this.hud.setFps(null);
    if (s.quality !== this.r.quality) {
      this.perf.reset();
      this.r.setQuality(s.quality);
      (this.r.scene.fog as THREE.FogExp2).density = s.quality === 'high' ? 0.022 : 0.026;
    }
    this.audio.setVolume(s.volume);
  }

  private setTouchMode(touch: boolean): void {
    document.body.classList.toggle('is-touch', touch);
    this.menus.refreshTitle();
    if (this.state === 'play' && !this.menus.isOpen) this.touch.setVisible(touch);
    if (touch) this.input.exitLock();
  }

  private goFullscreen(): void {
    if (device.isStandalone || document.fullscreenElement || (document as unknown as { webkitFullscreenElement?: Element }).webkitFullscreenElement) return;
    const de = document.documentElement as HTMLElement & { webkitRequestFullscreen?: () => void };
    const req = de.requestFullscreen?.bind(de) ?? de.webkitRequestFullscreen?.bind(de);
    if (!req) return; // iPhone Safari: use "Add to Home Screen" for fullscreen
    try {
      const p = req({ navigationUI: 'hide' } as FullscreenOptions) as Promise<void> | undefined;
      p?.then(() => (screen.orientation as unknown as { lock?: (o: string) => Promise<void> })?.lock?.('landscape').catch(() => {}))
        .catch(() => {});
    } catch {
      /* ignore */
    }
  }

  private preventBrowserGestures(): void {
    const stop = (e: Event) => e.preventDefault();
    document.addEventListener('gesturestart', stop);
    document.addEventListener('dblclick', stop);
    document.addEventListener('contextmenu', stop);
    document.addEventListener(
      'touchmove',
      (e) => {
        if (!(e.target as HTMLElement).closest?.('.card')) e.preventDefault();
      },
      { passive: false },
    );
  }

  /** HUD chip for the running night event, with time left. */
  private updateEventChip(dt: number): void {
    this.eventChipT -= dt;
    if (this.eventChipT > 0) return;
    this.eventChipT = 0.5;
    const ev = this.events.current;
    if (!ev || this.state !== 'play' || (ev.id === 'sorbetero' && !this.events.cartVisible)) {
      this.hud.setEvent(null);
      return;
    }
    const sec = Math.max(0, Math.ceil(this.events.leftMs / 1000));
    this.hud.setEvent(`${ev.chip}  ${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`, ev.id);
  }

  // ------------------------------------------------------------------ frame

  private tick(dt: number, t: number): void {
    const cam = this.r.camera;
    this.input.update();

    if (this.input.pausePressed && this.state === 'play') {
      if (this.paused) this.resume();
      else if (this.menus.kind === 'game' || this.menus.kind === 'join' || this.menus.kind === 'lobby') this.games.closeMenu();
      else if (!this.menus.isOpen) this.pause();
    }

    if (this.state === 'title') {
      // slow cinematic orbit over the barangay
      this.titleT += dt;
      const a = this.titleT * 0.045 + 2.2;
      cam.position.set(Math.cos(a) * 25, 11 + Math.sin(this.titleT * 0.2) * 1.5, 3 + Math.sin(a) * 25);
      cam.lookAt(0, 1.5, 3);
      this.games.update(dt, t, cam.position, false, false);
    } else if (this.state === 'play') {
      const controls = !this.paused && !this.menus.isOpen;
      // Multiplayer games keep running while one player has a menu open.
      const simulate = !this.paused || this.games.networked;
      if (simulate) {
        if (controls) this.player.update(dt);
        this.games.update(dt, t, cam.position, controls, simulate);
        this.physics.step(dt);
        this.player.syncCamera();
        this.games.postPhysics(dt);
      }
      const s = this.games.session;
      if (s) {
        const p = this.player.position;
        const anim = this.games.active?.localAnim() ?? (this.player.speed > 0.5 ? 1 : 0);
        s.setLocalPose(p.x, p.y, p.z, this.player.yaw, anim);
        s.update(dt);
      }
      if (!this.games.playing && !this.paused && !this.menus.isOpen && this.events.nearCart(this.player.position) && this.save.data.sorbetesSlot !== this.events.slot) {
        this.games.catchSorbetes(this.events.slot);
        this.events.hideCart();
      }
      this.avatars.setVisible(!!s && this.games.networked);
      this.avatars.update(dt, t, s);
      this.hand.update(dt, this.player.speed);
      this.hud.setClickHint(controls && !this.input.usingTouch && !this.input.locked && !this.pointerFree);
      this.audio.updateListener(cam);
    }

    if (this.state !== 'loading') {
      this.world.update(dt, t);
      this.ambient.update(t, this.r.renderer.getPixelRatio());
      this.traffic.update(dt, this.state === 'play' ? this.player.position : FAR_AWAY);
      this.events.update(dt, t, cam.position, this.save.data.sorbetesSlot);
      this.updateEventChip(dt);
      this.lighting.update(dt, this.state === 'play' ? this.player.position : cam.position);
      this.blobs.update();
      this.sky.update(cam, t);
      this.r.render();
      if (!this.paused) this.perf.frame(this.loop.rawDt);
      if (device.showFps || this.save.data.settings.showFps) {
        const info = this.r.renderer.info.render;
        const auto = this.perf.enabled ? `  auto L${this.perf.level}` : '';
        const gpu = this.r.gpuMs >= 0 ? `  gpu ${this.r.gpuMs.toFixed(1)}ms` : '';
        this.hud.setFps(`${this.loop.fps.toFixed(0)} fps  cpu ${this.loop.cpuMs.toFixed(1)}ms${gpu}  ${info.calls} calls  ${(info.triangles / 1000).toFixed(1)}k tris${auto}`);
        if (this.state === 'title') this.hud.show(true);
      }
    }
    this.input.endFrame();
  }
}

new App();

// PWA: offline cache + installability. Only in production builds.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  });
}
