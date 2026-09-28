import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFall, FALL } from '../src/world/fall.js';

const block = (segments, dir = { x: 1, z: 0 }) => ({ x: 0, z: 0, base: 30, width: 30, depth: 24, dir, segments });
const three = [{ y0: 30, y1: 70 }, { y0: 70, y1: 110 }, { y0: 110, y1: 150 }];
const fixed = () => 0.5; // sem sorteio: o teste é determinístico
function run(f, seconds, groundAt = () => 0) {
  let t = 0;
  while (t < seconds && f.step(1 / 60, groundAt)) t += 1 / 60;
  return t;
}

test('queda: antes de quebrar o bloco desce inteiro e tomba para o lado do golpe', () => {
  const f = createFall(block(three), fixed);
  const gap = () => f.segs[2].pos.distanceTo(f.segs[0].pos);
  const g0 = gap();
  run(f, FALL.breakAt - 0.1);
  assert.ok(!f.broken);
  assert.ok(Math.abs(gap() - g0) < 1e-6, 'rígido');
  assert.ok(f.segs[2].pos.x > 5, `o topo foi para +x: ${f.segs[2].pos.x.toFixed(1)}`);
  assert.ok(Math.abs(f.segs[2].pos.z) < 1e-6, 'não para o lado');
  assert.ok(f.crushY < 30, 'esmagou o toco');
});

test('queda: depois da quebra os segmentos se soltam, e todos chegam ao chão uma vez só', () => {
  const f = createFall(block(three), fixed);
  run(f, FALL.breakAt + 0.05);
  assert.ok(f.broken);
  assert.equal(f.events.filter((e) => e.type === 'break').length, 1);
  const d0 = f.segs[2].pos.distanceTo(f.segs[1].pos);
  run(f, 1);
  assert.ok(f.segs[2].pos.distanceTo(f.segs[1].pos) > d0 + 1, 'separaram');
  const t = run(f, 30);
  assert.ok(t < 20, `ainda caindo depois de ${t.toFixed(1)} s`);
  const ground = f.events.filter((e) => e.type === 'ground').map((e) => e.segment).sort();
  assert.deepEqual(ground, [0, 1, 2]);
  assert.ok(f.crushY === -Infinity, 'o de baixo afundou até o fim');
});

test('queda: um segmento que cai sobre um telhado vizinho se desfaz lá em cima', () => {
  const f = createFall(block(three), fixed);
  const roof = (x) => (x > 40 ? 60 : 0); // vizinho de 60 m do lado do golpe
  run(f, 30, roof);
  const high = f.events.filter((e) => e.type === 'ground' && e.floor === 60);
  assert.ok(high.length >= 1, 'algum caiu no vizinho');
  for (const e of high) assert.ok(e.at.x > 40);
});

test('queda: o lado do tombo segue a direção do golpe', () => {
  const f = createFall(block(three, { x: 0, z: -1 }), fixed);
  run(f, FALL.breakAt - 0.1);
  assert.ok(f.segs[2].pos.z < -5 && Math.abs(f.segs[2].pos.x) < 1e-6);
});

test('queda: corte limpo (visão de calor) não esmaga o toco, só tomba e escorrega para fora', () => {
  const f = createFall(block(three), fixed, { crushG: 0, tiltAccel: 1.1 });
  run(f, FALL.breakAt - 0.1);
  assert.equal(f.crushY, 30, 'o toco fica na altura do corte');
  assert.ok(f.tilt > 0.5, `tombou só ${f.tilt.toFixed(2)} rad`);
});
