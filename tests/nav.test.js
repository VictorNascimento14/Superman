import { test } from 'node:test';
import assert from 'node:assert/strict';
import { altitude, fromCity, nearCity, upAt, speedCap, EARTH, SPACE } from '../src/space/nav.js';

const close = (a, b, eps, msg) => assert.ok(Math.abs(a - b) < eps, `${msg}: ${a} × ${b}`);

test('altitude: na cidade é a altura; longe na horizontal o plano sobe acima da esfera', () => {
  close(altitude({ x: 0, y: 0, z: 0 }), 0, 1e-6, 'centro da cidade');
  close(altitude({ x: 0, y: 1000, z: 0 }), 1000, 1e-6, '1 km acima');
  // A 1.000 km na horizontal (reto, sem curvar), a Terra já ficou ~78 km para baixo.
  close(altitude({ x: 1e6, y: 0, z: 0 }), Math.hypot(EARTH.radius, 1e6) - EARTH.radius, 1e-3, 'plano tangente');
  close(altitude({ x: 0, y: -2 * EARTH.radius - 1000, z: 0 }), 1000, 1e-3, 'do outro lado da Terra');
});

test('distância da cidade pela superfície e a vertical local', () => {
  close(fromCity({ x: 0, y: 4e5, z: 0 }), 0, 1e-6, 'bem em cima da cidade');
  close(fromCity({ x: 0, y: -2 * EARTH.radius, z: 0 }), Math.PI * EARTH.radius, 1, 'antípoda');
  const up = upAt({ x: 1e7, y: -EARTH.radius, z: 0 }, {});
  close(up.x, 1, 1e-9, 'vertical no equador do mapa');
  assert.ok(nearCity({ x: 100, y: 50, z: -300 }));
  assert.ok(!nearCity({ x: 0, y: 5e3, z: 0 }), 'alto demais');
  assert.ok(!nearCity({ x: 1e5, y: 0, z: 0 }), 'longe demais');
});

test('teto de velocidade: voo normal perto do chão, proporcional à altitude no espaço', () => {
  assert.equal(speedCap(100, 420), 420);
  assert.equal(speedCap(1e6, 420), SPACE.cap * 1e6);
});
