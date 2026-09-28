import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GeoBuilder, addWalls, addTop, addBox, cutTier } from '../src/world/buildingGeo.js';
import { FACADE_TILE } from '../src/world/textures.js';

// Um nível de 20 × 60 × 10 m montado como na cidade: paredes, telhado e cornija.
function tierArrays() {
  const tier = { x: 5, z: 5, y0: 0, y1: 60 };
  const walls = new GeoBuilder();
  const roofs = new GeoBuilder();
  const trims = new GeoBuilder();
  addWalls(walls, -5, 0, 0, 15, 60, 10, 0.25, 0.5);
  addTop(roofs, -5, 60, 0, 15, 10, 10);
  addBox(trims, -5.6, 58.6, -0.6, 15.6, 60.9, 10.6, 4, false);
  const arr = { wallPos: Float32Array.from(walls.pos), wallUv: Float32Array.from(walls.uv), roofPos: Float32Array.from(roofs.pos), trimPos: Float32Array.from(trims.pos) };
  return { tier, ref: { wall: 0, roof: 0, trim: 0 }, arr };
}
const point = (pos, i) => Array.from(pos.slice(i * 3, i * 3 + 3));

test('corte no meio: paredes baixam até o corte com a textura na mesma escala; cornija some', () => {
  const { tier, ref, arr } = tierArrays();
  const uv0 = arr.wallUv.slice();
  assert.ok(cutTier(arr, ref, tier, 24, 0.5));
  for (let i = 0; i < 16; i++) {
    const top = i % 4 >= 2; // TR e TL de cada face
    assert.equal(arr.wallPos[i * 3 + 1], top ? 24 : 0);
    // v = y / altura do ladrilho + deslocamento: mesmos andares por metro, janelas sem esticar.
    const v = top ? 24 / FACADE_TILE.h + 0.5 : uv0[i * 2 + 1];
    assert.ok(Math.abs(arr.wallUv[i * 2 + 1] - v) < 1e-5, `v do vértice ${i}`);
  }
  for (let k = 0; k < 4; k++) assert.equal(arr.roofPos[k * 3 + 1], 24);
  for (let i = 1; i < 16; i++) assert.deepEqual(point(arr.trimPos, i), point(arr.trimPos, 0));
});

test('corte acima do topo não mexe; na base, o nível inteiro vira um ponto', () => {
  const a = tierArrays();
  const before = a.arr.wallPos.slice();
  assert.equal(cutTier(a.arr, a.ref, a.tier, 80, 0.5), false);
  assert.deepEqual(a.arr.wallPos, before);

  const b = tierArrays();
  assert.ok(cutTier(b.arr, b.ref, b.tier, 0, 0.5));
  for (let i = 1; i < 16; i++) assert.deepEqual(point(b.arr.wallPos, i), point(b.arr.wallPos, 0));
  for (let i = 1; i < 4; i++) assert.deepEqual(point(b.arr.roofPos, i), point(b.arr.roofPos, 0));
});

test('cortes sucessivos só descem (o esmagamento é monotônico)', () => {
  const { tier, ref, arr } = tierArrays();
  for (const y of [50, 36, 20, 6]) {
    cutTier(arr, ref, tier, y, 0.5);
    assert.equal(arr.wallPos[2 * 3 + 1], y);
  }
});
