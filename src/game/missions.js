import * as THREE from 'three';
import { createRng } from '../core/rng.js';
import { streetLine, CITY } from '../world/layout.js';
import { ringCrossed, makeRingCourse, stepFaller, tryCatch, burnDrone, DRONE } from './missionLogic.js';
import { goalDistance } from '../ui/hud.js';

// Missões em rodízio: treino de anéis → resgate → drones → … Cada uma tem início,
// objetivo no HUD, marcador no minimapa, sucesso ou falha, e 4 s de respiro.
const ORDER = ['aneis', 'resgate', 'drones'];
const COLORS = { aneis: '#f2c230', resgate: '#4da3ff', drones: '#ff4a3d' };
const BREAK = 4;

const fmt = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

export function createMissions({ scene, collision, layout, heatVision, hud }) {
  const rng = createRng(2026);
  const root = new THREE.Group();
  scene.add(root);
  let score = 0;
  let done = 0;
  const doneBy = { aneis: 0, resgate: 0, drones: 0 }; // o e2e exige uma vitória de cada
  let idx = -1;
  let m = null; // missão atual
  let pause = 2; // respiro antes da primeira
  const events = []; // { type: 'ring' | 'success' | 'fail' | 'explosion' | 'alert' } — consumidos pelo áudio
  const tmp = new THREE.Vector3();

  // --- Pilar de luz que marca o lugar da missão de longe.
  const beacon = new THREE.Mesh(
    new THREE.CylinderGeometry(3, 3, 700, 16, 1, true).translate(0, 350, 0),
    new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.18, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }),
  );
  beacon.visible = false;
  root.add(beacon);

  // --- Explosões: esferas aditivas que crescem e somem.
  const booms = Array.from({ length: 6 }, () => {
    const b = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 12), new THREE.MeshBasicMaterial({ color: new THREE.Color(4, 1.8, 0.5), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    b.visible = false;
    root.add(b);
    return { b, t: 0 };
  });
  let boomNext = 0;
  const boom = (p) => {
    const e = booms[boomNext++ % booms.length];
    e.b.position.copy(p);
    e.t = 0;
    e.b.visible = true;
    events.push({ type: 'explosion' });
  };

  // --- Construtores de cada tipo.
  const ringGeo = new THREE.TorusGeometry(1, 0.06, 8, 48);
  ringGeo.userData.shared = true;
  function startRings(flight) {
    const course = makeRingCourse(rng, flight.pos, flight.yaw, collision, 8, 10);
    const meshes = course.map((r) => {
      const mat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.6, 0.45, 0.1), transparent: true, opacity: 0.9 });
      const mesh = new THREE.Mesh(ringGeo, mat);
      mesh.scale.setScalar(r.radius);
      mesh.position.set(r.x, r.y, r.z);
      mesh.lookAt(r.x + r.normal.x, r.y + r.normal.y, r.z + r.normal.z);
      root.add(mesh);
      return mesh;
    });
    return { type: 'aneis', course, meshes, next: 0, time: 80, objects: meshes };
  }

  function startRescue(flight) {
    const cands = layout.buildings.filter((b) => !b.landmark && b.tiers.length === 1 && b.h > 70 && b.h < 230 && Math.hypot(b.x - flight.pos.x, b.z - flight.pos.z) > 300 && Math.hypot(b.x - flight.pos.x, b.z - flight.pos.z) < 900);
    const b = cands.length ? rng.pick(cands) : layout.buildings.find((x) => x.h > 70 && !x.landmark);
    // Lado do prédio virado para a rua mais próxima; a pessoa fica 1 m para fora da beirada.
    const side = rng.int(0, 3);
    const dx = [1, -1, 0, 0][side];
    const dz = [0, 0, 1, -1][side];
    const x = b.x + dx * (b.w / 2 + 1);
    const z = b.z + dz * (b.d / 2 + 1);
    const f = { state: 'waiting', x, y: b.h + 0.9, z, vy: 0, ground: collision.heightAt(x, z), wait: 14 };
    const fig = makePerson();
    fig.position.set(x, f.y, z);
    root.add(fig);
    return { type: 'resgate', f, fig, building: b, objects: [fig] };
  }

  function startDrones(flight) {
    let cx = 0;
    let cz = 0;
    for (let k = 0; k < 30; k++) {
      cx = streetLine(rng.int(1, CITY.blocks - 1));
      cz = streetLine(rng.int(1, CITY.blocks - 1));
      const d = Math.hypot(cx - flight.pos.x, cz - flight.pos.z);
      if (d > 300 && d < 850) break;
    }
    // A órbita (raio 22–40 m, ±13 m de altura) não pode cortar prédio: lá dentro o drone
    // some e a visão de calor para na fachada. Fica acima do telhado mais alto em volta.
    let roof = 0;
    for (let k = 0; k < 16; k++) {
      const a = (k / 16) * Math.PI * 2;
      for (let r = 22; r <= 40; r += 9) roof = Math.max(roof, collision.heightAt(cx + Math.cos(a) * r, cz + Math.sin(a) * r));
    }
    const cy = Math.max(45 + rng.range(0, 40), roof + 20);
    const drones = Array.from({ length: 5 }, (_, k) => {
      const mesh = makeDrone();
      root.add(mesh);
      const d = { hp: 1, mesh, a: (k / 5) * Math.PI * 2, r: rng.range(22, 40), h: rng.range(-10, 10), w: rng.range(0.3, 0.6) * (rng.chance(0.5) ? 1 : -1), pos: mesh.position, radius: DRONE.radius };
      d.hit = (dt) => {
        if (burnDrone(d, dt)) {
          boom(d.pos);
          d.mesh.visible = false;
          heatVision.targets.delete(d);
          hud.toast('DRONE ABATIDO', 1);
        }
        const mat = d.mesh.children[0].material;
        mat.emissive.setRGB(1, 0.3 + (1 - d.hp) * 0.5, 0);
        mat.emissiveIntensity = 1 + (1 - d.hp) * 3; // nasce 0: sem isto o drone nunca esquenta
      };
      heatVision.targets.add(d);
      return d;
    });
    return { type: 'drones', drones, c: { x: cx, y: cy, z: cz }, time: 120, objects: drones.map((d) => d.mesh) };
  }

  function begin(flight) {
    idx = (idx + 1) % ORDER.length;
    const type = ORDER[idx];
    m = type === 'aneis' ? startRings(flight) : type === 'resgate' ? startRescue(flight) : startDrones(flight);
    beacon.material.color.set(COLORS[type]);
    hud.toast({ aneis: 'TREINO DE VOO', resgate: 'ALGUÉM PRECISA DE AJUDA', drones: 'DRONES HOSTIS' }[type], 2.5);
    events.push({ type: 'alert' });
  }

  function end(ok, points) {
    if (ok) {
      score += points;
      done++;
      doneBy[m.type]++;
      hud.toast(`MISSÃO CUMPRIDA  +${points}`, 2.5);
      events.push({ type: 'success' });
    } else {
      hud.toast('MISSÃO FALHOU', 2.5);
      events.push({ type: 'fail' });
    }
    for (const o of m.objects) {
      root.remove(o);
      disposeTree(o);
    }
    if (m.type === 'drones') for (const d of m.drones) heatVision.targets.delete(d);
    m = null;
    pause = BREAK;
    beacon.visible = false;
    hud.setMarkers(baseMarkers);
  }

  let baseMarkers = [];
  const markers = [];

  function update(dt, flight, prevPos, t) {
    for (const e of booms) {
      if (!e.b.visible) continue;
      e.t += dt;
      const k = e.t / 0.7;
      if (k >= 1) { e.b.visible = false; continue; }
      e.b.scale.setScalar(1 + k * 9);
      e.b.material.opacity = 1 - k;
    }
    if (!m) {
      hud.setObjective(`Missões cumpridas: ${done} · Pontos: ${score}`);
      if ((pause -= dt) <= 0) begin(flight);
      return;
    }
    markers.length = 0;
    markers.push(...baseMarkers);
    if (m.type === 'aneis') updateRings(dt, flight, prevPos, t);
    else if (m.type === 'resgate') updateRescue(dt, flight, t);
    else updateDrones(dt, flight, t);
    // A missão pode ter acabado neste quadro: end() já deixou só os marcadores de base.
    if (m) hud.setMarkers(markers);
  }

  function updateRings(dt, flight, prevPos, t) {
    m.time -= dt;
    const r = m.course[m.next];
    m.meshes.forEach((mesh, i) => {
      mesh.visible = i >= m.next;
      const on = i === m.next;
      mesh.material.color.setRGB(on ? 4 : 0.6, on ? 3 : 0.45, on ? 0.6 : 0.1);
      if (on) mesh.rotation.z = t * 1.5;
    });
    if (ringCrossed(prevPos, flight.pos, r)) {
      m.next++;
      m.time += 6;
      events.push({ type: 'ring' });
      score += 25;
      if (m.next >= m.course.length) return end(true, 100 + Math.round(m.time) * 2);
      hud.toast(`${m.next}/${m.course.length}`, 0.8);
    }
    if (m.time <= 0) return end(false);
    const nr = m.course[m.next];
    markers.push({ x: nr.x, z: nr.z, color: COLORS.aneis });
    hud.setObjective(`TREINO DE VOO — anel ${m.next + 1}/${m.course.length} · ${fmt(m.time)} · ${goalDistance(dist(flight.pos, nr))}`);
  }

  function updateRescue(dt, flight, t) {
    const f = m.f;
    beacon.visible = f.state !== 'caught';
    beacon.position.set(m.building.x, 0, m.building.z);
    if (f.state === 'waiting') {
      f.wait -= dt;
      // Balança na beirada, acenando.
      m.fig.children[2].rotation.z = Math.sin(t * 8) * 0.8 + 2.4;
      if (f.wait <= 0 || dist(flight.pos, f) < 300) {
        f.state = 'falling';
        hud.toast('ELE CAIU!', 1.5);
        events.push({ type: 'alert' });
      }
    }
    if ((f.state === 'waiting' || f.state === 'falling') && tryCatch(f, flight.pos)) events.push({ type: 'ring' });
    stepFaller(f, dt);
    if (f.state === 'falling') {
      m.fig.rotation.z += dt * 3; // rodopiando
    }
    if (f.state === 'caught') {
      // Nos braços do herói: logo abaixo e à frente do peito.
      tmp.set(0, -0.4, 0.5).applyQuaternion(flight.orientation);
      f.x = flight.pos.x + tmp.x; f.y = flight.pos.y + tmp.y; f.z = flight.pos.z + tmp.z;
      m.fig.rotation.set(Math.PI / 2, 0, 0);
      if (flight.mode === 'ground') return end(true, 150);
    }
    if (f.state === 'lost') return end(false);
    m.fig.position.set(f.x, f.y - 0.9, f.z);
    markers.push({ x: f.x, z: f.z, color: COLORS.resgate });
    const msg = { waiting: 'RESGATE — alguém está na beirada do prédio marcado!', falling: 'PEGUE A PESSOA ANTES DO CHÃO!', caught: 'Salvo! Pouse em qualquer lugar para deixá-lo em segurança' }[f.state];
    hud.setObjective(`${msg} · ${goalDistance(dist(flight.pos, f))}`);
  }

  function updateDrones(dt, flight, t) {
    m.time -= dt;
    beacon.visible = true;
    beacon.position.set(m.c.x, 0, m.c.z);
    let alive = 0;
    let nearest = Infinity;
    for (const d of m.drones) {
      if (d.hp <= 0) continue;
      alive++;
      d.a += d.w * dt;
      d.pos.set(m.c.x + Math.cos(d.a) * d.r, m.c.y + d.h + Math.sin(t * 1.3 + d.a) * 3, m.c.z + Math.sin(d.a) * d.r);
      d.mesh.lookAt(flight.pos); // o olho vermelho acompanha o herói
      d.mesh.children[1].rotation.y += dt * 40;
      nearest = Math.min(nearest, dist(flight.pos, d.pos));
      markers.push({ x: d.pos.x, z: d.pos.z, color: COLORS.drones });
    }
    if (alive === 0) return end(true, 200 + Math.round(m.time));
    if (m.time <= 0) return end(false);
    hud.setObjective(`DRONES HOSTIS — ${alive} restantes · ${fmt(m.time)} · ${goalDistance(nearest)} · visão de calor: botão direito / F`);
  }

  return {
    update,
    events,
    skip: () => { if (m) end(false); },
    setBaseMarkers: (list) => { baseMarkers = list; },
    get score() { return score; },
    get done() { return done; },
    get doneBy() { return doneBy; },
    get current() { return m; },
  };
}

// Cada missão cria geometrias e materiais próprios; tirar da cena não libera a GPU.
// A geometria compartilhada dos anéis (ringGeo) é poupada.
function disposeTree(obj) {
  obj.traverse((o) => {
    if (o.geometry && !o.geometry.userData.shared) o.geometry.dispose();
    if (o.material) [].concat(o.material).forEach((mat) => mat.dispose());
  });
}

function makePerson() {
  const g = new THREE.Group();
  const shirt = new THREE.MeshStandardMaterial({ color: 0x2a9d8f, roughness: 0.7 });
  const skin = new THREE.MeshStandardMaterial({ color: 0xc68d6a, roughness: 0.6 });
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.22, 0.9, 2, 8), shirt);
  body.position.y = 0.8;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.14, 10, 8), skin);
  head.position.y = 1.55;
  const arm = new THREE.Mesh(new THREE.CapsuleGeometry(0.06, 0.5, 2, 6), shirt);
  arm.geometry.translate(0, -0.3, 0);
  arm.position.set(0.25, 1.3, 0);
  g.add(body, head, arm);
  g.traverse((o) => { o.castShadow = true; });
  return g;
}

function makeDrone() {
  const g = new THREE.Group();
  const metal = new THREE.MeshStandardMaterial({ color: 0x2a2d33, metalness: 0.8, roughness: 0.35, emissive: 0xff2200, emissiveIntensity: 0 });
  const body = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 12), metal);
  body.scale.set(1.2, 0.7, 1.2);
  const rotors = new THREE.Group();
  for (let k = 0; k < 4; k++) {
    const a = (k * Math.PI) / 2 + Math.PI / 4;
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.1, 1.6), metal);
    arm.position.set(Math.sin(a) * 1.3, 0.2, Math.cos(a) * 1.3);
    arm.rotation.y = a;
    const disc = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.7, 0.04, 16), new THREE.MeshBasicMaterial({ color: 0x999999, transparent: true, opacity: 0.35 }));
    disc.position.set(Math.sin(a) * 2, 0.3, Math.cos(a) * 2);
    rotors.add(arm, disc);
  }
  const eye = new THREE.Mesh(new THREE.SphereGeometry(0.28, 10, 8), new THREE.MeshBasicMaterial({ color: new THREE.Color(5, 0.3, 0.2) }));
  eye.position.set(0, 0, 1.15);
  g.add(body, rotors, eye);
  g.traverse((o) => { o.castShadow = true; });
  return g;
}
