import * as THREE from 'three';
import { viewDirection } from './flight.js';

// Câmera de perseguição em terceira pessoa. A posição é recalculada a cada quadro a
// partir do herói (sem atraso: a 400 m/s qualquer lerp deixaria o herói fora do quadro);
// só distância, FOV e tremor são suavizados.
export function createChaseCamera(camera, collision) {
  const dir = new THREE.Vector3();
  const target = new THREE.Vector3();
  const want = new THREE.Vector3();
  const ray = new THREE.Vector3();
  const hit = {};
  let dist = 6;
  let fov = camera.fov;
  let trauma = 0;
  let t = 0;

  function update(dt, flight) {
    t += dt;
    const sp = flight.speed;
    const flying = flight.mode === 'air';
    const fast = Math.min(sp, 420) / 420;
    const wantDist = flying ? 6.5 + fast * 2.5 : 5;
    dist += (wantDist - dist) * (1 - Math.exp(-dt * 3));
    const wantFov = 62 + 14 * THREE.MathUtils.smoothstep(sp, 40, 420);
    fov += (wantFov - fov) * (1 - Math.exp(-dt * 3));
    if (Math.abs(camera.fov - fov) > 0.01) {
      camera.fov = fov;
      camera.updateProjectionMatrix();
    }

    viewDirection(flight.yaw, flight.pitch, dir);
    target.copy(flight.pos);
    target.y += flying ? 0.7 : 0.9;
    want.copy(target).addScaledVector(dir, -dist);
    // Quanto mais rápido, mais alta a câmera: bem atrás e na mesma altura, o herói
    // deitado aparece de pés para a câmera, fino como um risco.
    want.y += 1.2 + fast * 3.2;
    // Parede entre o herói e a câmera: encurta a distância em vez de atravessar.
    ray.subVectors(want, target);
    const len = ray.length();
    ray.divideScalar(len);
    if (collision.raycast(target, ray, len, hit)) want.copy(target).addScaledVector(ray, Math.max(0.6, hit.dist - 0.6));
    camera.position.copy(want);

    trauma = Math.max(0, trauma - dt * 1.4);
    const sh = trauma * trauma;
    if (sh > 0) {
      camera.position.x += Math.sin(t * 47) * sh * 0.8;
      camera.position.y += Math.sin(t * 53 + 1) * sh * 0.8;
      camera.position.z += Math.sin(t * 59 + 2) * sh * 0.8;
    }
    camera.lookAt(target.addScaledVector(dir, 4));
  }

  return { update, shake: (a) => { trauma = Math.min(1, trauma + a); } };
}
