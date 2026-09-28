import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTraffic } from '../src/world/traffic.js';
import { CITY, HALF, CELL, parkBounds, streetLine } from '../src/world/layout.js';

const distToStreet = (v) => {
  const k = Math.round((v + HALF) / CELL);
  return Math.abs(v - streetLine(k));
};

test('mesma semente, mesmo trânsito', () => {
  const a = createTraffic();
  const b = createTraffic();
  for (let i = 0; i < 300; i++) { a.update(1 / 30); b.update(1 / 30); }
  assert.deepEqual(a.cars.map((c) => [c.x, c.z]), b.cars.map((c) => [c.x, c.z]));
});

test('carros ficam na rua, dentro da ilha, fora do parque, sem teleporte', () => {
  const t = createTraffic({ cars: 200, peds: 0 });
  const p = parkBounds();
  const last = t.cars.map((c) => [c.x, c.z]);
  const dt = 1 / 30;
  for (let i = 0; i < 30 * 90; i++) {
    t.update(dt);
    t.cars.forEach((c, k) => {
      const onStreet = Math.min(distToStreet(c.x), distToStreet(c.z)) <= CITY.street / 2 + 1e-6;
      assert.ok(onStreet, `carro ${k} fora da rua em ${c.x.toFixed(1)}, ${c.z.toFixed(1)}`);
      assert.ok(Math.abs(c.x) <= HALF + CITY.street / 2 && Math.abs(c.z) <= HALF + CITY.street / 2, 'saiu da ilha');
      const inPark = c.x > p.x0 + 1 && c.x < p.x1 - 1 && c.z > p.z0 + 1 && c.z < p.z1 - 1;
      assert.ok(!inPark, `carro ${k} dentro do parque`);
      const jump = Math.hypot(c.x - last[k][0], c.z - last[k][1]);
      assert.ok(jump < 16 * dt * 1.6 + 1e-6, `carro ${k} pulou ${jump.toFixed(2)} m`);
      last[k] = [c.x, c.z];
    });
  }
});

test('pedestres ficam na calçada do próprio quarteirão', () => {
  const t = createTraffic({ cars: 0, peds: 100 });
  for (let i = 0; i < 600; i++) t.update(1 / 30);
  for (const p of t.peds) {
    const onEdge = Math.min(Math.abs(p.x - p.r.x0), Math.abs(p.x - p.r.x1), Math.abs(p.z - p.r.z0), Math.abs(p.z - p.r.z1));
    assert.ok(onEdge < 1e-6);
    assert.ok(p.x >= p.r.x0 - 1e-6 && p.x <= p.r.x1 + 1e-6 && p.z >= p.r.z0 - 1e-6 && p.z <= p.r.z1 + 1e-6);
  }
});
