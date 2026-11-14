import * as THREE from 'three';
import type { Quality } from '../core/save';
import { device } from '../core/device';
import { radialTexture } from './textures';

/**
 * Night sky: gradient dome (warm dusk glow at the horizon fading to deep blue),
 * a point-cloud of stars, and a moon with a soft halo. None of it uses fog.
 */
export class Sky {
  readonly group = new THREE.Group();
  private stars: THREE.Points;
  private starMat: THREE.PointsMaterial;
  private cloudMat: THREE.ShaderMaterial;
  private clouds!: THREE.Mesh;
  private shoot: THREE.Line;
  private shootMat: THREE.LineBasicMaterial;
  private shootT = -1;
  private nextShoot = 8 + Math.random() * 10;
  private shootFrom = new THREE.Vector3();
  private shootDir = new THREE.Vector3();

  constructor(scene: THREE.Scene, moonDir: THREE.Vector3, quality: Quality) {
    const dome = new THREE.Mesh(
      new THREE.SphereGeometry(180, 32, 16),
      new THREE.ShaderMaterial({
        side: THREE.BackSide,
        depthWrite: false,
        fog: false,
        uniforms: {
          top: { value: new THREE.Color(0x03061a) },
          mid: { value: new THREE.Color(0x0e1a4a) },
          horizon: { value: new THREE.Color(0x4a2f5e) },
          glow: { value: new THREE.Color(0xc0603f) },
        },
        vertexShader: /* glsl */ `
          varying vec3 vDir;
          void main() {
            vDir = normalize(position);
            vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            gl_Position = p.xyww; // always at the far plane
          }`,
        fragmentShader: /* glsl */ `
          uniform vec3 top; uniform vec3 mid; uniform vec3 horizon; uniform vec3 glow;
          varying vec3 vDir;
          void main() {
            float h = vDir.y;
            vec3 c = mix(horizon, mid, smoothstep(0.0, 0.22, h));
            c = mix(c, top, smoothstep(0.22, 0.85, h));
            // last light of dusk, strongest toward the west (-X)
            float west = max(0.0, -vDir.x) * 0.7 + 0.3;
            c += glow * pow(1.0 - clamp(abs(h) * 4.0, 0.0, 1.0), 3.0) * 0.55 * west;
            c = mix(c, vec3(0.03, 0.04, 0.09), smoothstep(0.0, -0.25, h));
            gl_FragColor = vec4(c, 1.0);
          }`,
      }),
    );
    dome.renderOrder = -10;
    dome.frustumCulled = false;
    this.group.add(dome);

    // Stars (upper hemisphere only)
    const count = quality === 'high' ? 1400 : 600;
    const pos = new Float32Array(count * 3);
    const col = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const u = Math.random() * Math.PI * 2;
      const y = 0.08 + Math.random() * 0.92;
      const r = Math.sqrt(1 - y * y);
      pos.set([Math.cos(u) * r * 170, y * 170, Math.sin(u) * r * 170], i * 3);
      const b = 0.5 + Math.random() * 0.5;
      const warm = Math.random() < 0.2;
      col.set([b, b * (warm ? 0.85 : 0.95), b * (warm ? 0.7 : 1)], i * 3);
    }
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    sg.setAttribute('color', new THREE.BufferAttribute(col, 3));
    this.starMat = new THREE.PointsMaterial({ size: 1.6, sizeAttenuation: false, vertexColors: true, fog: false, transparent: true, depthWrite: false });
    this.stars = new THREE.Points(sg, this.starMat);
    this.stars.frustumCulled = false;
    this.group.add(this.stars);

    // Moon + halo
    const moonPos = moonDir.clone().multiplyScalar(160);
    const moon = new THREE.Mesh(new THREE.CircleGeometry(6, 24), new THREE.MeshBasicMaterial({ color: 0xfff3d1, fog: false }));
    moon.position.copy(moonPos);
    moon.lookAt(0, 0, 0);
    this.group.add(moon);
    const halo = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: radialTexture('rgba(255,240,200,0.55)', 'rgba(255,240,200,0)', 128, [[0.25, 'rgba(200,210,255,0.18)']]),
        fog: false,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    halo.position.copy(moonPos.clone().multiplyScalar(0.99));
    halo.scale.setScalar(55);
    this.group.add(halo);

    // Drifting clouds, lit at the edges by the moon. In front of the moon (radius 120 < 160).
    this.cloudMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      fog: false,
      side: THREE.BackSide,
      uniforms: { time: { value: 0 }, moonDir: { value: moonDir.clone().normalize() } },
      // full-sky shader: fewer noise octaves on phones / Low keeps fill cost down
      defines: { OCTAVES: quality === 'high' && !device.isMobile ? 4 : 3 },
      vertexShader: /* glsl */ `
        varying vec3 vDir;
        void main() {
          vDir = normalize(position);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: /* glsl */ `
        uniform float time; uniform vec3 moonDir;
        varying vec3 vDir;
        float h(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float n(vec2 p) {
          vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
          return mix(mix(h(i), h(i + vec2(1, 0)), f.x), mix(h(i + vec2(0, 1)), h(i + vec2(1, 1)), f.x), f.y);
        }
        float fbm(vec2 p) { float s = 0.0, a = 0.5; for (int i = 0; i < OCTAVES; i++) { s += a * n(p); p *= 2.03; a *= 0.5; } return s; }
        void main() {
          if (vDir.y < 0.02) discard;
          vec2 uv = vDir.xz / (vDir.y + 0.25) * 1.6 + vec2(time * 0.012, time * 0.004);
          float c = fbm(uv);
          float a = smoothstep(0.5, 0.78, c) * smoothstep(0.02, 0.25, vDir.y);
          float moon = pow(max(0.0, dot(vDir, moonDir)), 18.0);
          vec3 col = mix(vec3(0.07, 0.09, 0.18), vec3(0.55, 0.58, 0.72), moon * 1.5 + (1.0 - a) * 0.25);
          gl_FragColor = vec4(col, a * 0.75);
        }`,
    });
    const clouds = new THREE.Mesh(new THREE.SphereGeometry(120, 24, 8, 0, Math.PI * 2, 0, Math.PI * 0.5), this.cloudMat);
    this.clouds = clouds;
    clouds.renderOrder = -5;
    clouds.frustumCulled = false;
    this.group.add(clouds);

    // Shooting star: a short fading streak
    const sg2 = new THREE.BufferGeometry();
    sg2.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(6), 3));
    sg2.setAttribute('color', new THREE.Float32BufferAttribute([1, 1, 1, 0, 0, 0], 3));
    this.shootMat = new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, fog: false, depthWrite: false, blending: THREE.AdditiveBlending });
    this.shoot = new THREE.Line(sg2, this.shootMat);
    this.shoot.frustumCulled = false;
    this.shoot.visible = false;
    this.group.add(this.shoot);

    scene.add(this.group);
  }

  /** Auto FPS: hide the cloud layer under load. */
  setExtras(v: boolean): void {
    this.clouds.visible = v;
  }

  /** Keep the dome centered on the camera and gently twinkle the stars. */
  update(cam: THREE.Camera, t: number): void {
    this.group.position.copy(cam.position);
    this.starMat.opacity = 0.85 + Math.sin(t * 1.7) * 0.08;
    this.cloudMat.uniforms.time.value = t;

    // shooting star every 15-40 s, lasting under a second
    if (this.shootT < 0) {
      this.nextShoot -= 1 / 60;
      if (this.nextShoot <= 0) {
        const a = Math.random() * Math.PI * 2;
        this.shootFrom.set(Math.cos(a) * 130, 60 + Math.random() * 50, Math.sin(a) * 130);
        this.shootDir.set(-Math.sin(a) + (Math.random() - 0.5), -0.35, Math.cos(a) + (Math.random() - 0.5)).normalize();
        this.shootT = 0;
        this.shoot.visible = true;
      }
    } else {
      this.shootT += 1 / 60;
      const k = this.shootT / 0.8;
      const head = this.shootFrom.clone().addScaledVector(this.shootDir, k * 70);
      const tail = head.clone().addScaledVector(this.shootDir, -14 * Math.min(1, k * 3));
      const pos = this.shoot.geometry.getAttribute('position') as THREE.BufferAttribute;
      pos.setXYZ(0, head.x, head.y, head.z);
      pos.setXYZ(1, tail.x, tail.y, tail.z);
      pos.needsUpdate = true;
      this.shootMat.opacity = Math.sin(Math.min(1, k) * Math.PI);
      if (k >= 1) {
        this.shootT = -1;
        this.shoot.visible = false;
        this.nextShoot = 15 + Math.random() * 25;
      }
    }
  }
}
