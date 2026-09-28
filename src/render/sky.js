import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';

// Horários do dia. elevação/azimute do sol em graus; `night` liga janelas e estrelas.
export const TIME_PRESETS = {
  amanhecer: { elevation: 5, azimuth: 95, sun: 0xffc38a, sunI: 2.6, hemiI: 0.5, turbidity: 6, rayleigh: 2.5, exposure: 0.75, night: 0.35 },
  dia: { elevation: 48, azimuth: 150, sun: 0xfff1dc, sunI: 2.8, hemiI: 0.5, turbidity: 2.5, rayleigh: 1.0, exposure: 0.5, night: 0 },
  entardecer: { elevation: 6, azimuth: 250, sun: 0xff9a5c, sunI: 2.8, hemiI: 0.45, turbidity: 8, rayleigh: 3, exposure: 0.72, night: 0.45 },
  noite: { elevation: -2.5, azimuth: 200, sun: 0x9fb4ff, sunI: 0.9, hemiI: 1.1, turbidity: 1.5, rayleigh: 0.35, exposure: 1.1, night: 1 },
};
export const TIME_ORDER = ['amanhecer', 'dia', 'entardecer', 'noite'];

const SHADOW_BOX = 260; // meia-aresta da caixa de sombra que acompanha o herói
// Com o sol a 18°, a caixa cobre ~840 m de chão na direção dele: a luz a 800 m deixava esse
// trecho antes do `near`, e as sombras de lá sumiam e piscavam. A 2000 m, com far 3000, cabe.
const LIGHT_DIST = 2000;

// `world`: onde moram céu, luzes e estrelas (o grupo da origem flutuante). Neblina e mapa de
// ambiente são da cena de verdade — num grupo, o renderer os ignora.
export function createSky(scene, renderer, preset, world = scene) {
  const sky = new Sky();
  sky.scale.setScalar(4000);
  sky.frustumCulled = false;
  world.add(sky);
  const u = sky.material.uniforms;
  u.mieCoefficient.value = 0.004;
  u.mieDirectionalG.value = 0.8;
  u.cloudCoverage.value = 0.35;
  u.cloudDensity.value = 0.5;

  // Uma segunda instância divide o material e vive numa cena só dela: é dela que
  // sai o mapa de ambiente (reflexo do vidro dos prédios).
  const envScene = new THREE.Scene();
  const envSky = new Sky();
  envSky.material = sky.material;
  envSky.scale.setScalar(4000);
  envScene.add(envSky);

  // Abaixo do horizonte o shader do Sky vira preto chapado; à noite quem desenha o
  // céu é esta cúpula de gradiente (poluição luminosa da cidade no horizonte).
  const nightDome = makeNightDome();
  const envNightDome = new THREE.Mesh(nightDome.geometry, nightDome.material);
  world.add(nightDome);
  envScene.add(envNightDome);
  const pmrem = new THREE.PMREMGenerator(renderer);
  let envRT = null;

  const hemi = new THREE.HemisphereLight(0xbfd8ff, 0x3a3530, 0.8);
  world.add(hemi);

  const sun = new THREE.DirectionalLight(0xffffff, 3);
  sun.castShadow = preset.shadows;
  sun.shadow.mapSize.setScalar(preset.shadowMapSize);
  const sc = sun.shadow.camera;
  sc.left = -SHADOW_BOX; sc.right = SHADOW_BOX; sc.top = SHADOW_BOX; sc.bottom = -SHADOW_BOX;
  sc.near = 10; sc.far = 3000;
  sun.shadow.bias = -0.0002; // em profundidade normalizada: ~0,6 m no mundo com este far
  sun.shadow.normalBias = 0.6;
  world.add(sun, sun.target);

  scene.fog = new THREE.Fog(0xb8c8dc, 700, preset.viewDistance * 1.2);

  const stars = makeStars();
  world.add(stars);

  const sunDir = new THREE.Vector3();
  // Eixos da câmera de sombra (olha ao longo de −sunDir, com o up padrão): a grade de texel
  // do shadow map segue estes eixos, não x/z do mundo.
  const lightRight = new THREE.Vector3();
  const lightUp = new THREE.Vector3();
  const snap = new THREE.Vector3();
  const state = { name: 'dia', night: 0, exposure: 0.55, sunDir };

  function setTime(name) {
    const p = TIME_PRESETS[name];
    state.name = name;
    state.night = p.night;
    state.exposure = p.exposure;
    // Abaixo do horizonte o "sol" vira a lua: a luz direcional nunca some, só esfria.
    const lightElev = Math.max(p.elevation, 18);
    const phi = THREE.MathUtils.degToRad(90 - p.elevation);
    const theta = THREE.MathUtils.degToRad(p.azimuth);
    u.sunPosition.value.setFromSphericalCoords(1, phi, theta);
    u.turbidity.value = p.turbidity;
    u.rayleigh.value = p.rayleigh;
    u.showSunDisc.value = p.elevation > 0 ? 1 : 0;
    u.cloudCoverage.value = p.night > 0.9 ? 0.15 : 0.35;
    sunDir.setFromSphericalCoords(1, THREE.MathUtils.degToRad(90 - lightElev), theta);
    lightRight.crossVectors(sun.shadow.camera.up, sunDir).normalize();
    lightUp.crossVectors(sunDir, lightRight);
    sun.color.set(p.sun);
    sun.intensity = p.sunI;
    hemi.intensity = p.hemiI;
    hemi.color.set(p.night > 0.9 ? 0x4a5a8a : 0xbfd8ff);
    scene.fog.color.set(fogColorFor(p));
    stars.material.opacity = Math.max(0, p.night - 0.6) / 0.4;
    stars.visible = stars.material.opacity > 0;
    const isNight = p.elevation < 0;
    sky.visible = envSky.visible = !isNight;
    nightDome.visible = envNightDome.visible = isNight;

    envRT?.dispose();
    envRT = pmrem.fromScene(envScene, 0, 1, 5000);
    scene.environment = envRT.texture;
    scene.environmentIntensity = p.night > 0.9 ? 0.25 : 0.55;
  }

  function update(dt, focus, time) {
    u.time.value = time;
    sky.position.copy(focus);
    nightDome.position.copy(focus);
    stars.position.copy(focus);
    // A caixa de sombra segue o foco, presa à grade de texel nos eixos da câmera de sombra
    // para a borda da sombra não tremer (arredondar x/z do mundo ainda deslocava o mapa por
    // frações de texel). Ao longo do sol o centro é livre: não muda a projeção.
    const texel = (SHADOW_BOX * 2) / preset.shadowMapSize;
    snap.set(focus.x, 0, focus.z);
    const a = Math.round(snap.dot(lightRight) / texel) * texel;
    const b = Math.round(snap.dot(lightUp) / texel) * texel;
    sun.target.position.copy(lightRight).multiplyScalar(a).addScaledVector(lightUp, b).addScaledVector(sunDir, snap.dot(sunDir));
    sun.position.copy(sun.target.position).addScaledVector(sunDir, LIGHT_DIST);
  }

  setTime('dia');
  return { setTime, update, state, sun, hemi };
}

function fogColorFor(p) {
  if (p.night > 0.9) return 0x1a2746;
  if (p.night > 0.3) return p.azimuth > 180 ? 0xd79a7a : 0xd8b8a0;
  return 0x9fb6cf;
}

function makeNightDome() {
  const material = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: { horizon: { value: new THREE.Color(0x24345c) }, zenith: { value: new THREE.Color(0x03060f) } },
    vertexShader: `varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        gl_Position.z = gl_Position.w;
      }`,
    fragmentShader: `uniform vec3 horizon; uniform vec3 zenith; varying vec3 vDir;
      void main() {
        float t = pow(clamp(vDir.y, 0.0, 1.0), 0.45);
        gl_FragColor = vec4(mix(horizon, zenith, t), 1.0);
        #include <colorspace_fragment>
      }`,
  });
  const dome = new THREE.Mesh(new THREE.SphereGeometry(3800, 32, 16), material);
  dome.frustumCulled = false;
  dome.renderOrder = -2;
  return dome;
}

function makeStars() {
  const n = 1500;
  const pos = new Float32Array(n * 3);
  const v = new THREE.Vector3();
  for (let i = 0; i < n; i++) {
    // Distribuição uniforme na semiesfera superior (seed fixa não importa aqui).
    do { v.set(Math.random() * 2 - 1, Math.random(), Math.random() * 2 - 1); } while (v.lengthSq() > 1 || v.y < 0.05);
    v.normalize().multiplyScalar(3500);
    pos.set([v.x, v.y, v.z], i * 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const m = new THREE.PointsMaterial({ color: 0xffffff, size: 2, sizeAttenuation: false, transparent: true, fog: false, depthWrite: false });
  const pts = new THREE.Points(g, m);
  pts.frustumCulled = false;
  pts.renderOrder = -1;
  return pts;
}
