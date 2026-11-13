import * as THREE from 'three';
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

  constructor(canvas: HTMLCanvasElement, quality: Quality) {
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

  setQuality(q: Quality): void {
    this.quality = q;
    // Spec: cap DPR at 1.5 on mobile. Low drops to 1 for older phones.
    const cap = device.isMobile ? (q === 'high' ? 1.5 : 1) : q === 'high' ? 2 : 1;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, cap));
    this.resize();
  }

  resize(): void {
    const w = Math.max(1, window.innerWidth);
    const h = Math.max(1, window.innerHeight);
    this.renderer.setSize(w, h, false);
    const aspect = w / h;
    // Aim for ~100 degree horizontal FOV, clamped so phones in landscape
    // do not get a fish-eye view and tablets do not get tunnel vision.
    const vfov = THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(50)) / aspect));
    this.camera.fov = THREE.MathUtils.clamp(vfov, 56, 75);
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
    this.handCamera.fov = this.camera.fov;
    this.handCamera.aspect = aspect;
    this.handCamera.updateProjectionMatrix();
    for (const cb of this.resizeCbs) cb();
  }

  render(): void {
    const r = this.renderer;
    r.info.reset();
    r.clear();
    r.render(this.scene, this.camera);
    if (this.handScene.children.some((c) => c.visible && !(c instanceof THREE.Light))) {
      r.clearDepth();
      r.render(this.handScene, this.handCamera);
    }
  }
}
