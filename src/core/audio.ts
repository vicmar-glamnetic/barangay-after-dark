import * as THREE from 'three';

/**
 * Procedural audio via the Web Audio API. No audio files are loaded.
 *
 * Ambience: crickets (looped synthesized buffer), a far dog, a tricycle that
 * drives past, and faint videoke from one house (positional).
 * SFX: short synthesized one-shots, optionally positional.
 *
 * iOS only allows audio after a user gesture, so nothing is created until
 * unlock() is called from the first tap/click.
 */
export type Sfx =
  | 'throw' | 'clang' | 'slap' | 'kick' | 'whiff' | 'pickup' | 'tag' | 'win' | 'lose'
  | 'tick' | 'step' | 'giggle' | 'cheer' | 'ui' | 'thud' | 'perfect' | 'honk' | 'rattle' | 'swing' | 'smash' | 'marble';

const _v = new THREE.Vector3();
const _f = new THREE.Vector3();

export class AudioSys {
  ctx: AudioContext | null = null;
  private master!: GainNode;
  private amb!: GainNode;
  private sfx!: GainNode;
  private noise!: AudioBuffer;
  private volume = 0.8;
  private timers: number[] = [];
  private videokePos = new THREE.Vector3(23, 2, -12);

  setVolume(v: number): void {
    this.volume = v;
    if (this.ctx) this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.05);
  }

  /** Call from a user gesture (tap/click). Safe to call repeatedly. */
  unlock(): void {
    if (this.ctx) {
      if (this.ctx.state !== 'running') this.ctx.resume().catch(() => {});
      return;
    }
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    try {
      this.ctx = new AC();
    } catch {
      return;
    }
    const ctx = this.ctx;
    this.master = ctx.createGain();
    this.master.gain.value = this.volume;
    this.master.connect(ctx.destination);
    this.amb = ctx.createGain();
    this.amb.gain.value = 0.9;
    this.amb.connect(this.master);
    this.sfx = ctx.createGain();
    this.sfx.gain.value = 1;
    this.sfx.connect(this.master);

    // iOS unlock: play one silent buffer inside the gesture.
    const silent = ctx.createBufferSource();
    silent.buffer = ctx.createBuffer(1, 1, 22050);
    silent.connect(ctx.destination);
    silent.start(0);
    ctx.resume().catch(() => {});

    this.noise = this.makeNoise(2);
    this.startAmbience();
  }

  suspend(): void {
    this.ctx?.suspend().catch(() => {});
  }
  resume(): void {
    this.ctx?.resume().catch(() => {});
  }

  private get live(): boolean {
    return !!this.ctx && this.ctx.state === 'running';
  }

  /** Keep the Web Audio listener glued to the camera. */
  updateListener(cam: THREE.Camera): void {
    if (!this.ctx) return;
    const l = this.ctx.listener;
    cam.getWorldPosition(_v);
    cam.getWorldDirection(_f);
    if (l.positionX) {
      l.positionX.value = _v.x;
      l.positionY.value = _v.y;
      l.positionZ.value = _v.z;
      l.forwardX.value = _f.x;
      l.forwardY.value = _f.y;
      l.forwardZ.value = _f.z;
      l.upX.value = 0;
      l.upY.value = 1;
      l.upZ.value = 0;
    } else {
      l.setPosition(_v.x, _v.y, _v.z);
      l.setOrientation(_f.x, _f.y, _f.z, 0, 1, 0);
    }
  }

  // ------------------------------------------------------------------ helpers

  private makeNoise(seconds: number): AudioBuffer {
    const ctx = this.ctx!;
    const buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * seconds), ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  private panner(pos: THREE.Vector3, ref = 3, rolloff = 1.1): PannerNode {
    const p = this.ctx!.createPanner();
    p.panningModel = 'equalpower';
    p.distanceModel = 'inverse';
    p.refDistance = ref;
    p.maxDistance = 80;
    p.rolloffFactor = rolloff;
    if (p.positionX) {
      p.positionX.value = pos.x;
      p.positionY.value = pos.y;
      p.positionZ.value = pos.z;
    } else p.setPosition(pos.x, pos.y, pos.z);
    return p;
  }

  /** Exponential attack/decay envelope on a gain node. */
  private env(g: GainNode, t: number, attack: number, peak: number, decay: number): void {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
  }

  private tone(type: OscillatorType, f0: number, f1: number, t: number, dur: number, peak: number, dest: AudioNode, attack = 0.005): OscillatorNode {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
    const g = ctx.createGain();
    this.env(g, t, attack, peak, dur);
    o.connect(g).connect(dest);
    o.start(t);
    o.stop(t + attack + dur + 0.05);
    return o;
  }

  private burst(t: number, dur: number, type: BiquadFilterType, f0: number, f1: number, q: number, peak: number, dest: AudioNode, attack = 0.004): void {
    const ctx = this.ctx!;
    const s = ctx.createBufferSource();
    s.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.Q.value = q;
    f.frequency.setValueAtTime(f0, t);
    if (f1 !== f0) f.frequency.exponentialRampToValueAtTime(f1, t + dur);
    const g = ctx.createGain();
    this.env(g, t, attack, peak, dur);
    s.connect(f).connect(g).connect(dest);
    s.start(t, Math.random() * 1.5);
    s.stop(t + attack + dur + 0.05);
  }

  // --------------------------------------------------------------------- SFX

  play(name: Sfx, opts: { pos?: THREE.Vector3; vol?: number } = {}): void {
    if (!this.live) return;
    const ctx = this.ctx!;
    const t = ctx.currentTime + 0.005;
    const vol = opts.vol ?? 1;
    const out = ctx.createGain();
    out.gain.value = vol;
    if (opts.pos) out.connect(this.panner(opts.pos)).connect(this.sfx);
    else out.connect(this.sfx);
    const r = Math.random;

    switch (name) {
      case 'throw':
        this.burst(t, 0.22, 'bandpass', 500, 2600, 1.4, 0.5, out, 0.03);
        break;
      case 'clang': {
        const base = 420 + r() * 60;
        [1, 2.76, 5.4, 8.93].forEach((m, i) => this.tone('sine', base * m, base * m * 0.995, t, 0.7 / (1 + i * 0.5), 0.28 / (i + 1), out));
        this.burst(t, 0.04, 'highpass', 3000, 3000, 0.7, 0.4, out);
        break;
      }
      case 'slap':
        this.burst(t, 0.07, 'lowpass', 2200, 900, 0.8, 0.55, out, 0.002);
        break;
      case 'kick':
        this.tone('sine', 170, 55, t, 0.11, 0.7, out);
        this.burst(t, 0.035, 'bandpass', 1400, 1400, 2, 0.35, out, 0.002);
        break;
      case 'whiff':
        this.burst(t, 0.16, 'bandpass', 1100, 380, 1.2, 0.18, out, 0.02);
        break;
      case 'pickup':
        this.tone('square', 520, 880, t, 0.08, 0.09, out);
        this.tone('square', 880, 1320, t + 0.08, 0.08, 0.07, out);
        break;
      case 'tag': {
        const o = this.tone('sine', 1900, 1700, t, 0.5, 0.25, out, 0.01);
        const lfo = ctx.createOscillator();
        lfo.frequency.value = 28;
        const lg = ctx.createGain();
        lg.gain.value = 140;
        lfo.connect(lg).connect(o.frequency);
        lfo.start(t);
        lfo.stop(t + 0.6);
        break;
      }
      case 'win':
        [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => this.tone('triangle', f, f, t + i * 0.11, i === 3 ? 0.6 : 0.14, 0.3, out));
        this.tone('triangle', 1318.5, 1318.5, t + 0.44, 0.6, 0.12, out);
        break;
      case 'lose':
        [392, 329.6, 261.6, 196].forEach((f, i) => this.tone('sawtooth', f, f * 0.98, t + i * 0.17, i === 3 ? 0.5 : 0.16, 0.1, out));
        break;
      case 'tick':
        this.tone('sine', 1040, 1040, t, 0.05, 0.18, out);
        break;
      case 'step':
        this.burst(t, 0.08, 'lowpass', 320 + r() * 120, 200, 0.9, 0.22 * (0.7 + r() * 0.5), out, 0.003);
        break;
      case 'giggle':
        for (let i = 0; i < 5; i++) {
          const f = 950 + i * 50 + r() * 120;
          this.tone('sine', f, f * 1.25, t + i * 0.1, 0.06, 0.12, out, 0.008);
        }
        break;
      case 'cheer':
        this.burst(t, 0.7, 'bandpass', 1500, 1900, 0.6, 0.18, out, 0.08);
        for (let i = 0; i < 3; i++) this.tone('triangle', 700 + r() * 500, 1200 + r() * 400, t + i * 0.12 + r() * 0.05, 0.12, 0.05, out);
        break;
      case 'ui':
        this.tone('sine', 720, 900, t, 0.05, 0.12, out);
        break;
      case 'thud':
        this.tone('sine', 95, 40, t, 0.16, 0.5, out);
        this.burst(t, 0.05, 'lowpass', 600, 300, 0.7, 0.3, out);
        break;
      case 'honk':
        // little tricycle horn: two quick nasal beeps
        for (const dt of [0, 0.22]) {
          this.tone('square', 415, 415, t + dt, 0.14, 0.12, out, 0.01);
          this.tone('square', 523, 523, t + dt, 0.14, 0.08, out, 0.01);
        }
        break;
      case 'rattle':
        // candies shaking inside a clay pot
        for (let i = 0; i < 6; i++) this.burst(t + i * 0.045 + r() * 0.02, 0.025, 'bandpass', 2600 + r() * 1500, 2600, 4, 0.22, out, 0.002);
        break;
      case 'swing':
        this.burst(t, 0.28, 'bandpass', 300, 1400, 1.1, 0.45, out, 0.05);
        break;
      case 'smash':
        this.burst(t, 0.35, 'lowpass', 2400, 500, 0.7, 0.8, out, 0.002);
        [180, 260, 410].forEach((f, i) => this.tone('triangle', f, f * 0.7, t + i * 0.02, 0.25, 0.25, out));
        for (let i = 0; i < 10; i++) this.burst(t + 0.15 + r() * 0.5, 0.03, 'bandpass', 3000 + r() * 2000, 3000, 3, 0.12, out, 0.002);
        break;
      case 'marble':
        this.tone('sine', 2400 + r() * 600, 2000, t, 0.06, 0.25, out, 0.001);
        this.tone('sine', 3700 + r() * 500, 3200, t, 0.04, 0.12, out, 0.001);
        break;
      case 'perfect':
        this.tone('sine', 1320, 1320, t, 0.12, 0.14, out);
        this.tone('sine', 1760, 1760, t + 0.07, 0.2, 0.12, out);
        break;
    }
  }

  // ---------------------------------------------------------------- ambience

  private later(ms: number, fn: () => void): void {
    this.timers.push(window.setTimeout(fn, ms));
  }

  private startAmbience(): void {
    this.startCrickets();
    this.later(6000 + Math.random() * 8000, () => this.dogLoop());
    this.later(2500, () => this.startVideoke());
  }

  /** Synthesize a few seconds of chirping and loop it. Two layers for depth. */
  private startCrickets(): void {
    const ctx = this.ctx!;
    const make = (seconds: number, freq: number, rate: number, density: number) => {
      const sr = ctx.sampleRate;
      const buf = ctx.createBuffer(2, Math.floor(sr * seconds), sr);
      const L = buf.getChannelData(0);
      const R = buf.getChannelData(1);
      for (let voice = 0; voice < density; voice++) {
        const pan = Math.random();
        const f = freq * (0.92 + Math.random() * 0.16);
        const gap = rate * (0.8 + Math.random() * 0.5);
        let tt = Math.random() * gap;
        while (tt < seconds - 0.2) {
          const pulses = 2 + Math.floor(Math.random() * 3);
          for (let p = 0; p < pulses; p++) {
            const start = Math.floor((tt + p * 0.028) * sr);
            const len = Math.floor(0.016 * sr);
            for (let i = 0; i < len && start + i < L.length; i++) {
              const e = Math.sin((Math.PI * i) / len);
              const s = Math.sin((2 * Math.PI * f * i) / sr) * e * 0.13;
              L[start + i] += s * (1 - pan);
              R[start + i] += s * pan;
            }
          }
          tt += gap * (0.7 + Math.random() * 0.6);
        }
      }
      return buf;
    };
    const layer = (buf: AudioBuffer, gain: number, cutoff: number) => {
      const s = ctx.createBufferSource();
      s.buffer = buf;
      s.loop = true;
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = cutoff;
      const g = ctx.createGain();
      g.gain.value = gain;
      s.connect(f).connect(g).connect(this.amb);
      s.start();
    };
    layer(make(5.3, 4400, 0.42, 3), 0.55, 9000);
    layer(make(7.1, 3600, 0.7, 4), 0.32, 5000);
  }

  private dogLoop(): void {
    if (this.live) {
      const ctx = this.ctx!;
      const ang = Math.random() * Math.PI * 2;
      const pos = new THREE.Vector3(Math.cos(ang) * 45, 1, Math.sin(ang) * 45);
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 1300;
      const g = ctx.createGain();
      g.gain.value = 2.2;
      lp.connect(g).connect(this.panner(pos, 6, 0.6)).connect(this.amb);
      const barks = 2 + Math.floor(Math.random() * 3);
      let t = ctx.currentTime + 0.05;
      for (let i = 0; i < barks; i++) {
        const f = 380 + Math.random() * 80;
        const bp = ctx.createBiquadFilter();
        bp.type = 'bandpass';
        bp.frequency.value = 850;
        bp.Q.value = 1.6;
        bp.connect(lp);
        this.tone('sawtooth', f, f * 0.55, t, 0.13, 0.5, bp, 0.01);
        this.burst(t, 0.08, 'bandpass', 1100, 700, 1, 0.25, lp, 0.005);
        t += 0.28 + Math.random() * 0.18;
      }
    }
    this.later(15000 + Math.random() * 25000, () => this.dogLoop());
  }

  /**
   * Two-stroke putt-putt of a tricycle driving along the road from x0 to x1
   * (z = laneZ) over `dur` seconds. Called by world/traffic.ts so the sound
   * matches the vehicle you can see.
   */
  passBy(x0: number, x1: number, laneZ: number, dur: number): void {
    if (!this.live) return;
    const ctx = this.ctx!;
    const t = ctx.currentTime + 0.05;
    const p = this.panner(new THREE.Vector3(x0, 0.8, laneZ), 5, 0.9);
    if (p.positionX) {
      p.positionX.setValueAtTime(x0, t);
      p.positionX.linearRampToValueAtTime(x1, t + dur);
    }
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.55, t + 1.0);
    g.gain.setValueAtTime(0.55, t + dur - 1.0);
    g.gain.linearRampToValueAtTime(0.0001, t + dur);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 750;
    const engine = ctx.createOscillator();
    engine.type = 'sawtooth';
    engine.frequency.setValueAtTime(62, t);
    engine.frequency.linearRampToValueAtTime(58, t + dur);
    const am = ctx.createGain();
    am.gain.value = 0.5;
    const putt = ctx.createOscillator();
    putt.type = 'square';
    putt.frequency.value = 17;
    const puttDepth = ctx.createGain();
    puttDepth.gain.value = 0.5;
    putt.connect(puttDepth).connect(am.gain);
    engine.connect(am).connect(lp).connect(g).connect(p).connect(this.amb);
    engine.start(t);
    putt.start(t);
    engine.stop(t + dur + 0.1);
    putt.stop(t + dur + 0.1);
  }

  /**
   * Faint videoke from a house: minus-one backing (bass + organ chords) and a
   * slightly off-key "singer" (formant-filtered sawtooth with vibrato), through
   * a lowpass and an echo. Songs are generated, then a pause, then another.
   */
  private startVideoke(): void {
    const ctx = this.ctx!;
    const bus = ctx.createGain();
    bus.gain.value = 1.6;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 1700;
    const delay = ctx.createDelay(1);
    delay.delayTime.value = 0.27;
    const fb = ctx.createGain();
    fb.gain.value = 0.33;
    bus.connect(lp);
    lp.connect(delay);
    delay.connect(fb).connect(delay);
    const out = this.panner(this.videokePos, 4, 1.0);
    lp.connect(out);
    delay.connect(out);
    out.connect(this.amb);

    const bpm = 88;
    const beat = 60 / bpm;
    const progs = [
      [0, 9, 5, 7],
      [0, 7, 9, 5],
      [5, 7, 4, 9],
    ];
    const root = 196; // G3
    const semi = (n: number) => root * Math.pow(2, n / 12);
    const scale = [0, 2, 4, 7, 9, 12, 14, 16];

    let songStart = ctx.currentTime + 0.5;
    let nextBar = 0;
    let bars = 24;
    let prog = progs[0];
    let detune = 0;

    const scheduleBar = (bar: number, t0: number) => {
      const chord = prog[bar % 4];
      const minor = chord === 9 || chord === 4;
      const triad = [chord, chord + (minor ? 3 : 4), chord + 7];
      // bass on 1 and 3
      for (const b of [0, 2]) this.tone('triangle', semi(chord - 12), semi(chord - 12), t0 + b * beat, beat * 0.9, 0.16, bus, 0.01);
      // organ comp on every beat
      for (let b = 0; b < 4; b++)
        for (const n of triad) this.tone('square', semi(n + 12), semi(n + 12), t0 + b * beat + beat * 0.5, beat * 0.3, 0.012, bus, 0.01);
      // singer: 3 to 5 notes per bar from the scale near chord tones
      const notes = 3 + Math.floor(Math.random() * 3);
      let tt = t0;
      for (let i = 0; i < notes; i++) {
        const len = (4 * beat) / notes;
        const n = scale[Math.floor(Math.random() * scale.length)] + 12 + (Math.random() < 0.5 ? 0 : chord % 5);
        this.voice(semi(n) * Math.pow(2, detune / 1200), tt, len * 0.92, bus);
        tt += len;
      }
    };

    const tick = () => {
      if (this.live) {
        const now = ctx.currentTime;
        while (songStart + nextBar * 4 * beat < now + 0.4) {
          const t0 = songStart + nextBar * 4 * beat;
          if (nextBar < bars) scheduleBar(nextBar, t0);
          nextBar++;
          if (nextBar >= bars + 4) {
            // pause between songs, then a new one with a new progression
            songStart = now + 12 + Math.random() * 15;
            nextBar = 0;
            bars = 16 + 4 * Math.floor(Math.random() * 3);
            prog = progs[Math.floor(Math.random() * progs.length)];
            detune = (Math.random() - 0.5) * 60; // every tito sings a little off
            break;
          }
        }
      } else {
        // While suspended, shift the song forward so notes do not pile up.
        songStart = ctx.currentTime + 1;
        nextBar = 0;
      }
    };
    this.timers.push(window.setInterval(tick, 150));
  }

  private voice(freq: number, t: number, dur: number, dest: AudioNode): void {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(freq * 0.97, t);
    o.frequency.exponentialRampToValueAtTime(freq, t + 0.06);
    const vib = ctx.createOscillator();
    vib.frequency.value = 5.3;
    const vg = ctx.createGain();
    vg.gain.value = freq * 0.012;
    vib.connect(vg).connect(o.frequency);
    const f1 = ctx.createBiquadFilter();
    f1.type = 'bandpass';
    f1.frequency.value = 750;
    f1.Q.value = 5;
    const f2 = ctx.createBiquadFilter();
    f2.type = 'bandpass';
    f2.frequency.value = 1150;
    f2.Q.value = 6;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.22, t + 0.05);
    g.gain.setValueAtTime(0.22, t + dur * 0.7);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(f1).connect(g);
    o.connect(f2).connect(g);
    g.connect(dest);
    o.start(t);
    vib.start(t);
    o.stop(t + dur + 0.05);
    vib.stop(t + dur + 0.05);
  }
}
