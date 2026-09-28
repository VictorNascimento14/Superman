import * as THREE from 'three';
import { createRng } from '../core/rng.js';
import { EARTH } from './nav.js';
import { CITY_GEO, toCity, SUN, SUN_I } from './bodies.js';
import { HALF, CELL, QUAY, CITY } from '../world/layout.js';

// Espaço: uma cena à parte, desenhada antes da cidade, com o sistema solar em escala real e as
// estrelas. A câmera do espaço fica na origem com a orientação da câmera do jogo, e cada
// corpo é posto relativo a ela. Longe demais, ele é trazido para dentro do frustum com o raio
// reduzido na mesma proporção: o tamanho aparente não muda ("espaço escalado"). Assim um
// buffer de profundidade comum serve de 1 m a 10¹⁶ m.
const PLACE = 1e5; // até esta distância (m) o corpo fica onde está
const LOG_K = 2; // além dela, a distância cresce com o log: o mais longe continua atrás
const STAR_R = PLACE * 16; // estrelas atrás de tudo
const STARS = 6000;
const CORONA = 5; // raio da casca da coroa, em raios do Sol
const MIN_PX = 0.9; // raio aparente mínimo (px): um planeta a bilhões de km ainda é um ponto
const HOLES = 16; // entradas e saídas dos buracos da visão de calor (8 buracos)
const BEAM_W = 0.0012; // raio aparente (rad) do raio que atravessa a Terra

// Distância no espaço escalado: igual até PLACE, depois logarítmica e presa antes das
// estrelas. Preserva a ordem — é ela que decide quem passa na frente de quem.
export const mapDist = (d) => (d <= PLACE ? d : Math.min(PLACE * (1 + Math.log(d / PLACE) / LOG_K), STAR_R * 0.9));

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
  uniform vec4 holes[${HOLES}]; // buracos da visão de calor: direção (geo) e 1 − cos(raio)
  uniform int holeCount;
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
    // Buracos da visão de calor carregada: o túnel escuro com a parede em brasa, a borda
    // derretida que brilha (também de noite) e o chão queimado em volta.
    for (int i = 0; i < ${HOLES}; i++) {
      if (i >= holeCount) break;
      float t = sqrt(max(0.0, 1.0 - dot(n, holes[i].xyz)) / holes[i].w); // 0 no centro, 1 na borda
      if (t > 3.0) continue;
      float scorch = 1.0 - smoothstep(1.0, 3.0, t);
      col *= 1.0 - 0.8 * scorch;
      col += vec3(1.0, 0.22, 0.02) * pow(scorch, 3.0) * 0.6;
      col = mix(col, mix(vec3(0.015, 0.0, 0.0), vec3(2.4, 0.55, 0.05), smoothstep(0.15, 0.95, t)), 1.0 - smoothstep(0.92, 1.0, t));
      col += vec3(3.2, 1.7, 0.45) * smoothstep(0.6, 0.95, t) * (1.0 - smoothstep(0.95, 1.12, t));
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

// Sol: granulação que ferve devagar, manchas em latitudes médias e o limbo mais escuro e
// mais vermelho. `glow` é o brilho HDR: alto quando ele é pequeno na tela (o bloom faz a
// estrela), baixo quando é grande (a superfície aparece em vez de estourar a tela).
const SUN_FRAG = /* glsl */ `
  uniform float time;
  uniform float detail;
  uniform float glow;
  varying vec3 vGeo;
  varying vec3 vNormalW;
  varying vec3 vPosW;
  ${NOISE}
  void main() {
    vec3 n = normalize(vGeo);
    float mu = max(dot(normalize(vNormalW), normalize(-vPosW)), 0.0);
    float g = fbm(n * 26.0 + vec3(0.0, time * 0.015, 0.0), 4);
    if (detail > 0.0) g = mix(g, 0.55 * g + 0.45 * noise(n * 420.0 + vec3(time * 0.06)), detail);
    float band = smoothstep(0.1, 0.25, abs(n.y)) * (1.0 - smoothstep(0.45, 0.6, abs(n.y)));
    float spots = smoothstep(0.74, 0.8, fbm(n * 6.0 + 11.0, 3)) * band;
    float limb = 0.3 + 0.7 * pow(mu, 0.5);
    // De longe, branco-amarelado; de perto, o laranja com as células bem marcadas.
    vec3 hot = mix(vec3(1.0, 0.82, 0.55), vec3(1.0, 0.55, 0.16), detail);
    vec3 col = mix(vec3(1.0, 0.3, 0.05), hot, limb) * limb;
    col *= mix(0.7 + 0.6 * g, 0.25 + 1.5 * g * g, detail) * (1.0 - 0.85 * spots);
    gl_FragColor = vec4(col * glow, 1.0);
  }`;

// Coroa: casca de faces de trás em volta do Sol. Cada pixel mede o quanto o raio de visão
// passa perto do centro (em raios do Sol) e brilha mais quanto mais perto — funciona de
// qualquer distância, até de dentro dela.
const CORONA_FRAG = /* glsl */ `
  uniform vec3 center;
  uniform float radius;
  uniform float strength;
  varying vec3 vPosW;
  void main() {
    vec3 d = normalize(vPosW);
    float t = max(dot(center, d), 0.0);
    float b = max(length(center - d * t) / radius, 1.0);
    float glow = 1.4 * pow(1.0 / b, 7.0) + 0.15 * pow(1.0 / b, 2.4);
    glow *= 1.0 - smoothstep(0.55, 1.0, b / ${CORONA.toFixed(1)});
    glow *= smoothstep(-0.2, 0.3, dot(d, normalize(center))); // de costas para o Sol, não
    gl_FragColor = vec4(vec3(1.0, 0.6, 0.28) * glow * strength, 1.0);
  }`;

// Planetas e a Lua: um shader, quatro tipos (define KIND), cada um paga só o que usa.
// look: x frequência das faixas · y turbulência (ou mares) · z semente · w mares só na face
// voltada para a Terra (a Lua mostra sempre o mesmo lado).
const BODY_FRAG = /* glsl */ `
  uniform vec3 sunL;
  uniform vec3 colA;
  uniform vec3 colB;
  uniform vec3 colC;
  uniform vec4 look;
  uniform vec4 spot; // direção local da mancha (xyz) e tamanho (w; 0 = sem mancha)
  uniform float time;
  varying vec3 vGeo;
  varying vec3 vNormalW;
  varying vec3 vPosW;
  ${NOISE}
  void main() {
    vec3 n = normalize(vGeo);
    vec3 nw = normalize(vNormalW);
    float mu = max(dot(nw, normalize(-vPosW)), 0.0);
    float ndl = dot(nw, sunL);
    vec3 albedo;
  #if KIND == 0
    // Rochoso: terras altas claras e mares escuros, salpicados de crateras.
    float h = fbm(n * 4.0 + look.z, 5);
    float seas = smoothstep(0.5, 0.58, fbm(n * 1.5 + look.z * 2.0, 3)) * look.y;
    if (look.w > 0.0) seas *= smoothstep(-0.3, 0.4, n.z);
    float craters = smoothstep(0.8, 0.86, noise(n * 34.0 + look.z)) + 0.5 * smoothstep(0.82, 0.9, noise(n * 90.0));
    albedo = mix(colA, colB, h) * (1.0 - 0.5 * seas) * (1.0 + 0.35 * craters);
  #elif KIND == 1
    // Vênus: nuvens espessas em faixas largas, quase sem contraste.
    albedo = mix(colA, colB, fbm(vec3(n.x * 2.0, n.y * 7.0, n.z * 2.0) + look.z + vec3(time * 0.003, 0.0, 0.0), 4));
  #elif KIND == 2
    // Marte: poeira, planícies escuras e calotas polares.
    float h = fbm(n * 2.6 + look.z, 5);
    albedo = mix(colB, colA, smoothstep(0.35, 0.6, h)) * (1.0 - 0.4 * smoothstep(0.55, 0.65, fbm(n * 1.3 + 5.0, 3)));
    albedo = mix(albedo, vec3(0.92, 0.9, 0.88), smoothstep(0.955, 0.97, abs(n.y) + 0.03 * (h - 0.5)));
  #else
    // Gigante gasoso: faixas de latitude torcidas pela turbulência, e uma mancha (a Grande
    // Mancha Vermelha de Júpiter, a Mancha Escura de Netuno).
    float lat = n.y + look.y * (fbm(n * vec3(3.0, 10.0, 3.0) + look.z + vec3(time * 0.002, 0.0, 0.0), 4) - 0.5);
    albedo = mix(colA, colB, 0.5 + 0.5 * sin(lat * look.x));
    albedo = mix(albedo, colC, 0.35 * (0.5 + 0.5 * sin(lat * look.x * 2.7 + 1.3)));
    if (spot.w > 0.0) {
      vec3 sd = n - spot.xyz;
      albedo = mix(albedo, colC, (1.0 - smoothstep(0.6, 1.0, length(vec3(sd.x, sd.y * 1.8, sd.z)) / spot.w)) * 0.9);
    }
    albedo *= 0.7 + 0.3 * pow(mu, 0.4); // limbo mais escuro
  #endif
    // Abaixo de 1 no lado do dia: acima disso o bloom espalharia o planeta pela tela toda.
    vec3 col = albedo * (0.004 + 0.85 * max(ndl, 0.0));
  #if KIND != 0
    col += colB * pow(1.0 - mu, 3.0) * smoothstep(-0.2, 0.4, ndl) * 0.35; // borda da atmosfera
  #endif
    gl_FragColor = vec4(col, 1.0);
  }`;

// Anéis de Saturno no plano do equador (xz local, em raios do planeta): anel C, anel B
// brilhante, a divisão de Cassini e o anel A. O planeta faz sombra neles.
const RING_VERT = /* glsl */ `
  varying vec3 vLocal;
  void main() {
    vLocal = position;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }`;
const RING_FRAG = /* glsl */ `
  uniform vec3 sunLocal;
  varying vec3 vLocal;
  void main() {
    float r = length(vLocal.xz);
    float a = smoothstep(1.24, 1.3, r) * (1.0 - smoothstep(2.2, 2.27, r));
    float b = smoothstep(1.52, 1.56, r) * (1.0 - smoothstep(1.92, 1.95, r));
    float cassini = smoothstep(1.94, 1.96, r) * (1.0 - smoothstep(2.01, 2.03, r));
    float dens = a * (0.3 + 0.6 * b) * (1.0 - 0.92 * cassini) * (0.85 + 0.15 * sin(r * 160.0));
    float t = dot(vLocal, sunLocal);
    float shadow = t < 0.0 ? smoothstep(0.97, 1.03, length(vLocal - sunLocal * t)) : 1.0;
    gl_FragColor = vec4(vec3(0.86, 0.77, 0.58) * (0.02 + 0.95 * shadow), dens * 0.9);
  }`;

// Aparência de cada corpo (só render). Cores em sRGB; spot: [seno da latitude, longitude, tamanho].
const LOOKS = {
  LUA: { kind: 0, a: 0x5c5a57, b: 0x9d9b97, look: [0, 1, 3.1, 1] },
  'MERCÚRIO': { kind: 0, a: 0x57504a, b: 0x9a9088, look: [0, 0.35, 7.7, 0] },
  'VÊNUS': { kind: 1, a: 0xd2b77c, b: 0xf2e7c9, look: [0, 0, 2.3, 0] },
  MARTE: { kind: 2, a: 0xc8703f, b: 0x7c3b22, look: [0, 0, 5.2, 0] },
  'JÚPITER': { kind: 3, a: 0xe6d6b8, b: 0xa47a55, c: 0x9a4f30, look: [22, 0.18, 1.7, 0], spot: [-0.36, 0.9, 0.08] },
  SATURNO: { kind: 3, a: 0xeadaa8, b: 0xc8ab76, c: 0xa88c5e, look: [26, 0.06, 4.4, 0], rings: true },
  URANO: { kind: 3, a: 0xaee0e6, b: 0x96ced8, c: 0x86c0cc, look: [9, 0.03, 6.6, 0] },
  NETUNO: { kind: 3, a: 0x4d76dc, b: 0x3558bb, c: 0x1f3584, look: [12, 0.1, 8.8, 0], spot: [-0.34, 2.4, 0.07] },
};

// park: a pegada do parque da cidade ({ x0, z0, x1, z1 }), para a ilha desenhada bater.
export function createSpace({ park }) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x000000);
  // O far cabe a casca da coroa vista de dentro (o centro do Sol + 5 raios, em escala); a
  // precisão da profundidade quem decide é o near.
  const camera = new THREE.PerspectiveCamera(62, 1, 10, PLACE * 60);
  const rel = new THREE.Vector3();
  const sunGeo = new THREE.Vector3();
  const eye = new THREE.Vector3();

  // Globo: o ponto de Metrópolis gira para o "para cima" da cidade.
  const fromCity = toCity.clone().invert();
  const uniforms = {
    sunGeo: { value: new THREE.Vector3() }, sunW: { value: new THREE.Vector3() }, cityGeo: { value: CITY_GEO }, time: { value: 0 }, detail: { value: 0 },
    cityX: { value: new THREE.Vector3(1, 0, 0).applyQuaternion(fromCity) },
    cityZ: { value: new THREE.Vector3(0, 0, 1).applyQuaternion(fromCity) },
    park: { value: new THREE.Vector4(park.x0, park.z0, park.x1, park.z1) },
    holes: { value: Array.from({ length: HOLES }, () => new THREE.Vector4()) }, holeCount: { value: 0 },
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

  // Sol e coroa.
  const sphere = new THREE.SphereGeometry(1, 128, 80);
  const sunU = { time: uniforms.time, detail: { value: 0 }, glow: { value: 14 } };
  const sun = new THREE.Mesh(sphere, new THREE.ShaderMaterial({ uniforms: sunU, vertexShader: EARTH_VERT, fragmentShader: SUN_FRAG }));
  const coronaU = { center: { value: sun.position }, radius: { value: 1 }, strength: { value: 6 } };
  const corona = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 32), new THREE.ShaderMaterial({
    uniforms: coronaU, vertexShader: EARTH_VERT, fragmentShader: CORONA_FRAG,
    side: THREE.BackSide, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false,
  }));
  scene.add(sun, corona);

  // Planetas e a Lua.
  const lin = (hex) => new THREE.Color(hex ?? 0);
  const meshes = {};
  for (const [name, L] of Object.entries(LOOKS)) {
    const spot = L.spot
      ? new THREE.Vector4(Math.sqrt(1 - L.spot[0] ** 2) * Math.cos(L.spot[1]), L.spot[0], Math.sqrt(1 - L.spot[0] ** 2) * Math.sin(L.spot[1]), L.spot[2])
      : new THREE.Vector4();
    const mesh = new THREE.Mesh(sphere, new THREE.ShaderMaterial({
      defines: { KIND: L.kind },
      uniforms: {
        sunL: { value: new THREE.Vector3() }, colA: { value: lin(L.a) }, colB: { value: lin(L.b) }, colC: { value: lin(L.c) },
        look: { value: new THREE.Vector4(...L.look) }, spot: { value: spot }, time: uniforms.time,
      },
      vertexShader: EARTH_VERT, fragmentShader: BODY_FRAG,
    }));
    if (L.rings) {
      const ringGeo = new THREE.RingGeometry(1.24, 2.27, 160, 1).rotateX(-Math.PI / 2);
      mesh.add(new THREE.Mesh(ringGeo, new THREE.ShaderMaterial({
        uniforms: { sunLocal: { value: new THREE.Vector3() } }, vertexShader: RING_VERT, fragmentShader: RING_FRAG,
        side: THREE.DoubleSide, transparent: true, depthWrite: false,
      })));
    }
    meshes[name] = mesh;
    scene.add(mesh);
  }

  // Raio da visão de calor que atravessa a Terra: do herói até a entrada, e da saída para além
  // (dois raios da Terra). Um cone com a ponta no herói e um cilindro do raio proporcional à
  // distância: a espessura aparente fica ~constante de perto a 1 UA.
  const beamMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(9, 6.5, 3.5), blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, fog: false });
  const along = (g) => g.rotateX(Math.PI / 2).translate(0, 0, 0.5); // eixo +z, de 0 a 1
  const beamIn = new THREE.Mesh(along(new THREE.CylinderGeometry(BEAM_W, 0, 1, 12, 1, true)), beamMat);
  const beamOut = new THREE.Mesh(along(new THREE.CylinderGeometry(1, 1, 1, 12, 1, true)), beamMat);
  beamIn.frustumCulled = beamOut.frustumCulled = false;
  beamIn.visible = beamOut.visible = false;
  scene.add(beamIn, beamOut);
  const beam = { on: false, through: false, from: new THREE.Vector3(), entry: new THREE.Vector3(), exit: new THREE.Vector3(), dir: new THREE.Vector3() };
  const pa = new THREE.Vector3();
  const pb = new THREE.Vector3();
  // shot: o disparo do quadro (pierce.update) ou null; from: de onde o raio sai (a cabeça).
  function setBeam(shot, from) {
    beam.on = !!shot;
    if (!shot) return;
    beam.from.copy(from);
    beam.entry.copy(shot.entry);
    beam.through = !shot.blocked;
    beam.exit.copy(shot.exit);
    beam.dir.copy(shot.dir);
  }
  // Buracos (pierce.holes) no globo: entrada e saída, na orientação geográfica.
  const hg = new THREE.Vector3();
  function setHoles(list) {
    const h = uniforms.holes.value;
    for (let i = 0; i < list.length && 2 * i + 1 < HOLES; i++) {
      const w = 1 - Math.cos(list[i].radius / EARTH.radius);
      hg.copy(list[i].entry).applyQuaternion(fromCity);
      h[2 * i].set(hg.x, hg.y, hg.z, w);
      hg.copy(list[i].exit).applyQuaternion(fromCity);
      h[2 * i + 1].set(hg.x, hg.y, hg.z, w);
    }
    uniforms.holeCount.value = Math.min(HOLES, 2 * list.length);
  }
  // Ponto verdadeiro → espaço escalado (relativo ao olho), como em place().
  function mapPoint(p, out) {
    out.set(p.x - eye.x, p.y - eye.y, p.z - eye.z);
    const d = out.length();
    return d > 0 ? out.multiplyScalar(mapDist(d) / d) : out;
  }

  // Estrelas no "infinito": presas à câmera do espaço, que só gira.
  const rng = createRng(1977);
  const pos = new Float32Array(STARS * 3);
  const col = new Float32Array(STARS * 3);
  const c = new THREE.Color();
  for (let i = 0; i < STARS; i++) {
    const u = rng.range(-1, 1);
    const a = rng.range(0, Math.PI * 2);
    const r = Math.sqrt(1 - u * u) * STAR_R;
    pos.set([Math.cos(a) * r, u * STAR_R, Math.sin(a) * r], i * 3);
    c.setHSL(rng.pick([0.08, 0.12, 0.6, 0.62, 0.0]), rng.range(0.1, 0.5), rng.range(0.55, 1)).multiplyScalar(rng.chance(0.03) ? 3 : 1);
    col.set([c.r, c.g, c.b], i * 3);
  }
  const starGeo = new THREE.BufferGeometry();
  starGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  starGeo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const stars = new THREE.Points(starGeo, new THREE.PointsMaterial({ size: 1.6, sizeAttenuation: false, vertexColors: true, depthWrite: false }));
  stars.frustumCulled = false;
  scene.add(stars);

  // O sistema é estático: a orientação e a direção do Sol de cada corpo só mudam quando a hora
  // muda (e o sistema gira em volta da Terra).
  let bodies = [];
  const basis = new THREE.Matrix4();
  const bx = new THREE.Vector3();
  const by = new THREE.Vector3();
  const bz = new THREE.Vector3();
  const qInv = new THREE.Quaternion();
  function setBodies(list) {
    bodies = list;
    const s = list[SUN_I];
    const e = list[0];
    uniforms.sunW.value.set(s.x - e.x, s.y - e.y, s.z - e.z).normalize();
    uniforms.sunGeo.value.copy(sunGeo.copy(uniforms.sunW.value).applyQuaternion(fromCity));
    for (const b of list) {
      const mesh = meshes[b.name];
      if (!mesh) continue;
      by.set(b.axis.x, b.axis.y, b.axis.z);
      if (b.name === 'LUA') {
        // A Lua mostra sempre a mesma face (+z local, onde ficam os mares) para a Terra.
        bz.set(e.x - b.x, e.y - b.y, e.z - b.z).normalize();
        bz.addScaledVector(by, -bz.dot(by)).normalize();
        bx.crossVectors(by, bz);
        mesh.quaternion.setFromRotationMatrix(basis.makeBasis(bx, by, bz));
      } else {
        mesh.quaternion.setFromUnitVectors(bx.set(0, 1, 0), by);
      }
      const sunL = mesh.material.uniforms.sunL.value.set(s.x - b.x, s.y - b.y, s.z - b.z).normalize();
      const ring = mesh.children[0];
      if (ring) ring.material.uniforms.sunLocal.value.copy(sunL).applyQuaternion(qInv.copy(mesh.quaternion).invert());
    }
  }

  // Corpo em espaço escalado (mapDist), nunca menor que MIN_PX. Devolve a distância real.
  function place(mesh, b, radius, pixel) {
    rel.set(b.x - eye.x, b.y - eye.y, b.z - eye.z);
    const d = rel.length();
    const s = mapDist(d) / d;
    mesh.position.copy(rel).multiplyScalar(s);
    mesh.scale.setScalar(Math.max(radius, d * pixel * MIN_PX) * s);
    return d;
  }

  // `view`: a câmera do jogo; `at`: a posição verdadeira dela (referencial da cidade);
  // `pixel`: o ângulo de um pixel (rad).
  function update(view, at, time, pixel) {
    view.getWorldQuaternion(camera.quaternion);
    if (camera.fov !== view.fov || camera.aspect !== view.aspect) {
      camera.fov = view.fov;
      camera.aspect = view.aspect;
      camera.updateProjectionMatrix();
    }
    eye.copy(at);
    uniforms.time.value = time;
    const e = bodies[0];
    const de = place(earth, e, EARTH.radius, pixel);
    atmo.position.copy(earth.position);
    atmo.scale.copy(earth.scale).multiplyScalar(1.025);
    // Detalhe fino abaixo de ~4.000 km de altitude (antes disso ele só serrilharia).
    uniforms.detail.value = 1 - THREE.MathUtils.smoothstep(de - EARTH.radius, 4e5, 4e6);
    const ds = place(sun, bodies[SUN_I], SUN.radius, pixel);
    corona.position.copy(sun.position);
    corona.scale.copy(sun.scale).multiplyScalar(CORONA);
    coronaU.radius.value = sun.scale.x;
    // Quanto maior o Sol na tela, menos brilho por pixel (como o olho se ajusta): de longe, uma
    // estrela que o bloom espalha; de perto, a superfície com a granulação.
    const big = THREE.MathUtils.smoothstep(Math.asin(Math.min(1, SUN.radius / ds)), 0.02, 0.3);
    sunU.detail.value = big;
    sunU.glow.value = 14 * Math.pow(1.8 / 14, big);
    coronaU.strength.value = THREE.MathUtils.lerp(4, 0.5, big);
    for (let i = 0; i < bodies.length; i++) {
      const mesh = meshes[bodies[i].name];
      if (mesh) place(mesh, bodies[i], bodies[i].radius, pixel);
    }
    beamIn.visible = beam.on;
    beamOut.visible = beam.on && beam.through;
    if (beam.on) {
      mapPoint(beam.from, pa);
      mapPoint(beam.entry, pb);
      beamIn.position.copy(pa);
      beamIn.lookAt(pb);
      beamIn.scale.setScalar(pa.distanceTo(pb));
    }
    if (beamOut.visible) {
      mapPoint(beam.exit, pa);
      mapPoint(rel.copy(beam.exit).addScaledVector(beam.dir, 2 * EARTH.radius), pb);
      beamOut.position.copy(pa);
      beamOut.lookAt(pb);
      const r = pa.length() * BEAM_W;
      beamOut.scale.set(r, r, pa.distanceTo(pb));
    }
  }

  return { scene, camera, update, setBodies, setBeam, setHoles, earth, sun, meshes };
}
