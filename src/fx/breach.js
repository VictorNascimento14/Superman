import * as THREE from 'three';
import { createDebris } from './debrisSim.js';
import { createRng } from '../core/rng.js';
import { hideInstancesIn } from './instances.js';

// Rastro de quem atravessa um prédio: furo na fachada (entrada e saída), entulho com física
// e poeira. Tudo em pools de tamanho fixo — nada aloca por quadro.
const HOLES = 160;
const CHUNKS = 1200;
const PUFFS = 160;
const PUFF_LIFE = 3.5;

const Z = new THREE.Vector3(0, 0, 1);
const CONCRETE = [0x8d877c, 0x6f6a62, 0xa39c8f, 0x5a554e, 0x9a8f7d];
const GLASS = 0x9fc4d8;

export function createBreachFx(scene, openings = null) {
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const spinQ = new THREE.Quaternion();
  const p = new THREE.Vector3();
  const n = new THREE.Vector3();
  const j = new THREE.Vector3();
  const sc = new THREE.Vector3();
  const col = new THREE.Color();
  let breaches = 0;

  // --- Furos: a parede é uma casca oca, então o buraco é desenhado, não recortado.
  const holes = new THREE.InstancedMesh(
    new THREE.PlaneGeometry(1, 1),
    new THREE.MeshStandardMaterial({ map: holeTexture(), transparent: true, depthWrite: false, roughness: 1, polygonOffset: true, polygonOffsetFactor: -4 }),
    HOLES,
  );
  holes.count = 0;
  holes.frustumCulled = false;
  // Nos prédios com interior montado o furo é aberto de verdade: o miolo do decalque é recortado
  // junto com a parede, e fica só a borda de concreto quebrado.
  openings?.patch(holes.material, 'always');
  scene.add(holes);
  let holeNext = 0;

  // --- Entulho: caixas instanciadas com cor por pedaço (concreto ou vidro).
  const debris = createDebris(CHUNKS);
  const chunks = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ roughness: 0.85, metalness: 0.05 }), CHUNKS);
  chunks.count = 0;
  chunks.castShadow = true;
  chunks.frustumCulled = false; // o pool se espalha por onde o herói passou
  chunks.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  chunks.setColorAt(0, col.set(CONCRETE[0])); // cria o buffer de cor
  scene.add(chunks);

  // --- Poeira: pontos com tamanho e opacidade próprios (o PointsMaterial só tem um de cada).
  const dustPos = new Float32Array(PUFFS * 3);
  const dustVel = new Float32Array(PUFFS * 3);
  const dustSize = new Float32Array(PUFFS);
  const dustAlpha = new Float32Array(PUFFS);
  const dustAge = new Float32Array(PUFFS).fill(PUFF_LIFE);
  const dustLife = new Float32Array(PUFFS).fill(PUFF_LIFE);
  const dustMax = new Float32Array(PUFFS);
  const dustPeak = new Float32Array(PUFFS);
  const dustGeo = new THREE.BufferGeometry();
  dustGeo.setAttribute('position', new THREE.BufferAttribute(dustPos, 3).setUsage(THREE.DynamicDrawUsage));
  dustGeo.setAttribute('size', new THREE.BufferAttribute(dustSize, 1).setUsage(THREE.DynamicDrawUsage));
  dustGeo.setAttribute('alpha', new THREE.BufferAttribute(dustAlpha, 1).setUsage(THREE.DynamicDrawUsage));
  const dustMat = new THREE.ShaderMaterial({
    uniforms: { color: { value: new THREE.Color(0.5, 0.46, 0.4) }, scale: { value: 800 } },
    vertexShader: `
      attribute float size;
      attribute float alpha;
      uniform float scale;
      varying float vAlpha;
      void main() {
        vAlpha = alpha;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mv;
        gl_PointSize = size * scale / max(-mv.z, 0.1);
      }`,
    fragmentShader: `
      uniform vec3 color;
      varying float vAlpha;
      void main() {
        vec2 d = gl_PointCoord - 0.5;
        float r2 = dot(d, d) * 4.0;
        if (r2 > 1.0 || vAlpha <= 0.0) discard;
        float a = vAlpha * (1.0 - r2) * (1.0 - r2);
        gl_FragColor = vec4(color, a);
      }`,
    transparent: true,
    depthWrite: false,
  });
  const dust = new THREE.Points(dustGeo, dustMat);
  dust.frustumCulled = false;
  scene.add(dust);
  let dustNext = 0;

  // Uma nuvem: cresce de 3 m até `max`, começa com opacidade `peak` e some em `life`
  // segundos, subindo devagar.
  function puff(x, y, z, vx, vy, vz, max = 14, life = PUFF_LIFE, peak = 0.55) {
    const i = dustNext;
    dustNext = (dustNext + 1) % PUFFS;
    const o = i * 3;
    dustPos[o] = x; dustPos[o + 1] = y; dustPos[o + 2] = z;
    dustVel[o] = vx; dustVel[o + 1] = vy; dustVel[o + 2] = vz;
    dustAge[i] = 0;
    dustLife[i] = life;
    dustMax[i] = max;
    dustPeak[i] = peak;
  }

  // Estouro genérico (desabamento, interior quebrado): `count` pedaços saindo de (x, y, z) com
  // velocidade base (vx, vy, vz), espalhamento `spread`, tamanho até `sizeMax` e, se dada, a cor
  // do que quebrou (senão concreto e vidro).
  function burst(x, y, z, vx, vy, vz, count, spread, sizeMax, color = null) {
    for (let i = 0; i < count; i++) {
      const s = 0.3 + Math.random() ** 2 * (sizeMax - 0.3);
      const idx = debris.spawn(
        x + (Math.random() - 0.5) * spread, y + Math.random() * 2, z + (Math.random() - 0.5) * spread,
        vx + (Math.random() - 0.5) * spread, vy + Math.random() * 3, vz + (Math.random() - 0.5) * spread,
        s, (Math.random() - 0.5) * 6, (Math.random() - 0.5) * 6, (Math.random() - 0.5) * 6,
      );
      if (color !== null) col.set(color).multiplyScalar(0.8 + Math.random() * 0.3);
      else col.set(Math.random() < 0.12 ? GLASS : CONCRETE[(Math.random() * CONCRETE.length) | 0]);
      chunks.setColorAt(idx, col);
    }
    chunks.instanceColor.needsUpdate = true;
  }

  // Um furo por evento (entrada ou saída), com entulho e poeira proporcionais à velocidade.
  // Devolve onde o furo ficou (centro, normal da face e raio da abertura), ou null.
  function spawn(e) {
    if (e.at.y < -1) return null; // nível que já desabou (a caixa foi para debaixo da terra)
    breaches++;
    const exit = !e.entry;
    const k = Math.min(1, e.speed / 200);
    axisNormal(e.normal, n); // numa quina a normal do contato é diagonal: o furo fica na face

    p.copy(e.at).addScaledVector(n, 0.04);
    q.setFromUnitVectors(Z, n);
    q.premultiply(spinQ.setFromAxisAngle(n, Math.random() * Math.PI * 2));
    const size = (exit ? 4.5 : 3.5) + 3 * k + Math.random() * 0.8; // quanto mais rápido, maior o rombo
    holes.setMatrixAt(holeNext, m.compose(p, q, sc.set(size, size, 1)));
    holeNext = (holeNext + 1) % HOLES;
    holes.count = Math.min(HOLES, holes.count + 1);
    holes.instanceMatrix.needsUpdate = true;

    // Na saída o material empurrado sai quase na velocidade do herói e voa junto com ele; na
    // entrada a fachada estoura para fora, na direção de quem vem atrás (a câmera).
    const count = Math.round(exit ? 30 + 60 * k : 20 + 25 * k);
    const spread = 3 + 6 * k;
    for (let i = 0; i < count; i++) {
      const s = 0.2 + Math.random() ** 3 * 1.3;
      const along = exit ? e.speed * (0.55 + Math.random() * 0.55) : 0;
      const out = exit ? 2 + Math.random() * 6 : 4 + Math.random() * 10;
      // Espalha no plano da face (nunca para dentro do prédio) e nasce um pouco fora dela.
      j.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(size * 0.8);
      j.addScaledVector(n, -j.dot(n)).addScaledVector(n, s / 2 + 0.3).add(e.at);
      const idx = debris.spawn(
        j.x, j.y, j.z,
        e.dir.x * along + n.x * out + (Math.random() - 0.5) * spread,
        e.dir.y * along + n.y * out + Math.random() * 4,
        e.dir.z * along + n.z * out + (Math.random() - 0.5) * spread,
        s, (Math.random() - 0.5) * 16, (Math.random() - 0.5) * 16, (Math.random() - 0.5) * 16,
      );
      chunks.setColorAt(idx, col.set(Math.random() < 0.2 ? GLASS : CONCRETE[(Math.random() * CONCRETE.length) | 0]));
    }
    chunks.instanceColor.needsUpdate = true;

    const push = exit ? e.speed * 0.03 : 0;
    for (let i = 0, puffs = exit ? 6 : 3; i < puffs; i++) {
      puff(
        e.at.x + n.x * 2 + (Math.random() - 0.5) * 3, e.at.y + n.y * 2 + (Math.random() - 0.5) * 3, e.at.z + n.z * 2 + (Math.random() - 0.5) * 3,
        n.x * (1.5 + Math.random() * 2) + e.dir.x * push, n.y * (1.5 + Math.random() * 2) + e.dir.y * push + 0.6, n.z * (1.5 + Math.random() * 2) + e.dir.z * push,
      );
    }
    // A abertura é o miolo escuro do decalque (~30% do tamanho dele); a borda fica em volta.
    return { x: e.at.x, y: e.at.y, z: e.at.z, nx: n.x, ny: n.y, nz: n.z, r: size * 0.3 };
  }

  // viewHeight: altura do canvas em pixels, para a poeira ter tamanho em metros.
  function update(dt, camera, groundAt, viewHeight) {
    debris.step(dt, groundAt);
    for (let i = 0; i < debris.count; i++) {
      const o = i * 3;
      const s = debris.size[i];
      p.set(debris.pos[o], debris.pos[o + 1], debris.pos[o + 2]);
      q.set(debris.rot[i * 4], debris.rot[i * 4 + 1], debris.rot[i * 4 + 2], debris.rot[i * 4 + 3]);
      chunks.setMatrixAt(i, m.compose(p, q, sc.set(s, s * 0.6, s * 0.85)));
    }
    chunks.count = debris.count;
    if (debris.count) chunks.instanceMatrix.needsUpdate = true;

    for (let i = 0; i < PUFFS; i++) {
      if (dustAge[i] >= dustLife[i]) {
        dustAlpha[i] = 0;
        continue;
      }
      const o = i * 3;
      dustAge[i] += dt;
      const t = Math.min(1, dustAge[i] / dustLife[i]);
      const drag = Math.exp(-dt * 0.8);
      dustVel[o] *= drag; dustVel[o + 1] = dustVel[o + 1] * drag + 0.3 * dt; dustVel[o + 2] *= drag;
      dustPos[o] += dustVel[o] * dt; dustPos[o + 1] += dustVel[o + 1] * dt; dustPos[o + 2] += dustVel[o + 2] * dt;
      dustSize[i] = 3 + (dustMax[i] - 3) * Math.sqrt(t);
      dustAlpha[i] = dustPeak[i] * (1 - t) ** 1.5;
    }
    dustGeo.attributes.position.needsUpdate = true;
    dustGeo.attributes.size.needsUpdate = true;
    dustGeo.attributes.alpha.needsUpdate = true;
    dustMat.uniforms.scale.value = viewHeight / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2));
  }

  return {
    spawn,
    burst,
    puff,
    update,
    clearMarks: (box) => hideInstancesIn(holes, box),
    stats: () => ({ breaches, holes: holes.count, debris: debris.count }),
  };
}

// Eixo dominante de uma normal: as fachadas são alinhadas aos eixos.
function axisNormal(v, out) {
  const ax = Math.abs(v.x);
  const ay = Math.abs(v.y);
  const az = Math.abs(v.z);
  if (ax >= ay && ax >= az) return out.set(Math.sign(v.x), 0, 0);
  if (ay >= az) return out.set(0, Math.sign(v.y), 0);
  return out.set(0, 0, Math.sign(v.z));
}

// Furo: concreto esmigalhado e rachado em volta, miolo escuro com vergalhão aparecendo.
function holeTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const rng = createRng(4242);
  const blob = (r, jitter) => {
    g.beginPath();
    for (let k = 0; k < 20; k++) {
      const a = (k / 20) * Math.PI * 2;
      const rr = r * (1 - jitter + rng.next() * jitter * 2);
      if (k === 0) g.moveTo(64 + Math.cos(a) * rr, 64 + Math.sin(a) * rr);
      else g.lineTo(64 + Math.cos(a) * rr, 64 + Math.sin(a) * rr);
    }
    g.closePath();
  };
  g.fillStyle = 'rgba(128,120,108,0.9)';
  blob(56, 0.18);
  g.fill();
  g.strokeStyle = 'rgba(38,34,30,0.85)';
  g.lineWidth = 2;
  for (let k = 0; k < 10; k++) {
    const a = rng.next() * Math.PI * 2;
    const b = a + (rng.next() - 0.5) * 0.3;
    g.beginPath();
    g.moveTo(64 + Math.cos(a) * 30, 64 + Math.sin(a) * 30);
    g.lineTo(64 + Math.cos(b) * 62, 64 + Math.sin(b) * 62);
    g.stroke();
  }
  g.fillStyle = '#0d0c0b';
  blob(36, 0.3);
  g.fill();
  g.strokeStyle = 'rgba(96,74,58,0.9)';
  g.lineWidth = 1.5;
  for (let k = 0; k < 5; k++) {
    const y = 40 + rng.next() * 48;
    g.beginPath();
    g.moveTo(34, y);
    g.lineTo(94, y + (rng.next() - 0.5) * 14);
    g.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
