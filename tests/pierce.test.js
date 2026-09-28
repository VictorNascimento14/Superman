import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Vector3 } from 'three';
import { createPierce, assistAim, chord, PIERCE } from '../src/powers/pierce.js';
import { EARTH } from '../src/space/nav.js';
import { AU } from '../src/space/bodies.js';

const close = (a, b, eps, msg) => assert.ok(Math.abs(a - b) <= eps, `${msg}: ${a} × ${b}`);
const center = new Vector3(0, -EARTH.radius, 0);
// De `dist` m do centro da Terra, na direção `from` (unitária), olhando para o centro.
const at = (from, dist) => center.clone().addScaledVector(from, dist);
const toward = (o, p) => p.clone().sub(o).normalize();
const side = new Vector3(1, 0.2, -0.4).normalize(); // longe de Metrópolis (que fica em +y)

test('corda: do Sol, mirando o centro, entra a 1 UA − R e sai do outro lado', () => {
  const o = at(side, AU);
  const out = {};
  assert.ok(chord(o, toward(o, center), out));
  close(out.tIn, AU - EARTH.radius, 1, 'entrada');
  close(out.tOut - out.tIn, 2 * EARTH.radius, 1, 'diâmetro');
  assert.ok(!chord(o, toward(o, center).negate(), out), 'de costas para a Terra');
  assert.ok(!chord(o, toward(o, center.clone().add(new Vector3(0, 0, 3 * EARTH.radius))), out), 'passando ao lado');
});

test('mira assistida: perto do disco vai ao centro; no disco, fica onde o jogador mira', () => {
  const o = at(side, AU); // de lá a Terra tem 0,0024° de raio aparente
  const aim = {};
  const off = (deg) => toward(o, center).applyAxisAngle(new Vector3(0, 1, 0), (deg * Math.PI) / 180);
  assert.ok(assistAim(o, off(1.5), aim), '1,5° fora do disco');
  close(new Vector3(aim.x, aim.y, aim.z).dot(toward(o, center)), 1, 1e-12, 'foi ao centro');
  assert.ok(!assistAim(o, off(4), aim), '4° fora do disco: não assiste');
  const near = at(side, 2 * EARTH.radius); // de perto o disco é grande: mira livre
  const d = toward(near, center).applyAxisAngle(new Vector3(0, 0, 1), 0.2);
  assert.ok(assistAim(near, d, aim));
  close(new Vector3(aim.x, aim.y, aim.z).dot(d), 1, 1e-12, 'mira mantida');
});

test('buraco: abre na entrada e na saída, cresce enquanto o raio fica nele e continua lá', () => {
  const p = createPierce();
  const o = at(side, AU);
  const dir = toward(o, center);
  let opened = 0;
  for (let t = 0; t < 2; t += 1 / 60) if (p.update(1 / 60, o, dir, 1, true)?.opened) opened++;
  assert.equal(opened, 1);
  assert.equal(p.holes.length, 1);
  const h = p.holes[0];
  close(h.radius, PIERCE.start + PIERCE.grow * 2, PIERCE.grow / 30, 'raio depois de 2 s');
  close(h.entry.x * side.x + h.entry.y * side.y + h.entry.z * side.z, 1, 1e-9, 'entrada virada para o Sol');
  close(h.entry.x * h.exit.x + h.entry.y * h.exit.y + h.entry.z * h.exit.z, -1, 1e-9, 'saída nos antípodas');
  for (let t = 0; t < 30; t += 1 / 60) p.update(1 / 60, o, dir, 1, true);
  assert.equal(p.holes[0].radius, PIERCE.max);
  assert.equal(p.update(1 / 60, o, dir, 1, false), null, 'sem disparar, nada');
  assert.equal(p.holes.length, 1, 'o buraco fica');
});

test('buraco: a mira que tremeu continua no mesmo buraco, e ele desliza atrás do raio', () => {
  const p = createPierce();
  const o = at(side, 3 * EARTH.radius);
  const dir = toward(o, center);
  p.update(1 / 60, o, dir, 1, true);
  const first = { ...p.holes[0].entry };
  const moved = dir.clone().applyAxisAngle(new Vector3(0, 0, 1), 0.01); // ~120 km na superfície
  for (let t = 0; t < 2; t += 1 / 60) p.update(1 / 60, o, moved, 1, true);
  assert.equal(p.holes.length, 1);
  const shot = p.update(1 / 60, o, moved, 1, true);
  const h = p.holes[0].entry;
  const e = new Vector3(shot.entry.x, shot.entry.y, shot.entry.z).sub(center).normalize();
  assert.ok(Math.acos(Math.min(1, h.x * e.x + h.y * e.y + h.z * e.z)) * EARTH.radius < 5e3, 'o buraco foi para baixo do raio');
  assert.ok(first.x !== h.x, 'o centro andou');
});

test('buraco: cada lugar novo abre outro; do nono em diante, o mais antigo fecha', () => {
  const p = createPierce();
  for (let k = 0; k < PIERCE.count + 2; k++) {
    const from = new Vector3(Math.cos(k * 0.6), -0.3, Math.sin(k * 0.6)).normalize();
    const o = at(from, 3 * EARTH.radius);
    p.update(1 / 60, o, toward(o, center), 1, true);
  }
  assert.equal(p.holes.length, PIERCE.count);
});

test('Metrópolis é protegida, e sem carga o raio não atravessa', () => {
  const p = createPierce();
  const above = at(new Vector3(0, 1, 0), EARTH.radius + 2e7); // em cima da cidade
  const shot = p.update(1 / 60, above, toward(above, center), 1, true);
  assert.ok(shot.blocked, 'bloqueado');
  close(shot.entry.y, 0, 1, 'para na superfície, em cima da cidade');
  assert.equal(p.holes.length, 0);
  const o = at(side, AU);
  assert.equal(p.update(1 / 60, o, toward(o, center), PIERCE.min - 0.01, true), null);
});
