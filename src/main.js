import * as THREE from 'three';
import { createRenderer } from './render/renderer.js';
import { createSky, TIME_ORDER } from './render/sky.js';
import { createPost } from './render/post.js';
import { createSpace } from './space/space.js';
import { solarSystem, sunlight, SUN_I } from './space/bodies.js';
import { EARTH, nearCity } from './space/nav.js';
import { QUALITY, pickQuality } from './render/quality.js';
import { generateLayout, collisionBoxes, WATER_Y } from './world/layout.js';
import { createCollisionWorld } from './world/collision.js';
import { createCity } from './world/city.js';
import { createTraffic } from './world/traffic.js';
import { createTrafficView } from './world/trafficView.js';
import { createHero } from './player/hero.js';
import { createFlight, FLIGHT } from './player/flight.js';
import { createChaseCamera } from './player/camera.js';
import { createInput } from './core/input.js';
import { createShockwaves } from './fx/shockwave.js';
import { createBreachFx } from './fx/breach.js';
import { createCollapses } from './world/collapse.js';
import { createOverlay } from './ui/overlay.js';
import { createHud } from './ui/hud.js';
import { createHeatVision } from './powers/heatvision.js';
import { createSolar, solarFlux } from './powers/solar.js';
import { createMissions } from './game/missions.js';
import { createAudio } from './audio/audio.js';

const app = document.getElementById('app');
const qualityName = pickQuality();
const preset = QUALITY[qualityName];
const renderer = createRenderer(app, preset);
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.3, 6000);
// Origem flutuante: tudo que tem posição no mundo mora em `world`, deslocado por −origem. A
// GPU trabalha em float32 e, longe da cidade (no espaço, a 10¹¹ m do Sol), posição absoluta
// perderia metros ou quilômetros de precisão. Perto da cidade a origem é zero: nada muda.
const world = new THREE.Group();
world.name = 'mundo';
scene.add(world);
world.add(camera);
const origin = new THREE.Vector3();
const FLOAT_FROM = 20e3; // m do centro da cidade: além disto, a origem acompanha o herói
const lookAtV = new THREE.Vector3();
const beaconV = new THREE.Vector3();
const beaconAt = new Float32Array(24); // posições já ocupadas neste quadro (x, y)
let beacons = 0;
// Marcador na tela para um ponto verdadeiro (referencial da cidade). Com `edge`, fora de vista
// fica preso à borda, apontando para onde virar; sem ele, só aparece quando está na tela.
function beacon(i, name, x, y, z, edge) {
  const meters = beaconV.set(x, y, z).distanceTo(flight.pos);
  // Atrás da câmera é z > 0 em espaço de câmera. Depois da projeção não dá para saber: ponto
  // além do far (a cidade a 7.000 km) também sai com z > 1.
  beaconV.set(x, y, z).sub(origin).applyMatrix4(camera.matrixWorldInverse);
  const behind = beaconV.z > 0;
  beaconV.applyMatrix4(camera.projectionMatrix);
  let sx = beaconV.x;
  let sy = beaconV.y;
  if (behind) { sx = -sx; sy = -sy; }
  const m = Math.max(Math.abs(sx), Math.abs(sy), 1e-6);
  const off = behind || m > 0.92;
  if (off && !edge) return hud.setBeacon(i, '', 0, 0, 0, false);
  if (off) { sx *= 0.92 / m; sy *= 0.92 / m; }
  const px = ((sx + 1) / 2) * window.innerWidth;
  const py = ((1 - sy) / 2) * window.innerHeight;
  // Um marcador por lugar: vista do Sol, a Lua cai em cima da Terra.
  for (let k = 0; k < beacons * 2; k += 2) {
    if (Math.abs(beaconAt[k] - px) < 90 && Math.abs(beaconAt[k + 1] - py) < 18) return hud.setBeacon(i, '', 0, 0, 0, false);
  }
  beaconAt[beacons * 2] = px;
  beaconAt[beacons * 2 + 1] = py;
  beacons++;
  hud.setBeacon(i, name, px, py, meters, true);
}
const sky = createSky(scene, renderer, preset, world);

const layout = generateLayout();
const space = createSpace({ park: layout.park });
const post = createPost(renderer, scene, camera, preset, space);
post.setExposure(sky.state.exposure);
const collision = createCollisionWorld(collisionBoxes(layout), { floor: WATER_Y });
const city = createCity(world, layout, renderer);
const traffic = createTraffic();
const trafficView = createTrafficView(world, traffic);
const hero = createHero(world);
const shockwaves = createShockwaves(world);
const breachFx = createBreachFx(world);
const heatVision = createHeatVision(world, hero, collision, camera);
const solar = createSolar();
const collapses = createCollapses({
  scene: world, city, layout, collision, fx: breachFx,
  clearMarks: (box) => { breachFx.clearMarks(box); heatVision.clearMarks(box); },
});

// Nasce na sacada do terceiro recuo do Planeta Diário, olhando para o centro.
const planet = layout.buildings.find((b) => b.landmark);
const ledge = planet.tiers[2];
const spawn = { x: planet.x + ledge.w / 2 - 3, y: ledge.y1 + FLIGHT.footDepth, z: planet.z, yaw: Math.PI / 2 };
const flight = createFlight(collision, spawn);
const chase = createChaseCamera(camera, collision);
const input = createInput(renderer.domElement);
const move = { forward: 0, right: 0, up: 0, boost: false, jump: false };

const hud = createHud(layout);
const missions = createMissions({ scene: world, collision, layout, heatVision, hud });
missions.setBaseMarkers([{ x: planet.x, z: planet.z, color: '#e8e8e8' }]);
input.onKey('KeyH', () => hud.toggleHelp());
input.onKey('KeyN', () => missions.skip());
const prevPos = new THREE.Vector3();
const audio = createAudio();
input.onKey('KeyM', () => hud.toast(audio.toggleMute() ? 'SOM DESLIGADO' : 'SOM LIGADO', 1));

let paused = true;
let dustLevel = 0;
const resume = () => {
  overlay.hide();
  hud.show();
  paused = false;
};
// Autopiloto e e2e começam direto, sem pointer lock.
const start = () => {
  audio.start();
  resume();
};
const overlay = createOverlay(() => {
  audio.start(); // no clique: o navegador só libera o som com gesto do usuário
  // Despausa quando o lock pega de fato (pointerlockchange). O Chrome recusa o relock por
  // ~1 s depois de sair com Esc; aí o overlay continua e o próximo clique tenta de novo.
  if (!input.lock()) resume(); // navegador sem pointer lock: joga só com o teclado
});
document.addEventListener('pointerlockchange', () => {
  if (input.locked()) resume();
  else if (!debug.autopilot) {
    paused = true;
    hud.hide();
    overlay.show();
    audio.suspend(); // aba em segundo plano para o loop: o som ficaria no último ganho
  }
});

// O sistema solar gira em volta da Terra com a hora do dia (é a Terra girando): muda junto.
let bodies = [];
const toSun = new THREE.Vector3();
const setBodies = () => {
  bodies = solarSystem(sky.state.sunTrue);
  flight.bodies = bodies;
  space.setBodies(bodies);
};
setBodies();
let timeIdx = TIME_ORDER.indexOf('dia');
const setTime = (name) => {
  sky.setTime(name);
  post.setExposure(sky.state.exposure);
  timeIdx = TIME_ORDER.indexOf(name);
  setBodies();
};
// Longe da Terra, mudar a hora giraria o sistema inteiro e tiraria o planeta de perto do herói.
input.onKey('KeyT', () => {
  if (flight.altitude > 1e8) hud.toast('O DIA SÓ MUDA PERTO DA TERRA', 1.5);
  else setTime(TIME_ORDER[(timeIdx + 1) % TIME_ORDER.length]);
});

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
  // Antes de qualquer conversão entre espaço de render e verdadeiro (capa, câmera, feixes).
  origin.copy(flight.pos.lengthSq() > FLOAT_FROM * FLOAT_FROM ? flight.pos : lookAtV.set(0, 0, 0));
  world.position.copy(origin).negate();
  world.updateWorldMatrix(false, false);
  for (const e of flight.events) {
    if (e.type === 'sonicboom') {
      shockwaves.spawn(e.at, flight.vel.clone().normalize());
      chase.shake(0.9);
      hud.toast('BARREIRA DO SOM');
      audio.sonicBoom();
    } else if (e.type === 'breach') {
      // Furou a fachada (entrada) ou saiu do outro lado: a saída espalha mais entulho.
      breachFx.spawn(e);
      collapses.onBreach(e);
      chase.shake(Math.min(1, e.speed / (e.entry ? 160 : 240)));
      audio.breach(Math.min(1, e.speed / 200), e.entry);
    } else if (e.type === 'impact') {
      chase.shake(Math.min(1, e.speed / 200));
      audio.impact(Math.min(1, e.speed / 300));
    } else if (e.type === 'takeoff') audio.takeoff();
    else if (e.type === 'supersonic') chase.shake(0.3);
  }
  flight.events.length = 0;
  for (const e of missions.events) audio[e.type]?.();
  collapses.update(dt);
  for (const e of collapses.events) {
    // Mais perto, mais tremor: o ronco de um prédio inteiro caindo se sente de longe.
    const near = Math.max(0, 1 - e.at.distanceTo(flight.pos) / 700);
    if (e.type === 'collapse') {
      audio.collapse(near);
      chase.shake(0.3 + 0.7 * near);
      hud.toast('DESABOU!', 1.5);
    } else audio.impact(0.4 + 0.6 * near);
  }
  collapses.events.length = 0;
  missions.events.length = 0;

  hero.root.position.copy(flight.pos);
  hero.root.quaternion.copy(flight.orientation);
  hero.update(dt, { pose: flight.pose, walk: flight.walk, velocity: flight.vel, t: elapsed });
  shockwaves.update(dt);
  breachFx.update(dt, camera, collision.heightAt, renderer.domElement.height);

  if (debug.cam) {
    camera.position.copy(flight.pos).add(debug.cam);
    camera.lookAt(world.localToWorld(lookAtV.copy(flight.pos))); // lookAt quer espaço de render
  } else chase.update(dt, flight, heatVision.firing);

  // Câmera dentro de um prédio (atravessando junto com o herói): poeira na tela. As paredes
  // são cascas de face única e, lá de dentro, a cidade apareceria "de raio-x". O chão da cidade
  // só existe no mundo plano: abaixo do plano dela, em Júpiter, não há prédio nenhum.
  const inside = nearCity(camera.position) && collision.heightAt(camera.position.x, camera.position.z) > camera.position.y;
  dustLevel = inside ? 1 : dustLevel * Math.exp(-dt * 4);
  hud.setDust(dustLevel);

  // A mira sai da câmera: atualizar depois dela. Botão direito ou F.
  const wantsHeat = !paused && (input.mouseDown(2) || input.isDown('KeyF'));
  heatVision.update(dt, wantsHeat || debug.heat);
  hud.setEnergy(heatVision.energy.value);
  const groundY = collision.heightAt(flight.pos.x, flight.pos.z);
  hud.update(dt, flight, groundY);
  // Espaço: o céu esmaece de 4 km a 40 km de altitude, e abaixo do horizonte já de 2,5 a 4 km.
  // Acima de 2,5 km a cena do espaço é desenhada antes da cidade, que sai de vista aos 4 km
  // (a neblina já a apagou); dali para cima, Metrópolis é a ilha desenhada no globo.
  // No vácuo não há vento.
  const alt = flight.altitude;
  const spaceK = THREE.MathUtils.smoothstep(alt, 4e3, 40e3);
  sky.setSpace(spaceK, THREE.MathUtils.smoothstep(alt, 2.5e3, 4e3));
  city.group.visible = alt < 4e3;
  // A neblina foi pensada para olhar na horizontal; de cima, o ar é fino e a cidade aparece.
  scene.fog.near = 700 + alt * 0.6;
  scene.fog.far = preset.viewDistance * 1.2 + alt * 1.6;
  post.setSpace(alt > 2.5e3);
  // No espaço a luz do herói é o Sol de verdade, visto de onde ele está — e some na sombra da
  // Terra (ou de qualquer corpo entre ele e o Sol).
  const sun = bodies[SUN_I];
  toSun.set(sun.x - flight.pos.x, sun.y - flight.pos.y, sun.z - flight.pos.z);
  const sunDist = toSun.length();
  toSun.divideScalar(sunDist);
  const lit = spaceK > 0 ? sunlight(bodies, flight.pos) : 1;
  sky.setSunlight(toSun, spaceK, lit);
  // Carga solar: enche perto do Sol e cai devagar longe dele (vale a partir do próximo quadro).
  if (!paused || debug.autopilot) {
    const ev = solar.update(dt, solarFlux(sunDist, lit), heatVision.firing);
    if (ev === 'full') hud.toast('CARGA SOLAR MÁXIMA', 2.5);
    else if (ev === 'empty') hud.toast('CARGA SOLAR ESGOTADA', 1.5);
  }
  flight.charge = solar.charge;
  heatVision.setCharge(solar.charge);
  hero.setCharge(solar.charge, elapsed);
  hud.setSolar(solar.charge);
  audio.update(paused ? 0 : flight.speed * (1 - spaceK), nearCity(flight.pos) ? flight.pos.y - groundY : flight.altitude, heatVision.firing, heatVision.hitting);
  sky.update(dt, flight.pos, elapsed);
  city.update(dt, elapsed, sky.state.night);
  traffic.update(dt);
  trafficView.update(sky.state.night, elapsed, camera.position);
  if (alt > 2.5e3) space.update(camera, camera.position, elapsed, (camera.fov * THREE.MathUtils.DEG2RAD) / window.innerHeight);
  // No espaço, Metrópolis vira um marcador (lá de cima a ilha tem menos de um pixel) e, depois
  // da Lua, a Terra inteira. O Sol também fica preso à borda; os outros corpos só aparecem na tela.
  camera.updateMatrixWorld();
  beacons = 0;
  if (alt > 20e3) {
    beacon(0, alt > 5e7 ? 'TERRA' : 'METRÓPOLIS', 0, alt > 5e7 ? -EARTH.radius : 0, 0, true);
    beacon(SUN_I, sun.name, sun.x, sun.y, sun.z, true);
    for (let i = 2; i < bodies.length; i++) beacon(i, bodies[i].name, bodies[i].x, bodies[i].y, bodies[i].z, false);
  } else {
    for (let i = 0; i < bodies.length; i++) hud.setBeacon(i, '', 0, 0, 0, false);
  }
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
  solar,
  missions,
  destruction: breachFx,
  collapses,
  space,
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
