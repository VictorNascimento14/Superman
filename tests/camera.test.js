import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PerspectiveCamera, Vector3 } from 'three';
import { createChaseCamera } from '../src/player/camera.js';
import { createCollisionWorld } from '../src/world/collision.js';

// Prédio à direita do herói: com yaw 0 ele olha para +z, e a direita é −x.
const box = { minX: -20, minY: 0, minZ: -50, maxX: 0, maxY: 60, maxZ: 50 };
const world = createCollisionWorld([box]);
const inside = (p) => p.x > box.minX && p.x < box.maxX && p.y > box.minY && p.y < box.maxY && p.z > box.minZ && p.z < box.maxZ;

test('câmera: encostado numa parede à direita, não entra no prédio', () => {
  // O ombro (1,1 m; 1,7 m mirando) caía dentro do prédio e o raycast ignora a caixa que
  // contém a origem: a câmera atravessava a parede e o prédio sumia da tela.
  for (const aiming of [false, true]) {
    const camera = new PerspectiveCamera(62, 16 / 9, 0.1, 5000);
    const chase = createChaseCamera(camera, world);
    // Esfera de colisão (raio 0,9) tangente à parede x = 0.
    const flight = { pos: new Vector3(0.9, 20, 0), yaw: 0, pitch: 0, speed: 0, mode: 'air' };
    for (let i = 0; i < 120; i++) chase.update(1 / 60, flight, aiming); // ombro e distância convergem
    const p = camera.position;
    assert.ok(!inside(p), `mirando=${aiming}: câmera dentro do prédio em (${p.x.toFixed(2)}, ${p.y.toFixed(2)}, ${p.z.toFixed(2)})`);
  }
});
