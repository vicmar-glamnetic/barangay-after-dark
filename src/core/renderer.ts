import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { device } from './device';
import type { Quality } from './save';

/**
 * Owns the WebGL renderer, the world camera and a second "hand" scene that is
 * drawn on top after a depth clear, so first-person items never clip into walls.
 */
export class Renderer {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  /** Scene for first-person held items. Its camera never moves. */
  readonly handScene = new THREE.Scene();
  readonly handCamera: THREE.PerspectiveCamera;
  quality: Quality = 'high';
  private resizeCbs: (() => void)[] = [];
  /** Bloom post-processing: desktop on High only (too heavy for phones). */
  private composer: EffectComposer | null = null;
  private bloom: UnrealBloomPass | null = null;

  constructor(canvas: HTMLCanvasElement, quality: Quality, glow = false) {
    this.glow = glow;
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      // MSAA is expensive on phones; DPR 1.5 already smooths edges there.
      antialias: !device.isMobile,
      powerPreference: 'high-performance',
      stencil: false,
      alpha: false,
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.autoClear = false;
    this.renderer.info.autoReset = false; // two passes per frame; reset manually in render()
    this.renderer.setClearColor(0x070b1d, 1);

    this.camera = new THREE.PerspectiveCamera(70, 1, 0.08, 230);
    this.camera.rotation.order = 'YXZ';
    this.handCamera = new THREE.PerspectiveCamera(60, 1, 0.01, 10);

    this.setQuality(quality);
    const onResize = () => this.resize();
    window.addEventListener('resize', onResize);
    window.visualViewport?.addEventListener('resize', onResize);
    // iOS reports stale sizes right after rotation; re-check shortly after.
    window.addEventListener('orientationchange', () => setTimeout(onResize, 250));
  }

  onResize(cb: () => void): void {
    this.resizeCbs.push(cb);
  }

  /** Set by the Auto FPS governor (core/perf.ts) on top of the quality setting. */
  private perfScale = 1;
  private perfBloom = true;
  /** Player's Glow setting. */
  glow = false;
  /** Measured GPU ms per frame (EXT_disjoint_timer_query_webgl2), or -1 if unavailable. */
  gpuMs = -1;
  private timerExt: { TIME_ELAPSED_EXT: number; GPU_DISJOINT_EXT: number } | null = null;
  private query: WebGLQuery | null = null;
  private queryFrame = 0;

  setPerf(resScale: number, bloom: boolean): void {
    this.perfScale = resScale;
    this.perfBloom = bloom;
    this.setQuality(this.quality);
  }

  setQuality(q: Quality): void {
    this.quality = q;
    // DPR caps: phones 1.5 (High) / 1 (Low). Desktop 1.5 / 1: Retina at 2x costs
    // nearly double the pixels for a barely visible gain at night.
    const cap = q === 'high' ? 1.5 : 1;
    const dpr = Math.min(window.devicePixelRatio || 1, cap) * this.perfScale;
    this.renderer.setPixelRatio(Math.max(0.5, dpr));
    const wantBloom = this.glow && q === 'high' && !device.isMobile && this.perfBloom;
    if (wantBloom && !this.composer) {
      this.composer = new EffectComposer(this.renderer);
      this.composer.addPass(new RenderPass(this.scene, this.camera));
      // threshold keeps it to the bright stuff: bulbs, lit windows, signs, parols, fireflies
      this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.7, 0.55, 0.9);
      // Run the blur chain at half resolution: the glow is soft anyway, and it
      // cuts most of bloom's GPU cost.
      const bloom = this.bloom;
      const baseSetSize = bloom.setSize.bind(bloom);
      bloom.setSize = (w: number, h: number) => baseSetSize(Math.max(1, Math.round(w / 2)), Math.max(1, Math.round(h / 2)));
      this.composer.addPass(this.bloom);
      this.composer.addPass(new OutputPass());
    } else if (!wantBloom && this.composer) {
      this.composer.dispose();
      this.composer = null;
      this.bloom = null;
    }
    this.resize();
  }

  resize(): void {
    const w = Math.max(1, window.innerWidth);
    const h = Math.max(1, window.innerHeight);
    this.renderer.setSize(w, h, false);
    this.composer?.setPixelRatio(this.renderer.getPixelRatio());
    this.composer?.setSize(w, h);
    const aspect = w / h;
    // Aim for ~100 degree horizontal FOV, clamped so phones in landscape
    // do not get a fish-eye view and tablets do not get tunnel vision.
    const vfov = THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(50)) / aspect));
    this.camera.fov = THREE.MathUtils.clamp(vfov, 56, 75);
    this.camera.userData.baseFov = this.camera.fov; // the player adds a sprint FOV kick on top
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
    this.handCamera.fov = this.camera.fov;
    this.handCamera.aspect = aspect;
    this.handCamera.updateProjectionMatrix();
    for (const cb of this.resizeCbs) cb();
  }

  render(): void {
    const r = this.renderer;
    // Sample GPU time every 20th frame (desktop browsers expose a timer query).
    const gl = r.getContext() as WebGL2RenderingContext;
    if (this.queryFrame === 0 && this.timerExt === null) {
      this.timerExt = (gl.getExtension?.('EXT_disjoint_timer_query_webgl2') as typeof this.timerExt) ?? null;
      if (!this.timerExt) this.queryFrame = -1; // unsupported: never try again
    }
    let measuring = false;
    if (this.timerExt && this.queryFrame >= 0) {
      if (this.query && gl.getQueryParameter(this.query, gl.QUERY_RESULT_AVAILABLE)) {
        if (!gl.getParameter(this.timerExt.GPU_DISJOINT_EXT)) {
          const ms = gl.getQueryParameter(this.query, gl.QUERY_RESULT) / 1e6;
          this.gpuMs = this.gpuMs < 0 ? ms : this.gpuMs * 0.7 + ms * 0.3;
        }
        gl.deleteQuery(this.query);
        this.query = null;
      }
      if (!this.query && ++this.queryFrame % 20 === 0) {
        this.query = gl.createQuery();
        if (this.query) {
          gl.beginQuery(this.timerExt.TIME_ELAPSED_EXT, this.query);
          measuring = true;
        }
      }
    }
    r.info.reset();
    if (this.composer) this.composer.render();
    else {
      r.clear();
      r.render(this.scene, this.camera);
    }
    if (this.handScene.children.some((c) => c.visible && !(c instanceof THREE.Light))) {
      r.clearDepth();
      r.render(this.handScene, this.handCamera);
    }
    if (measuring && this.timerExt) gl.endQuery(this.timerExt.TIME_ELAPSED_EXT);
  }
}
