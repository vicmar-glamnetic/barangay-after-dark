import * as THREE from 'three';
import type { Quality } from '../core/save';

/**
 * Night life that costs one draw call: fireflies drifting over the grass and
 * trees, and moths circling every street lamp. All motion runs in the vertex
 * shader, so the CPU only updates one time uniform per frame.
 */
export class Ambient {
  private points: THREE.Points;
  private mat: THREE.ShaderMaterial;

  constructor(scene: THREE.Scene, lampHeads: THREE.Vector3[], quality: Quality) {
    const fireflyZones: [number, number, number, number, number][] = [
      // [cx, cz, radius, count, height]
      [-25, 23, 6, 16, 2.5], // acacia
      [-2.5, 25, 4.5, 10, 2.2], // mango
      [-17, 15, 7, 12, 1.4], // plaza edge
      [-13.5, -17, 4, 8, 1.2], // sampayan yard
      [24, 11, 5, 10, 1.4], // langit-lupa crates
      [-6, 8, 3, 6, 2.5], // coconut
      [12, 26, 4, 6, 2], // south coconut
      [2, -15, 3, 6, 1.2], // alley plants
    ];
    const scale = quality === 'high' ? 1 : 0.6;
    const base: number[] = [];
    const data: number[] = []; // phase, kind (0 firefly, 1 moth), size, speed
    for (const [cx, cz, r, count, h] of fireflyZones) {
      for (let i = 0; i < Math.round(count * scale); i++) {
        const a = Math.random() * Math.PI * 2, d = Math.sqrt(Math.random()) * r;
        base.push(cx + Math.cos(a) * d, 0.4 + Math.random() * h, cz + Math.sin(a) * d);
        data.push(Math.random() * 100, 0, 0.9 + Math.random() * 0.6, 0.6 + Math.random() * 0.8);
      }
    }
    for (const lh of lampHeads) {
      for (let i = 0; i < Math.round(6 * scale); i++) {
        base.push(lh.x, lh.y - 0.25, lh.z);
        data.push(Math.random() * 100, 1, 0.5 + Math.random() * 0.3, 0.8 + Math.random() * 0.8);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(base, 3));
    g.setAttribute('data', new THREE.Float32BufferAttribute(data, 4));
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 2, 0), 60);

    this.mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: {
        time: { value: 0 },
        pixelRatio: { value: 1 },
      },
      vertexShader: /* glsl */ `
        attribute vec4 data;
        uniform float time;
        uniform float pixelRatio;
        varying float vGlow;
        varying float vKind;
        void main() {
          float ph = data.x;
          float kind = data.y;
          float sp = data.w;
          vec3 p = position;
          if (kind < 0.5) {
            // firefly: lazy wandering + slow blink
            float t = time * 0.35 * sp + ph;
            p += vec3(sin(t) * 1.3 + sin(t * 2.3) * 0.3, sin(t * 0.7 + ph) * 0.45, cos(t * 0.9) * 1.3);
            float blink = sin(time * (0.8 + sp) + ph * 3.0);
            vGlow = smoothstep(-0.2, 0.9, blink) * 0.9 + 0.1;
          } else {
            // moth: erratic orbit around the lamp head
            float t = time * 3.2 * sp + ph;
            p += vec3(cos(t) * 0.45 + sin(t * 2.7) * 0.12, sin(t * 1.9) * 0.18, sin(t * 1.1) * 0.45);
            vGlow = 0.55;
          }
          vKind = kind;
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          gl_Position = projectionMatrix * mv;
          float fade = smoothstep(45.0, 18.0, -mv.z);
          vGlow *= fade;
          gl_PointSize = min(40.0 * pixelRatio, data.z * (kind < 0.5 ? 85.0 : 22.0) * pixelRatio / max(1.5, -mv.z));
        }`,
      fragmentShader: /* glsl */ `
        varying float vGlow;
        varying float vKind;
        void main() {
          vec2 c = gl_PointCoord - 0.5;
          float d = length(c);
          // bright pinpoint + soft halo
          float core = smoothstep(0.12, 0.0, d) + smoothstep(0.5, 0.0, d) * 0.35;
          vec3 col = vKind < 0.5 ? vec3(0.8, 1.0, 0.35) * 2.2 : vec3(1.0, 0.88, 0.65) * 1.2;
          gl_FragColor = vec4(col * core * vGlow, core * vGlow);
        }`,
    });
    this.points = new THREE.Points(g, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 4;
    scene.add(this.points);
  }

  setVisible(v: boolean): void {
    this.points.visible = v;
  }

  update(t: number, pixelRatio: number): void {
    this.mat.uniforms.time.value = t;
    this.mat.uniforms.pixelRatio.value = pixelRatio;
  }
}
