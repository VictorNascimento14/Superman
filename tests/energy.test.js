import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createEnergy, raySphere, ENERGY } from '../src/powers/energy.js';

const run = (e, wants, s, dt = 1 / 60) => { for (let t = 0; t < s; t += dt) e.update(dt, wants); };

test('disparar drena; esvaziar trava até juntar o mínimo', () => {
  const e = createEnergy();
  run(e, true, 1 / ENERGY.drain + 0.1);
  assert.equal(e.value, 0);
  assert.equal(e.firing, false);
  assert.ok(e.locked);
  run(e, true, 0.5); // travado: segurar o botão não dispara, e a recarga segue
  run(e, false, ENERGY.regenDelay + ENERGY.restart / ENERGY.regen + 0.1);
  e.update(1 / 60, true);
  assert.ok(e.firing);
});

test('com a carga solar, disparar não drena a reserva', () => {
  const e = createEnergy();
  for (let t = 0; t < 5; t += 1 / 60) e.update(1 / 60, true, 0);
  assert.equal(e.value, 1);
  assert.ok(e.firing);
});

test('recarga só começa depois da pausa', () => {
  const e = createEnergy();
  run(e, true, 1);
  const v = e.value;
  run(e, false, ENERGY.regenDelay * 0.5);
  assert.equal(e.value, v);
  run(e, false, 1);
  assert.ok(e.value > v);
});

test('raio contra esfera', () => {
  const o = { x: 0, y: 0, z: 0 };
  assert.ok(Math.abs(raySphere(o, { x: 0, y: 0, z: 1 }, { x: 0, y: 0, z: 10 }, 2) - 8) < 1e-9);
  assert.equal(raySphere(o, { x: 0, y: 0, z: -1 }, { x: 0, y: 0, z: 10 }, 2), -1);
  assert.equal(raySphere(o, { x: 1, y: 0, z: 0 }, { x: 0, y: 0, z: 10 }, 2), -1);
});
