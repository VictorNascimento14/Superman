import { windFor, cityFor } from './curves.js';

// Áudio 100% sintetizado (WebAudio): ruído filtrado, osciladores e envelopes.
// O AudioContext só pode nascer de gesto do usuário — `start()` é chamado no clique.
export function createAudio() {
  let ctx = null;
  let master;
  let wind;
  let city;
  let heat;
  let muted = false;
  let noiseBuf;

  function noise(seconds = 2) {
    const b = ctx.createBuffer(1, ctx.sampleRate * seconds, ctx.sampleRate);
    const d = b.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return b;
  }

  function loopNoise(filterType, freq) {
    const src = ctx.createBufferSource();
    src.buffer = noiseBuf;
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = filterType;
    f.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.value = 0;
    src.connect(f).connect(g).connect(master);
    src.start();
    return { f, g };
  }

  // Envelope curto: ataque rápido, queda exponencial.
  function env(g, peak, attack, decay) {
    const t = ctx.currentTime;
    g.gain.cancelScheduledValues(t);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
  }

  function burst({ lp = 800, sweepTo = 80, peak = 0.8, decay = 1, thump = 0 }) {
    if (!ctx) return;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = noiseBuf;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(lp, t);
    f.frequency.exponentialRampToValueAtTime(sweepTo, t + decay);
    const g = ctx.createGain();
    src.connect(f).connect(g).connect(master);
    env(g, peak, 0.01, decay);
    src.start(t);
    src.stop(t + decay + 0.1);
    if (thump) {
      const o = ctx.createOscillator();
      o.frequency.setValueAtTime(thump, t);
      o.frequency.exponentialRampToValueAtTime(30, t + 0.6);
      const og = ctx.createGain();
      o.connect(og).connect(master);
      env(og, peak * 0.9, 0.01, 0.7);
      o.start(t);
      o.stop(t + 0.8);
    }
  }

  function tones(freqs, { type = 'sine', step = 0.09, length = 0.35, peak = 0.18 } = {}) {
    if (!ctx) return;
    freqs.forEach((fr, i) => {
      const t = ctx.currentTime + i * step;
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.value = fr;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(peak, t + 0.015);
      g.gain.exponentialRampToValueAtTime(0.0001, t + length);
      o.connect(g).connect(master);
      o.start(t);
      o.stop(t + length + 0.05);
    });
  }

  function start() {
    if (ctx) return ctx.resume();
    ctx = new AudioContext();
    master = ctx.createGain();
    master.gain.value = muted ? 0 : 0.8;
    // Compressor no fim: explosão e estrondo juntos não estouram o alto-falante.
    const comp = ctx.createDynamicsCompressor();
    master.connect(comp).connect(ctx.destination);
    noiseBuf = noise();
    wind = loopNoise('bandpass', 300);
    city = loopNoise('lowpass', 380);
    // Visão de calor: duas serras desafinadas num passa-baixa + chiado agudo.
    heat = { g: ctx.createGain(), sizzle: loopNoise('highpass', 4000) };
    heat.g.gain.value = 0;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 900;
    for (const fr of [110, 113.5, 220]) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = fr;
      o.connect(lp);
      o.start();
    }
    lp.connect(heat.g).connect(master);
    return ctx.resume();
  }

  const smooth = (param, v, tc = 0.08) => param.setTargetAtTime(v, ctx.currentTime, tc);

  return {
    start,
    // Pausa: com a aba em segundo plano o loop para e o som ficaria tocando no último ganho.
    suspend: () => ctx?.suspend(),
    // Depuração: mede o nível de saída (RMS) numa janela curta.
    probe(ms = 400) {
      if (!ctx) return Promise.resolve(null);
      const an = ctx.createAnalyser();
      master.connect(an);
      const buf = new Float32Array(an.fftSize);
      return new Promise((r) => setTimeout(() => {
        an.getFloatTimeDomainData(buf);
        master.disconnect(an);
        r({ state: ctx.state, rms: Math.sqrt(buf.reduce((s, v) => s + v * v, 0) / buf.length) });
      }, ms));
    },
    toggleMute() {
      muted = !muted;
      if (ctx) smooth(master.gain, muted ? 0 : 0.8, 0.05);
      return muted;
    },
    // Por quadro: vento pela velocidade, cidade pela altura, calor se disparando.
    update(speed, heightAboveGround, firing, hitting) {
      if (!ctx) return;
      const w = windFor(speed);
      smooth(wind.g.gain, w.gain);
      smooth(wind.f.frequency, w.freq);
      wind.f.Q.value = w.q;
      smooth(city.g.gain, cityFor(heightAboveGround).gain, 0.3);
      smooth(heat.g.gain, firing ? 0.07 : 0, 0.03);
      smooth(heat.sizzle.g.gain, firing && hitting ? 0.06 : 0, 0.03);
    },
    sonicBoom: () => burst({ lp: 1400, sweepTo: 60, peak: 0.9, decay: 1.4, thump: 70 }),
    impact: (k) => burst({ lp: 600, sweepTo: 60, peak: 0.3 + 0.5 * k, decay: 0.5, thump: 55 }),
    explosion: () => burst({ lp: 1200, sweepTo: 100, peak: 0.7, decay: 0.9, thump: 60 }),
    // Parede cedendo: estalo seco na entrada, estrondo mais longo e grave na saída (entulho).
    breach: (k, entry) => burst({ lp: entry ? 2600 : 1800, sweepTo: 120, peak: 0.35 + 0.5 * k, decay: entry ? 0.6 : 1.1, thump: entry ? 60 : 45 }),
    takeoff: () => burst({ lp: 2400, sweepTo: 300, peak: 0.2, decay: 0.5 }),
    ring: () => tones([880, 1320], { step: 0.06, length: 0.4 }),
    success: () => tones([523, 659, 784, 1047], { type: 'triangle', step: 0.11, length: 0.5, peak: 0.2 }),
    fail: () => tones([392, 330, 262], { type: 'triangle', step: 0.16, length: 0.45, peak: 0.16 }),
    alert: () => tones([740, 988, 740, 988], { type: 'square', step: 0.12, length: 0.1, peak: 0.06 }),
  };
}
