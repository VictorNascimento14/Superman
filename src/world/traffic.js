import { createRng } from '../core/rng.js';
import { CITY, CELL, HALF, streetLine, streetOpen, blockBounds, isPark } from './layout.js';

// Simulação pura de tráfego e pedestres (testada). Carros andam pela mão direita em
// duas faixas por sentido; nos cruzamentos escolhem seguir/virar entre as saídas
// abertas e fazem a curva por uma Bézier quadrática. Cada faixa tem velocidade fixa,
// então ninguém ultrapassa ninguém na reta.
export const LANES = [2.8, 8.2]; // distância do eixo da rua (m)
const LANE_SPEED = [11, 15];
const EDGE = CITY.street / 2; // o carro decide a curva ao cruzar a faixa de pedestre

const heading = (axis, dir) => (axis === 'x' ? (dir > 0 ? Math.PI / 2 : -Math.PI / 2) : dir > 0 ? 0 : Math.PI);

// Posição no mundo de um carro em reta.
function place(axis, line, dir, lane, s, out) {
  const off = LANES[lane] * dir;
  if (axis === 'x') { out.x = s; out.z = streetLine(line) + off; } else { out.x = streetLine(line) - off; out.z = s; }
  out.yaw = heading(axis, dir);
  return out;
}

// Saídas possíveis a partir do cruzamento (ix, iz) chegando por `axis`/`dir`.
function exits(car, ix, iz) {
  const opts = [];
  const tryGo = (axis, dir, kind) => {
    const line = axis === 'x' ? iz : ix; // rua que passa pelo cruzamento nesse eixo
    const from = axis === 'x' ? ix : iz;
    const seg = dir > 0 ? from : from - 1;
    if (seg < 0 || seg >= CITY.blocks) return;
    if (!streetOpen(axis, line, seg)) return;
    opts.push({ axis, dir, line, kind });
  };
  const other = car.axis === 'x' ? 'z' : 'x';
  tryGo(car.axis, car.dir, 'reto');
  // Virar à direita na mão direita: indo +x a direita é +z; indo +z a direita é −x.
  const rightDir = car.axis === 'x' ? car.dir : -car.dir;
  tryGo(other, rightDir, 'direita');
  tryGo(other, -rightDir, 'esquerda');
  return opts;
}

export function createTraffic({ cars = 900, peds = 1400, seed = 77 } = {}) {
  const rng = createRng(seed);
  const list = [];
  let guard = 0;
  while (list.length < cars && guard++ < cars * 20) {
    const axis = rng.chance(0.5) ? 'x' : 'z';
    const line = rng.int(0, CITY.blocks);
    const seg = rng.int(0, CITY.blocks - 1);
    if (!streetOpen(axis, line, seg)) continue;
    const dir = rng.chance(0.5) ? 1 : -1;
    const lane = rng.int(0, 1);
    const s = streetLine(seg) + EDGE + rng.range(2, CELL - 2 * EDGE - 2);
    const c = { axis, line, dir, lane, s, speed: LANE_SPEED[lane] * rng.range(0.92, 1.05), turn: null, x: 0, z: 0, yaw: 0 };
    place(axis, line, dir, lane, s, c);
    list.push(c);
  }

  const pedList = [];
  guard = 0;
  while (pedList.length < peds && guard++ < peds * 20) {
    const i = rng.int(0, CITY.blocks - 1);
    const j = rng.int(0, CITY.blocks - 1);
    if (isPark(i, j)) continue;
    const b = blockBounds(i, j);
    const inset = rng.range(0.8, CITY.sidewalk - 0.8);
    const r = { x0: b.x0 + inset, z0: b.z0 + inset, x1: b.x1 - inset, z1: b.z1 - inset };
    const per = 2 * (r.x1 - r.x0 + r.z1 - r.z0);
    pedList.push({ r, per, u: rng.range(0, per), speed: rng.range(1.1, 1.7) * (rng.chance(0.5) ? 1 : -1), x: 0, z: 0, yaw: 0, phase: rng.range(0, 6.28) });
  }

  function startTurn(c, ix, iz) {
    const opts = exits(c, ix, iz);
    let pick = opts.find((o) => o.kind === 'reto');
    const roll = rng.next();
    if (!pick || roll < 0.35) pick = opts.length ? opts[Math.floor(rng.next() * opts.length)] : null;
    if (!pick) { // beco sem saída (não deve existir na grade, mas não trava): meia-volta
      pick = { axis: c.axis, dir: -c.dir, line: c.line, kind: 'volta' };
    }
    const cx = streetLine(ix);
    const cz = streetLine(iz);
    const p0 = { x: c.x, z: c.z };
    // Saída: EDGE metros depois do cruzamento, na faixa certa da rua nova.
    const exitS = (pick.axis === 'x' ? cx : cz) + pick.dir * EDGE;
    const p2 = place(pick.axis, pick.line, pick.dir, c.lane, exitS, {});
    // Controle: onde as duas linhas de faixa se cruzam (reto: ponto médio).
    const p1 = pick.axis === c.axis ? { x: (p0.x + p2.x) / 2, z: (p0.z + p2.z) / 2 } : c.axis === 'x' ? { x: p2.x, z: p0.z } : { x: p0.x, z: p2.z };
    const len = Math.hypot(p1.x - p0.x, p1.z - p0.z) + Math.hypot(p2.x - p1.x, p2.z - p1.z);
    c.turn = { p0, p1, p2, t: 0, dur: Math.max(0.3, (len * 0.92) / c.speed), next: { axis: pick.axis, dir: pick.dir, line: pick.line, s: exitS } };
  }

  function stepCar(c, dt) {
    if (c.turn) {
      const tr = c.turn;
      tr.t = Math.min(1, tr.t + dt / tr.dur);
      const t = tr.t;
      const a = (1 - t) * (1 - t);
      const b = 2 * (1 - t) * t;
      const d = t * t;
      c.x = a * tr.p0.x + b * tr.p1.x + d * tr.p2.x;
      c.z = a * tr.p0.z + b * tr.p1.z + d * tr.p2.z;
      // Direção = derivada da Bézier.
      const dx = 2 * (1 - t) * (tr.p1.x - tr.p0.x) + 2 * t * (tr.p2.x - tr.p1.x);
      const dz = 2 * (1 - t) * (tr.p1.z - tr.p0.z) + 2 * t * (tr.p2.z - tr.p1.z);
      if (dx * dx + dz * dz > 1e-8) c.yaw = Math.atan2(dx, dz);
      if (t >= 1) {
        Object.assign(c, tr.next);
        c.turn = null;
        place(c.axis, c.line, c.dir, c.lane, c.s, c);
      }
      return;
    }
    const before = c.s;
    c.s += c.dir * c.speed * dt;
    // Próximo cruzamento à frente: a "linha de decisão" fica EDGE antes do eixo.
    const k = (before + HALF) / CELL;
    const next = c.dir > 0 ? Math.floor(k + 1e-9) + 1 : Math.ceil(k - 1e-9) - 1;
    const decide = streetLine(next) - c.dir * EDGE;
    if ((c.dir > 0 && c.s >= decide && before < decide) || (c.dir < 0 && c.s <= decide && before > decide)) {
      c.s = decide;
      place(c.axis, c.line, c.dir, c.lane, c.s, c);
      const ix = c.axis === 'x' ? next : c.line;
      const iz = c.axis === 'x' ? c.line : next;
      startTurn(c, ix, iz);
      return;
    }
    place(c.axis, c.line, c.dir, c.lane, c.s, c);
  }

  function stepPed(p, dt) {
    p.u = (((p.u + p.speed * dt) % p.per) + p.per) % p.per;
    const w = p.r.x1 - p.r.x0;
    const d = p.r.z1 - p.r.z0;
    let u = p.u;
    // Perímetro no sentido: +x no lado z0, +z no lado x1, −x no lado z1, −z no lado x0.
    let dirX = 0;
    let dirZ = 0;
    if (u < w) { p.x = p.r.x0 + u; p.z = p.r.z0; dirX = 1; } else if ((u -= w) < d) { p.x = p.r.x1; p.z = p.r.z0 + u; dirZ = 1; } else if ((u -= d) < w) { p.x = p.r.x1 - u; p.z = p.r.z1; dirX = -1; } else { u -= w; p.x = p.r.x0; p.z = p.r.z1 - u; dirZ = -1; }
    const sgn = Math.sign(p.speed);
    p.yaw = Math.atan2(dirX * sgn, dirZ * sgn);
  }

  return {
    cars: list,
    peds: pedList,
    update(dt) {
      for (const c of list) stepCar(c, dt);
      for (const p of pedList) stepPed(p, dt);
    },
  };
}
