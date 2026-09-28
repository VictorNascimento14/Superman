import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCollisionWorld } from '../src/world/collision.js';

const box = { minX: 0, minY: 0, minZ: 0, maxX: 10, maxY: 50, maxZ: 10 };
const world = createCollisionWorld([box, { minX: 100, minY: 0, minZ: 0, maxX: 110, maxY: 20, maxZ: 10 }]);
const n = { x: 0, y: 0, z: 0 };
const hit = {};

test('esfera encostada na parede é empurrada para fora', () => {
  const p = { x: -0.5, y: 20, z: 5 };
  assert.ok(world.resolveSphere(p, 1, n));
  assert.ok(Math.abs(p.x - -1) < 1e-9);
  assert.ok(n.x < 0);
});

test('esfera dentro da caixa sai pela face mais próxima', () => {
  const p = { x: 5, y: 49, z: 5 };
  world.resolveSphere(p, 1, n);
  assert.ok(Math.abs(p.y - 51) < 1e-9, `y = ${p.y}`);
  assert.equal(n.y, 1);
});

test('esfera longe não é tocada; chão segura em y = r', () => {
  const p = { x: 50, y: 0.2, z: 50 };
  assert.ok(world.resolveSphere(p, 1, n));
  assert.equal(p.y, 1);
  const q = { x: 50, y: 30, z: 50 };
  assert.equal(world.resolveSphere(q, 1, n), false);
});

test('raio acerta a parede mais próxima com a normal certa', () => {
  assert.ok(world.raycast({ x: -20, y: 10, z: 5 }, { x: 1, y: 0, z: 0 }, 500, hit));
  assert.ok(Math.abs(hit.dist - 20) < 1e-9);
  assert.equal(hit.nx, -1);
  assert.equal(hit.box, 0);
});

test('raio acerta o segundo prédio quando passa por cima do primeiro', () => {
  assert.ok(world.raycast({ x: -20, y: 15, z: 5 }, { x: 1, y: 0, z: 0 }, 500, hit));
  assert.equal(hit.box, 0);
  assert.ok(world.raycast({ x: 50, y: 15, z: 5 }, { x: 1, y: 0, z: 0 }, 500, hit));
  assert.equal(hit.box, 1);
  assert.ok(Math.abs(hit.dist - 50) < 1e-9);
});

test('raio para baixo acerta o chão; raio para cima não acerta nada', () => {
  const d = Math.SQRT1_2;
  assert.ok(world.raycast({ x: 50, y: 10, z: 50 }, { x: d, y: -d, z: 0 }, 500, hit));
  assert.equal(hit.ny, 1);
  assert.ok(Math.abs(hit.y) < 1e-9);
  assert.equal(world.raycast({ x: 50, y: 10, z: 50 }, { x: 0, y: 1, z: 0 }, 500, hit), false);
});

test('altura do telhado sob um ponto', () => {
  assert.equal(world.heightAt(5, 5), 50);
  assert.equal(world.heightAt(105, 5), 20);
  assert.equal(world.heightAt(50, 50), 0);
});
