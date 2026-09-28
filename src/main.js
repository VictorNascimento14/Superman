import * as THREE from 'three';
import { createRenderer } from './render/renderer.js';
import { createSky, TIME_ORDER } from './render/sky.js';
import { createPost } from './render/post.js';
import { QUALITY, pickQuality } from './render/quality.js';

const app = document.getElementById('app');
const qualityName = pickQuality();
const preset = QUALITY[qualityName];
const renderer = createRenderer(app, preset);
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.5, 6000);
const sky = createSky(scene, renderer, preset);
const post = createPost(renderer, scene, camera, preset);
post.setExposure(sky.state.exposure);

// Palco provisório para ver luz e sombra; a cidade substitui isto no PR seguinte.
const ground = new THREE.Mesh(new THREE.PlaneGeometry(4000, 4000), new THREE.MeshStandardMaterial({ color: 0x3f4349, roughness: 0.95 }));
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);
const towerMat = new THREE.MeshStandardMaterial({ color: 0x8fb3d9, metalness: 0.9, roughness: 0.12 });
for (let i = 0; i < 12; i++) {
  const h = 60 + i * 18;
  const m = new THREE.Mesh(new THREE.BoxGeometry(30, h, 30), towerMat);
  const a = (i / 12) * Math.PI * 2;
  m.position.set(Math.cos(a) * 160, h / 2, Math.sin(a) * 160);
  m.castShadow = m.receiveShadow = true;
  scene.add(m);
}

let timeIdx = TIME_ORDER.indexOf('dia');
window.addEventListener('keydown', (e) => {
  if (e.code !== 'KeyT') return;
  timeIdx = (timeIdx + 1) % TIME_ORDER.length;
  sky.setTime(TIME_ORDER[timeIdx]);
  post.setExposure(sky.state.exposure);
});

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  post.setSize(window.innerWidth, window.innerHeight);
});

const timer = new THREE.Timer();
timer.connect(document);
let elapsed = 0;
renderer.info.autoReset = false; // o pós faz vários render(); conta o quadro inteiro
const focus = new THREE.Vector3();
renderer.setAnimationLoop(() => {
  timer.update();
  renderer.info.reset();
  const dt = Math.min(timer.getDelta(), 1 / 20);
  elapsed += dt;
  camera.position.set(Math.cos(elapsed * 0.05) * 420, 140, Math.sin(elapsed * 0.05) * 420);
  camera.lookAt(focus);
  sky.update(dt, focus, elapsed);
  post.render(dt);
});

// Gancho de depuração para testes automatizados (screenshot headless).
window.__game = {
  setTime: (n) => { sky.setTime(n); post.setExposure(sky.state.exposure); },
  debugInfo: () => ({ quality: qualityName, time: sky.state.name, calls: renderer.info.render.calls, tris: renderer.info.render.triangles }),
};
