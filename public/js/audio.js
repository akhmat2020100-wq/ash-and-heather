/* Пепел и Вереск — синтезированный звук без внешних файлов */

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.musicGain = null;
    this.sfxGain = null;
    this.noiseBuf = null;
    this.musicVol = 0.55;
    this.sfxVol = 0.75;
    this.unlocked = false;
    this.bellTimer = 12;
    this.started = false;
    this.lastShotAt = -1;
    this.voices = 0;
  }

  unlock() {
    if (this.unlocked) {
      if (this.ctx?.state === "suspended") this.ctx.resume().catch(() => {});
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    try {
      this.ctx = new AC();
      const ctx = this.ctx;
      this.master = ctx.createGain();
      this.master.gain.value = 0.85;
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -16;
      comp.knee.value = 18;
      comp.ratio.value = 4;
      comp.attack.value = 0.005;
      comp.release.value = 0.25;
      this.master.connect(comp);
      comp.connect(ctx.destination);
      this.musicGain = ctx.createGain();
      this.musicGain.gain.value = this.musicVol;
      this.musicGain.connect(this.master);
      this.sfxGain = ctx.createGain();
      this.sfxGain.gain.value = this.sfxVol;
      this.sfxGain.connect(this.master);
      this.noiseBuf = this.makeNoise(ctx, 2.5);
      this.unlocked = true;
      this.startAmbience();
      if (ctx.state === "suspended") ctx.resume().catch(() => {});
    } catch {
      this.unlocked = false;
    }
  }

  makeNoise(ctx, seconds) {
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) {
      const white = Math.random() * 2 - 1;
      last = (last + 0.02 * white) / 1.02;
      data[i] = last * 3.2;
    }
    return buf;
  }

  startAmbience() {
    if (!this.unlocked || this.started) return;
    this.started = true;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    // wind
    const wind = ctx.createBufferSource();
    wind.buffer = this.noiseBuf;
    wind.loop = true;
    const windFilter = ctx.createBiquadFilter();
    windFilter.type = "lowpass";
    windFilter.frequency.value = 420;
    windFilter.Q.value = 0.8;
    const windGain = ctx.createGain();
    windGain.gain.value = 0.055;
    wind.connect(windFilter);
    windFilter.connect(windGain);
    windGain.connect(this.musicGain);
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.045;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 180;
    lfo.connect(lfoGain);
    lfoGain.connect(windFilter.frequency);
    wind.start(now);
    lfo.start(now);

    // low drone
    const droneGain = ctx.createGain();
    droneGain.gain.value = 0.022;
    const droneFilter = ctx.createBiquadFilter();
    droneFilter.type = "lowpass";
    droneFilter.frequency.value = 260;
    droneGain.connect(droneFilter);
    droneFilter.connect(this.musicGain);
    for (const [freq, detune, gain] of [[55, 0, 0.5], [82.4, 4, 0.3], [110, -3, 0.18], [164.8, 7, 0.07]]) {
      const o = ctx.createOscillator();
      o.type = "sine";
      o.frequency.value = freq;
      o.detune.value = detune;
      const g = ctx.createGain();
      g.gain.value = gain;
      o.connect(g);
      g.connect(droneGain);
      o.start(now);
    }
    const breath = ctx.createOscillator();
    breath.frequency.value = 0.06;
    const breathGain = ctx.createGain();
    breathGain.gain.value = 0.008;
    breath.connect(breathGain);
    breathGain.connect(droneGain.gain);
    breath.start(now);

    this.windGain = windGain;
    this.droneGain = droneGain;
  }

  setMusic(v) {
    this.musicVol = Math.max(0, Math.min(1, v));
    if (this.musicGain) this.musicGain.gain.setTargetAtTime(this.musicVol, this.ctx.currentTime, 0.15);
  }

  setSfx(v) {
    this.sfxVol = Math.max(0, Math.min(1, v));
    if (this.sfxGain) this.sfxGain.gain.setTargetAtTime(this.sfxVol, this.ctx.currentTime, 0.1);
  }

  tone({ freq = 220, to = null, type = "sine", dur = 0.3, gain = 0.15, delay = 0, attack = 0.005, dest = null }) {
    if (!this.unlocked || this.voices > 32) return;
    this.voices++;
    const ctx = this.ctx;
    const t = ctx.currentTime + delay;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(Math.max(20, freq), t);
    if (to) o.frequency.exponentialRampToValueAtTime(Math.max(20, to), t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g);
    g.connect(dest || this.sfxGain);
    o.onended = () => { this.voices = Math.max(0, this.voices - 1); };
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  noise({ dur = 0.2, gain = 0.15, freq = 900, q = 1, type = "bandpass", delay = 0, sweepTo = null }) {
    if (!this.unlocked || this.voices > 32) return;
    this.voices++;
    const ctx = this.ctx;
    const t = ctx.currentTime + delay;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(freq, t);
    if (sweepTo) f.frequency.exponentialRampToValueAtTime(Math.max(60, sweepTo), t + dur);
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f);
    f.connect(g);
    g.connect(this.sfxGain);
    src.onended = () => { this.voices = Math.max(0, this.voices - 1); };
    src.start(t);
    src.stop(t + dur + 0.05);
  }

  update(dt) {
    if (!this.unlocked || this.musicVol <= 0.01) return;
    this.bellTimer -= dt;
    if (this.bellTimer <= 0) {
      this.bellTimer = 28 + Math.random() * 38;
      this.bell();
    }
  }

  bell() {
    if (!this.unlocked) return;
    const base = 196 * (Math.random() < 0.5 ? 1 : 1.5);
    this.tone({ freq: base, type: "sine", dur: 5.5, gain: 0.028, attack: 0.02, dest: this.musicGain });
    this.tone({ freq: base * 2.01, type: "sine", dur: 4, gain: 0.012, attack: 0.02, delay: 0.03, dest: this.musicGain });
    this.tone({ freq: base * 2.98, type: "sine", dur: 2.6, gain: 0.006, attack: 0.02, delay: 0.06, dest: this.musicGain });
  }

  play(name, opts = {}) {
    if (!this.unlocked) return;
    if (name === "shoot") {
      const now = this.ctx?.currentTime || 0;
      if (now - this.lastShotAt < 0.055) return;
      this.lastShotAt = now;
    }
    switch (name) {
      case "ui":
        this.tone({ freq: 520, to: 430, type: "triangle", dur: 0.1, gain: 0.06 });
        break;
      case "dialogue":
        this.tone({ freq: 330 + Math.random() * 40, type: "triangle", dur: 0.08, gain: 0.04 });
        break;
      case "choice":
        this.tone({ freq: 440, to: 560, type: "triangle", dur: 0.16, gain: 0.07 });
        break;
      case "slash":
        this.noise({ dur: 0.16, gain: 0.16, freq: 1800, q: 0.8, sweepTo: 500 });
        this.tone({ freq: 160, to: 90, type: "sawtooth", dur: 0.12, gain: 0.05 });
        break;
      case "shoot":
        this.tone({ freq: 900, to: 380, type: "triangle", dur: 0.14, gain: 0.08 });
        this.noise({ dur: 0.1, gain: 0.05, freq: 2400, q: 1.4 });
        break;
      case "hit":
        this.noise({ dur: 0.09, gain: 0.1, freq: 700, q: 1 });
        this.tone({ freq: 190, to: 120, type: "square", dur: 0.08, gain: 0.045 });
        break;
      case "hurt":
        this.tone({ freq: 150, to: 70, type: "sawtooth", dur: 0.26, gain: 0.11 });
        this.noise({ dur: 0.16, gain: 0.08, freq: 500, q: 0.7 });
        break;
      case "dodge":
        this.noise({ dur: 0.22, gain: 0.1, freq: 900, q: 1.2, sweepTo: 2600, type: "highpass" });
        break;
      case "ability":
        this.tone({ freq: 523, to: 1046, type: "sine", dur: 0.5, gain: 0.09 });
        this.tone({ freq: 784, to: 1568, type: "sine", dur: 0.6, gain: 0.05, delay: 0.05 });
        this.noise({ dur: 0.4, gain: 0.05, freq: 1600, q: 0.9 });
        break;
      case "pierce":
        this.tone({ freq: 1200, to: 300, type: "sawtooth", dur: 0.28, gain: 0.06 });
        this.noise({ dur: 0.22, gain: 0.08, freq: 2200, q: 2, sweepTo: 700 });
        break;
      case "cone":
        this.noise({ dur: 0.3, gain: 0.18, freq: 1000, q: 0.6, sweepTo: 300 });
        this.tone({ freq: 110, to: 55, type: "sawtooth", dur: 0.32, gain: 0.1 });
        break;
      case "nova":
        this.tone({ freq: 660, to: 1320, type: "sine", dur: 0.55, gain: 0.09 });
        this.tone({ freq: 990, to: 1980, type: "sine", dur: 0.5, gain: 0.05, delay: 0.03 });
        break;
      case "ember":
        this.tone({ freq: 392, type: "sine", dur: 1.6, gain: 0.08 });
        this.tone({ freq: 587, type: "sine", dur: 1.8, gain: 0.055, delay: 0.08 });
        this.tone({ freq: 784, type: "sine", dur: 2.1, gain: 0.035, delay: 0.16 });
        break;
      case "memory":
        this.tone({ freq: 880, to: 1174, type: "sine", dur: 0.9, gain: 0.055 });
        break;
      case "pickup":
        this.tone({ freq: 660, to: 880, type: "triangle", dur: 0.16, gain: 0.07 });
        break;
      case "shard":
        this.tone({ freq: 1180, to: 1560, type: "triangle", dur: 0.12, gain: 0.035 });
        this.tone({ freq: 790, to: 1040, type: "sine", dur: 0.17, gain: 0.03, delay: 0.02 });
        break;
      case "upgrade":
        this.tone({ freq: 330, to: 660, type: "sine", dur: 0.45, gain: 0.07 });
        this.tone({ freq: 495, to: 990, type: "sine", dur: 0.5, gain: 0.04, delay: 0.06 });
        this.noise({ dur: 0.18, gain: 0.04, freq: 1800, q: 1.6 });
        break;
      case "marker":
        this.tone({ freq: 880, to: 1320, type: "triangle", dur: 0.14, gain: 0.045 });
        break;
      case "map":
        this.tone({ freq: 420, to: 280, type: "triangle", dur: 0.14, gain: 0.05 });
        break;
      case "herb":
        this.noise({ dur: 0.12, gain: 0.04, freq: 2600, q: 1.2 });
        this.tone({ freq: 660, to: 990, type: "sine", dur: 0.18, gain: 0.04 });
        break;
      case "beacon":
        this.tone({ freq: 196, to: 392, type: "sine", dur: 0.8, gain: 0.08 });
        this.tone({ freq: 392, to: 784, type: "sine", dur: 0.9, gain: 0.04, delay: 0.08 });
        this.noise({ dur: 0.5, gain: 0.05, freq: 700, q: 0.9, sweepTo: 1400 });
        break;
      case "levelUp":
        for (let i = 0; i < 3; i++) {
          this.tone({ freq: 392 * Math.pow(1.25, i), type: "sine", dur: 1.2, gain: 0.06, delay: i * 0.11 });
        }
        break;
      case "bossIntro":
        this.tone({ freq: 55, to: 41, type: "sine", dur: 3.4, gain: 0.16, attack: 0.4 });
        this.tone({ freq: 220, to: 196, type: "sine", dur: 3, gain: 0.04, attack: 0.6 });
        this.noise({ dur: 2.6, gain: 0.05, freq: 300, q: 0.6 });
        break;
      case "bossSlam":
        this.tone({ freq: 90, to: 28, type: "sine", dur: 0.7, gain: 0.2 });
        this.noise({ dur: 0.5, gain: 0.16, freq: 300, q: 0.5, sweepTo: 80 });
        break;
      case "bossTears":
        for (let i = 0; i < 5; i++) {
          this.tone({ freq: 1400 - i * 120, to: 500, type: "sine", dur: 0.5, gain: 0.03, delay: i * 0.04 });
        }
        break;
      case "bossPhase":
        this.tone({ freq: 110, to: 220, type: "sawtooth", dur: 1.2, gain: 0.07 });
        this.noise({ dur: 1.1, gain: 0.07, freq: 700, q: 0.7, sweepTo: 180 });
        break;
      case "down":
        this.tone({ freq: 220, to: 60, type: "sawtooth", dur: 1.4, gain: 0.12 });
        break;
      case "revive":
        this.tone({ freq: 220, to: 440, type: "sine", dur: 1.3, gain: 0.09 });
        this.tone({ freq: 330, to: 660, type: "sine", dur: 1.2, gain: 0.05, delay: 0.1 });
        break;
      case "rest":
        this.tone({ freq: 196, type: "sine", dur: 2.6, gain: 0.07 });
        this.tone({ freq: 294, type: "sine", dur: 2.4, gain: 0.04, delay: 0.12 });
        break;
      case "whisper":
        this.noise({ dur: 1.8, gain: 0.035, freq: 800, q: 2.2, type: "bandpass", sweepTo: 400 });
        break;
      case "ending":
        this.tone({ freq: 261, type: "sine", dur: 4.5, gain: 0.08 });
        this.tone({ freq: 392, type: "sine", dur: 4.2, gain: 0.05, delay: 0.2 });
        this.tone({ freq: 523, type: "sine", dur: 3.8, gain: 0.04, delay: 0.4 });
        break;
      case "chime":
        this.tone({ freq: 1046, type: "sine", dur: 1.4, gain: 0.035 });
        break;
      default:
        break;
    }
  }
}
