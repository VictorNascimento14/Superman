import * as THREE from 'three';
import { createRenderer } from './render/renderer.js';
import { createSky, TIME_ORDER } from './render/sky.js';
import { createPost } from './render/post.js';
import { QUALITY, pickQuality } from './render/quality.js';
import { generateLayout, collisionBoxes } from './world/layout.js';
import { createCollisionWorld } from './world/collision.js';
import { createCity } from './world/city.js';
import { createTraffic } from './world/traffic.js';
import { createTrafficView } from './world/trafficView.js';
import { createHero } from './player/hero.js';
import { createFlight, FLIGHT } from './player/flight.js';
import { createChaseCamera } from './player/camera.js';
import { createInput } from './core/input.js';
import { createShockwaves } from './fx/shockwave.js';
import { createOverlay } from './ui/overlay.js';
import { createHud } from './ui/hud.js';
import { createHeatVision } from './powers/heatvision.js';
import { createMissions } from './game/missions.js';
import { createAudio } from './audio/audio.js';

const app = document.getElementById('app');
const qualityName = pickQuality();
const preset = QUALITY[qualityName];
const renderer = createRenderer(app, preset);
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.3, 6000);
const sky = createSky(scene, renderer, preset);
const post = createPost(renderer, scene, camera, preset);
post.setExposure(sky.state.exposure);

const layout = generateLayout();
const collision = createCollisionWorld(collisionBoxes(layout));
const city = createCity(scene, layout, renderer);
const traffic = createTraffic();
const trafficView = createTrafficView(scene, traffic);
const hero = createHero(scene);
const shockwaves = createShockwaves(scene);
const heatVision = createHeatVision(scene, hero, collision, camera);

// Nasce na sacada do terceiro recuo do Planeta Diário, olhando para o centro.
const planet = layout.buildings.find((b) => b.landmark);
const ledge = planet.tiers[2];
const spawn = { x: planet.x + ledge.w / 2 - 3, y: ledge.y1 + FLIGHT.footDepth, z: planet.z, yaw: Math.PI / 2 };
const flight = createFlight(collision, spawn);
const chase = createChaseCamera(camera, collision);
const input = createInput(renderer.domElement);
const move = { forward: 0, right: 0, up: 0, boost: false, jump: false };

const hud = createHud(layout);
const missions = createMissions({ scene, collision, layout, heatVision, hud });
missions.setBaseMarkers([{ x: planet.x, z: planet.z, color: '#e8e8e8' }]);
input.onKey('KeyH', () => hud.toggleHelp());
input.onKey('KeyN', () => missions.skip());
const prevPos = new THREE.Vector3();
const audio = createAudio();
input.onKey('KeyM', () => hud.toast(audio.toggleMute() ? 'SOM DESLIGADO' : 'SOM LIGADO', 1));

let paused = true;
const start = () => {
  audio.start();
  overlay.hide();
  hud.show();
  paused = false;
};
const overlay = createOverlay(() => {
  input.lock();
  start();
});
document.addEventListener('pointerlockchange', () => {
  if (!input.locked() && !debug.autopilot) {
    paused = true;
    hud.hide();
    overlay.show();
  }
});

let timeIdx = TIME_ORDER.indexOf('dia');
const setTime = (name) => {
  sky.setTime(name);
  post.setExposure(sky.state.exposure);
  timeIdx = TIME_ORDER.indexOf(name);
};
input.onKey('KeyT', () => setTime(TIME_ORDER[(timeIdx + 1) % TIME_ORDER.length]));

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  post.setSize(window.innerWidth, window.innerHeight);
});

const LOOK = 0.0022;
const timer = new THREE.Timer();
timer.connect(document);
renderer.info.autoReset = false; // o pós faz vários render(); conta o quadro inteiro
let elapsed = 0;
const debug = { autopilot: null, cam: null, heat: false };

renderer.setAnimationLoop(() => {
  timer.update();
  renderer.info.reset();
  const dt = Math.min(timer.getDelta(), 1 / 20);
  elapsed += dt;

  if (!paused || debug.autopilot) {
    const look = input.consumeLook(dt);
    flight.yaw -= look.dx * LOOK;
    flight.pitch = THREE.MathUtils.clamp(flight.pitch - look.dy * LOOK, -1.45, 1.45);
    if (debug.autopilot) Object.assign(move, debug.autopilot);
    else input.read(move);
    prevPos.copy(flight.pos);
    flight.update(dt, move);
    missions.update(dt, flight, prevPos, elapsed);
    if (debug.autopilot) debug.autopilot.jump = false;
  }
  for (const e of flight.events) {
    if (e.type === 'sonicboom') {
      shockwaves.spawn(e.at, flight.vel.clone().normalize());
      chase.shake(0.9);
      hud.toast('BARREIRA DO SOM');
      audio.sonicBoom();
    } else if (e.type === 'impact') {
      chase.shake(Math.min(1, e.speed / 200));
      audio.impact(Math.min(1, e.speed / 300));
    } else if (e.type === 'takeoff') audio.takeoff();
    else if (e.type === 'supersonic') chase.shake(0.3);
  }
  flight.events.length = 0;
  for (const e of missions.events) audio[e.type]?.();
  missions.events.length = 0;

  hero.root.position.copy(flight.pos);
  hero.root.quaternion.copy(flight.orientation);
  hero.update(dt, { pose: flight.pose, walk: flight.walk, velocity: flight.vel, t: elapsed });
  shockwaves.update(dt);

  if (debug.cam) {
    camera.position.copy(flight.pos).add(debug.cam);
    camera.lookAt(flight.pos);
  } else chase.update(dt, flight, heatVision.firing);

  // A mira sai da câmera: atualizar depois dela. Botão direito ou F.
  const wantsHeat = !paused && (input.mouseDown(2) || input.isDown('KeyF'));
  heatVision.update(dt, wantsHeat || debug.heat);
  hud.setEnergy(heatVision.energy.value);
  const groundY = collision.heightAt(flight.pos.x, flight.pos.z);
  hud.update(dt, flight, groundY);
  audio.update(paused ? 0 : flight.speed, flight.pos.y - groundY, heatVision.firing, heatVision.hitting);
  sky.update(dt, flight.pos, elapsed);
  city.update(dt, elapsed, sky.state.night);
  traffic.update(dt);
  trafficView.update(sky.state.night, elapsed, camera.position);
  post.render(dt);
});

// Gancho de depuração para testes automatizados (screenshot headless).
window.__game = {
  scene,
  camera,
  flight,
  layout,
  collision,
  traffic,
  setTime,
  // Dirige o herói sem teclado: autopilot({ forward: 1, boost: true }) — null devolve o controle.
  start,
  hud,
  heatVision,
  missions,
  audio,
  heat: (on) => { debug.heat = on; },
  autopilot: (m) => { debug.autopilot = m ? { forward: 0, right: 0, up: 0, boost: false, jump: false, ...m } : null; },
  camHero: (x, y, z) => { debug.cam = new THREE.Vector3(x, y, z); },
  debugInfo: () => ({
    quality: qualityName, time: sky.state.name, calls: renderer.info.render.calls, tris: renderer.info.render.triangles,
    geometries: renderer.info.memory.geometries,
    mode: flight.mode, speed: Math.round(flight.speed), pos: flight.pos.toArray().map(Math.round), pose: flight.pose,
  }),
};
