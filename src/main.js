import * as THREE from 'three';
import { createRenderer } from './render/renderer.js';
import { createSky, TIME_ORDER } from './render/sky.js';
import { createPost } from './render/post.js';
import { QUALITY, pickQuality } from './render/quality.js';
import { generateLayout, collisionBoxes, DOWNTOWN } from './world/layout.js';
import { createCollisionWorld } from './world/collision.js';
import { createCity } from './world/city.js';
import { createHero, FOOT_DEPTH } from './player/hero.js';

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
const hero = createHero(scene);

// Demonstração das poses até o voo chegar: P troca a pose; em voo ele circula.
const DEMO_POSES = ['idle', 'hover', 'fly', 'flyFast'];
let demoPose = 0;
const demoCenter = new THREE.Vector3(DOWNTOWN.x + 56, 0, DOWNTOWN.z + 56);
const heroVel = new THREE.Vector3();
const lastHeroPos = new THREE.Vector3();
window.addEventListener('keydown', (e) => {
  if (e.code === 'KeyP') demoPose = (demoPose + 1) % DEMO_POSES.length;
});

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
let heroCam = null; // câmera presa ao herói por um deslocamento (depuração)
renderer.setAnimationLoop(() => {
  timer.update();
  renderer.info.reset();
  const dt = Math.min(timer.getDelta(), 1 / 20);
  elapsed += dt;
  const pose = DEMO_POSES[demoPose];
  const root = hero.root;
  lastHeroPos.copy(root.position);
  if (pose === 'fly' || pose === 'flyFast') {
    const r = 40;
    const w = pose === 'fly' ? 0.5 : 1.1;
    const a = elapsed * w;
    root.position.set(demoCenter.x + Math.cos(a) * r, 30, demoCenter.z + Math.sin(a) * r);
    // Cabeça para a direção do movimento (tangente), barriga para baixo.
    root.quaternion.setFromEuler(new THREE.Euler(Math.PI / 2, -a, 0, 'YXZ'));
    root.rotateOnWorldAxis(new THREE.Vector3(Math.cos(a), 0, Math.sin(a)), 0);
  } else {
    root.position.set(demoCenter.x, pose === 'hover' ? 6 + Math.sin(elapsed * 1.5) * 0.3 : FOOT_DEPTH, demoCenter.z);
    root.quaternion.identity();
  }
  heroVel.subVectors(root.position, lastHeroPos).divideScalar(Math.max(dt, 1e-4));
  hero.update(dt, { pose, velocity: heroVel, t: elapsed });

  if (heroCam) {
    camera.position.copy(root.position).add(new THREE.Vector3(heroCam[0], heroCam[1], heroCam[2]));
    camera.lookAt(root.position);
  } else if (fixedCam) {
    camera.position.set(fixedCam[0], fixedCam[1], fixedCam[2]);
    camera.lookAt(fixedCam[3], fixedCam[4], fixedCam[5]);
  } else {
    // Câmera de vitrine em volta do herói; a de perseguição entra com o voo.
    const a = elapsed * 0.3;
    const d = pose.startsWith('fly') ? 70 : 5;
    const look = pose.startsWith('fly') ? demoCenter.clone().setY(30) : root.position;
    camera.position.set(look.x + Math.cos(a) * d, look.y + (pose.startsWith('fly') ? 25 : 0.6), look.z + Math.sin(a) * d);
    camera.lookAt(look);
  }
  sky.update(dt, focus, elapsed);
  city.update(dt, elapsed, sky.state.night);
  post.render(dt);
});

// Gancho de depuração para testes automatizados (screenshot headless).
window.__game = {
  cam: (...v) => { fixedCam = v; },
  camHero: (...v) => { heroCam = v; },
  scene,
  hero,
  pose: (p) => { demoPose = DEMO_POSES.indexOf(p); },
  collision,
  layout,
  setTime: (n) => { sky.setTime(n); post.setExposure(sky.state.exposure); },
  debugInfo: () => ({ quality: qualityName, time: sky.state.name, calls: renderer.info.render.calls, tris: renderer.info.render.triangles }),
};
