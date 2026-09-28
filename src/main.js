import * as THREE from 'three';
import { createRenderer } from './render/renderer.js';
import { createSky, TIME_ORDER } from './render/sky.js';
import { createPost } from './render/post.js';
import { QUALITY, pickQuality } from './render/quality.js';
import { generateLayout, collisionBoxes, DOWNTOWN } from './world/layout.js';
import { createCollisionWorld } from './world/collision.js';
import { createCity } from './world/city.js';

const app = document.getElementById('app');
const qualityName = pickQuality();
const preset = QUALITY[qualityName];
const renderer = createRenderer(app, preset);
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.5, 6000);
const sky = createSky(scene, renderer, preset);
const post = createPost(renderer, scene, camera, preset);
post.setExposure(sky.state.exposure);

const layout = generateLayout();
const collision = createCollisionWorld(collisionBoxes(layout));
const city = createCity(scene, layout, renderer);

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
const focus = new THREE.Vector3(DOWNTOWN.x, 0, DOWNTOWN.z);
let fixedCam = null; // câmera travada pelo gancho de depuração
renderer.setAnimationLoop(() => {
  timer.update();
  renderer.info.reset();
  const dt = Math.min(timer.getDelta(), 1 / 20);
  elapsed += dt;
  if (fixedCam) {
    camera.position.set(fixedCam[0], fixedCam[1], fixedCam[2]);
    camera.lookAt(fixedCam[3], fixedCam[4], fixedCam[5]);
  } else {
    // Sobrevoo provisório do centro; o herói e a câmera de perseguição entram depois.
    const a = elapsed * 0.04;
    camera.position.set(DOWNTOWN.x + Math.cos(a) * 520, 230, DOWNTOWN.z + Math.sin(a) * 520);
    camera.lookAt(focus.x, 90, focus.z);
  }
  sky.update(dt, focus, elapsed);
  city.update(dt, elapsed, sky.state.night);
  post.render(dt);
});

// Gancho de depuração para testes automatizados (screenshot headless).
window.__game = {
  cam: (...v) => { fixedCam = v; },
  scene,
  collision,
  layout,
  setTime: (n) => { sky.setTime(n); post.setExposure(sky.state.exposure); },
  debugInfo: () => ({ quality: qualityName, time: sky.state.name, calls: renderer.info.render.calls, tris: renderer.info.render.triangles }),
};
