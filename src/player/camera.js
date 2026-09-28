import * as THREE from 'three';
import { viewDirection } from './flight.js';

// Câmera de perseguição em terceira pessoa. A posição é recalculada a cada quadro a
// partir do herói (sem atraso: a 400 m/s qualquer lerp deixaria o herói fora do quadro);
// só distância, FOV e tremor são suavizados.
export function createChaseCamera(camera, collision) {
  const dir = new THREE.Vector3();
  const target = new THREE.Vector3();
  const pivot = new THREE.Vector3();
  const want = new THREE.Vector3();
  const ray = new THREE.Vector3();
  const hit = {};
  let dist = 6;
  let fov = camera.fov;
  let trauma = 0;
  let shoulder = 1;
  let t = 0;

  function update(dt, flight, aiming = false) {
    t += dt;
    const sp = flight.speed;
    const flying = flight.mode === 'air';
    const fast = Math.min(sp, 420) / 420;
    const wantDist = (flying ? 6.5 + fast * 2.5 : 5) * (aiming ? 0.7 : 1);
    dist += (wantDist - dist) * (1 - Math.exp(-dt * 3));
    const wantFov = 62 + 14 * THREE.MathUtils.smoothstep(sp, 40, 420);
    fov += (wantFov - fov) * (1 - Math.exp(-dt * 3));
    if (Math.abs(camera.fov - fov) > 0.01) {
      camera.fov = fov;
      camera.updateProjectionMatrix();
    }

    viewDirection(flight.yaw, flight.pitch, dir);
    // Sobre o ombro direito: sem isto o herói fica entre a câmera e a mira e esconde
    // os feixes da visão de calor. Centraliza em alta velocidade.
    const wantShoulder = (aiming ? 1.7 : 1.1) * (1 - THREE.MathUtils.smoothstep(sp, 20, 80));
    shoulder += (wantShoulder - shoulder) * (1 - Math.exp(-dt * 5));
    target.copy(flight.pos);
    target.y += flying ? 0.7 : 0.9;
    pivot.copy(target); // o herói em si: a esfera de colisão o mantém fora dos prédios
    target.x -= Math.cos(flight.yaw) * shoulder;
    target.z += Math.sin(flight.yaw) * shoulder;
    want.copy(target).addScaledVector(dir, -dist);
    // Quanto mais rápido, mais alta a câmera: bem atrás e na mesma altura, o herói
    // deitado aparece de pés para a câmera, fino como um risco.
    want.y += 1.2 + fast * 3.2;
    // Parede entre o herói e a câmera: encurta a distância em vez de atravessar. O raio sai
    // do herói, não do ombro: encostado numa parede à direita, o ombro (1,1–1,7 m) cai dentro
    // do prédio, e o raycast ignora a caixa que contém a origem.
    ray.subVectors(want, pivot);
    const len = ray.length();
    ray.divideScalar(len);
    if (collision.raycast(pivot, ray, len, hit)) want.copy(pivot).addScaledVector(ray, Math.max(0.6, hit.dist - 0.6));
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
