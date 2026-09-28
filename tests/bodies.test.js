import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Vector3 } from 'three';
import { solarSystem, sunlight, AU, PLANETS, MOON, SUN_I } from '../src/space/bodies.js';
import { nearestSurface, EARTH } from '../src/space/nav.js';
import { mapDist } from '../src/space/space.js';
import { distance } from '../src/ui/hud.js';

const close = (a, b, eps, msg) => assert.ok(Math.abs(a - b) <= eps, `${msg}: ${a} × ${b}`);
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
const sunDir = new Vector3(0.3, 0.5, -0.8).normalize();
const bodies = solarSystem(sunDir);
const byName = Object.fromEntries(bodies.map((b) => [b.name, b]));
const earth = bodies[0];
const sun = bodies[SUN_I];

test('sistema solar: a Terra no lugar da cidade e o Sol a 1 UA, na direção do sol do céu', () => {
  assert.deepEqual([earth.x, earth.y, earth.z], [0, -EARTH.radius, 0]);
  close(dist(earth, sun), AU, 1, 'Terra–Sol');
  close((sun.x - earth.x) / AU, sunDir.x, 1e-12, 'direção');
  close((sun.z - earth.z) / AU, sunDir.z, 1e-12, 'direção');
});

test('sistema solar: órbitas nos raios certos, todas no mesmo plano, e a Lua a 384.400 km', () => {
  for (const p of PLANETS) close(dist(byName[p.name], sun) / AU, p.orbit, 1e-9, p.name);
  close(dist(byName.LUA, earth), MOON.distance, 1e-3, 'Lua');
  // A normal do plano Terra–Sol–Júpiter: todo planeta fica nele (a eclíptica).
  const a = new Vector3(earth.x - sun.x, earth.y - sun.y, earth.z - sun.z);
  const b = new Vector3(byName['JÚPITER'].x - sun.x, byName['JÚPITER'].y - sun.y, byName['JÚPITER'].z - sun.z);
  const n = a.cross(b).normalize();
  for (const p of PLANETS) {
    const q = byName[p.name];
    close((n.x * (q.x - sun.x) + n.y * (q.y - sun.y) + n.z * (q.z - sun.z)) / AU, 0, 1e-9, `${p.name} fora do plano`);
  }
  // O eixo de Saturno inclinado 27° do "para cima" da câmera (os anéis abrem).
  close(Math.acos(byName.SATURNO.axis.y) * (180 / Math.PI), 27, 1e-6, 'inclinação de Saturno');
});

test('corpo mais perto: mede até a superfície, não até o centro', () => {
  const out = { i: -1, d: 0 };
  const jup = byName['JÚPITER'];
  nearestSurface(bodies, { x: jup.x, y: jup.y + jup.radius + 5e6, z: jup.z }, out);
  assert.equal(bodies[out.i].name, 'JÚPITER');
  close(out.d, 5e6, 1e-3, 'distância à superfície');
  nearestSurface(bodies, { x: 0, y: 1000, z: 0 }, out);
  assert.equal(out.i, 0);
  close(out.d, 1000, 1e-6, 'altitude na cidade');
});

test('luz do Sol: some na sombra da Terra e da Lua, mas a Terra vista de Marte não faz sombra', () => {
  const up = (b, dir, h) => ({ x: b.x + dir.x * (b.radius + h), y: b.y + dir.y * (b.radius + h), z: b.z + dir.z * (b.radius + h) });
  assert.equal(sunlight(bodies, up(earth, sunDir, 4e5)), 1, 'lado do dia');
  assert.equal(sunlight(bodies, up(earth, sunDir.clone().negate(), 4e5)), 0, 'lado da noite');
  const moon = byName.LUA;
  const fromSun = new Vector3(moon.x - sun.x, moon.y - sun.y, moon.z - sun.z).normalize();
  assert.equal(sunlight(bodies, up(moon, fromSun, 2e4)), 0, 'noite na Lua');
  // Bem atrás da Terra, a 0,5 UA: o disco dela é pequeno demais para cobrir o Sol.
  const far = { x: earth.x - sunDir.x * 0.5 * AU, y: earth.y - sunDir.y * 0.5 * AU, z: earth.z - sunDir.z * 0.5 * AU };
  assert.ok(sunlight(bodies, far) > 0.99, `sombra a 0,5 UA: ${sunlight(bodies, far)}`);
});

test('espaço escalado: igual até 100 km, depois cresce devagar sem nunca inverter a ordem', () => {
  assert.equal(mapDist(5e4), 5e4);
  let last = mapDist(1e5);
  for (let d = 1.5e5; d < 1e18; d *= 1.5) {
    const m = mapDist(d);
    assert.ok(m >= last, `ordem invertida em ${d}`);
    last = m;
  }
  assert.ok(mapDist(30 * AU) > mapDist(AU) + 1e5, 'Netuno bem atrás do Sol');
  assert.ok(mapDist(1e30) < 1.6e6, 'antes das estrelas');
});

test('HUD: distâncias legíveis em km, milhões e bilhões', () => {
  assert.equal(distance(384_400e3), '384.400 km');
  assert.equal(distance(1.5e9), '1,5 milhão de km');
  assert.equal(distance(149.6e9), '149,6 milhões de km');
  assert.equal(distance(628e9), '628 milhões de km');
  assert.equal(distance(4.5e12), '4,5 bilhões de km');
});
