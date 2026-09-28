import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFlight, FLIGHT, SMASH } from '../src/player/flight.js';
import { createCollisionWorld } from '../src/world/collision.js';
import { EARTH, SPACE } from '../src/space/nav.js';
import { solarSystem, SUN_I } from '../src/space/bodies.js';
import { Vector3 } from 'three';

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

test('bater num prédio voando rente ao chão não lança o herói para cima', () => {
  // Chão e parede no mesmo subpasso: somar as normais dava a diagonal (0,71; 0,71), e o
  // corte convertia metade da velocidade horizontal em subida — o herói escalava a parede.
  const f = airborne();
  f.pos.set(5, FLIGHT.radius, 60);
  f.vel.set(0, 0, FLIGHT.cruise);
  f.pitch = -0.1; // nariz levemente para baixo: fica raspando o chão
  run(f, { ...idle, forward: 1 }, 1.5);
  assert.ok(f.pos.z < 100 - FLIGHT.radius + 0.01, `atravessou: z = ${f.pos.z}`);
  assert.ok(f.pos.y < 3, `lançado para cima: y = ${f.pos.y.toFixed(1)}, vy = ${f.vel.y.toFixed(1)}`);
});

// O mesmo prédio, quebrável (como os da cidade), e um bem fundo para frear lá dentro.
const breakable = createCollisionWorld([{ minX: 0, minY: 0, minZ: 100, maxX: 10, maxY: 50, maxZ: 110, breakable: true }]);
const deep = createCollisionWorld([{ minX: 0, minY: 0, minZ: 100, maxX: 10, maxY: 50, maxZ: 300, breakable: true }]);
function flyingIn(w) {
  const f = createFlight(w, { x: 5, y: 100, z: 0, yaw: 0 });
  f.update(1 / 60, { ...idle, jump: true });
  return f;
}
const breaches = (f) => f.events.filter((e) => e.type === 'breach');

test('rápido contra um prédio: fura, atravessa e sai do outro lado mais devagar', () => {
  const f = flyingIn(breakable);
  f.pos.set(5, 20, 90);
  f.vel.set(0, 0, 150);
  run(f, { ...idle, forward: 1, boost: true }, 0.4);
  assert.ok(f.pos.z > 110 + FLIGHT.radius, `não saiu: z = ${f.pos.z}`);
  const [inn, out] = breaches(f);
  assert.equal(breaches(f).length, 2);
  assert.ok(inn.entry && Math.abs(inn.at.z - 100) < 0.5 && inn.normal.z < -0.99, 'furo de entrada fora da face da frente');
  assert.ok(!out.entry && Math.abs(out.at.z - 110) < 0.5 && out.normal.z > 0.99, 'furo de saída fora da face de trás');
  assert.ok(out.speed < inn.speed, `saiu a ${out.speed} m/s, entrou a ${inn.speed}`);
});

test('devagar contra o prédio: ele continua sólido', () => {
  const f = flyingIn(breakable);
  f.pos.set(5, 20, 95);
  f.vel.set(0, 0, SMASH.speed - 10);
  run(f, { ...idle, forward: 1 }, 1);
  assert.ok(f.pos.z < 100 - FLIGHT.radius + 0.01, `atravessou: z = ${f.pos.z}`);
  assert.equal(breaches(f).length, 0);
});

test('raspar a parede de lado em alta velocidade não fura', () => {
  // Fachada comprida: vindo de lado, o herói só roça a face z = 100 (de frente numa quina, fura).
  const f = flyingIn(createCollisionWorld([{ minX: -200, minY: 0, minZ: 100, maxX: 200, maxY: 50, maxZ: 110, breakable: true }]));
  f.pos.set(-100, 20, 99);
  f.vel.set(150, 0, 5); // quase paralelo à face
  run(f, idle, 0.5);
  assert.equal(breaches(f).length, 0);
  assert.ok(f.pos.z < 100 - FLIGHT.radius + 0.01);
});

test('lá dentro, devagar, não pousa no telhado nem fica preso', () => {
  // heightAt dentro do prédio é o telhado: pousar ali teleportava o herói 30 m para cima.
  const f = flyingIn(deep);
  f.pos.set(5, 20, 99); // encosta já no primeiro quadro: sem comando, o herói freia sozinho
  f.vel.set(0, 0, SMASH.speed + 10);
  run(f, idle, 1.5);
  assert.equal(f.mode, 'air');
  assert.ok(f.pos.y < 30, `teleportou: y = ${f.pos.y}`);
  assert.ok(f.speed >= SMASH.min - 1e-6, `parou lá dentro: ${f.speed} m/s`);
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

// --- Espaço em escala real.
const boostUp = { ...idle, forward: 1, boost: true };
function inSpace(x, y, z, pitch) {
  const f = airborne();
  f.pos.set(x, y, z);
  f.vel.set(0, 0, 0);
  f.pitch = pitch;
  return f;
}

test('espaço: com boost a subida é exponencial — 20 km → 20.000 km em menos de 15 s', () => {
  const f = inSpace(0, 25e3, 0, 1.45);
  let t = 0;
  while (f.altitude < 2e7 && t < 30) { f.update(1 / 60, boostUp); t += 1 / 60; }
  assert.ok(t < 15, `levou ${t.toFixed(1)} s`);
});

test('espaço: descendo a toda (C + boost) sobre a cidade, chega sem atravessar a superfície', () => {
  // Com o pitch limitado a 83°, "mirar para baixo" ainda deriva 12% na horizontal: de 20.000 km
  // cairia a milhares de km da cidade. Descer na vertical é a tecla de descer.
  const f = inSpace(0, 2e7, 0, 0);
  let low = Infinity;
  for (let t = 0; t < 40; t += 1 / 60) {
    f.update(1 / 60, { ...idle, up: -1, boost: true });
    low = Math.min(low, f.altitude);
  }
  assert.ok(low > -1, `atravessou: ${low} m`);
  assert.ok(f.altitude < 50, `não chegou: ${f.altitude} m`);
});

test('espaço: longe da cidade não desce abaixo do piso — só Metrópolis tem chão', () => {
  const a = 5e5 / EARTH.radius; // 500 km da cidade pela superfície, 100 km de altitude
  const r = EARTH.radius + 1e5;
  const f = inSpace(Math.sin(a) * r, Math.cos(a) * r - EARTH.radius, 0, -1.45);
  let low = Infinity;
  for (let t = 0; t < 20; t += 1 / 60) {
    f.update(1 / 60, boostUp);
    low = Math.min(low, f.altitude);
  }
  assert.ok(low > SPACE.floor - 1, `desceu a ${low} m`);
});

test('espaço: do outro lado da Terra, o chão plano da cidade não puxa o herói', () => {
  const f = inSpace(0, -2 * EARTH.radius - 5e5, 0, 0);
  run(f, idle, 1);
  assert.ok(f.pos.y < -EARTH.radius, `puxado para y = ${f.pos.y}`);
  assert.ok(Math.abs(f.altitude - 5e5) < 1, `altitude ${f.altitude}`);
});

// --- Sistema solar: a mesma lei de velocidade, com o corpo mais perto no lugar da Terra.
const solar = solarSystem(new Vector3(0.3, 0.5, -0.8).normalize());
const surface = (f, b) => Math.hypot(f.pos.x - b.x, f.pos.y - b.y, f.pos.z - b.z) - b.radius;
function aimAt(f, b) {
  const d = new Vector3(b.x - f.pos.x, b.y - f.pos.y, b.z - f.pos.z).normalize();
  f.yaw = Math.atan2(d.x, d.z);
  f.pitch = Math.asin(d.y);
}

test('sistema solar: da Terra ao Sol com boost leva de 10 s a 60 s, e para sem atravessar', () => {
  const sun = solar[SUN_I];
  const f = inSpace(0, 25e3, 0, 0);
  f.bodies = solar;
  aimAt(f, sun);
  let t = 0;
  let low = Infinity;
  while (surface(f, sun) > 1e8 && t < 90) {
    f.update(1 / 60, boostUp);
    t += 1 / 60;
  }
  assert.ok(t > 10 && t < 60, `levou ${t.toFixed(1)} s`);
  for (let k = 0; k < 20 * 60; k++) {
    f.update(1 / 60, boostUp);
    low = Math.min(low, surface(f, sun));
  }
  assert.ok(low > sun.floor - 1, `desceu a ${low} m da superfície do Sol`);
  assert.equal(f.nearest.i, SUN_I);
});

test('sistema solar: mergulhando em Júpiter a toda, para no piso dele e não atravessa', () => {
  const jup = solar.find((b) => b.name === 'JÚPITER');
  const f = inSpace(jup.x, jup.y, jup.z - 1e9, 0);
  f.bodies = solar;
  aimAt(f, jup);
  let low = Infinity;
  for (let t = 0; t < 30; t += 1 / 60) {
    f.update(1 / 60, boostUp);
    low = Math.min(low, surface(f, jup));
  }
  assert.ok(low > jup.floor - 1, `desceu a ${low} m`);
  assert.ok(surface(f, jup) < 2 * jup.floor, `não chegou: ${surface(f, jup)} m`);
  assert.equal(solar[f.nearest.i].name, 'JÚPITER');
});
