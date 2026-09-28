import { createRng } from '../core/rng.js';
import { CITY } from './layout.js';

// Interior dos prédios (lógica pura, testada): lajes, pilares, núcleo de elevadores,
// divisórias, mesas, armários, luminárias e o lado de dentro da fachada. Cada andar sai de
// uma semente própria (prédio + andar): o mesmo pedaço tem o mesmo id seja qual for a faixa
// pedida, e o que foi quebrado continua quebrado. Só a faixa de andares pedida é montada — o
// jogo pede a faixa em volta de onde o herói entrou.
export const INTERIOR = {
  skin: 0.35, // m: as peças ficam aquém da fachada
  slab: 0.3, // espessura da laje
  grid: 8, // m entre pilares (dois vãos de janela)
  column: 0.6,
  core: 0.26, // fração da planta ocupada pelo núcleo (elevadores e escada)
  coreMin: 16, // m: planta menor que isso não tem núcleo
  wall: 0.12, // divisória
  seg: 3, // m: paredes em segmentos, para quebrar um pedaço de cada vez
  light: 6, // m entre luminárias
  tile: 6, // m: a laje vem em placas, para os andares em volta de um furo cederem em pedaços
};
export const KINDS = ['slab', 'column', 'core', 'wall', 'desk', 'cabinet', 'light', 'inner'];

const F = CITY.floor;
const SLAB_ID = 1 << 24; // ids de laje: SLAB_ID + (altura em cm, placa) — a laje é do prédio, não do andar

// Laje a `y` no nível `t`, em placas de INTERIOR.tile.
function slab(out, t, y) {
  const x0 = t.x - t.w / 2 + INTERIOR.skin;
  const z0 = t.z - t.d / 2 + INTERIOR.skin;
  const w = t.w - 2 * INTERIOR.skin;
  const d = t.d - 2 * INTERIOR.skin;
  const nx = Math.max(1, Math.round(w / INTERIOR.tile));
  const nz = Math.max(1, Math.round(d / INTERIOR.tile));
  for (let i = 0; i < nx; i++) {
    for (let j = 0; j < nz; j++) {
      const id = SLAB_ID + Math.round(y * 100) * 1024 + i * 32 + j;
      push(out, 'slab', id, x0 + (w * i) / nx, y - INTERIOR.slab, z0 + (d * j) / nz, x0 + (w * (i + 1)) / nx, y, z0 + (d * (j + 1)) / nz);
    }
  }
}

function push(out, kind, id, x0, y0, z0, x1, y1, z1) {
  out.push({ kind, id, minX: Math.min(x0, x1), minY: Math.min(y0, y1), minZ: Math.min(z0, z1), maxX: Math.max(x0, x1), maxY: Math.max(y0, y1), maxZ: Math.max(z0, z1) });
}

// Parede de (ax, az) a (bx, bz), horizontal ou vertical na planta, em segmentos de `seg` m.
// `door` pula um segmento a cada tantos (porta), a contar do primeiro.
function wallLine(out, kind, next, ax, az, bx, bz, y0, y1, t, door = 0) {
  const len = Math.hypot(bx - ax, bz - az);
  const n = Math.max(1, Math.round(len / INTERIOR.seg));
  for (let i = 0; i < n; i++) {
    if (door && i % door === door - 1) continue;
    const s0 = i / n;
    const s1 = (i + 1) / n;
    const x0 = ax + (bx - ax) * s0;
    const z0 = az + (bz - az) * s0;
    const x1 = ax + (bx - ax) * s1;
    const z1 = az + (bz - az) * s1;
    if (ax === bx) push(out, kind, next(), x0 - t / 2, y0, z0, x1 + t / 2, y1, z1);
    else push(out, kind, next(), x0, y0, z0 - t / 2, x1, y1, z1 + t / 2);
  }
}

const overlaps = (a, x0, z0, x1, z1) => a.x0 < x1 && a.x1 > x0 && a.z0 < z1 && a.z1 > z0;

// Um andar do nível `t` com a base em yb.
function floorPieces(out, t, f, seed) {
  const rng = createRng((seed ^ Math.imul(f + 1, 0x9e3779b1)) >>> 0);
  let k = 0;
  const next = () => f * 4096 + k++;
  const yb = f * F;
  const top = Math.min(yb + F, t.y1); // o último andar de um nível pode ser mais baixo
  const ceil = top - INTERIOR.slab; // embaixo da laje de cima
  const x0 = t.x - t.w / 2 + INTERIOR.skin;
  const x1 = t.x + t.w / 2 - INTERIOR.skin;
  const z0 = t.z - t.d / 2 + INTERIOR.skin;
  const z1 = t.z + t.d / 2 - INTERIOR.skin;
  const w = x1 - x0;
  const d = z1 - z0;

  // Lado de dentro da fachada (com as janelas) — sem ele, de dentro, a cidade apareceria.
  const e = 0.12;
  push(out, 'inner', next(), x0 - e, yb, z1, x1 + e, top, z1 + e);
  push(out, 'inner', next(), x0 - e, yb, z0 - e, x1 + e, top, z0);
  push(out, 'inner', next(), x1, yb, z0, x1 + e, top, z1);
  push(out, 'inner', next(), x0 - e, yb, z0, x0, top, z1);

  // Núcleo de elevadores e escada no meio, em concreto.
  const hasCore = w >= INTERIOR.coreMin && d >= INTERIOR.coreMin;
  const cw = Math.max(6, w * INTERIOR.core) / 2;
  const cd = Math.max(6, d * INTERIOR.core) / 2;
  const core = hasCore ? { x0: t.x - cw, z0: t.z - cd, x1: t.x + cw, z1: t.z + cd } : { x0: t.x, z0: t.z, x1: t.x, z1: t.z };
  if (hasCore) {
    const c = 0.3;
    wallLine(out, 'core', next, core.x0, core.z0, core.x1, core.z0, yb, ceil, c);
    wallLine(out, 'core', next, core.x0, core.z1, core.x1, core.z1, yb, ceil, c);
    wallLine(out, 'core', next, core.x0, core.z0, core.x0, core.z1, yb, ceil, c);
    wallLine(out, 'core', next, core.x1, core.z0, core.x1, core.z1, yb, ceil, c, 3);
  }

  // Pilares numa grade alinhada às janelas, fora do núcleo.
  const g = INTERIOR.grid;
  const cols = [];
  const h = INTERIOR.column / 2;
  for (let x = x0 + g / 2; x < x1 - 1; x += g) {
    for (let z = z0 + g / 2; z < z1 - 1; z += g) {
      if (overlaps(core, x - h - 0.5, z - h - 0.5, x + h + 0.5, z + h + 0.5)) continue;
      cols.push({ x0: x - h, z0: z - h, x1: x + h, z1: z + h });
      push(out, 'column', next(), x - h, yb, z - h, x + h, ceil, z + h);
    }
  }
  const free = (bx0, bz0, bx1, bz1) => !overlaps(core, bx0 - 1, bz0 - 1, bx1 + 1, bz1 + 1) && !cols.some((c) => overlaps(c, bx0 - 0.3, bz0 - 0.3, bx1 + 0.3, bz1 + 0.3));

  if (hasCore && rng.chance(0.45)) {
    // Salas: corredor em volta do núcleo e divisórias até a fachada, uma mesa por sala.
    const r = 2.2;
    const ring = { x0: core.x0 - r, z0: core.z0 - r, x1: core.x1 + r, z1: core.z1 + r };
    const wt = INTERIOR.wall;
    wallLine(out, 'wall', next, ring.x0, ring.z0, ring.x1, ring.z0, yb, ceil, wt, 4);
    wallLine(out, 'wall', next, ring.x0, ring.z1, ring.x1, ring.z1, yb, ceil, wt, 4);
    wallLine(out, 'wall', next, ring.x0, ring.z0, ring.x0, ring.z1, yb, ceil, wt, 4);
    wallLine(out, 'wall', next, ring.x1, ring.z0, ring.x1, ring.z1, yb, ceil, wt, 4);
    const room = 6;
    for (let x = ring.x0; x <= ring.x1 + 0.01; x += room) {
      if (ring.z0 - z0 > 3) wallLine(out, 'wall', next, x, z0, x, ring.z0, yb, ceil, wt);
      if (z1 - ring.z1 > 3) wallLine(out, 'wall', next, x, ring.z1, x, z1, yb, ceil, wt);
    }
    for (let x = ring.x0 + room / 2; x < ring.x1; x += room) {
      if (ring.z0 - z0 > 3 && free(x - 0.8, z0 + 0.8, x + 0.8, z0 + 1.6)) push(out, 'desk', next(), x - 0.8, yb, z0 + 0.8, x + 0.8, yb + 0.75, z0 + 1.6);
      if (z1 - ring.z1 > 3 && free(x - 0.8, z1 - 1.6, x + 0.8, z1 - 0.8)) push(out, 'desk', next(), x - 0.8, yb, z1 - 1.6, x + 0.8, yb + 0.75, z1 - 0.8);
    }
  } else {
    // Planta livre: mesas em fileiras, armários encostados no núcleo.
    for (let z = z0 + 2.2; z < z1 - 2; z += 4.2) {
      for (let x = x0 + 1.5; x < x1 - 2; x += 2.4) {
        if (rng.chance(0.2)) continue;
        if (free(x, z, x + 1.6, z + 0.8)) push(out, 'desk', next(), x, yb, z, x + 1.6, yb + 0.75, z + 0.8);
      }
    }
    if (hasCore) {
      for (let x = core.x0 + 0.5; x < core.x1 - 1; x += 1.4) {
        if (rng.chance(0.5)) push(out, 'cabinet', next(), x, yb, core.z0 - 0.7, x + 1, yb + 1.35, core.z0 - 0.25);
      }
    }
  }

  // Luminárias no forro.
  const l = INTERIOR.light;
  for (let x = x0 + l / 2; x < x1; x += l) {
    for (let z = z0 + l / 2; z < z1; z += l) {
      if (overlaps(core, x - 1, z - 1, x + 1, z + 1)) continue;
      push(out, 'light', next(), x - 0.6, ceil - 0.06, z - 0.3, x + 0.6, ceil, z + 0.3);
    }
  }
}

// Peças do prédio `b` (do layout) com andares de base em [yLo, yHi].
export function interiorBand(b, yLo, yHi) {
  const out = [];
  for (const t of b.tiers) {
    // Lajes: cada divisa de andar dentro do nível e a laje do topo (embaixo do telhado). A do
    // pé do nível é a de cima do nível de baixo, que é maior.
    for (let y = Math.ceil((t.y0 + 0.01) / F) * F; y < t.y1 - 0.01; y += F) {
      if (y >= yLo && y <= yHi + F) slab(out, t, y);
    }
    if (t.y1 >= yLo && t.y1 <= yHi + F) slab(out, t, t.y1);
    // Andares cuja base cai no nível (e sobra pelo menos meio andar até o topo dele).
    for (let f = Math.ceil((t.y0 - 0.01) / F); f * F < t.y1 - F / 2; f++) {
      const yb = f * F;
      if (yb >= yLo && yb <= yHi) floorPieces(out, t, f, b.seed);
    }
  }
  return out;
}

// Peças atingidas por uma esfera (centro p, raio r) — o herói passando.
export function piecesInSphere(pieces, p, r, out = []) {
  out.length = 0;
  for (let i = 0; i < pieces.length; i++) {
    const c = pieces[i];
    const dx = Math.max(c.minX - p.x, 0, p.x - c.maxX);
    const dy = Math.max(c.minY - p.y, 0, p.y - c.maxY);
    const dz = Math.max(c.minZ - p.z, 0, p.z - c.maxZ);
    if (dx * dx + dy * dy + dz * dz < r * r) out.push(i);
  }
  return out;
}
