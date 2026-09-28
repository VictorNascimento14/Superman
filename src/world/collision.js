// Mundo de colisão: AABBs num hash espacial 2D (x/z). Sem three, sem alocação no
// caminho quente — os resultados saem em objetos que o chamador reaproveita.

// `floor`: plano infinito sob tudo (y = floor) — no jogo, o nível do mar.
export function createCollisionWorld(boxes, { cellSize = 64, floor = 0 } = {}) {
  const cells = new Map();
  const key = (ix, iz) => (ix + 2048) * 4096 + (iz + 2048);
  const cellOf = (v) => Math.floor(v / cellSize);
  boxes.forEach((b, idx) => {
    for (let ix = cellOf(b.minX); ix <= cellOf(b.maxX); ix++) {
      for (let iz = cellOf(b.minZ); iz <= cellOf(b.maxZ); iz++) {
        const k = key(ix, iz);
        if (!cells.has(k)) cells.set(k, []);
        cells.get(k).push(idx);
      }
    }
  });
  const stamp = new Uint32Array(boxes.length);
  let visit = 0;

  function forEachNear(minX, minZ, maxX, maxZ, fn) {
    visit++;
    for (let ix = cellOf(minX); ix <= cellOf(maxX); ix++) {
      for (let iz = cellOf(minZ); iz <= cellOf(maxZ); iz++) {
        const list = cells.get(key(ix, iz));
        if (!list) continue;
        for (let j = 0; j < list.length; j++) {
          const idx = list[j];
          if (stamp[idx] === visit) continue;
          stamp[idx] = visit;
          fn(boxes[idx], idx);
        }
      }
    }
  }

  // Consulta de esfera em curso. O visitante do forEachNear é criado uma vez só: uma closure
  // nova por chamada alocava a cada subpasso do voo.
  let qp = null;
  let qr = 0;
  let qn = null;
  let qc = null;
  let qhit = false;
  function pushOut(b) {
    const p = qp;
    const r = qr;
    const outNormal = qn;
    const onContact = qc;
    const cx = Math.max(b.minX, Math.min(p.x, b.maxX));
    const cy = Math.max(b.minY, Math.min(p.y, b.maxY));
    const cz = Math.max(b.minZ, Math.min(p.z, b.maxZ));
    let dx = p.x - cx;
    let dy = p.y - cy;
    let dz = p.z - cz;
    const d2 = dx * dx + dy * dy + dz * dz;
    if (d2 >= r * r) return;
    qhit = true;
    if (d2 > 1e-9) {
      const d = Math.sqrt(d2);
      const push = (r - d) / d;
      p.x += dx * push; p.y += dy * push; p.z += dz * push;
      outNormal.x += dx / d; outNormal.y += dy / d; outNormal.z += dz / d;
      onContact?.(dx / d, dy / d, dz / d);
      return;
    }
    // Centro dentro da caixa (túnel por velocidade alta): sai pela face mais próxima.
    const exits = [
      [b.maxX - p.x + r, 1, 0, 0], [p.x - b.minX + r, -1, 0, 0],
      [b.maxY - p.y + r, 0, 1, 0], [p.y - b.minY + r, 0, -1, 0],
      [b.maxZ - p.z + r, 0, 0, 1], [p.z - b.minZ + r, 0, 0, -1],
    ];
    let best = exits[0];
    for (const e of exits) if (e[0] < best[0]) best = e;
    [, dx, dy, dz] = best;
    p.x += dx * best[0]; p.y += dy * best[0]; p.z += dz * best[0];
    outNormal.x += dx; outNormal.y += dy; outNormal.z += dz;
    onContact?.(dx, dy, dz);
  }

  // Empurra a esfera para fora dos prédios e do chão. Devolve true se tocou algo;
  // `outNormal` recebe a soma das normais de contato (não normalizada). `onContact`, se
  // vier, recebe cada normal unitária em separado: quem corta velocidade precisa delas uma
  // a uma — chão + parede somados viram uma diagonal que joga o corpo para cima.
  function resolveSphere(p, r, outNormal, onContact) {
    qp = p; qr = r; qn = outNormal; qc = onContact; qhit = false;
    outNormal.x = outNormal.y = outNormal.z = 0;
    forEachNear(p.x - r, p.z - r, p.x + r, p.z + r, pushOut);
    let hit = qhit;
    if (p.y < floor + r) {
      p.y = floor + r;
      outNormal.y += 1;
      onContact?.(0, 1, 0);
      hit = true;
    }
    return hit;
  }

  // Raio contra prédios e o chão (y = 0). `dir` deve ser unitário.
  // Preenche `out` { hit, dist, x, y, z, nx, ny, nz, box } e devolve out.hit.
  function raycast(o, dir, maxDist, out) {
    out.hit = false;
    out.dist = maxDist;
    out.box = -1;
    if (dir.y < 0) {
      const t = (floor - o.y) / dir.y;
      if (t >= 0 && t < out.dist) setHit(out, o, dir, t, 0, 1, 0, -1);
    }
    // Varre as células que o segmento cruza em passos de meia célula (DDA simples).
    const steps = Math.ceil(out.dist / (cellSize * 0.5)) + 1;
    visit++;
    for (let s = 0; s <= steps; s++) {
      const t = Math.min(s * cellSize * 0.5, out.dist);
      const px = o.x + dir.x * t;
      const pz = o.z + dir.z * t;
      for (let ox = -1; ox <= 1; ox++) {
        for (let oz = -1; oz <= 1; oz++) {
          const list = cells.get(key(cellOf(px) + ox, cellOf(pz) + oz));
          if (!list) continue;
          for (let j = 0; j < list.length; j++) {
            const idx = list[j];
            if (stamp[idx] === visit) continue;
            stamp[idx] = visit;
            slab(boxes[idx], idx, o, dir, out);
          }
        }
      }
      if (out.hit && t >= out.dist) break;
    }
    return out.hit;
  }

  // Altura do topo mais alto sob (x, z): telhado onde o herói pode pousar, ou o piso.
  let hx = 0;
  let hz = 0;
  let hh = 0;
  const topAt = (b) => {
    if (hx >= b.minX && hx <= b.maxX && hz >= b.minZ && hz <= b.maxZ && b.maxY > hh) hh = b.maxY;
  };
  function heightAt(x, z) {
    hx = x; hz = z; hh = floor;
    forEachNear(x, z, x, z, topAt);
    return hh;
  }

  return { resolveSphere, raycast, heightAt, forEachNear, boxes };
}

function setHit(out, o, dir, t, nx, ny, nz, box) {
  out.hit = true;
  out.dist = t;
  out.x = o.x + dir.x * t; out.y = o.y + dir.y * t; out.z = o.z + dir.z * t;
  out.nx = nx; out.ny = ny; out.nz = nz;
  out.box = box;
}

// Eixos do teste de slab: um array novo por caixa por raio alocava a cada quadro (a câmera
// testa ~16 caixas; a visão de calor, até ~90).
const AXES = [['x', 'minX', 'maxX'], ['y', 'minY', 'maxY'], ['z', 'minZ', 'maxZ']];

function slab(b, idx, o, dir, out) {
  let tmin = 0;
  let tmax = out.dist;
  let nAxis = -1;
  let nSign = 0;
  for (let a = 0; a < 3; a++) {
    const ax = AXES[a];
    const c = ax[0];
    const lo = ax[1];
    const hi = ax[2];
    const d = dir[c];
    if (Math.abs(d) < 1e-12) {
      if (o[c] < b[lo] || o[c] > b[hi]) return;
      continue;
    }
    let t1 = (b[lo] - o[c]) / d;
    let t2 = (b[hi] - o[c]) / d;
    let sign = -1;
    if (t1 > t2) { const t = t1; t1 = t2; t2 = t; sign = 1; }
    if (t1 > tmin) { tmin = t1; nAxis = a; nSign = sign; }
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return;
  }
  if (nAxis < 0) return; // origem dentro da caixa: ignora
  setHit(out, o, dir, tmin, nAxis === 0 ? nSign : 0, nAxis === 1 ? nSign : 0, nAxis === 2 ? nSign : 0, idx);
}
