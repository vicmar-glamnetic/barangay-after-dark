import * as THREE from 'three';

/**
 * All static light halos (street lamps, store bulb, court floods, parols) in
 * ONE instanced draw call. Each instance is a camera-facing quad built in the
 * vertex shader, so it looks exactly like a Sprite but costs one call total
 * instead of one per light.
 */
export class GlowField {
  private items: { pos: THREE.Vector3; color: THREE.Color; size: number; k: number }[] = [];
  private mesh: THREE.InstancedMesh | null = null;
  private tmp = new THREE.Color();

  constructor(private scene: THREE.Scene, private map: THREE.Texture) {}

  /** Add a glow before build(). Returns its index (for intensity changes). */
  add(pos: THREE.Vector3, color: number, size: number): number {
    this.items.push({ pos: pos.clone(), color: new THREE.Color(color), size, k: 1 });
    return this.items.length - 1;
  }

  build(): void {
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: { map: { value: this.map } },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        varying vec3 vColor;
        void main() {
          vUv = uv;
          vec3 center = (instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
          float scale = length(instanceMatrix[0].xyz);
          vec4 mv = modelViewMatrix * vec4(center, 1.0);
          mv.xy += position.xy * scale; // billboard: offset in view space
          gl_Position = projectionMatrix * mv;
          #ifdef USE_INSTANCING_COLOR
            vColor = instanceColor;
          #else
            vColor = vec3(1.0);
          #endif
        }`,
      fragmentShader: /* glsl */ `
        uniform sampler2D map;
        varying vec2 vUv;
        varying vec3 vColor;
        void main() {
          vec4 t = texture2D(map, vUv);
          gl_FragColor = vec4(t.rgb * vColor, t.a);
          #include <colorspace_fragment>
        }`,
    });
    const mesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), mat, this.items.length);
    const m = new THREE.Matrix4();
    this.items.forEach((it, i) => {
      m.makeScale(it.size, it.size, it.size).setPosition(it.pos);
      mesh.setMatrixAt(i, m);
      mesh.setColorAt(i, it.color);
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.frustumCulled = false;
    mesh.renderOrder = 3;
    this.scene.add(mesh);
    this.mesh = mesh;
  }

  /** Brightness multiplier for one glow (used for the flickering lamp). */
  setIntensity(i: number, k: number): void {
    const it = this.items[i];
    if (!this.mesh || !it || it.k === k) return;
    it.k = k;
    this.mesh.setColorAt(i, this.tmp.copy(it.color).multiplyScalar(k));
    this.mesh.instanceColor!.needsUpdate = true;
  }
}
