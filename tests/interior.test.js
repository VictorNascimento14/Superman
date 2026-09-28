import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateLayout, CITY } from '../src/world/layout.js';
import { interiorBand, piecesInSphere, INTERIOR } from '../src/world/interior.js';
import { createOpenings, OPEN } from '../src/world/openings.js';
import { GeoBuilder, addWalls } from '../src/world/buildingGeo.js';

const F = CITY.floor;
const layout = generateLayout();
const plain = layout.buildings.filter((b) => !b.landmark && b.h > 40);
const big = plain.reduce((a, b) => (b.w * b.d > a.w * a.d ? b : a));
const stepped = plain.find((b) => b.tiers.length > 1);
// Nenhum prédio da cidade tem menos de 16 m de lado: o estreito é sintético.
const small = { seed: 7, tiers: [{ x: 0, z: 0, w: 12, d: 10, y0: 0, y1: 20 * F }] };
const key = (p) => `${p.kind}:${p.id}`;
const overlap = (a, b) => a.minX < b.maxX && a.maxX > b.minX && a.minZ < b.maxZ && a.maxZ > b.minZ && a.minY < b.maxY && a.maxY > b.minY;

test('interior: a mesma faixa sai igual, e andares em comum têm as mesmas peças em faixas diferentes', () => {
  assert.deepEqual(interiorBand(big, 10 * F, 16 * F), interiorBand(big, 10 * F, 16 * F));
  const a = new Map(interiorBand(big, 10 * F, 16 * F).map((p) => [key(p), p]));
  const b = interiorBand(big, 13 * F, 20 * F).filter((p) => p.minY >= 13 * F && p.maxY <= 16 * F);
  assert.ok(b.length > 100, `${b.length} peças em comum`);
  for (const p of b) assert.deepEqual(a.get(key(p)), p, key(p));
});

test('interior: tudo dentro da planta do nível e na faixa pedida; laje em cada andar, fachada por dentro', () => {
  for (const b of [big, stepped]) {
    const lo = 8 * F;
    const hi = 14 * F;
    const pieces = interiorBand(b, lo, hi);
    for (const p of pieces) {
      const t = b.tiers.find((t) => p.minY >= t.y0 - INTERIOR.slab - 0.01 && p.maxY <= t.y1 + 0.01 && p.minX >= t.x - t.w / 2 && p.maxX <= t.x + t.w / 2 && p.minZ >= t.z - t.d / 2 && p.maxZ <= t.z + t.d / 2);
      assert.ok(t, `${key(p)} fora do prédio`);
      assert.ok(p.minY >= lo - INTERIOR.slab - 0.01 && p.maxY <= hi + 2 * F + 0.01, `${key(p)} fora da faixa`);
    }
    const slabs = pieces.filter((p) => p.kind === 'slab').map((p) => p.maxY);
    for (let y = lo + F; y <= hi; y += F) if (y < b.h - 0.01) assert.ok(slabs.some((s) => Math.abs(s - y) < 0.01), `sem laje a ${y} m`);
    const floors = new Set(pieces.filter((p) => p.kind === 'inner').map((p) => Math.round(p.minY / F)));
    for (const f of floors) assert.equal(pieces.filter((p) => p.kind === 'inner' && Math.round(p.minY / F) === f).length, 4);
  }
});

test('interior: pilares fora do núcleo, mesas fora dos pilares; prédio estreito não tem núcleo', () => {
  const pieces = interiorBand(big, 20 * F, 22 * F);
  const cores = pieces.filter((p) => p.kind === 'core');
  const cols = pieces.filter((p) => p.kind === 'column');
  assert.ok(cores.length > 0 && cols.length > 0);
  for (const c of cols) for (const k of cores) assert.ok(!overlap(c, k), `pilar ${c.id} dentro do núcleo`);
  for (const d of pieces.filter((p) => p.kind === 'desk')) for (const c of cols) assert.ok(!overlap(d, c), `mesa ${d.id} no pilar ${c.id}`);
  assert.equal(interiorBand(small, 0, 3 * F).filter((p) => p.kind === 'core').length, 0);
});

test('peças atingidas: só o que a esfera toca', () => {
  const pieces = [
    { minX: 0, minY: 0, minZ: 0, maxX: 1, maxY: 1, maxZ: 1 },
    { minX: 5, minY: 0, minZ: 0, maxX: 6, maxY: 1, maxZ: 1 },
  ];
  assert.deepEqual(piecesInSphere(pieces, { x: 1.5, y: 0.5, z: 0.5 }, 0.6), [0]);
  assert.deepEqual(piecesInSphere(pieces, { x: 3, y: 0.5, z: 0.5 }, 1), []);
  assert.deepEqual(piecesInSphere(pieces, { x: 3, y: 0.5, z: 0.5 }, 2.5), [0, 1]);
});

test('aberturas: até OPEN ao mesmo tempo (a mais antiga fecha) e fecham por prédio', () => {
  const o = createOpenings();
  for (let i = 0; i < OPEN + 3; i++) o.add(i % 5, { x: i, y: 10, z: 0, nx: 0, ny: 0, nz: 1, r: 2 });
  assert.equal(o.list.length, OPEN);
  assert.equal(o.uniforms.uCutCount.value, OPEN);
  assert.equal(o.list[0].x, 3, 'as 3 primeiras fecharam');
  o.removeBuilding(0);
  assert.ok(o.list.every((h) => h.building !== 0));
  assert.equal(o.uniforms.uCutCount.value, o.list.length);
  assert.equal(o.uniforms.uCut.value[0].x, o.list[0].x);
});

test('paredes: o atributo que liga o recorte dos furos nasce desligado', () => {
  const gb = new GeoBuilder();
  addWalls(gb, 0, 0, 0, 10, 20, 10, 0, 0);
  const g = gb.build();
  assert.equal(g.attributes.open.count, g.attributes.position.count);
  assert.ok(g.attributes.open.array.every((v) => v === 0));
});
