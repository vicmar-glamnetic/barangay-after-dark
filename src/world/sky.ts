import * as THREE from 'three';
import type { Quality } from '../core/save';
import { radialTexture } from './textures';

/**
 * Night sky: gradient dome (warm dusk glow at the horizon fading to deep blue),
 * a point-cloud of stars, and a moon with a soft halo. None of it uses fog.
 */
export class Sky {
  readonly group = new THREE.Group();
  private stars: THREE.Points;
  private starMat: THREE.PointsMaterial;

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

    scene.add(this.group);
  }

  /** Keep the dome centered on the camera and gently twinkle the stars. */
  update(cam: THREE.Camera, t: number): void {
    this.group.position.copy(cam.position);
    this.starMat.opacity = 0.85 + Math.sin(t * 1.7) * 0.08;
  }
}
