// Partículas de explosão (lógica pura, testada): fogo que sobe e cresce, fumaça que fica no
// ar, brasas que voam e caem. Arrays planos num pool fixo, em anel (a mais velha é a próxima a
// ser reusada): nada aloca por quadro.
export function createParticles(n, { gravity = 0, buoyancy = 0, drag = 0 } = {}) {
  const p = {
    n,
    count: 0, // até onde o pool já foi usado
    pos: new Float32Array(n * 3),
    vel: new Float32Array(n * 3),
    age: new Float32Array(n).fill(Infinity),
    life: new Float32Array(n).fill(1),
    size0: new Float32Array(n),
    size1: new Float32Array(n),
    seed: new Float32Array(n),
  };
  let next = 0;

  // Nasce em (x, y, z) com velocidade (vx, vy, vz), vive `life` s e cresce de s0 a s1 m.
  p.spawn = (x, y, z, vx, vy, vz, life, s0, s1) => {
    const i = next;
    next = (next + 1) % n;
    const o = i * 3;
    p.pos[o] = x;
    p.pos[o + 1] = y;
    p.pos[o + 2] = z;
    p.vel[o] = vx;
    p.vel[o + 1] = vy;
    p.vel[o + 2] = vz;
    p.age[i] = 0;
    p.life[i] = life;
    p.size0[i] = s0;
    p.size1[i] = s1;
    p.seed[i] = Math.random();
    p.count = Math.max(p.count, i + 1);
    return i;
  };

  p.step = (dt) => {
    const k = Math.exp(-dt * drag);
    const up = (buoyancy - gravity) * dt;
    for (let i = 0; i < p.count; i++) {
      if (p.age[i] >= p.life[i]) continue;
      p.age[i] += dt;
      const o = i * 3;
      p.vel[o] *= k;
      p.vel[o + 1] = p.vel[o + 1] * k + up;
      p.vel[o + 2] *= k;
      p.pos[o] += p.vel[o] * dt;
      p.pos[o + 1] += p.vel[o + 1] * dt;
      p.pos[o + 2] += p.vel[o + 2] * dt;
    }
  };

  // Fração da vida (negativa enquanto espera para aparecer, 0 ao nascer, 1 morta) e o tamanho
  // nela: cresce rápido no começo.
  p.t = (i) => Math.min(1, p.age[i] / p.life[i]);
  p.size = (i) => p.size0[i] + (p.size1[i] - p.size0[i]) * Math.sqrt(Math.max(0, p.t(i)));
  return p;
}

// Quanto de cada coisa uma explosão de força `power` (0 a 1) solta, e o tamanho da bola de fogo.
export const BLAST = { fire: [26, 72], smoke: [22, 70], embers: [20, 80], radius: [7, 26], flash: 6000 };
const lerp = ([a, b], k) => a + (b - a) * k;
export function blastSize(power) {
  const k = Math.min(1, Math.max(0, power));
  return {
    fire: Math.round(lerp(BLAST.fire, k)),
    smoke: Math.round(lerp(BLAST.smoke, k)),
    embers: Math.round(lerp(BLAST.embers, k)),
    radius: lerp(BLAST.radius, k),
    flash: BLAST.flash * (0.3 + 0.7 * k),
  };
}
