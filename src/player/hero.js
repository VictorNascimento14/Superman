import * as THREE from 'three';
import { createCloth, gridNormals } from './cloth.js';

// Herói montado com primitivas (ADR-001). A origem do `root` é a pélvis; em pé, a sola
// fica `FLIGHT.footDepth` (flight.js, 1,04 m já com a escala) abaixo dela. O corpo olha
// para +z e a cabeça para +y — em voo o `root` inteiro é girado para a cabeça apontar
// para onde ele vai.
const SCALE = 1.1;

const MAT = {
  suit: () => new THREE.MeshPhysicalMaterial({ color: 0x1a3584, roughness: 0.55, sheen: 0.5, sheenColor: 0x4a64d0, sheenRoughness: 0.5 }),
  red: () => new THREE.MeshPhysicalMaterial({ color: 0xa3121a, roughness: 0.5, sheen: 0.4, sheenColor: 0xff5555 }),
  gold: () => new THREE.MeshStandardMaterial({ color: 0xe0b12a, roughness: 0.35, metalness: 0.6 }),
  skin: () => new THREE.MeshStandardMaterial({ color: 0xd9a47f, roughness: 0.6 }),
  hair: () => new THREE.MeshStandardMaterial({ color: 0x0e1014, roughness: 0.45 }),
};

function capsule(r, len, mat, sx = 1, sz = 1) {
  const g = new THREE.CapsuleGeometry(r, len, 6, 14);
  g.translate(0, -len / 2 - r * 0.6, 0); // pendurado a partir da junta
  const m = new THREE.Mesh(g, mat);
  m.scale.set(sx, 1, sz);
  m.castShadow = true;
  return m;
}

function sphere(r, mat, sx = 1, sy = 1, sz = 1) {
  const m = new THREE.Mesh(new THREE.SphereGeometry(r, 18, 14), mat);
  m.scale.set(sx, sy, sz);
  m.castShadow = true;
  return m;
}

function joint(parent, x, y, z) {
  const j = new THREE.Object3D();
  j.position.set(x, y, z);
  parent.add(j);
  return j;
}

// Emblema estilizado: escudo pentagonal com um traço abstrato — de propósito NÃO é o
// logotipo oficial (ADR-002).
function emblemTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  const shield = () => {
    g.beginPath();
    g.moveTo(40, 58); g.lineTo(92, 22); g.lineTo(164, 22); g.lineTo(216, 58); g.lineTo(128, 236);
    g.closePath();
  };
  shield();
  g.fillStyle = '#b0141d';
  g.fill();
  g.save();
  g.translate(128, 120);
  g.scale(0.8, 0.8);
  g.translate(-128, -120);
  shield();
  g.fillStyle = '#e8b923';
  g.fill();
  g.restore();
  // Divisa: duas asas em "V" sobre uma barra — lê como brasão, sem letra nenhuma.
  g.fillStyle = '#b0141d';
  for (const y of [70, 108]) {
    g.beginPath();
    g.moveTo(66, y); g.lineTo(128, y + 34); g.lineTo(190, y); g.lineTo(190, y + 20); g.lineTo(128, y + 56); g.lineTo(66, y + 20);
    g.closePath();
    g.fill();
  }
  g.beginPath();
  g.arc(128, 188, 14, 0, Math.PI * 2);
  g.fill();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function buildArm(chest, side, m) {
  const shoulder = joint(chest, side * 0.29, 0.35, 0);
  shoulder.add(sphere(0.1, m.suit, 1.15, 1, 1.05)); // deltoide
  const upper = joint(shoulder, 0, 0, 0);
  upper.add(capsule(0.08, 0.17, m.suit));
  const elbow = joint(upper, 0, -0.3, 0);
  elbow.add(capsule(0.066, 0.16, m.suit));
  const hand = joint(elbow, 0, -0.28, 0);
  const fist = sphere(0.064, m.skin, 0.9, 1.1, 1);
  fist.position.y = -0.04;
  hand.add(fist);
  return { shoulder: upper, elbow, hand };
}

function buildLeg(pelvis, side, m) {
  const hip = joint(pelvis, side * 0.105, -0.06, 0);
  hip.add(capsule(0.1, 0.27, m.suit));
  const knee = joint(hip, 0, -0.44, 0);
  knee.add(capsule(0.078, 0.27, m.suit));
  const boot = capsule(0.084, 0.16, m.red);
  boot.position.y = -0.2;
  knee.add(boot);
  const ankle = joint(knee, 0, -0.44, 0);
  const foot = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.08, 0.26), m.red);
  foot.geometry.translate(0, -0.03, 0.06);
  foot.castShadow = true;
  ankle.add(foot);
  return { hip, knee, ankle };
}

function buildRig(m) {
  const root = new THREE.Group();
  const body = new THREE.Group();
  body.scale.setScalar(SCALE);
  root.add(body);
  const pelvis = joint(body, 0, 0, 0);
  const trunks = sphere(0.17, m.red, 1.05, 0.72, 0.82);
  trunks.position.y = -0.03;
  pelvis.add(trunks);
  const belt = new THREE.Mesh(new THREE.TorusGeometry(0.155, 0.022, 6, 24), m.gold);
  belt.rotation.x = Math.PI / 2;
  belt.scale.set(1.05, 0.8, 1);
  belt.position.y = 0.06;
  pelvis.add(belt);

  const spine = joint(pelvis, 0, 0.08, 0);
  const abdomen = capsule(0.155, 0.1, m.suit, 1.05, 0.8);
  abdomen.position.y = 0.2;
  spine.add(abdomen);
  const chest = joint(spine, 0, 0.18, 0);
  const torso = capsule(0.2, 0.14, m.suit, 1.45, 0.82);
  torso.position.y = 0.38;
  chest.add(torso);
  for (const s of [-1, 1]) {
    const pec = sphere(0.11, m.suit, 1.25, 0.8, 0.6);
    pec.position.set(s * 0.09, 0.28, 0.1);
    chest.add(pec);
  }
  const emblem = new THREE.Mesh(new THREE.PlaneGeometry(0.26, 0.26), new THREE.MeshStandardMaterial({ map: emblemTexture(), transparent: true, roughness: 0.5, polygonOffset: true, polygonOffsetFactor: -2 }));
  emblem.position.set(0, 0.27, 0.172);
  emblem.rotation.x = -0.12;
  chest.add(emblem);

  const neck = joint(chest, 0, 0.42, 0);
  const neckMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.062, 0.075, 0.1, 10), m.skin);
  neckMesh.position.y = 0.03;
  neck.add(neckMesh);
  const head = joint(neck, 0, 0.1, 0);
  const skull = sphere(0.105, m.skin, 0.92, 1.12, 1);
  skull.position.y = 0.06;
  head.add(skull);
  const jaw = sphere(0.085, m.skin, 0.95, 0.7, 0.95);
  jaw.position.set(0, 0.0, 0.02);
  head.add(jaw);
  const hair = new THREE.Mesh(new THREE.SphereGeometry(0.112, 18, 12, 0, Math.PI * 2, 0, Math.PI * 0.52), m.hair);
  hair.scale.set(0.95, 1.1, 1.05);
  hair.position.set(0, 0.075, -0.008);
  hair.rotation.x = -0.25;
  head.add(hair);
  const curl = new THREE.Mesh(new THREE.TorusGeometry(0.018, 0.007, 6, 12, Math.PI * 1.5), m.hair);
  curl.position.set(0.01, 0.13, 0.1);
  curl.rotation.set(0, 0.3, 0.8);
  head.add(curl);
  const nose = sphere(0.016, m.skin, 0.9, 1.3, 1.2);
  nose.position.set(0, 0.05, 0.103);
  head.add(nose);
  for (const sd of [-1, 1]) {
    const ear = sphere(0.022, m.skin, 0.5, 1.2, 0.9);
    ear.position.set(sd * 0.098, 0.06, 0);
    head.add(ear);
    const brow = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.008, 0.01), m.hair);
    brow.position.set(sd * 0.037, 0.093, 0.094);
    brow.rotation.z = sd * -0.15;
    head.add(brow);
  }
  const eyeMat = new THREE.MeshStandardMaterial({ color: 0x1a2a55, emissive: 0xff2200, emissiveIntensity: 0 });
  const eyes = [-1, 1].map((s) => {
    const e = new THREE.Mesh(new THREE.SphereGeometry(0.013, 8, 6), eyeMat);
    e.position.set(s * 0.037, 0.075, 0.093);
    head.add(e);
    return e;
  });

  return {
    root, body, pelvis, spine, chest, neck, head, eyes, eyeMat,
    armR: buildArm(chest, -1, m), armL: buildArm(chest, 1, m),
    legR: buildLeg(pelvis, -1, m), legL: buildLeg(pelvis, 1, m),
  };
}

// Poses em ângulos de Euler por junta. "R" é o lado direito DO HERÓI (x negativo).
const POSES = {
  // Mãos na cintura, peito aberto.
  idle: {
    spine: [0.02, 0, 0], chest: [-0.05, 0, 0], head: [-0.05, 0, 0],
    armR: [[0.3, 0, -0.7], [0, 0, 1.5]], armL: [[0.3, 0, 0.7], [0, 0, -1.5]],
    legR: [[0, 0, -0.06], [0, 0, 0], [0, 0, 0]], legL: [[0, 0, 0.06], [0, 0, 0], [0, 0, 0]],
  },
  // Pairando: joelho dobrado, braços soltos.
  hover: {
    spine: [0.05, 0, 0], chest: [0, 0, 0], head: [0, 0, 0],
    armR: [[-0.15, 0, -0.3], [-0.4, 0, 0]], armL: [[-0.15, 0, 0.3], [-0.4, 0, 0]],
    legR: [[-0.25, 0, -0.05], [0.55, 0, 0], [0.4, 0, 0]], legL: [[0.05, 0, 0.05], [0.15, 0, 0], [0.5, 0, 0]],
  },
  // Voo: punho direito à frente (acima da cabeça, no referencial do corpo), esquerdo junto ao corpo.
  fly: {
    spine: [0, 0, 0], chest: [0, 0, 0], head: [-0.9, 0, 0],
    armR: [[-3.0, 0, 0.1], [-0.1, 0, 0]], armL: [[0.1, 0, 0.12], [-0.2, 0, 0]],
    legR: [[0.05, 0, -0.02], [0.08, 0, 0], [1.2, 0, 0]], legL: [[0.02, 0, 0.02], [0.25, 0, 0], [1.2, 0, 0]],
  },
  // Supervelocidade: os dois punhos à frente.
  flyFast: {
    spine: [0, 0, 0], chest: [0, 0, 0], head: [-1.0, 0, 0],
    armR: [[-3.05, 0, 0.12], [0, 0, 0]], armL: [[-3.05, 0, -0.12], [0, 0, 0]],
    legR: [[0, 0, -0.02], [0.05, 0, 0], [1.3, 0, 0]], legL: [[0, 0, 0.02], [0.05, 0, 0], [1.3, 0, 0]],
  },
};

export function createHero(scene) {
  const m = Object.fromEntries(Object.entries(MAT).map(([k, f]) => [k, f()]));
  const rig = buildRig(m);
  scene.add(rig.root);

  // Juntas controladas pelas poses, na mesma ordem das chaves de POSES.
  const joints = {
    spine: rig.spine, chest: rig.chest, head: rig.head,
    armR: [rig.armR.shoulder, rig.armR.elbow], armL: [rig.armL.shoulder, rig.armL.elbow],
    legR: [rig.legR.hip, rig.legR.knee, rig.legR.ankle], legL: [rig.legL.hip, rig.legL.knee, rig.legL.ankle],
  };
  const weights = { idle: 1, hover: 0, fly: 0, flyFast: 0 };

  function applyPoses(dt, target, t, walk) {
    // Pesos vão ao alvo com suavização exponencial; a pose final é a média ponderada.
    const k = 1 - Math.exp(-dt * 6);
    for (const p in weights) weights[p] += ((p === target ? 1 : 0) - weights[p]) * k;
    const each = (obj, key, fn) => {
      const v = obj[key];
      if (Array.isArray(v)) v.forEach((j, i) => fn(j, (pose) => pose[key][i]));
      else fn(v, (pose) => pose[key]);
    };
    for (const key in joints) {
      each(joints, key, (j, pick) => {
        let x = 0; let y = 0; let z = 0; let sum = 0;
        for (const p in weights) {
          const w = weights[p];
          if (w < 1e-3) continue;
          const e = pick(POSES[p]);
          x += e[0] * w; y += e[1] * w; z += e[2] * w; sum += w;
        }
        j.rotation.set(x / sum, y / sum, z / sum);
      });
    }
    // Camadas procedurais por cima da pose: respiração, e passada quando anda.
    const breathe = Math.sin(t * 1.6) * 0.015;
    rig.chest.rotation.x += breathe;
    if (walk > 0.01) {
      const s = Math.sin(t * 9) * 0.6 * walk;
      joints.legR[0].rotation.x += s;
      joints.legL[0].rotation.x -= s;
      joints.legR[1].rotation.x += Math.max(0, -s) * 1.2;
      joints.legL[1].rotation.x += Math.max(0, s) * 1.2;
    }
    // Em voo o corpo ondula de leve: o vento nunca é constante.
    const flying = weights.fly + weights.flyFast;
    rig.spine.rotation.z += Math.sin(t * 2.3) * 0.03 * flying;
  }

  const cape = createCape(rig, m.red);
  scene.add(cape.mesh);

  return {
    root: rig.root,
    rig,
    eyeMat: rig.eyeMat,
    eyes: rig.eyes,
    // state: { pose, walk, velocity (THREE.Vector3), t }
    update(dt, state) {
      applyPoses(dt, state.pose, state.t, state.walk ?? 0);
      rig.root.updateMatrixWorld(true);
      cape.update(dt, state.velocity, state.t);
    },
    resetCape: () => cape.reset(),
  };
}

// --- Capa: pano simulado no referencial que acompanha o herói (sem rotação), com o
// vento efetivo limitado — acima de ~40 m/s ela já está toda esticada.
const CAPE = { cols: 7, rows: 12, topWidth: 0.5, bottomWidth: 1.0, length: 1.4 };
const MAX_AIR = 42;
const SUBSTEP = 1 / 120;

function createCape(rig, mat) {
  const cloth = createCloth(CAPE);
  const geo = new THREE.PlaneGeometry(1, 1, CAPE.cols - 1, CAPE.rows - 1);
  const capeMat = mat.clone();
  capeMat.side = THREE.DoubleSide;
  const mesh = new THREE.Mesh(geo, capeMat);
  mesh.castShadow = true;
  mesh.frustumCulled = false;

  // Pinos: linha dos ombros, atrás do peito (espaço local do `chest`).
  const anchorsLocal = Array.from({ length: CAPE.cols }, (_, c) => {
    const u = c / (CAPE.cols - 1) - 0.5;
    return new THREE.Vector3(u * 0.52, 0.45, -0.15 - Math.cos(u * Math.PI) * 0.02);
  });
  const anchorW = anchorsLocal.map(() => new THREE.Vector3());
  const origin = new THREE.Vector3();
  const lastOrigin = new THREE.Vector3();
  const air = [0, 0, 0];
  const gravity = [0, -9.8, 0];
  // Corpo para colisão: cápsula da pélvis ao peito, em coordenadas do referencial da capa.
  const bodyA = new THREE.Vector3();
  const bodyB = new THREE.Vector3();
  const seg = new THREE.Vector3();
  const tmp = new THREE.Vector3();
  const closest = new THREE.Vector3();
  let ready = false;
  let acc = 0;

  function computeAnchors() {
    for (let c = 0; c < CAPE.cols; c++) anchorW[c].copy(anchorsLocal[c]).applyMatrix4(rig.chest.matrixWorld);
    origin.copy(anchorW[Math.floor(CAPE.cols / 2)]);
  }

  function reset() {
    rig.root.updateMatrixWorld(true);
    computeAnchors();
    cloth.reset({ x: 0, y: 0, z: 0 });
    // A forma de repouso é centrada em x=0; posiciona já pendurada atrás do herói.
    for (let i = 0; i < cloth.pos.length; i += 3) cloth.pos[i + 2] -= 0.05;
    lastOrigin.copy(origin);
    ready = true;
  }

  const collide = (p, o) => {
    // Distância do ponto ao segmento pélvis–peito; raio do tronco ~0.2 m.
    tmp.set(p[o], p[o + 1], p[o + 2]).sub(bodyA);
    const t = Math.max(0, Math.min(1, tmp.dot(seg) / seg.lengthSq()));
    closest.copy(seg).multiplyScalar(t).add(bodyA);
    tmp.set(p[o], p[o + 1], p[o + 2]).sub(closest);
    const d = tmp.length();
    const r = 0.24 * SCALE;
    if (d < r && d > 1e-6) {
      tmp.multiplyScalar((r - d) / d);
      p[o] += tmp.x; p[o + 1] += tmp.y; p[o + 2] += tmp.z;
    }
  };

  function update(dt, velocity, t) {
    computeAnchors();
    if (!ready || origin.distanceTo(lastOrigin) > 30) reset();
    lastOrigin.copy(origin);
    // Vento relativo = −velocidade do herói, com teto, + rajada que faz a capa tremular.
    const sp = velocity.length();
    const s = sp > MAX_AIR ? MAX_AIR / sp : 1;
    const gust = Math.min(1, sp / 15);
    air[0] = -velocity.x * s + Math.sin(t * 7.1) * 2.5 * gust;
    air[1] = -velocity.y * s + Math.sin(t * 5.3) * 2 * gust;
    air[2] = -velocity.z * s + Math.cos(t * 6.7) * 2.5 * gust;
    tmp.set(0, 0, 0).applyMatrix4(rig.pelvis.matrixWorld);
    bodyA.copy(tmp).sub(origin);
    tmp.set(0, 0.45, -0.02).applyMatrix4(rig.chest.matrixWorld);
    bodyB.copy(tmp).sub(origin);
    seg.subVectors(bodyB, bodyA);
    for (let c = 0; c < CAPE.cols; c++) cloth.setPin(c, anchorW[c].x - origin.x, anchorW[c].y - origin.y, anchorW[c].z - origin.z);
    acc = Math.min(acc + dt, SUBSTEP * 4);
    while (acc >= SUBSTEP) {
      cloth.step(SUBSTEP, gravity, air, 3 + Math.min(sp, 60) * 0.12, 5, collide);
      acc -= SUBSTEP;
    }
    // Direto nos arrays: o setXYZ encaixota os doubles dos argumentos, e o computeVertexNormals
    // varre os 132 triângulos alocando — juntos, ~1 MB/s.
    const posArr = geo.attributes.position.array;
    for (let i = 0; i < cloth.pos.length; i += 3) {
      posArr[i] = cloth.pos[i] + origin.x;
      posArr[i + 1] = cloth.pos[i + 1] + origin.y;
      posArr[i + 2] = cloth.pos[i + 2] + origin.z;
    }
    geo.attributes.position.needsUpdate = true;
    gridNormals(cloth.pos, CAPE.cols, CAPE.rows, geo.attributes.normal.array);
    geo.attributes.normal.needsUpdate = true;
  }

  return { mesh, update, reset };
}
