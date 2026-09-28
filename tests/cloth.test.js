import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PlaneGeometry } from 'three';
import { createCloth, gridNormals } from '../src/player/cloth.js';

const G = [0, -9.8, 0];
const still = [0, 0, 0];
const make = () => {
  const c = createCloth({ cols: 6, rows: 10, topWidth: 0.5, bottomWidth: 0.9, length: 1.3 });
  c.reset({ x: 0, y: 2, z: 0 });
  return c;
};

test('pendurado em ar parado, o pano fica abaixo dos pinos e não estica demais', () => {
  const c = make();
  for (let i = 0; i < 300; i++) c.step(1 / 120, G, still, 2, 6);
  const bottom = c.at(3, 9) * 3;
  assert.ok(c.pos[bottom + 1] < 2 - 1.1, `y = ${c.pos[bottom + 1]}`);
  assert.ok(c.pos[bottom + 1] > 2 - 1.5, 'esticou além do comprimento');
  assert.equal(c.pos[c.at(0, 0) * 3 + 1], 2, 'pino se mexeu');
});

test('ar vindo de frente joga o pano para trás (como em voo)', () => {
  const c = make();
  for (let i = 0; i < 300; i++) c.step(1 / 120, G, [0, 0, -60], 8, 6);
  const bottom = c.at(3, 9) * 3;
  assert.ok(c.pos[bottom + 2] < -0.9, `z = ${c.pos[bottom + 2]}`);
});

// O herói simula a capa no referencial que o acompanha e limita o vento efetivo
// (acima de ~40 m/s a capa já está toda esticada): este é o pior caso real.
test('passo grande com vento no teto não explode', () => {
  const c = make();
  for (let i = 0; i < 200; i++) c.step(1 / 20, G, [0, 0, -45], 12, 4);
  for (const v of c.pos) assert.ok(Number.isFinite(v) && Math.abs(v) < 10);
});

test('colisão empurra partícula para fora', () => {
  const c = make();
  const collide = (p, o) => { if (p[o + 2] < 0.2) p[o + 2] = 0.2; };
  for (let i = 0; i < 100; i++) c.step(1 / 120, G, [0, 0, -20], 4, 4, collide);
  for (let i = c.cols; i < c.cols * c.rows; i++) assert.ok(c.pos[i * 3 + 2] >= 0.2 - 1e-6);
});

test('normais da grade iguais às do computeVertexNormals do three', () => {
  // A capa trocou o computeVertexNormals (alocava ~14 KB por quadro) pelo gridNormals: o
  // sombreamento tem de continuar o mesmo, inclusive nas dobras do pano em voo.
  const c = createCloth({ cols: 7, rows: 12, topWidth: 0.5, bottomWidth: 1.0, length: 1.4 });
  c.reset({ x: 0, y: 2, z: 0 });
  for (let i = 0; i < 90; i++) c.step(1 / 60, G, [-30, 5, -38], 3, 5);
  const geo = new PlaneGeometry(1, 1, c.cols - 1, c.rows - 1);
  geo.attributes.position.array.set(c.pos);
  geo.computeVertexNormals();
  const ref = geo.attributes.normal.array;
  const out = new Float32Array(c.pos.length);
  gridNormals(c.pos, c.cols, c.rows, out);
  for (let i = 0; i < out.length; i += 3) {
    const cos = out[i] * ref[i] + out[i + 1] * ref[i + 1] + out[i + 2] * ref[i + 2];
    assert.ok(cos > 0.9999, `vértice ${i / 3}: cosseno ${cos.toFixed(4)}`);
  }
});
