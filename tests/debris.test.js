import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDebris } from '../src/fx/debrisSim.js';

const flat = () => 0;
const run = (d, seconds, groundAt = flat, dt = 1 / 60) => { for (let t = 0; t < seconds; t += dt) d.step(dt, groundAt); };

test('entulho: cai, quica, para no chão e dorme', () => {
  const d = createDebris(8);
  d.spawn(0, 20, 0, 6, 4, -3, 0.8, 5, 3, 1);
  run(d, 8);
  assert.ok(Math.abs(d.pos[1] - 0.4) < 1e-4, `y = ${d.pos[1]}`);
  assert.equal(d.awake[0], 0);
});

test('entulho: nenhum pedaço fica abaixo do chão', () => {
  const d = createDebris(200);
  for (let i = 0; i < 200; i++) d.spawn(i % 20, 5 + (i % 7), 0, (i % 11) - 5, (i % 5) * 3, (i % 13) - 6, 0.2 + (i % 4) * 0.3, i % 9, 1, 2);
  for (let t = 0; t < 6; t += 1 / 60) {
    d.step(1 / 60, flat);
    for (let i = 0; i < d.count; i++) assert.ok(d.pos[i * 3 + 1] >= d.size[i] / 2 - 1e-5, `pedaço ${i} abaixo do chão`);
  }
});

test('entulho: bate na parede de um prédio mais alto em vez de subir no telhado', () => {
  const building = (x) => (x > 5 ? 50 : 0);
  const d = createDebris(4);
  d.spawn(0, 2, 0, 30, 0, 0, 0.5, 0, 0, 0);
  run(d, 3, building);
  assert.ok(d.pos[0] <= 5, `entrou no prédio: x = ${d.pos[0]}`);
  assert.ok(d.pos[1] < 10, `subiu no telhado: y = ${d.pos[1]}`);
});

test('entulho: pool cheio recicla o pedaço mais antigo', () => {
  const d = createDebris(4);
  for (let i = 0; i < 6; i++) d.spawn(i, 10, 0, 0, 0, 0, 1, 0, 0, 0);
  assert.equal(d.count, 4);
  // As vagas 0 e 1 foram reusadas pelos pedaços 4 e 5.
  assert.deepEqual([d.pos[0], d.pos[3], d.pos[6], d.pos[9]], [4, 5, 2, 3]);
});

test('entulho: a rotação continua unitária girando rápido', () => {
  const d = createDebris(1);
  d.spawn(0, 500, 0, 0, 0, 0, 1, 40, -25, 17);
  run(d, 3);
  const [x, y, z, w] = d.rot;
  assert.ok(Math.abs(Math.hypot(x, y, z, w) - 1) < 1e-5);
});
