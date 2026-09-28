import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSolar, solarFlux, SOLAR } from '../src/powers/solar.js';
import { SUN, AU } from '../src/space/bodies.js';

const step = (s, flux, firing, seconds, dt = 1 / 60) => {
  const events = [];
  for (let t = 0; t < seconds; t += dt) {
    const e = s.update(dt, flux, firing);
    if (e) events.push(e);
  }
  return events;
};
const timeTo = (s, flux, firing, done) => {
  let t = 0;
  while (!done(s.charge) && t < 1000) { s.update(1 / 60, flux, firing); t += 1 / 60; }
  return t;
};

test('fluxo do Sol: inverso do quadrado, 1 rente à superfície e nada na sombra', () => {
  assert.equal(solarFlux(SUN.radius, 1), 1);
  assert.equal(solarFlux(2 * SUN.radius, 1), 0.25);
  assert.ok(solarFlux(AU, 1) < 3e-5, 'na Terra o Sol mal carrega');
  assert.equal(solarFlux(1.1 * SUN.radius, 0), 0, 'eclipse: nada chega');
});

test('carga solar: rente ao Sol enche em ~5 s e avisa; na Terra não enche nada', () => {
  const s = createSolar();
  const t = timeTo(s, solarFlux(1.01 * SUN.radius, 1), false, (c) => c >= 1);
  assert.ok(t > 4 && t < 7, `encheu em ${t.toFixed(1)} s`);
  const earth = createSolar();
  step(earth, solarFlux(AU, 1), false, 60);
  assert.equal(earth.charge, 0);
  assert.deepEqual(step(createSolar(), 1, false, 6), ['full']);
});

test('carga solar: cheia, dura 4 minutos longe do Sol; a visão de calor carregada gasta mais', () => {
  const idle = createSolar();
  idle.charge = 1;
  const t = timeTo(idle, 0, false, (c) => c <= 0);
  assert.ok(Math.abs(t - 240) < 1, `durou ${t.toFixed(1)} s`);
  const firing = createSolar();
  firing.charge = 1;
  const tf = timeTo(firing, 0, true, (c) => c <= 0);
  assert.ok(Math.abs(tf - 1 / (SOLAR.drain + SOLAR.beam)) < 1, `disparando durou ${tf.toFixed(1)} s`);
  const s = createSolar();
  s.charge = 0.01;
  assert.deepEqual(step(s, 0, true, 2), ['empty']);
});

test('carga solar: a ~7 raios do centro, o que entra empata com o que sai', () => {
  const r = SUN.radius * Math.sqrt(SOLAR.fill / SOLAR.drain);
  assert.ok(r / SUN.radius > 6 && r / SUN.radius < 8, `equilíbrio a ${(r / SUN.radius).toFixed(1)} raios`);
  const s = createSolar();
  s.charge = 0.5;
  step(s, solarFlux(r, 1), false, 30);
  assert.ok(Math.abs(s.charge - 0.5) < 1e-6, `saiu do equilíbrio: ${s.charge}`);
});
