import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createParticles, blastSize, BLAST } from '../src/fx/fireSim.js';

const run = (p, s, dt = 1 / 60) => { for (let t = 0; t < s; t += dt) p.step(dt); };

test('fogo sobe e cresce; morre no fim da vida', () => {
  const p = createParticles(8, { buoyancy: 7, drag: 2.4 });
  const i = p.spawn(0, 10, 0, 0, 0, 0, 1, 2, 12);
  run(p, 0.5);
  assert.ok(p.pos[i * 3 + 1] > 10.5, `subiu só até ${p.pos[i * 3 + 1]}`);
  assert.ok(p.size(i) > 7, `tamanho ${p.size(i)}`);
  run(p, 0.6);
  assert.equal(p.t(i), 1, 'morta');
});

test('brasas caem com a gravidade; o arrasto freia', () => {
  const p = createParticles(8, { gravity: 9.8, drag: 0.35 });
  const i = p.spawn(0, 10, 0, 20, 0, 0, 3, 0.2, 0.1);
  run(p, 1);
  assert.ok(p.vel[i * 3 + 1] < -8, `vy ${p.vel[i * 3 + 1]}`);
  assert.ok(p.vel[i * 3] < 20 && p.vel[i * 3] > 12, `vx ${p.vel[i * 3]}`);
});

test('fumaça com espera: invisível (fração negativa, tamanho inicial) até a hora de aparecer', () => {
  const p = createParticles(4, { buoyancy: 2.6 });
  const i = p.spawn(0, 0, 0, 0, 0, 0, 6, 2, 20);
  p.age[i] = -0.3;
  assert.ok(p.t(i) < 0);
  assert.equal(p.size(i), 2);
  run(p, 0.4);
  assert.ok(p.t(i) > 0 && p.size(i) > 2);
});

test('pool em anel: a mais velha é reusada, e o contador para no tamanho do pool', () => {
  const p = createParticles(3);
  for (let k = 0; k < 5; k++) p.spawn(k, 0, 0, 0, 0, 0, 1, 1, 1);
  assert.equal(p.count, 3);
  assert.deepEqual([p.pos[0], p.pos[3], p.pos[6]], [3, 4, 2]);
});

test('explosão cresce com a força e fica nos limites', () => {
  const small = blastSize(0);
  const big = blastSize(1);
  assert.deepEqual([small.fire, small.radius], [BLAST.fire[0], BLAST.radius[0]]);
  assert.deepEqual([big.fire, big.smoke, big.embers, big.radius], [BLAST.fire[1], BLAST.smoke[1], BLAST.embers[1], BLAST.radius[1]]);
  assert.deepEqual(blastSize(7), big, 'acima de 1 é 1');
  const mid = blastSize(0.5);
  for (const k of ['fire', 'smoke', 'embers', 'radius', 'flash']) assert.ok(mid[k] > small[k] && mid[k] < big[k], k);
});
