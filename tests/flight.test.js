import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFlight, FLIGHT } from '../src/player/flight.js';
import { createCollisionWorld } from '../src/world/collision.js';

// Um prédio de 10 × 50 × 10 em x ∈ [0, 10], z ∈ [100, 110].
const world = createCollisionWorld([{ minX: 0, minY: 0, minZ: 100, maxX: 10, maxY: 50, maxZ: 110 }]);
const idle = { forward: 0, right: 0, up: 0, boost: false, jump: false };
const run = (f, input, seconds, dt = 1 / 60) => { for (let t = 0; t < seconds; t += dt) f.update(dt, input); };

function airborne(y = 100) {
  const f = createFlight(world, { x: 5, y, z: 0, yaw: 0 });
  f.update(1 / 60, { ...idle, jump: true });
  return f;
}

test('começa em pé no chão, com os pés no chão', () => {
  const f = createFlight(world, { x: 50, y: FLIGHT.footDepth, z: 0 });
  run(f, idle, 1);
  assert.equal(f.mode, 'ground');
  assert.ok(Math.abs(f.pos.y - FLIGHT.footDepth) < 1e-6);
});

test('pular decola e dispara o evento', () => {
  const f = createFlight(world, { x: 50, y: FLIGHT.footDepth, z: 0 });
  f.update(1 / 60, { ...idle, jump: true });
  assert.equal(f.mode, 'air');
  assert.ok(f.events.some((e) => e.type === 'takeoff'));
});

test('sem comando, pairar freia até quase parar', () => {
  const f = airborne();
  f.vel.set(40, 0, 0);
  run(f, idle, 3);
  assert.ok(f.speed < 0.5, `speed ${f.speed}`);
  assert.equal(f.pose, 'hover');
});

test('frente acelera até o cruzeiro e não passa dele', () => {
  const f = airborne(300);
  f.pos.set(-500, 300, -500);
  run(f, { ...idle, forward: 1 }, 5);
  assert.ok(f.speed > FLIGHT.cruise * 0.95 && f.speed <= FLIGHT.cruise + 1e-6, `speed ${f.speed}`);
  assert.equal(f.pose, 'fly');
});

test('boost segurado vira supersônico e cruza o som uma vez', () => {
  const f = airborne(300);
  f.pos.set(-3000, 300, -3000);
  run(f, { ...idle, forward: 1, boost: true }, 8);
  assert.ok(f.supersonic);
  assert.ok(f.speed > FLIGHT.sound, `speed ${f.speed}`);
  assert.equal(f.events.filter((e) => e.type === 'sonicboom').length, 1);
  assert.equal(f.pose, 'flyFast');
});

test('parede segura o herói e o impacto rápido é registrado', () => {
  const f = airborne(20);
  f.pos.set(5, 20, 50);
  f.vel.set(0, 0, 200);
  run(f, { ...idle, forward: 1, boost: true }, 1);
  assert.ok(f.pos.z < 100 - FLIGHT.radius + 0.01, `atravessou: z = ${f.pos.z}`);
  assert.ok(f.events.some((e) => e.type === 'impact'));
});

test('descer devagar até o telhado pousa em cima dele', () => {
  const f = airborne(60);
  f.pos.set(5, 60, 105);
  run(f, { ...idle, up: -1 }, 3);
  run(f, idle, 0.5);
  assert.equal(f.mode, 'ground');
  assert.ok(Math.abs(f.pos.y - (50 + FLIGHT.footDepth)) < 1e-6, `y = ${f.pos.y}`);
});

test('andar para fora da beirada do telhado volta a voar', () => {
  const f = createFlight(world, { x: 5, y: 50 + FLIGHT.footDepth, z: 105, yaw: 0 });
  run(f, { ...idle, forward: 1 }, 2);
  assert.equal(f.mode, 'air');
});

test('orientação: em pé fica vertical; voando rápido deita na direção do voo', () => {
  const f = airborne(300);
  f.pos.set(-500, 300, -500);
  run(f, { ...idle, forward: 1 }, 4);
  const head = { x: 0, y: 1, z: 0 };
  const q = f.orientation;
  // Cabeça (eixo +y local) no mundo ≈ +z (yaw 0).
  const hz = 2 * (q.y * q.z + q.w * q.x) * head.y;
  assert.ok(hz > 0.9, `cabeça z = ${hz}`);
});
