import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PerspectiveCamera, Vector3, Group, Quaternion } from 'three';
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

test('câmera: com a origem flutuante longe (10⁹ m), a imagem sai idêntica', () => {
  // O mundo vive num grupo deslocado por −origem; a câmera é filha dele. Em espaço de render
  // tudo tem de bater com o mesmo voo perto da cidade — e com números pequenos.
  const empty = createCollisionWorld([]);
  const shoot = (far) => {
    const world = new Group();
    const camera = new PerspectiveCamera(62, 16 / 9, 0.3, 6000);
    world.add(camera);
    world.position.set(-far, 0, 0);
    world.updateMatrixWorld();
    const chase = createChaseCamera(camera, empty);
    const flight = { pos: new Vector3(far, 20, 0), yaw: 0.7, pitch: -0.2, speed: 30, mode: 'air' };
    for (let i = 0; i < 90; i++) {
      chase.update(1 / 60, flight);
      world.updateMatrixWorld();
    }
    return { p: new Vector3().setFromMatrixPosition(camera.matrixWorld), q: camera.getWorldQuaternion(new Quaternion()) };
  };
  const near = shoot(0);
  const far = shoot(1e9);
  assert.ok(far.p.distanceTo(near.p) < 1e-6, `posição de render: ${far.p.toArray()} × ${near.p.toArray()}`);
  assert.ok(far.p.length() < 100, `longe da origem de render: ${far.p.length()} m`); // o herói está a 20 m de altura
  assert.ok(Math.abs(far.q.dot(near.q)) > 1 - 1e-9, 'orientação diferente');
});
