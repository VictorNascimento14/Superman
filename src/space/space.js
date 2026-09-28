import * as THREE from 'three';
import { createRng } from '../core/rng.js';
import { EARTH } from './nav.js';
import { HALF, CELL, QUAY, CITY } from '../world/layout.js';

// Espaço: uma cena à parte, desenhada antes da cidade, com a Terra em escala real e as
// estrelas. A câmera do espaço fica na origem com a orientação da câmera do jogo, e cada
// corpo é posto relativo a ela. Longe demais, ele é trazido para dentro do frustum com o raio
// reduzido na mesma proporção: o tamanho aparente não muda ("espaço escalado"). Assim um
// buffer de profundidade comum serve de 1 m a 10¹² m.
const PLACE = 1e5; // corpos além disto (m) são trazidos para esta distância, em escala
const STARS = 6000;
// Metrópolis no globo: 40,7° N, 74° O. O globo gira para esse ponto ficar no "para cima"
// da cidade.
const CITY_LAT = THREE.MathUtils.degToRad(40.7);
const CITY_LON = THREE.MathUtils.degToRad(-74);

const NOISE = /* glsl */ `
  // Hash aritmético (sem sin: barato em GPU integrada) e value noise 3D suave.
  float hash(vec3 p) {
    p = fract(p * 0.3183099 + 0.1);
    p *= 17.0;
    return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
  }
  float noise(vec3 x) {
    vec3 i = floor(x);
    vec3 f = fract(x);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(mix(hash(i), hash(i + vec3(1, 0, 0)), f.x), mix(hash(i + vec3(0, 1, 0)), hash(i + vec3(1, 1, 0)), f.x), f.y),
               mix(mix(hash(i + vec3(0, 0, 1)), hash(i + vec3(1, 0, 1)), f.x), mix(hash(i + vec3(0, 1, 1)), hash(i + vec3(1, 1, 1)), f.x), f.y), f.z);
  }
  // fbm normalizado em [0, 1] com \`oct\` oitavas: cada camada paga só as que usa.
  float fbm(vec3 p, int oct) {
    float a = 0.5;
    float s = 0.0;
    float t = 0.0;
    for (int i = 0; i < 6; i++) {
      if (i >= oct) break;
      s += a * noise(p);
      t += a;
      p = p * 2.03 + vec3(1.7, 9.2, 3.1);
      a *= 0.5;
    }
    return s / t;
  }`;

const EARTH_VERT = /* glsl */ `
  varying vec3 vGeo;
  varying vec3 vNormalW;
  varying vec3 vPosW;
  void main() {
    vGeo = position; // esfera unitária: a posição é a normal geográfica
    vNormalW = normalize(mat3(modelMatrix) * position);
    vec4 w = modelMatrix * vec4(position, 1.0);
    vPosW = w.xyz;
    gl_Position = projectionMatrix * viewMatrix * w;
  }`;

const EARTH_FRAG = /* glsl */ `
  uniform vec3 sunGeo;
  uniform vec3 sunW;
  uniform vec3 cityGeo;
  uniform float time;
  uniform float detail; // 0 longe, 1 perto: as oitavas finas só quando dá para vê-las
  uniform vec3 cityX; // eixos x e z da cidade no globo: a ilha desenhada bate com a de verdade
  uniform vec3 cityZ;
  uniform vec4 park; // x0, z0, x1, z1 (m)
  varying vec3 vGeo;
  varying vec3 vNormalW;
  varying vec3 vPosW;
  ${NOISE}
  void main() {
    vec3 n = normalize(vGeo);
    float toCity = distance(n, cityGeo);
    // Continentes: ~30% de terra; em volta de Metrópolis (uma ilha) é mar.
    float h = fbm(n * 1.7, 5) - 0.53 + 0.1 * (fbm(n * 6.0 + 3.0, 3) - 0.5);
    if (detail > 0.0) h += detail * 0.06 * (fbm(n * 40.0, 4) - 0.5);
    // Mar em volta da ilha, com a borda recortada por ruído (uma baía, não um círculo).
    h = mix(-0.06, h, smoothstep(0.004, 0.012, toCity + 0.008 * (fbm(n * 90.0, 3) - 0.5)));
    float land = smoothstep(0.0, 0.012, h);
    float lat = abs(n.y);
    float v = fbm(n * 5.0 + 7.0, 3); // uma camada serve para seca e para o tom do verde
    vec3 ocean = mix(vec3(0.008, 0.04, 0.13), vec3(0.02, 0.13, 0.26), smoothstep(-0.2, 0.0, h));
    vec3 green = mix(vec3(0.09, 0.2, 0.06), vec3(0.26, 0.28, 0.11), v);
    float dry = smoothstep(0.15, 0.3, lat) * (1.0 - smoothstep(0.38, 0.5, lat)) * smoothstep(0.45, 0.6, v);
    vec3 ground = mix(green, vec3(0.56, 0.46, 0.29), dry);
    if (detail > 0.0) ground *= 1.0 + detail * 0.35 * (noise(n * 900.0) - 0.5);
    ground = mix(ground, vec3(0.92, 0.94, 0.97), smoothstep(0.8, 0.87, lat + 0.06 * v));
    vec3 albedo = mix(ocean, ground, land);
    // Metrópolis como ela é: a ilha de ${(2 * (HALF + QUAY) / 1000).toFixed(1)} km com o grid de ruas no mesmo lugar da
    // cidade de verdade. Com fwidth, a rua some suave quando fica menor que um pixel.
    vec2 xz = vec2(dot(n - cityGeo, cityX), dot(n - cityGeo, cityZ)) * ${EARTH.radius.toFixed(1)};
    vec2 cw = fwidth(xz);
    vec2 edge = smoothstep(vec2(${(HALF + QUAY).toFixed(1)}) + cw, vec2(${(HALF + QUAY).toFixed(1)}) - cw, abs(xz));
    float island = edge.x * edge.y;
    vec2 g = (xz + ${HALF.toFixed(1)}) / ${CELL.toFixed(1)};
    vec2 gw = fwidth(g);
    vec2 st = smoothstep(${(CITY.street / CELL).toFixed(4)} + gw, ${(CITY.street / CELL).toFixed(4)} - gw, fract(g));
    float street = mix(max(st.x, st.y), 0.35, smoothstep(0.2, 0.6, max(gw.x, gw.y)));
    vec3 blocks = vec3(0.5, 0.49, 0.47) * (0.8 + 0.4 * hash(vec3(floor(g), 3.0)));
    vec3 cityCol = mix(blocks, vec3(0.16, 0.16, 0.18), street);
    float inPark = step(park.x, xz.x) * step(xz.x, park.z) * step(park.y, xz.y) * step(xz.y, park.w);
    cityCol = mix(cityCol, vec3(0.14, 0.3, 0.1), inPark);
    albedo = mix(albedo, cityCol, island);
    float metro = island * (1.0 - inPark) * (0.4 + street * 1.2); // de noite: janelas e ruas

    float ndl = dot(n, sunGeo);
    float day = smoothstep(-0.12, 0.12, ndl);
    vec3 col = albedo * (0.03 + 1.15 * max(ndl, 0.0));
    vec3 vw = normalize(-vPosW); // a câmera do espaço está na origem
    vec3 nw = normalize(vNormalW);
    col += vec3(1.0, 0.92, 0.75) * pow(max(dot(nw, normalize(sunW + vw)), 0.0), 70.0) * (1.0 - land) * day * 0.7;
    // Nuvens: deslizam devagar; de noite só escurecem.
    float cn = fbm(n * 3.2 + vec3(time * 0.004, 0.0, time * 0.002), 5);
    if (detail > 0.0) cn += detail * 0.12 * (fbm(n * 30.0 + time * 0.01, 3) - 0.5);
    float c = smoothstep(0.52, 0.72, cn);
    col = mix(col, vec3(0.03 + 1.05 * max(ndl, 0.0)), c * 0.85);
    // Luzes das cidades, só onde é noite: regiões povoadas (suaves de longe) feitas de pontos
    // (cidades) que só aparecem de perto — de longe, pontos finos só serrilhariam.
    if (day < 0.99) {
      float density = smoothstep(0.55, 0.8, fbm(n * 12.0, 4)) * land * (1.0 - island);
      float towns = detail > 0.0 ? smoothstep(0.72, 0.9, noise(n * 900.0)) * 1.8 : 0.0;
      float lights = density * mix(0.35, towns, detail) + metro * 2.5;
      col += vec3(1.0, 0.68, 0.32) * lights * (1.0 - day) * (1.0 - c * 0.8) * 1.4;
    }
    // Borda da atmosfera por dentro do disco.
    float rim = pow(1.0 - max(dot(nw, vw), 0.0), 3.0);
    col += vec3(0.25, 0.5, 1.0) * rim * (0.1 + 0.9 * day) * 0.9;
    gl_FragColor = vec4(col, 1.0);
  }`;

// Halo: casca um pouco maior, só as faces de trás, somando luz na borda do lado do dia.
const ATMO_FRAG = /* glsl */ `
  uniform vec3 sunW;
  varying vec3 vNormalW;
  varying vec3 vPosW;
  void main() {
    vec3 nw = normalize(vNormalW);
    vec3 v = normalize(-vPosW);
    float edge = pow(clamp(1.0 + dot(nw, v) * 1.2, 0.0, 1.0), 4.0);
    float day = smoothstep(-0.35, 0.35, dot(nw, sunW));
    gl_FragColor = vec4(vec3(0.3, 0.58, 1.0) * edge * (0.05 + 0.95 * day) * 1.3, 1.0);
  }`;

// park: a pegada do parque da cidade ({ x0, z0, x1, z1 }), para a ilha desenhada bater.
export function createSpace({ park }) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x000000);
  const camera = new THREE.PerspectiveCamera(62, 1, 1, PLACE * 20);
  const rel = new THREE.Vector3();
  const sunGeo = new THREE.Vector3();

  // Globo: o ponto de Metrópolis gira para o "para cima" da cidade.
  const cityGeo = new THREE.Vector3(Math.cos(CITY_LAT) * Math.cos(CITY_LON), Math.sin(CITY_LAT), -Math.cos(CITY_LAT) * Math.sin(CITY_LON));
  const toCity = new THREE.Quaternion().setFromUnitVectors(cityGeo, new THREE.Vector3(0, 1, 0));
  const fromCity = toCity.clone().invert();
  const uniforms = {
    sunGeo: { value: new THREE.Vector3() }, sunW: { value: new THREE.Vector3() }, cityGeo: { value: cityGeo }, time: { value: 0 }, detail: { value: 0 },
    cityX: { value: new THREE.Vector3(1, 0, 0).applyQuaternion(fromCity) },
    cityZ: { value: new THREE.Vector3(0, 0, 1).applyQuaternion(fromCity) },
    park: { value: new THREE.Vector4(park.x0, park.z0, park.x1, park.z1) },
  };
  const earth = new THREE.Mesh(new THREE.SphereGeometry(1, 160, 96), new THREE.ShaderMaterial({ uniforms, vertexShader: EARTH_VERT, fragmentShader: EARTH_FRAG }));
  earth.quaternion.copy(toCity);
  earth.frustumCulled = false;
  const atmo = new THREE.Mesh(new THREE.SphereGeometry(1, 96, 64), new THREE.ShaderMaterial({
    uniforms: { sunW: uniforms.sunW }, vertexShader: EARTH_VERT, fragmentShader: ATMO_FRAG,
    side: THREE.BackSide, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false,
  }));
  atmo.frustumCulled = false;
  scene.add(earth, atmo);

  // Estrelas no "infinito": presas à câmera do espaço, que só gira.
  const rng = createRng(1977);
  const pos = new Float32Array(STARS * 3);
  const col = new Float32Array(STARS * 3);
  const c = new THREE.Color();
  for (let i = 0; i < STARS; i++) {
    const u = rng.range(-1, 1);
    const a = rng.range(0, Math.PI * 2);
    const r = Math.sqrt(1 - u * u) * PLACE * 9;
    pos.set([Math.cos(a) * r, u * PLACE * 9, Math.sin(a) * r], i * 3);
    c.setHSL(rng.pick([0.08, 0.12, 0.6, 0.62, 0.0]), rng.range(0.1, 0.5), rng.range(0.55, 1)).multiplyScalar(rng.chance(0.03) ? 3 : 1);
    col.set([c.r, c.g, c.b], i * 3);
  }
  const starGeo = new THREE.BufferGeometry();
  starGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  starGeo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const stars = new THREE.Points(starGeo, new THREE.PointsMaterial({ size: 1.6, sizeAttenuation: false, vertexColors: true, depthWrite: false }));
  stars.frustumCulled = false;
  scene.add(stars);

  // Corpo em espaço escalado: longe, vem para PLACE com o raio reduzido na mesma razão.
  function place(mesh, radius) {
    const d = rel.length();
    const s = d > PLACE ? PLACE / d : 1;
    mesh.position.copy(rel).multiplyScalar(s);
    mesh.scale.setScalar(radius * s);
  }

  // `view`: a câmera do jogo; `eye`: a posição verdadeira dela (referencial da cidade).
  function update(view, eye, sunDir, time) {
    view.getWorldQuaternion(camera.quaternion);
    if (camera.fov !== view.fov || camera.aspect !== view.aspect) {
      camera.fov = view.fov;
      camera.aspect = view.aspect;
      camera.updateProjectionMatrix();
    }
    rel.set(-eye.x, -EARTH.radius - eye.y, -eye.z); // centro da Terra em (0, −R, 0)
    place(earth, EARTH.radius);
    place(atmo, EARTH.radius * 1.025);
    uniforms.sunW.value.copy(sunDir);
    uniforms.sunGeo.value.copy(sunGeo.copy(sunDir).applyQuaternion(fromCity));
    uniforms.time.value = time;
    // Detalhe fino abaixo de ~4.000 km de altitude (antes disso ele só serrilharia).
    uniforms.detail.value = 1 - THREE.MathUtils.smoothstep(rel.length() - EARTH.radius, 4e5, 4e6);
  }

  return { scene, camera, update, earth };
}
