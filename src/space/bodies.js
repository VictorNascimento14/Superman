import { Vector3, Quaternion, MathUtils } from 'three';
import { EARTH, SPACE } from './nav.js';

// Sistema solar em escala real (lógica pura, testada). Tudo no referencial da cidade: a Terra
// tem o centro em (0, −R, 0) e o Sol fica a 1 UA na direção em que o céu o mostra (a hora do
// dia gira o sistema em volta da Terra — é a Terra girando). Os planetas ficam no plano da
// eclíptica, cada um no seu raio de órbita, em ângulos fixos escolhidos para aparecerem em
// direções diferentes do céu da Terra — uns perto do Sol, outros de noite (numa sessão de
// jogo eles quase não andam).
export const AU = 1.495978707e11;
export const SUN = { name: 'SOL', radius: 6.957e8 };
export const MOON = { name: 'LUA', radius: 1.7374e6, distance: 3.844e8, angle: 70 };
// raio (m), órbita (UA), ângulo na eclíptica a partir da direção Sol → Terra e inclinação do
// eixo (graus). Vistos da Terra: Mercúrio e Vênus perto do Sol; Marte, Saturno e Urano de noite.
export const PLANETS = [
  { name: 'MERCÚRIO', radius: 2.4397e6, orbit: 0.387, angle: 70, tilt: 0 },
  { name: 'VÊNUS', radius: 6.0518e6, orbit: 0.723, angle: -40, tilt: 177 },
  { name: 'MARTE', radius: 3.3895e6, orbit: 1.524, angle: 20, tilt: 25 },
  { name: 'JÚPITER', radius: 6.9911e7, orbit: 5.203, angle: -100, tilt: 3 },
  { name: 'SATURNO', radius: 5.8232e7, orbit: 9.537, angle: 30, tilt: 27 },
  { name: 'URANO', radius: 2.5362e7, orbit: 19.19, angle: -60, tilt: 98 },
  { name: 'NETUNO', radius: 2.4622e7, orbit: 30.07, angle: 110, tilt: 28 },
];
export const SUN_I = 1; // ordem de solarSystem(): Terra, Sol, Lua, planetas
// Piso de cada corpo: ninguém pisa num planeta além da Terra (só Metrópolis tem chão).
export const floorOf = (radius) => Math.max(20e3, 0.01 * radius);

// Metrópolis no globo: 40,7° N, 74° O. `toCity` gira o globo para esse ponto ficar no "para
// cima" da cidade; o eixo norte da Terra, no referencial da cidade, sai dela.
const CITY_LAT = MathUtils.degToRad(40.7);
const CITY_LON = MathUtils.degToRad(-74);
export const CITY_GEO = new Vector3(Math.cos(CITY_LAT) * Math.cos(CITY_LON), Math.sin(CITY_LAT), -Math.cos(CITY_LAT) * Math.sin(CITY_LON));
export const toCity = new Quaternion().setFromUnitVectors(CITY_GEO, new Vector3(0, 1, 0));
export const NORTH = new Vector3(0, 1, 0).applyQuaternion(toCity);

// Corpos no referencial da cidade para o Sol na direção `sunDir` (unitária). A eclíptica é o
// plano que contém a direção Sol → Terra e fica o mais perto possível do equador da Terra.
export function solarSystem(sunDir) {
  const earth = { name: 'TERRA', x: 0, y: -EARTH.radius, z: 0, radius: EARTH.radius, floor: SPACE.floor };
  const u = new Vector3().copy(sunDir).negate(); // Sol → Terra
  const n = new Vector3().copy(NORTH).addScaledVector(u, -NORTH.dot(u)).normalize(); // normal da eclíptica
  const v = new Vector3().crossVectors(n, u);
  const sun = { ...SUN, x: earth.x + sunDir.x * AU, y: earth.y + sunDir.y * AU, z: earth.z + sunDir.z * AU, floor: floorOf(SUN.radius) };
  const at = (cx, cy, cz, dist, deg) => {
    const a = MathUtils.degToRad(deg);
    return { x: cx + dist * (Math.cos(a) * u.x + Math.sin(a) * v.x), y: cy + dist * (Math.cos(a) * u.y + Math.sin(a) * v.y), z: cz + dist * (Math.cos(a) * u.z + Math.sin(a) * v.z) };
  };
  // Eixo de rotação: o "para cima" da cidade — que é o da câmera, em qualquer lugar —
  // inclinado na direção Sol → Terra. As faixas ficam deitadas na tela, os anéis de Saturno
  // abrem para quem vem da Terra, e Urano, com 98°, gira de lado. (A eclíptica, com o Sol do
  // céu da cidade a até 48° de altura, deixaria as faixas quase em pé.)
  const h = new Vector3(u.x, 0, u.z);
  if (h.lengthSq() < 1e-9) h.set(1, 0, 0);
  h.normalize();
  const axis = (deg) => {
    const t = MathUtils.degToRad(deg);
    return { x: h.x * Math.sin(t), y: Math.cos(t), z: h.z * Math.sin(t) };
  };
  const planets = PLANETS.map((p) => ({ ...p, ...at(sun.x, sun.y, sun.z, p.orbit * AU, p.angle), floor: floorOf(p.radius), axis: axis(p.tilt) }));
  const moon = { ...MOON, ...at(earth.x, earth.y, earth.z, MOON.distance, MOON.angle), floor: floorOf(MOON.radius), axis: axis(0) };
  return [earth, sun, moon, ...planets];
}

// Quanto do Sol chega em p (0 a 1): um corpo entre p e o Sol cobre parte do disco dele. Conta
// com o tamanho aparente dos dois — a Terra vista de Marte não faz sombra, e a borda da
// sombra é uma penumbra, não um degrau (a luz não pisca ao cruzá-la).
export function sunlight(bodies, p) {
  const sun = bodies[SUN_I];
  const lx = sun.x - p.x;
  const ly = sun.y - p.y;
  const lz = sun.z - p.z;
  const ld = Math.sqrt(lx * lx + ly * ly + lz * lz);
  const rs = Math.asin(Math.min(1, sun.radius / ld)); // raio aparente do Sol
  let light = 1;
  for (let i = 0; i < bodies.length; i++) {
    if (i === SUN_I) continue;
    const b = bodies[i];
    const cx = b.x - p.x;
    const cy = b.y - p.y;
    const cz = b.z - p.z;
    const cd = Math.sqrt(cx * cx + cy * cy + cz * cz);
    if (cd >= ld) continue; // atrás do Sol não faz sombra
    const t = (cx * lx + cy * ly + cz * lz) / ld;
    const mx = cx - (lx / ld) * t;
    const my = cy - (ly / ld) * t;
    const mz = cz - (lz / ld) * t;
    const sep = Math.atan2(Math.sqrt(mx * mx + my * my + mz * mz), t); // corpo ↔ Sol, visto de p
    const rb = Math.asin(Math.min(1, b.radius / cd));
    const cover = rb >= rs ? 1 : (rb / rs) ** 2; // o máximo do disco que ele consegue cobrir
    light = Math.min(light, 1 - cover * (1 - MathUtils.smoothstep(sep, Math.abs(rb - rs), rb + rs)));
  }
  return light;
}
