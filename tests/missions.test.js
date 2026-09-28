import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ringCrossed, makeRingCourse, stepFaller, tryCatch, burnDrone, FALL } from '../src/game/missionLogic.js';
import { createRng } from '../src/core/rng.js';
import { generateLayout, collisionBoxes, HALF } from '../src/world/layout.js';
import { createCollisionWorld } from '../src/world/collision.js';

const ring = { x: 0, y: 50, z: 0, radius: 10, normal: { x: 0, y: 0, z: 1 } };

test('anel: atravessar por dentro conta, por fora não, e 7 m por quadro ainda conta', () => {
  assert.ok(ringCrossed({ x: 0, y: 50, z: -1 }, { x: 0, y: 50, z: 1 }, ring));
  assert.ok(ringCrossed({ x: 3, y: 55, z: -4 }, { x: 3, y: 55, z: 3 }, ring));
  assert.ok(!ringCrossed({ x: 12, y: 50, z: -1 }, { x: 12, y: 50, z: 1 }, ring));
  assert.ok(!ringCrossed({ x: 0, y: 50, z: 1 }, { x: 0, y: 50, z: 3 }, ring));
});

test('percurso: anéis dentro da ilha, acima dos telhados e com normal unitária', () => {
  const collision = createCollisionWorld(collisionBoxes(generateLayout()));
  for (let seed = 1; seed <= 20; seed++) {
    const rings = makeRingCourse(createRng(seed), { x: 0, y: 100, z: 0 }, seed, collision);
    assert.ok(rings.length >= 6, `seed ${seed}: só ${rings.length} anéis`);
    for (const r of rings) {
      assert.ok(Math.abs(r.x) < HALF && Math.abs(r.z) < HALF);
      assert.ok(r.y - r.radius > collision.heightAt(r.x, r.z) + 5, 'anel dentro de prédio');
      assert.ok(Math.abs(Math.hypot(r.normal.x, r.normal.y, r.normal.z) - 1) < 1e-9);
    }
  }
});

test('percurso: da beirada olhando para fora ou do mar, o circuito não sai vazio', () => {
  // Circuito vazio derrubava o jogo: ringCrossed(…, undefined) a cada quadro.
  const collision = createCollisionWorld(collisionBoxes(generateLayout()));
  const starts = [
    [{ x: HALF - 20, y: 100, z: 0 }, Math.PI / 2], // beirada leste, olhando para o mar
    [{ x: HALF + 400, y: 60, z: HALF + 400 }, 0], // sobre o mar, longe da ilha
    [{ x: -HALF - 250, y: 80, z: 200 }, -Math.PI / 2], // mar a oeste, olhando para fora
  ];
  for (const [start, yaw] of starts) {
    for (let seed = 1; seed <= 20; seed++) {
      const rings = makeRingCourse(createRng(seed), start, yaw, collision);
      assert.ok(rings.length >= 4, `seed ${seed} em (${start.x}, ${start.z}): só ${rings.length} anéis`);
      for (const r of rings) {
        assert.ok(Math.abs(r.x) < HALF && Math.abs(r.z) < HALF);
        assert.ok(r.y - r.radius > collision.heightAt(r.x, r.z) + 5, 'anel dentro de prédio');
      }
    }
  }
});

test('queda chega perto da velocidade terminal e termina no chão', () => {
  // v(t) = vt·tanh(g·t/vt): 97% da terminal em 12 s (e só 89% em 8 s).
  const f = { state: 'falling', y: 1000, vy: 0, ground: 0, x: 0, z: 0 };
  for (let i = 0; i < 60 * 12; i++) stepFaller(f, 1 / 60);
  assert.equal(f.state, 'falling');
  assert.ok(-f.vy > FALL.terminal * 0.95, `vy = ${f.vy}`);
  for (let i = 0; i < 60 * 30; i++) stepFaller(f, 1 / 60);
  assert.equal(f.state, 'lost');
  assert.equal(f.y, 0.9);
});

test('pegar só dentro do raio e só uma vez', () => {
  const f = { state: 'falling', x: 0, y: 100, z: 0 };
  assert.ok(!tryCatch(f, { x: 10, y: 100, z: 0 }));
  assert.ok(tryCatch(f, { x: 2, y: 101, z: 1 }));
  assert.equal(f.state, 'caught');
  assert.ok(!tryCatch(f, { x: 0, y: 100, z: 0 }));
});

test('drone morre uma vez, depois de ~1,25 s de fogo', () => {
  const d = { hp: 1 };
  let deaths = 0;
  let t = 0;
  while (t < 3) { if (burnDrone(d, 1 / 60)) deaths++; t += 1 / 60; if (deaths && t < 1.2) assert.fail('morreu cedo'); }
  assert.equal(deaths, 1);
});
