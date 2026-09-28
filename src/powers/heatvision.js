import * as THREE from 'three';
import { hideInstancesIn } from '../fx/instances.js';
import { createEnergy, raySphere } from './energy.js';
import { SOLAR } from './solar.js';

const RANGE = 700;
const MAX_SCORCH = 400;
const MAX_SPARKS = 400;

// Visão de calor: mira pelo centro da câmera, feixes saindo dos olhos, fagulhas,
// marcas de queimado e uma luz no ponto de impacto. `targets` recebe alvos atingíveis
// ({ pos: Vector3, radius, hit(dt, point) }) — as missões registram drones aqui.
export function createHeatVision(scene, hero, collision, camera) {
  const energy = createEnergy();
  const targets = new Set();

  // Feixe = núcleo branco-quente fino + halo vermelho largo, ambos aditivos e em HDR
  // (valores > 1 passam o limiar do bloom).
  const beamGeo = new THREE.CylinderGeometry(1, 1, 1, 8, 1, true).translate(0, 0.5, 0).rotateX(Math.PI / 2);
  const core = new THREE.MeshBasicMaterial({ color: new THREE.Color(6, 3.2, 2), blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, fog: false });
  const halo = new THREE.MeshBasicMaterial({ color: new THREE.Color(3, 0.25, 0.08), blending: THREE.AdditiveBlending, transparent: true, opacity: 0.55, depthWrite: false, fog: false });
  const beams = [0, 1].map(() => {
    const g = new THREE.Group();
    const c = new THREE.Mesh(beamGeo, core);
    c.scale.set(0.022, 0.022, 1);
    const h = new THREE.Mesh(beamGeo, halo);
    h.scale.set(0.09, 0.09, 1);
    g.add(c, h);
    g.visible = false;
    g.frustumCulled = false;
    c.frustumCulled = h.frustumCulled = false;
    scene.add(g);
    return g;
  });

  const light = new THREE.PointLight(0xff5a1f, 0, 30, 1.6);
  scene.add(light);
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: radialTexture('rgba(255,220,160,1)', 'rgba(255,60,10,0)'), color: new THREE.Color(2.5, 1, 0.4), blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
  glow.scale.setScalar(4);
  glow.visible = false;
  scene.add(glow);

  // Marcas de queimado: quads instanciados colados na superfície, em anel circular.
  const scorch = new THREE.InstancedMesh(
    new THREE.PlaneGeometry(1, 1),
    new THREE.MeshStandardMaterial({ map: radialTexture('rgba(10,6,4,.95)', 'rgba(10,6,4,0)'), transparent: true, depthWrite: false, roughness: 1, polygonOffset: true, polygonOffsetFactor: -4 }),
    MAX_SCORCH,
  );
  scorch.count = 0;
  scorch.frustumCulled = false;
  scene.add(scorch);
  let scorchNext = 0;
  let scorchTimer = 0;

  // Fagulhas: pontos com física simples, aditivos.
  const sparkPos = new Float32Array(MAX_SPARKS * 3);
  const sparkVel = new Float32Array(MAX_SPARKS * 3);
  const sparkLife = new Float32Array(MAX_SPARKS);
  const sparkGeo = new THREE.BufferGeometry();
  sparkGeo.setAttribute('position', new THREE.BufferAttribute(sparkPos, 3));
  const sparks = new THREE.Points(sparkGeo, new THREE.PointsMaterial({ color: new THREE.Color(2.4, 1.1, 0.4), size: 0.12, map: radialTexture('rgba(255,255,255,1)', 'rgba(255,255,255,0)'), blending: THREE.AdditiveBlending, transparent: true, depthWrite: false }));
  sparks.frustumCulled = false;
  scene.add(sparks);
  let sparkNext = 0;

  const origin = new THREE.Vector3();
  const dir = new THREE.Vector3();
  const aim = new THREE.Vector3();
  const eye = new THREE.Vector3();
  const hit = {};
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const s = new THREE.Vector3();
  const n = new THREE.Vector3();
  const back = new THREE.Vector3();
  const aimW = new THREE.Vector3();
  const zAxis = new THREE.Vector3(0, 0, 1);

  function addScorch(p, normal) {
    n.copy(normal);
    q.setFromUnitVectors(zAxis, n);
    s.setScalar(1.2 + Math.random() * 1.4);
    eye.copy(p).addScaledVector(n, 0.05);
    scorch.setMatrixAt(scorchNext, m.compose(eye, q, s));
    scorchNext = (scorchNext + 1) % MAX_SCORCH;
    scorch.count = Math.min(MAX_SCORCH, scorch.count + 1);
    scorch.instanceMatrix.needsUpdate = true;
  }

  function emitSparks(p, normal, count) {
    for (let k = 0; k < count; k++) {
      const i = sparkNext;
      sparkNext = (sparkNext + 1) % MAX_SPARKS;
      sparkPos[i * 3] = p.x; sparkPos[i * 3 + 1] = p.y; sparkPos[i * 3 + 2] = p.z;
      const sp = 3 + Math.random() * 7;
      sparkVel[i * 3] = (normal.x + (Math.random() - 0.5) * 1.6) * sp;
      sparkVel[i * 3 + 1] = (normal.y + Math.random() * 0.8) * sp;
      sparkVel[i * 3 + 2] = (normal.z + (Math.random() - 0.5) * 1.6) * sp;
      sparkLife[i] = 0.25 + Math.random() * 0.45;
    }
  }

  function updateSparks(dt) {
    for (let i = 0; i < MAX_SPARKS; i++) {
      if (sparkLife[i] <= 0) { sparkPos[i * 3 + 1] = -1e4; continue; }
      sparkLife[i] -= dt;
      sparkVel[i * 3 + 1] -= 18 * dt;
      sparkPos[i * 3] += sparkVel[i * 3] * dt;
      sparkPos[i * 3 + 1] += sparkVel[i * 3 + 1] * dt;
      sparkPos[i * 3 + 2] += sparkVel[i * 3 + 2] * dt;
    }
    sparkGeo.attributes.position.needsUpdate = true;
  }

  // Carga solar (0–1): mais alcance, mais dano, raio mais grosso e mais branco, e a reserva
  // paga pelo Sol.
  let charge = 0;
  const coreCold = core.color.clone();
  const coreHot = new THREE.Color(8, 7, 5);
  const haloCold = halo.color.clone();
  const haloHot = new THREE.Color(3, 1.4, 0.3);
  function setCharge(k) {
    charge = k;
    core.color.lerpColors(coreCold, coreHot, k);
    halo.color.lerpColors(haloCold, haloHot, k);
  }

  // Devolve o ponto mirado (e preenche `hit`); alvos vencem prédios mais distantes. `over`: a
  // direção da mira assistida, quando o raio carregado vai à Terra.
  function trace(over) {
    origin.copy(camera.position);
    if (over) dir.set(over.x, over.y, over.z);
    else camera.getWorldDirection(dir);
    const range = RANGE * (1 + SOLAR.range * charge);
    let best = range;
    let target = null;
    if (collision.raycast(origin, dir, range, hit)) best = hit.dist;
    for (const t of targets) {
      const d = raySphere(origin, dir, t.pos, t.radius);
      if (d >= 0 && d < best) { best = d; target = t; }
    }
    aim.copy(origin).addScaledVector(dir, best);
    return { target, surface: !target && best < range };
  }

  let heat = 0;
  let hitting = false;
  function update(dt, wants, over = null) {
    const firing = energy.update(dt, wants, 1 - charge);
    heat += ((firing ? 1 : 0) - heat) * (1 - Math.exp(-dt * 12));
    hero.eyeMat.emissiveIntensity = heat * 12;
    updateSparks(dt);
    hitting = false;
    if (!firing) {
      beams.forEach((b) => { b.visible = false; });
      light.intensity = 0;
      glow.visible = false;
      return;
    }
    const { target, surface } = trace(over);
    hitting = surface || !!target;
    hero.eyes.forEach((e, k) => {
      // Olho e mira no mesmo espaço (o do mundo, que a origem flutuante desloca); o lookAt quer
      // espaço de render.
      scene.worldToLocal(e.getWorldPosition(eye));
      const b = beams[k];
      b.visible = true;
      b.position.copy(eye);
      b.lookAt(scene.localToWorld(aimW.copy(aim)));
      b.scale.z = eye.distanceTo(aim);
      // Tremor fino no raio: calor não é linha de laser.
      const j = (1 + Math.sin(performance.now() * 0.05 + k) * 0.15) * (1 + 1.2 * charge);
      b.scale.x = b.scale.y = j;
    });
    light.position.copy(aim);
    light.intensity = 80 * heat;
    glow.position.copy(aim);
    glow.visible = surface || !!target;
    glow.scale.setScalar(1.8 + Math.random() * 0.8);
    if (target) {
      target.hit(dt * (1 + SOLAR.power * charge), aim);
      emitSparks(aim, back.copy(dir).negate(), 3);
    } else if (surface) {
      n.set(hit.nx, hit.ny, hit.nz);
      emitSparks(aim, n, 4);
      if ((scorchTimer -= dt) <= 0) {
        addScorch(aim, n);
        scorchTimer = 0.04;
      }
    }
  }

  return {
    update, energy, targets, setCharge,
    clearMarks: (box) => hideInstancesIn(scorch, box), // prédio desabou: marca não fica no ar
    get firing() { return energy.firing; },
    get hitting() { return hitting; },
  };
}

function radialTexture(inner, outer) {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, inner);
  grad.addColorStop(1, outer);
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
