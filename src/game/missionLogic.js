import { HALF } from '../world/layout.js';

// Lógica pura das missões (testada). Pontos são objetos {x, y, z}.

// Atravessou o anel entre p0 e p1? Testa a troca de lado do plano e o raio no ponto de
// cruzamento — funciona a 400 m/s, quando o herói pula 7 m por quadro e nunca "está" no anel.
export function ringCrossed(p0, p1, ring) {
  const n = ring.normal;
  const d0 = (p0.x - ring.x) * n.x + (p0.y - ring.y) * n.y + (p0.z - ring.z) * n.z;
  const d1 = (p1.x - ring.x) * n.x + (p1.y - ring.y) * n.y + (p1.z - ring.z) * n.z;
  if (d0 === d1 || Math.sign(d0) === Math.sign(d1)) return false;
  const t = d0 / (d0 - d1);
  const x = p0.x + (p1.x - p0.x) * t - ring.x;
  const y = p0.y + (p1.y - p0.y) * t - ring.y;
  const z = p0.z + (p1.z - p0.z) * t - ring.z;
  return x * x + y * y + z * z <= ring.radius * ring.radius;
}

// Percurso de anéis: cada um 170–260 m depois do anterior, curvas de até ±45°, sempre
// acima dos telhados com folga e dentro da ilha. A normal aponta para o próximo anel.
export function makeRingCourse(rng, start, yaw, collision, count = 8, radius = 10) {
  const rings = [];
  let x = start.x;
  let z = start.z;
  let h = yaw;
  for (let i = 0; i < count; i++) {
    let placed = null;
    for (let attempt = 0; attempt < 40 && !placed; attempt++) {
      const turn = rng.range(-0.8, 0.8) * (attempt < 20 ? 1 : 2);
      const dist = rng.range(170, 260);
      const hh = h + turn;
      let nx = x + Math.sin(hh) * dist;
      let nz = z + Math.cos(hh) * dist;
      if (Math.abs(nx) > HALF - 60 || Math.abs(nz) > HALF - 60) continue;
      // Maior telhado num raio em volta do anel: o anel inteiro tem que caber acima.
      let roof = 0;
      for (const [ox, oz] of [[0, 0], [radius, 0], [-radius, 0], [0, radius], [0, -radius]]) roof = Math.max(roof, collision.heightAt(nx + ox, nz + oz));
      const y = roof + radius + rng.range(12, 60);
      placed = { x: nx, y, z: nz, radius };
      h = hh;
      x = nx;
      z = nz;
    }
    if (!placed) break;
    rings.push(placed);
  }
  for (let i = 0; i < rings.length; i++) {
    const a = rings[i];
    const b = rings[i + 1] ?? { x: a.x + (a.x - (rings[i - 1]?.x ?? start.x)), y: a.y, z: a.z + (a.z - (rings[i - 1]?.z ?? start.z)) };
    const prev = i === 0 ? start : rings[i - 1];
    // Normal = direção de chegada (de onde o herói vem), suavizada com a de saída.
    let nx = b.x - prev.x;
    let ny = (b.y - prev.y) * 0.5;
    let nz = b.z - prev.z;
    const l = Math.hypot(nx, ny, nz) || 1;
    a.normal = { x: nx / l, y: ny / l, z: nz / l };
  }
  return rings;
}

// Pessoa em queda: gravidade com arrasto quadrático (terminal ~55 m/s).
export const FALL = { g: 9.8, terminal: 55, catchRadius: 4.5 };
export function stepFaller(f, dt) {
  if (f.state !== 'falling') return f;
  const k = FALL.g / (FALL.terminal * FALL.terminal);
  f.vy += (-FALL.g + k * f.vy * f.vy) * dt;
  f.y += f.vy * dt;
  if (f.y <= f.ground + 0.9) {
    f.y = f.ground + 0.9;
    f.state = 'lost';
  }
  return f;
}

export function tryCatch(f, heroPos) {
  if (f.state !== 'falling' && f.state !== 'waiting') return false;
  const d = Math.hypot(f.x - heroPos.x, f.y - heroPos.y, f.z - heroPos.z);
  if (d > FALL.catchRadius) return false;
  f.state = 'caught';
  return true;
}

// Drone: vida 1, visão de calor tira DRONE.burn por segundo.
export const DRONE = { burn: 0.8, radius: 2.2 };
export function burnDrone(d, dt) {
  if (d.hp <= 0) return false;
  d.hp = Math.max(0, d.hp - DRONE.burn * dt);
  return d.hp === 0; // true no quadro em que morre
}
