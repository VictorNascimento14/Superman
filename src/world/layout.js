import { createRng } from '../core/rng.js';

// Metropolis numa ilha em grade. Ruas nas bordas de cada célula; o quarteirão fica no meio.
// Tudo aqui é lógica pura: mesma semente, mesma cidade (invariante 4).
export const CITY = {
  seed: 1938,
  blocks: 20, // quarteirões por lado
  block: 90, // aresta do quarteirão, calçada incluída (m)
  street: 22, // largura da rua (m)
  sidewalk: 4,
  floor: 3.6, // altura de um andar
  bay: 4, // largura de um vão de janela
};
export const CELL = CITY.block + CITY.street;
export const HALF = (CITY.blocks * CELL) / 2;
// Chão, igual na cena e na colisão: a laje da ilha (topo em y = 0) passa QUAY m das ruas
// da borda e vira o cais; o mar fica em WATER_Y; o gramado do parque sobe LAWN acima da rua.
export const QUAY = 30;
export const WATER_Y = -1.2;
export const LAWN = 0.6;

// Centro do centro financeiro (onde nascem os arranha-céus) e quarteirões especiais.
export const DOWNTOWN = { x: -200, z: -120 };
export const PARK = { i0: 12, j0: 4, i1: 14, j1: 7 }; // inclusivo
export const LANDMARK = { i: 9, j: 9 };

export const STYLES = ['vidro', 'artdeco', 'concreto', 'tijolo'];

export const streetLine = (k) => -HALF + k * CELL; // eixo da k-ésima rua (k = 0..blocks)

export function blockBounds(i, j) {
  const s = CITY.street / 2;
  return { x0: streetLine(i) + s, z0: streetLine(j) + s, x1: streetLine(i + 1) - s, z1: streetLine(j + 1) - s };
}

export const isPark = (i, j) => i >= PARK.i0 && i <= PARK.i1 && j >= PARK.j0 && j <= PARK.j1;

export function parkBounds() {
  const a = blockBounds(PARK.i0, PARK.j0);
  const b = blockBounds(PARK.i1, PARK.j1);
  return { x0: a.x0, z0: a.z0, x1: b.x1, z1: b.z1 };
}

// Trecho de rua fechado: a rua que passa DENTRO do parque some sob o gramado.
// axis 'x' = rua que corre ao longo de x na linha z = streetLine(k); seg = índice do quarteirão cruzado.
export function streetOpen(axis, k, seg) {
  const insideLine = (lo, hi, v) => v > lo && v <= hi;
  if (axis === 'x') return !(insideLine(PARK.j0, PARK.j1, k) && seg >= PARK.i0 && seg <= PARK.i1);
  return !(insideLine(PARK.i0, PARK.i1, k) && seg >= PARK.j0 && seg <= PARK.j1);
}

// 0 no subúrbio, 1 no coração do centro financeiro.
export function density(x, z) {
  const d = Math.hypot(x - DOWNTOWN.x, z - DOWNTOWN.z) / HALF;
  return Math.max(0, 1 - d * 0.95);
}

function pickStyle(rng, t) {
  if (t > 0.5) return rng.chance(0.6) ? 'vidro' : 'artdeco';
  if (t > 0.22) return rng.pick(['concreto', 'artdeco', 'vidro', 'concreto']);
  return rng.chance(0.65) ? 'tijolo' : 'concreto';
}

// Recuos (setbacks) no estilo dos arranha-céus dos anos 30: cada nível mais estreito.
function makeTiers(rng, x, z, w, d, h, style) {
  const tiers = [];
  const stepped = h > 80 && (style === 'artdeco' || rng.chance(0.35));
  if (!stepped) return [{ x, z, w, d, y0: 0, y1: h }];
  const cuts = style === 'artdeco' ? [0.55, 0.8, 1] : [0.7, 1];
  const shrink = style === 'artdeco' ? [1, 0.78, 0.56] : [1, 0.72];
  let y0 = 0;
  cuts.forEach((c, k) => {
    const y1 = h * c;
    tiers.push({ x, z, w: w * shrink[k], d: d * shrink[k], y0, y1 });
    y0 = y1;
  });
  return tiers;
}

function splitLots(rng, b, t) {
  const inner = { x0: b.x0 + CITY.sidewalk, z0: b.z0 + CITY.sidewalk, x1: b.x1 - CITY.sidewalk, z1: b.z1 - CITY.sidewalk };
  let nx;
  let nz;
  if (t > 0.55) [nx, nz] = rng.chance(0.55) ? [1, 1] : [2, 1];
  else if (t > 0.25) [nx, nz] = [2, 2];
  else [nx, nz] = rng.chance(0.5) ? [3, 2] : [3, 3];
  if (rng.chance(0.5)) [nx, nz] = [nz, nx];
  const gap = 3;
  const lw = (inner.x1 - inner.x0 - gap * (nx - 1)) / nx;
  const ld = (inner.z1 - inner.z0 - gap * (nz - 1)) / nz;
  const lots = [];
  for (let a = 0; a < nx; a++) {
    for (let c = 0; c < nz; c++) {
      const x0 = inner.x0 + a * (lw + gap);
      const z0 = inner.z0 + c * (ld + gap);
      lots.push({ x0, z0, x1: x0 + lw, z1: z0 + ld });
    }
  }
  return lots;
}

export function generateLayout(seed = CITY.seed) {
  const rng = createRng(seed);
  const buildings = [];
  for (let i = 0; i < CITY.blocks; i++) {
    for (let j = 0; j < CITY.blocks; j++) {
      if (isPark(i, j)) continue;
      const b = blockBounds(i, j);
      if (i === LANDMARK.i && j === LANDMARK.j) {
        buildings.push(makeLandmark(b));
        continue;
      }
      const cx = (b.x0 + b.x1) / 2;
      const cz = (b.z0 + b.z1) / 2;
      const t = density(cx, cz);
      for (const lot of splitLots(rng, b, t)) {
        const inset = t > 0.55 ? rng.range(0, 1.5) : rng.range(0, 3);
        const w = lot.x1 - lot.x0 - inset * 2;
        const d = lot.z1 - lot.z0 - inset * 2;
        const hMax = 16 + 320 * t ** 1.8;
        const floors = Math.max(3, Math.round((hMax * rng.range(0.45, 1)) / CITY.floor));
        const h = floors * CITY.floor;
        const style = pickStyle(rng, t);
        const x = (lot.x0 + lot.x1) / 2;
        const z = (lot.z0 + lot.z1) / 2;
        buildings.push({ x, z, w, d, h, style, tiers: makeTiers(rng, x, z, w, d, h, style), seed: rng.int(0, 1e9) });
      }
    }
  }
  return { buildings, park: parkBounds() };
}

// O prédio do Planeta Diário: torre art déco em quatro recuos, globo dourado no topo.
function makeLandmark(b) {
  const x = (b.x0 + b.x1) / 2;
  const z = (b.z0 + b.z1) / 2;
  const w = b.x1 - b.x0 - CITY.sidewalk * 2 - 6;
  const tiers = [
    { x, z, w, d: w, y0: 0, y1: 118.8 },
    { x, z, w: w * 0.74, d: w * 0.74, y0: 118.8, y1: 190.8 },
    { x, z, w: w * 0.52, d: w * 0.52, y0: 190.8, y1: 241.2 },
    { x, z, w: w * 0.34, d: w * 0.34, y0: 241.2, y1: 262.8 },
  ];
  // Globo sobre um pedestal de 6 m; o centro fica um raio acima dele.
  return { x, z, w, d: w, h: 262.8, style: 'artdeco', tiers, seed: 1, landmark: true, globe: { x, z, y: 262.8 + 6 + 14, r: 14 } };
}

// Caixas de colisão (AABB) de todos os níveis de todos os prédios.
export function collisionBoxes(layout) {
  const boxes = [];
  layout.buildings.forEach((b, building) => {
    for (const t of b.tiers) {
      boxes.push({ minX: t.x - t.w / 2, minY: t.y0, minZ: t.z - t.d / 2, maxX: t.x + t.w / 2, maxY: t.y1, maxZ: t.z + t.d / 2, breakable: true, building });
    }
    if (b.globe) {
      // Caixa a 75% do raio: com o raio inteiro o herói ficava em pé no ar nas quinas.
      const g = b.globe;
      const r = g.r * 0.75;
      boxes.push({ minX: g.x - r, minY: b.h, minZ: g.z - r, maxX: g.x + r, maxY: g.y + r, maxZ: g.z + r });
    }
  });
  // Laje da ilha e gramado: sem elas o piso era o plano y = 0 em toda parte — pernas
  // enterradas 0,6 m no parque e pouso 1,2 m acima da água. O piso infinito do mundo de
  // colisão fica no nível do mar (main.js).
  const s = HALF + QUAY;
  boxes.push({ minX: -s, minY: -4, minZ: -s, maxX: s, maxY: 0, maxZ: s });
  const p = layout.park;
  boxes.push({ minX: p.x0, minY: 0, minZ: p.z0, maxX: p.x1, maxY: LAWN, maxZ: p.z1 });
  return boxes;
}
