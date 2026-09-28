// Entulho: um pool de pedaços com física simples em arrays planos — gravidade, quique com
// atrito, giro e sono quando para. Lógica pura (testada); quem desenha só lê pos/rot/size.
export const DEBRIS = { gravity: 18, bounce: 0.3, friction: 0.55, sleep: 0.8, spinDamp: 0.6 };

export function createDebris(capacity) {
  const pos = new Float32Array(capacity * 3);
  const vel = new Float32Array(capacity * 3);
  const rot = new Float32Array(capacity * 4);
  const spin = new Float32Array(capacity * 3);
  const size = new Float32Array(capacity);
  const awake = new Uint8Array(capacity);
  let next = 0;
  let count = 0;

  // Ocupa a próxima vaga do anel; cheio, recicla o pedaço mais antigo.
  function spawn(x, y, z, vx, vy, vz, s, wx, wy, wz) {
    const i = next;
    next = (next + 1) % capacity;
    if (count < capacity) count++;
    const o = i * 3;
    pos[o] = x; pos[o + 1] = y; pos[o + 2] = z;
    vel[o] = vx; vel[o + 1] = vy; vel[o + 2] = vz;
    spin[o] = wx; spin[o + 1] = wy; spin[o + 2] = wz;
    rot[i * 4] = 0; rot[i * 4 + 1] = 0; rot[i * 4 + 2] = 0; rot[i * 4 + 3] = 1;
    size[i] = s;
    awake[i] = 1;
    return i;
  }

  // groundAt(x, z): altura do chão ou do telhado sob o ponto (collision.heightAt).
  function step(dt, groundAt) {
    for (let i = 0; i < count; i++) {
      if (!awake[i]) continue;
      const o = i * 3;
      const half = size[i] / 2;
      vel[o + 1] -= DEBRIS.gravity * dt;
      let x = pos[o] + vel[o] * dt;
      let y = pos[o + 1] + vel[o + 1] * dt;
      let z = pos[o + 2] + vel[o + 2] * dt;
      const ground = groundAt(x, z);
      if (ground > pos[o + 1] + half) {
        // Chão acima de onde o pedaço *estava* é parede de prédio: volta e rebate na
        // horizontal em vez de subir no telhado. (Comparar com o y novo confundia a queda
        // rápida através do chão com parede.)
        x = pos[o];
        z = pos[o + 2];
        vel[o] *= -DEBRIS.bounce;
        vel[o + 2] *= -DEBRIS.bounce;
      } else if (y - half < ground) {
        y = ground + half;
        if (vel[o + 1] < 0) vel[o + 1] *= -DEBRIS.bounce;
        vel[o] *= DEBRIS.friction;
        vel[o + 2] *= DEBRIS.friction;
        spin[o] *= DEBRIS.spinDamp; spin[o + 1] *= DEBRIS.spinDamp; spin[o + 2] *= DEBRIS.spinDamp;
        if (vel[o] * vel[o] + vel[o + 1] * vel[o + 1] + vel[o + 2] * vel[o + 2] < DEBRIS.sleep * DEBRIS.sleep) {
          awake[i] = 0;
          vel[o] = vel[o + 1] = vel[o + 2] = 0;
        }
      }
      pos[o] = x; pos[o + 1] = y; pos[o + 2] = z;
      // Giro: q += ½·dt·(ω ⊗ q), renormalizado.
      const q = i * 4;
      const qx = rot[q], qy = rot[q + 1], qz = rot[q + 2], qw = rot[q + 3];
      const wx = spin[o] * 0.5 * dt, wy = spin[o + 1] * 0.5 * dt, wz = spin[o + 2] * 0.5 * dt;
      const nx = qx + wx * qw + wy * qz - wz * qy;
      const ny = qy + wy * qw + wz * qx - wx * qz;
      const nz = qz + wz * qw + wx * qy - wy * qx;
      const nw = qw - wx * qx - wy * qy - wz * qz;
      const l = Math.sqrt(nx * nx + ny * ny + nz * nz + nw * nw) || 1;
      rot[q] = nx / l; rot[q + 1] = ny / l; rot[q + 2] = nz / l; rot[q + 3] = nw / l;
    }
  }

  return { pos, rot, size, awake, capacity, spawn, step, get count() { return count; } };
}
