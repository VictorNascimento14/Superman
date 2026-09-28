import * as THREE from 'three';

// Anel do estrondo sônico: um toro aditivo que cresce e some. Poucos ao mesmo tempo,
// então um pool pequeno basta.
export function createShockwaves(scene) {
  const geo = new THREE.TorusGeometry(1, 0.08, 8, 64);
  const pool = Array.from({ length: 4 }, () => {
    const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0xcfe6ff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }));
    m.visible = false;
    scene.add(m);
    return { m, age: 0 };
  });
  let next = 0;
  const z = new THREE.Vector3(0, 0, 1);

  return {
    spawn(at, dir) {
      const w = pool[next++ % pool.length];
      w.age = 0;
      w.m.position.copy(at);
      w.m.quaternion.setFromUnitVectors(z, dir);
      w.m.visible = true;
    },
    update(dt) {
      for (const w of pool) {
        if (!w.m.visible) continue;
        w.age += dt;
        const k = w.age / 0.9;
        if (k >= 1) { w.m.visible = false; continue; }
        w.m.scale.setScalar(2 + k * 40);
        w.m.material.opacity = (1 - k) * 1.6;
      }
    },
  };
}
