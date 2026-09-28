import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { createRng } from '../core/rng.js';

// Carros e pedestres instanciados: um draw call por tipo, matrizes atualizadas por quadro.
function tinted(geo, hex) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  const c = new THREE.Color(hex);
  const arr = new Float32Array(g.attributes.position.count * 3);
  for (let i = 0; i < arr.length; i += 3) arr.set([c.r, c.g, c.b], i);
  g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return g;
}

function carGeometry() {
  const parts = [
    tinted(new THREE.BoxGeometry(1.9, 0.7, 4.4).translate(0, 0.65, 0), 0xffffff), // carroceria (tingida por instância)
    tinted(new THREE.BoxGeometry(1.7, 0.6, 2.3).translate(0, 1.3, -0.2), 0x1a2029), // cabine/vidro
  ];
  for (const [x, z] of [[-0.9, 1.4], [0.9, 1.4], [-0.9, -1.4], [0.9, -1.4]]) {
    parts.push(tinted(new THREE.CylinderGeometry(0.36, 0.36, 0.3, 6).rotateZ(Math.PI / 2).translate(x, 0.36, z), 0x111111));
  }
  return mergeGeometries(parts);
}

function lightsGeometry() {
  const parts = [];
  for (const x of [-0.65, 0.65]) {
    parts.push(tinted(new THREE.BoxGeometry(0.4, 0.18, 0.05).translate(x, 0.75, 2.21), 0xfff2d6));
    parts.push(tinted(new THREE.BoxGeometry(0.4, 0.16, 0.05).translate(x, 0.8, -2.21), 0xff2a1a));
  }
  return mergeGeometries(parts);
}

function pedGeometry() {
  return mergeGeometries([
    tinted(new THREE.CapsuleGeometry(0.22, 0.9, 1, 6).translate(0, 0.78, 0), 0xffffff),
    tinted(new THREE.SphereGeometry(0.14, 6, 4).translate(0, 1.58, 0), 0xd9a47f),
  ]);
}

const CAR_COLORS = [0xf2c230, 0xf2c230, 0xf2c230, 0xe8e8e8, 0x1c1c1f, 0x8a0f14, 0x1f3d7a, 0x6b6f75, 0x2e5c3a, 0xd9d4c7];

export function createTrafficView(scene, traffic) {
  const rng = createRng(99);
  const nCars = traffic.cars.length;
  const nPeds = traffic.peds.length;
  const cars = new THREE.InstancedMesh(carGeometry(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.35, metalness: 0.5 }), Math.max(1, nCars));
  const lightMat = new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false });
  const lights = new THREE.InstancedMesh(lightsGeometry(), lightMat, Math.max(1, nCars));
  const peds = new THREE.InstancedMesh(pedGeometry(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8 }), Math.max(1, nPeds));
  cars.count = lights.count = nCars;
  peds.count = nPeds;
  const col = new THREE.Color();
  for (let i = 0; i < nCars; i++) cars.setColorAt(i, col.setHex(rng.pick(CAR_COLORS)));
  for (let i = 0; i < nPeds; i++) peds.setColorAt(i, col.setHSL(rng.next(), rng.range(0.2, 0.6), rng.range(0.25, 0.6)));
  cars.castShadow = true; // pedestre é pequeno demais para a sombra valer o custo
  cars.receiveShadow = true;
  for (const m of [cars, lights, peds]) {
    m.frustumCulled = false; // as instâncias se espalham pela ilha inteira
    m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    scene.add(m);
  }

  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const p = new THREE.Vector3();
  const s = new THREE.Vector3(1, 1, 1);
  const up = new THREE.Vector3(0, 1, 0);

  return {
    update(night, t) {
      traffic.cars.forEach((c, i) => {
        q.setFromAxisAngle(up, c.yaw);
        m.compose(p.set(c.x, 0, c.z), q, s);
        cars.setMatrixAt(i, m);
        lights.setMatrixAt(i, m);
      });
      traffic.peds.forEach((pd, i) => {
        q.setFromAxisAngle(up, pd.yaw);
        // Balanço do passo: sobe e desce de leve.
        m.compose(p.set(pd.x, 0.15 + Math.abs(Math.sin(t * 7 + pd.phase)) * 0.05, pd.z), q, s);
        peds.setMatrixAt(i, m);
      });
      cars.instanceMatrix.needsUpdate = lights.instanceMatrix.needsUpdate = peds.instanceMatrix.needsUpdate = true;
      // Faróis: apagados (cor escura) de dia; em HDR à noite para o bloom pegar.
      lightMat.color.setScalar(0.25 + night * 3.5);
    },
  };
}
