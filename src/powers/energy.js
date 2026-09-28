// Reserva da visão de calor. Lógica pura (testada): drena disparando, recarrega depois
// de uma pausa curta, e não religa até juntar um mínimo — senão vira pisca-pisca no zero.
export const ENERGY = { drain: 0.22, regen: 0.18, regenDelay: 0.8, restart: 0.2 };

export function createEnergy() {
  const e = { value: 1, firing: false, idle: 0, locked: false };
  e.update = (dt, wants) => {
    if (e.locked && e.value >= ENERGY.restart) e.locked = false;
    e.firing = wants && !e.locked && e.value > 0;
    if (e.firing) {
      e.value = Math.max(0, e.value - ENERGY.drain * dt);
      e.idle = 0;
      if (e.value === 0) e.locked = true;
    } else {
      e.idle += dt;
      if (e.idle >= ENERGY.regenDelay) e.value = Math.min(1, e.value + ENERGY.regen * dt);
    }
    return e.firing;
  };
  return e;
}

// Raio contra esfera: distância até a entrada, ou -1. `dir` unitário.
export function raySphere(o, dir, c, r) {
  const ox = o.x - c.x;
  const oy = o.y - c.y;
  const oz = o.z - c.z;
  const b = ox * dir.x + oy * dir.y + oz * dir.z;
  const cc = ox * ox + oy * oy + oz * oz - r * r;
  const disc = b * b - cc;
  if (disc < 0) return -1;
  const t = -b - Math.sqrt(disc);
  return t >= 0 ? t : cc < 0 ? 0 : -1;
}
