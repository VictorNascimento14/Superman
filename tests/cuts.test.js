import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCuts, faceOf, CUT } from '../src/powers/cuts.js';

const dt = 1 / 60;
// Varre a face de 30 m em `seconds`, na altura y, com a carga dada; devolve os eventos.
function sweep(c, y, seconds, charge = 0, from = 0, to = 30) {
  const got = { slices: [], blasts: [] };
  const n = Math.round(seconds / dt);
  for (let k = 0; k <= n; k++) {
    const u = from + ((to - from) * k) / n;
    const r = c.hit(dt, 7, 2, u, 30, { x: u, y, z: 0 }, charge);
    if (r.slice !== null) got.slices.push(r.slice);
    if (r.blast) got.blasts.push(r.blast);
  }
  return got;
}

test('corte: varrer a largura da face fatia o prédio naquela altura, uma vez só', () => {
  const c = createCuts();
  const got = sweep(c, 21, 2);
  assert.deepEqual(got.slices, [21]);
  assert.ok(c.coverage(7, 2, 21) >= CUT.slice);
  assert.deepEqual(sweep(c, 20, 2).slices, [], 'a faixa já estava fatiada');
});

test('corte: a mira subindo e descendo na divisa de duas faixas ainda fatia', () => {
  const c = createCuts();
  let sliced = null;
  for (let k = 0; k <= 120; k++) {
    const u = (30 * k) / 120;
    const y = 32 + (k % 2 ? 1.5 : -1.5); // alterna entre as faixas de 24–32 m e 32–40 m
    const r = c.hit(dt, 7, 2, u, 30, { x: u, y, z: 0 }, 0);
    if (r.slice !== null) sliced = r.slice;
  }
  assert.ok(sliced !== null, 'não fatiou');
});

test('corte: metade da largura não fatia, e faixas diferentes não somam', () => {
  const c = createCuts();
  assert.deepEqual(sweep(c, 10, 1, 0, 0, 14).slices, []);
  assert.deepEqual(sweep(c, 30, 1, 0, 15, 30).slices, [], 'outra faixa');
  assert.ok(c.coverage(7, 2, 10) < CUT.slice && c.coverage(7, 2, 30) < CUT.slice);
});

test('corte: o raio parado estoura um furo; com a carga solar, bem mais rápido', () => {
  const time = (charge) => {
    const c = createCuts();
    let t = 0;
    for (;;) {
      t += dt;
      if (c.hit(dt, 3, 0, 5, 20, { x: 1, y: 12, z: 5 }, charge).blast || t > 5) return t;
    }
  };
  assert.ok(Math.abs(time(0) - CUT.dwell) < 0.05, `sem carga: ${time(0)}`);
  assert.ok(Math.abs(time(1) - CUT.dwellCharged) < 0.05, `carregado: ${time(1)}`);
});

test('corte: mexer o raio, trocar de prédio ou soltar recomeçam o "parado"', () => {
  const c = createCuts();
  const hold = (x, building, s) => { for (let t = 0; t < s; t += dt) if (c.hit(dt, building, 0, x, 30, { x, y: 12, z: 0 }, 0).blast) return true; return false; };
  assert.equal(hold(2, 1, 0.4), false);
  assert.equal(hold(6, 1, 0.4), false, 'andou 4 m: recomeçou');
  assert.equal(hold(6, 2, 0.4), false, 'outro prédio: recomeçou');
  c.release();
  assert.equal(hold(6, 2, 0.4), false, 'soltou: recomeçou');
  assert.equal(hold(6, 2, 0.4), true, 'agora sim');
});

test('face pela normal do acerto: qual lado, a coordenada ao longo dela e a largura', () => {
  const box = { minX: 10, maxX: 40, minZ: -5, maxZ: 15 };
  const f = {};
  assert.deepEqual(faceOf(box, 0, 1, { x: 25, z: 15 }, f), { face: 2, u: 15, len: 30 });
  assert.deepEqual(faceOf(box, -1, 0, { x: 10, z: 0 }, f), { face: 1, u: 5, len: 20 });
});
