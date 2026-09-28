import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateLayout, collisionBoxes, blockBounds, isPark, parkBounds, streetOpen, streetLine, CITY, HALF, LANDMARK, PARK, QUAY, WATER_Y, LAWN } from '../src/world/layout.js';
import { createCollisionWorld } from '../src/world/collision.js';

const layout = generateLayout();

test('mesma semente gera a mesma cidade', () => {
  assert.deepEqual(generateLayout().buildings, layout.buildings);
  assert.notDeepEqual(generateLayout(7).buildings, layout.buildings);
});

test('nenhum prédio invade a rua ou a calçada', () => {
  for (const b of layout.buildings) {
    for (const t of b.tiers) {
      const cellI = Math.floor((t.x + HALF) / (CITY.block + CITY.street));
      const cellJ = Math.floor((t.z + HALF) / (CITY.block + CITY.street));
      const bb = blockBounds(cellI, cellJ);
      assert.ok(t.x - t.w / 2 >= bb.x0 + CITY.sidewalk - 1e-6, `x0 ${b.x}`);
      assert.ok(t.x + t.w / 2 <= bb.x1 - CITY.sidewalk + 1e-6, `x1 ${b.x}`);
      assert.ok(t.z - t.d / 2 >= bb.z0 + CITY.sidewalk - 1e-6, `z0 ${b.z}`);
      assert.ok(t.z + t.d / 2 <= bb.z1 - CITY.sidewalk + 1e-6, `z1 ${b.z}`);
    }
  }
});

test('o parque não tem prédio e o marco existe', () => {
  const p = parkBounds();
  for (const b of layout.buildings) assert.ok(!(b.x > p.x0 && b.x < p.x1 && b.z > p.z0 && b.z < p.z1));
  const lm = layout.buildings.filter((b) => b.landmark);
  assert.equal(lm.length, 1);
  const bb = blockBounds(LANDMARK.i, LANDMARK.j);
  assert.ok(lm[0].x > bb.x0 && lm[0].x < bb.x1);
});

test('níveis empilham sem buraco e cada um cabe no de baixo', () => {
  for (const b of layout.buildings) {
    for (let k = 1; k < b.tiers.length; k++) {
      assert.equal(b.tiers[k].y0, b.tiers[k - 1].y1);
      assert.ok(b.tiers[k].w <= b.tiers[k - 1].w && b.tiers[k].d <= b.tiers[k - 1].d);
    }
    assert.equal(b.tiers.at(-1).y1, b.h);
  }
});

test('o centro é mais alto que o subúrbio', () => {
  const tall = layout.buildings.filter((b) => b.h > 150).length;
  assert.ok(tall > 10, `só ${tall} arranha-céus`);
  assert.ok(layout.buildings.length > 800);
});

test('ruas internas do parque ficam fechadas, as de fora abertas', () => {
  assert.equal(streetOpen('x', PARK.j0 + 1, PARK.i0), false);
  assert.equal(streetOpen('z', PARK.i0 + 1, PARK.j0), false);
  assert.equal(streetOpen('x', PARK.j0, PARK.i0), true); // borda do parque
  assert.equal(streetOpen('x', 0, 0), true);
  assert.ok(isPark(PARK.i0, PARK.j0) && !isPark(0, 0));
});

test('caixas de colisão: uma por nível, mais o globo, a laje da ilha e o gramado', () => {
  const n = layout.buildings.reduce((s, b) => s + b.tiers.length + (b.globe ? 1 : 0), 0);
  assert.equal(collisionBoxes(layout).length, n + 2);
});

test('chão da colisão igual ao da cena: rua 0, gramado LAWN, mar WATER_Y', () => {
  // Com o piso fixo em y = 0, o herói pousava com as pernas enterradas no parque e em pé
  // 1,2 m acima da água.
  const world = createCollisionWorld(collisionBoxes(layout), { floor: WATER_Y });
  const p = layout.park;
  assert.equal(world.heightAt((p.x0 + p.x1) / 2, (p.z0 + p.z1) / 2), LAWN);
  assert.equal(world.heightAt(streetLine(0), streetLine(0)), 0); // cruzamento da borda
  assert.equal(world.heightAt(HALF + QUAY + 50, 0), WATER_Y);
  const hit = {};
  assert.ok(world.raycast({ x: HALF + QUAY + 50, y: 30, z: 0 }, { x: 0, y: -1, z: 0 }, 100, hit));
  assert.ok(Math.abs(hit.dist - (30 - WATER_Y)) < 1e-9, `raio no mar parou em ${hit.dist}`);
});
