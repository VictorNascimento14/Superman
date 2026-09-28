import * as THREE from 'three';
import { createParticles, blastSize } from './fireSim.js';
import { createRng } from '../core/rng.js';

// Explosão no impacto: clarão, bola de fogo que sobe e vira fumaça escura, brasas voando e a
// onda de choque. Pools fixos; a fumaça fica no ar por vários segundos.
const FIRE_N = 320;
const SMOKE_N = 260;
const EMBER_N = 400;
const WAVES = 4;

// Nuvem macia e irregular (vários borrões radiais), só no alfa: serve ao fogo e à fumaça.
function puffTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const rng = createRng(1945);
  for (let k = 0; k < 16; k++) {
    const a = rng.range(0, Math.PI * 2);
    const r = rng.range(0, 26);
    const x = 64 + Math.cos(a) * r;
    const y = 64 + Math.sin(a) * r;
    const s = rng.range(20, 44);
    const grad = g.createRadialGradient(x, y, 0, x, y, s);
    grad.addColorStop(0, 'rgba(255,255,255,0.5)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 128, 128);
  }
  return new THREE.CanvasTexture(c);
}

const POINT_VERT = /* glsl */ `
  attribute float size;
  attribute float t;
  attribute float seed;
  uniform float scale;
  varying float vT;
  varying float vSeed;
  void main() {
    vT = t;
    vSeed = seed;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = (t >= 1.0 || t < 0.0) ? 0.0 : size * scale / max(-mv.z, 0.1);
  }`;

// A textura girada pela semente: os puffs não saem iguais.
const ROTATED = /* glsl */ `
  vec2 rotated(float s) {
    float a = s * 6.2832;
    vec2 c = gl_PointCoord - 0.5;
    return vec2(c.x * cos(a) - c.y * sin(a), c.x * sin(a) + c.y * cos(a)) + 0.5;
  }`;

const ATTRS = ['position', 'size', 't', 'seed'];

// Pontos que leem a posição direto do array da simulação (sem cópia por quadro).
function points(sim, material) {
  const n = sim.n;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(sim.pos, 3).setUsage(THREE.DynamicDrawUsage));
  g.setAttribute('size', new THREE.BufferAttribute(new Float32Array(n), 1).setUsage(THREE.DynamicDrawUsage));
  g.setAttribute('t', new THREE.BufferAttribute(new Float32Array(n).fill(1), 1).setUsage(THREE.DynamicDrawUsage));
  g.setAttribute('seed', new THREE.BufferAttribute(new Float32Array(n), 1).setUsage(THREE.DynamicDrawUsage));
  g.setDrawRange(0, 0);
  const p = new THREE.Points(g, material);
  p.frustumCulled = false;
  return p;
}

export function createExplosions(scene) {
  const puff = puffTexture();
  const scale = { value: 800 };
  const fireSim = createParticles(FIRE_N, { buoyancy: 7, drag: 2.4 });
  const smokeSim = createParticles(SMOKE_N, { buoyancy: 2.6, drag: 0.9 });
  const emberSim = createParticles(EMBER_N, { gravity: 9.8, drag: 0.35 });

  // Fogo: branco-amarelo no começo, laranja, vermelho escuro, e some (aditivo, HDR para o bloom).
  const fire = points(fireSim, new THREE.ShaderMaterial({
    uniforms: { map: { value: puff }, scale },
    vertexShader: POINT_VERT,
    fragmentShader: /* glsl */ `
      uniform sampler2D map;
      varying float vT;
      varying float vSeed;
      ${ROTATED}
      void main() {
        float m = texture2D(map, rotated(vSeed)).a;
        vec3 hot = mix(vec3(7.0, 6.0, 4.2), vec3(5.0, 2.0, 0.45), smoothstep(0.0, 0.22, vT));
        vec3 col = mix(hot, vec3(1.2, 0.25, 0.05), smoothstep(0.22, 0.6, vT));
        gl_FragColor = vec4(col * m * (1.0 - smoothstep(0.45, 1.0, vT)), 1.0);
      }`,
    blending: THREE.AdditiveBlending, transparent: true, depthWrite: false,
  }));

  // Fumaça: escura ao nascer, clareia ao se espalhar; de noite, mais escura (não brilha).
  const light = { value: 1 };
  const smoke = points(smokeSim, new THREE.ShaderMaterial({
    uniforms: { map: { value: puff }, scale, light },
    vertexShader: POINT_VERT,
    fragmentShader: /* glsl */ `
      uniform sampler2D map;
      uniform float light;
      varying float vT;
      varying float vSeed;
      ${ROTATED}
      void main() {
        float m = texture2D(map, rotated(vSeed)).a;
        float a = m * smoothstep(0.0, 0.06, vT) * (1.0 - smoothstep(0.45, 1.0, vT)) * 1.1;
        // Cada puff num tom (a semente): a nuvem fica com volume, não uma bola chapada.
        vec3 col = mix(vec3(0.13, 0.115, 0.105), vec3(0.42, 0.4, 0.38), smoothstep(0.1, 0.8, vT));
        col *= (0.75 + 0.5 * vSeed) * light;
        gl_FragColor = vec4(col, min(a, 0.75));
      }`,
    transparent: true, depthWrite: false,
  }));

  // Brasas: pontos pequenos e brilhantes que caem.
  const embers = points(emberSim, new THREE.ShaderMaterial({
    uniforms: { scale },
    vertexShader: POINT_VERT,
    fragmentShader: /* glsl */ `
      varying float vT;
      void main() {
        float r = length(gl_PointCoord - 0.5) * 2.0;
        float a = (1.0 - smoothstep(0.2, 1.0, r)) * (1.0 - vT);
        gl_FragColor = vec4(vec3(6.0, 2.8, 0.7) * a, 1.0);
      }`,
    blending: THREE.AdditiveBlending, transparent: true, depthWrite: false,
  }));
  scene.add(smoke, fire, embers);

  // Clarão: uma luz só, reaproveitada (com número fixo de luzes os shaders não recompilam).
  const flash = new THREE.PointLight(0xffb070, 0, 220, 2);
  scene.add(flash);
  let flashI = 0;

  // Onda de choque: casca que cresce, com a borda acesa.
  const waveMat = () => new THREE.ShaderMaterial({
    uniforms: { alpha: { value: 0 } },
    vertexShader: /* glsl */ `
      varying vec3 vN;
      varying vec3 vV;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vN = normalMatrix * normal;
        vV = -mv.xyz;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      uniform float alpha;
      varying vec3 vN;
      varying vec3 vV;
      void main() {
        float f = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), 6.0); // só a borda: uma bolha inteira parecia vidro
        gl_FragColor = vec4(vec3(1.0, 0.85, 0.6) * f * alpha, 1.0);
      }`,
    blending: THREE.AdditiveBlending, transparent: true, depthWrite: false,
  });
  const sphere = new THREE.SphereGeometry(1, 32, 16);
  const waves = Array.from({ length: WAVES }, () => {
    const m = new THREE.Mesh(sphere, waveMat());
    m.visible = false;
    m.frustumCulled = false;
    scene.add(m);
    return { m, age: 0, radius: 1 };
  });
  let waveNext = 0;
  let blasts = 0;

  const u = new THREE.Vector3();
  const rand = (v) => v.set(Math.random() * 2 - 1, Math.random() * 2 - 1, Math.random() * 2 - 1).normalize();

  // Explosão em `at`, soprando para `dir` (unitário), com força `power` de 0 a 1.
  function blast(at, dir, power) {
    blasts++;
    const s = blastSize(power);
    const k = Math.min(1, Math.max(0, power));
    flash.position.copy(at);
    flashI = Math.max(flashI, s.flash);
    // Bola de fogo: cresce a partir do ponto, soprada para fora da fachada (quase nada para
    // dentro do prédio, onde a parede a esconderia).
    for (let i = 0; i < s.fire; i++) {
      rand(u).addScaledVector(dir, 1.1).normalize();
      const v = (10 + Math.random() * 18) * (0.6 + k);
      fireSim.spawn(at.x, at.y, at.z, u.x * v, u.y * v + 3, u.z * v, 0.8 + Math.random() * 0.9, 2, s.radius * (0.5 + Math.random() * 0.5));
    }
    // Fumaça: nasce no lugar do fogo um pouco depois, cresce e sobe devagar.
    for (let i = 0; i < s.smoke; i++) {
      rand(u).addScaledVector(dir, 0.9).normalize();
      const v = 2 + Math.random() * 5 * (0.5 + k);
      const r = 2 + Math.random() * s.radius * 0.5; // espalhada pelo volume da bola de fogo
      const j = smokeSim.spawn(at.x + u.x * r, at.y + u.y * r, at.z + u.z * r, u.x * v, u.y * v + 1.5, u.z * v, 5 + Math.random() * 4, 2, s.radius * (0.7 + Math.random() * 0.7));
      smokeSim.age[j] = -(0.2 + Math.random() * 0.4); // espera o fogo
    }
    // Brasas: rápidas, em arco, caindo.
    for (let i = 0; i < s.embers; i++) {
      rand(u).addScaledVector(dir, 0.8).normalize();
      const v = (12 + Math.random() * 28) * (0.5 + k);
      emberSim.spawn(at.x, at.y, at.z, u.x * v, u.y * v + 4, u.z * v, 1 + Math.random() * 1.6, 0.12 + Math.random() * 0.18, 0.08);
    }
    const w = waves[waveNext];
    waveNext = (waveNext + 1) % WAVES;
    w.age = 0;
    w.radius = s.radius * 2.2;
    w.m.position.copy(at);
    w.m.visible = true;
  }

  function sync(sim, pts) {
    const g = pts.geometry;
    const size = g.attributes.size.array;
    const t = g.attributes.t.array;
    const seed = g.attributes.seed.array;
    for (let i = 0; i < sim.count; i++) {
      t[i] = sim.age[i] < 0 ? -1 : sim.t(i);
      size[i] = sim.size(i);
      seed[i] = sim.seed[i];
    }
    g.setDrawRange(0, sim.count);
    for (let a = 0; a < ATTRS.length; a++) g.attributes[ATTRS[a]].needsUpdate = true;
  }

  // viewHeight: altura do canvas em pixels; night: 0 de dia, 1 de noite.
  function update(dt, camera, viewHeight, night) {
    fireSim.step(dt);
    smokeSim.step(dt);
    emberSim.step(dt);
    sync(fireSim, fire);
    sync(smokeSim, smoke);
    sync(emberSim, embers);
    scale.value = viewHeight / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2));
    light.value = 1 - 0.7 * night;
    flashI *= Math.exp(-dt * 9);
    flash.intensity = flashI > 5 ? flashI : 0;
    for (const w of waves) {
      if (!w.m.visible) continue;
      w.age += dt;
      const k = w.age / 0.45;
      if (k >= 1) {
        w.m.visible = false;
        continue;
      }
      w.m.scale.setScalar(w.radius * (1 - (1 - k) ** 3));
      w.m.material.uniforms.alpha.value = (1 - k) * 0.7;
    }
  }

  const alive = (sim) => {
    let n = 0;
    for (let i = 0; i < sim.count; i++) if (sim.age[i] >= 0 && sim.age[i] < sim.life[i]) n++;
    return n;
  };

  return { blast, update, stats: () => ({ blasts, fire: alive(fireSim), smoke: alive(smokeSim), embers: alive(emberSim) }) };
}
