import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { createRng } from '../core/rng.js';
import { CITY, CELL, HALF, STYLES, streetLine } from './layout.js';
import { createTextures, FACADE_TILE, TILE_N } from './textures.js';

// Constrói os meshes da cidade a partir do layout. Invariante 1: geometria repetida é
// mesclada por material ou instanciada — a cidade inteira sai em poucas dezenas de draw calls.

class GeoBuilder {
  constructor() {
    this.pos = [];
    this.nor = [];
    this.uv = [];
    this.col = [];
    this.idx = [];
    this.tint = [1, 1, 1];
  }

  // Cantos na ordem BL, BR, TR, TL vistos de fora (anti-horário).
  quad(a, b, c, d, n, uv) {
    const base = this.pos.length / 3;
    for (const p of [a, b, c, d]) this.pos.push(p[0], p[1], p[2]);
    for (let k = 0; k < 4; k++) this.nor.push(n[0], n[1], n[2]);
    this.uv.push(...uv);
    for (let k = 0; k < 4; k++) this.col.push(this.tint[0], this.tint[1], this.tint[2]);
    this.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }

  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setIndex(this.idx);
    g.computeBoundingSphere();
    return g;
  }
}

// Paredes com UV em metros de fachada; `uo/vo` deslocam o padrão para cada prédio
// não repetir as mesmas janelas acesas do vizinho.
function addWalls(gb, x0, y0, z0, x1, y1, z1, uo, vo) {
  const tw = FACADE_TILE.w;
  const th = FACADE_TILE.h;
  const v0 = y0 / th + vo;
  const v1 = y1 / th + vo;
  const w = x1 - x0;
  const d = z1 - z0;
  const faces = [
    [[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], [0, 0, 1], w],
    [[x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [0, 0, -1], w],
    [[x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [1, 0, 0], d],
    [[x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], [-1, 0, 0], d],
  ];
  for (const [a, b, c, e, n, len] of faces) {
    const u1 = uo + len / tw;
    gb.quad(a, b, c, e, n, [uo, v0, u1, v0, u1, v1, uo, v1]);
  }
}

function addTop(gb, x0, y, z0, x1, z1, scale) {
  gb.quad([x0, y, z1], [x1, y, z1], [x1, y, z0], [x0, y, z0], [0, 1, 0],
    [x0 / scale, z1 / scale, x1 / scale, z1 / scale, x1 / scale, z0 / scale, x0 / scale, z0 / scale]);
}

function addBox(gb, x0, y0, z0, x1, y1, z1, scale = 4, top = true) {
  const u = (a) => a / scale;
  gb.quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], [0, 0, 1], [u(x0), u(y0), u(x1), u(y0), u(x1), u(y1), u(x0), u(y1)]);
  gb.quad([x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [0, 0, -1], [u(x1), u(y0), u(x0), u(y0), u(x0), u(y1), u(x1), u(y1)]);
  gb.quad([x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [1, 0, 0], [u(z1), u(y0), u(z0), u(y0), u(z0), u(y1), u(z1), u(y1)]);
  gb.quad([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], [-1, 0, 0], [u(z0), u(y0), u(z1), u(y0), u(z1), u(y1), u(z0), u(y1)]);
  if (top) addTop(gb, x0, y1, z0, x1, z1, scale);
}

function shadowed(mesh, cast = true) {
  mesh.castShadow = cast;
  mesh.receiveShadow = true;
  return mesh;
}

export function createCity(scene, layout, renderer) {
  const tex = createTextures(renderer);
  const group = new THREE.Group();
  group.name = 'cidade';
  scene.add(group);
  const rng = createRng(CITY.seed + 1);

  // --- Prédios: um mesh de paredes por estilo, um de telhados, um de cornijas.
  const walls = Object.fromEntries(STYLES.map((s) => [s, new GeoBuilder()]));
  const roofs = new GeoBuilder();
  const trims = new GeoBuilder();
  const tint = new THREE.Color();
  for (const b of layout.buildings) {
    const uo = rng.int(0, TILE_N - 1) / TILE_N;
    const vo = rng.int(0, TILE_N - 1) / TILE_N;
    // Tom por prédio (vertex color multiplica a textura): sem isto, todo prédio do
    // mesmo estilo sai idêntico e a cidade vira papel quadriculado.
    if (b.style === 'vidro') tint.setHSL(rng.pick([0.58, 0.55, 0.5, 0.42, 0.08, 0.6]), rng.range(0.15, 0.5), rng.range(0.5, 0.8));
    else tint.setHSL(rng.range(0.05, 0.12), rng.range(0, 0.25), rng.range(0.5, 0.82));
    if (b.landmark) tint.setRGB(1, 1, 1);
    walls[b.style].tint = [tint.r, tint.g, tint.b];
    for (const t of b.tiers) {
      const x0 = t.x - t.w / 2;
      const x1 = t.x + t.w / 2;
      const z0 = t.z - t.d / 2;
      const z1 = t.z + t.d / 2;
      addWalls(walls[b.style], x0, t.y0, z0, x1, t.y1, z1, uo, vo);
      addTop(roofs, x0, t.y1, z0, x1, z1, 10);
      if (b.style !== 'vidro') {
        // Cornija: faixa saliente no topo de cada nível, sem tampa (a tampa cobriria o
        // telhado inteiro com a cor da pedra). Vista de cima, lê como parapeito.
        const o = 0.6;
        addBox(trims, x0 - o, t.y1 - 1.4, z0 - o, x1 + o, t.y1 + 0.9, z1 + o, 4, false);
      }
    }
  }
  const windowMats = [];
  for (const s of STYLES) {
    const f = tex.facades[s];
    const m = new THREE.MeshStandardMaterial({
      map: f.map, emissiveMap: f.emissiveMap, emissive: 0xffffff, emissiveIntensity: 0,
      roughnessMap: f.rmMap, metalnessMap: f.rmMap, roughness: 1, metalness: 1, vertexColors: true,
    });
    windowMats.push(m);
    group.add(shadowed(new THREE.Mesh(walls[s].build(), m)));
  }
  group.add(shadowed(new THREE.Mesh(roofs.build(), new THREE.MeshStandardMaterial({ map: tex.roof, roughness: 0.95 })), false));
  group.add(shadowed(new THREE.Mesh(trims.build(), new THREE.MeshStandardMaterial({ color: 0xb9ad96, roughness: 0.8 }))));

  // --- Chão: uma laje grossa (a borda vira o cais) com a textura de ruas repetida por célula.
  const margin = 30;
  const size = HALF * 2 + margin * 2;
  const groundGeo = new THREE.BoxGeometry(size, 4, size);
  groundGeo.translate(0, -2, 0);
  const uv = groundGeo.attributes.uv;
  const posA = groundGeo.attributes.position;
  for (let i = 0; i < uv.count; i++) {
    // UV em células a partir da primeira rua, para as ruas caírem nas bordas da textura.
    uv.setXY(i, (posA.getX(i) + HALF) / CELL, (posA.getZ(i) + HALF) / CELL);
  }
  tex.ground.repeat.set(1, 1);
  const ground = shadowed(new THREE.Mesh(groundGeo, new THREE.MeshStandardMaterial({ map: tex.ground, roughness: 0.92 })), false);
  group.add(ground);

  // --- Parque: gramado sobre as ruas internas + árvores instanciadas.
  const p = layout.park;
  tex.grass.repeat.set((p.x1 - p.x0) / 12, (p.z1 - p.z0) / 12);
  const lawn = shadowed(new THREE.Mesh(new THREE.BoxGeometry(p.x1 - p.x0, 0.6, p.z1 - p.z0), new THREE.MeshStandardMaterial({ map: tex.grass, roughness: 1 })), false);
  lawn.position.set((p.x0 + p.x1) / 2, 0.3, (p.z0 + p.z1) / 2);
  group.add(lawn);
  const pond = new THREE.Mesh(new THREE.CircleGeometry(38, 40), null);
  pond.rotation.x = -Math.PI / 2;
  pond.position.set(lawn.position.x + 40, 0.65, lawn.position.z - 30);
  group.add(pond);
  group.add(makeTrees(p, rng, pond.position));

  // --- Água em volta da ilha.
  tex.waterNormals.repeat.set(160, 160);
  const waterMat = new THREE.MeshStandardMaterial({ color: 0x0d2c44, roughness: 0.06, metalness: 0.2, normalMap: tex.waterNormals, normalScale: new THREE.Vector2(0.35, 0.35) });
  const water = new THREE.Mesh(new THREE.PlaneGeometry(14000, 14000), waterMat);
  water.rotation.x = -Math.PI / 2;
  water.position.y = -1.2;
  water.receiveShadow = true;
  group.add(water);
  pond.material = waterMat;

  // --- Postes nas quinas dos cruzamentos; a lâmpada acende à noite.
  const lampHeadMat = new THREE.MeshStandardMaterial({ color: 0x222222, emissive: 0xffd7a0, emissiveIntensity: 0 });
  group.add(makeLamps(lampHeadMat));

  // --- Objetos de telhado: caixas d'água, condensadoras, antenas com luz de aviso.
  const beaconMat = new THREE.MeshStandardMaterial({ color: 0x330000, emissive: 0xff2a1a, emissiveIntensity: 0 });
  group.add(makeRoofProps(layout, rng, beaconMat));

  // --- O Planeta Diário: letreiro nos quatro lados e o globo dourado.
  const signMat = new THREE.MeshStandardMaterial({ color: 0x111111, emissive: 0xffffff, emissiveMap: tex.sign, emissiveIntensity: 0.4, map: tex.sign });
  const landmark = layout.buildings.find((b) => b.landmark);
  if (landmark) group.add(makeLandmark(landmark, signMat));

  function update(dt, time, night) {
    // Janelas acendem com o anoitecer; de dia ficam apagadas para não virar bloom.
    const k = night ** 1.3;
    for (const m of windowMats) m.emissiveIntensity = k * 1.8;
    lampHeadMat.emissiveIntensity = k * 6;
    signMat.emissiveIntensity = 0.4 + k * 2.6;
    beaconMat.emissiveIntensity = Math.sin(time * 3) > 0.6 ? 2 + k * 6 : 0.2;
    tex.waterNormals.offset.set(time * 0.004, time * 0.0025);
  }

  return { group, update };
}

function makeTrees(p, rng, avoid) {
  const trunk = new THREE.CylinderGeometry(0.35, 0.5, 4, 6).translate(0, 2, 0);
  const crown = new THREE.IcosahedronGeometry(3.2, 0).translate(0, 6.2, 0);
  const color = (g, c) => {
    const col = new THREE.Color(c);
    const arr = new Float32Array(g.attributes.position.count * 3);
    for (let i = 0; i < arr.length; i += 3) arr.set([col.r, col.g, col.b], i);
    g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
    return g;
  };
  const geo = mergeGeometries([color(trunk.toNonIndexed(), 0x5a4030), color(crown, 0x3d6b2a)]);
  const mesh = new THREE.InstancedMesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, flatShading: true, envMapIntensity: 0.25 }), 900);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const s = new THREE.Vector3();
  const v = new THREE.Vector3();
  const tint = new THREE.Color();
  let n = 0;
  for (let x = p.x0 + 8; x < p.x1 - 6; x += 11) {
    for (let z = p.z0 + 8; z < p.z1 - 6; z += 11) {
      if (n >= mesh.count || rng.chance(0.3)) continue;
      v.set(x + rng.range(-4, 4), 0.6, z + rng.range(-4, 4));
      if (Math.hypot(v.x - avoid.x, v.z - avoid.z) < 44) continue;
      q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, rng.range(0, Math.PI * 2));
      s.setScalar(rng.range(0.8, 1.5));
      mesh.setMatrixAt(n, m.compose(v, q, s));
      mesh.setColorAt(n, tint.setHSL(rng.range(0.1, 0.3), rng.range(0.1, 0.4), rng.range(0.35, 0.55)));
      n++;
    }
  }
  mesh.count = n;
  return shadowed(mesh);
}

function makeLamps(headMat) {
  const pole = new THREE.CylinderGeometry(0.12, 0.16, 8, 6).translate(0, 4, 0);
  const head = new THREE.BoxGeometry(0.9, 0.3, 0.5).translate(0, 8, 0);
  const n = (CITY.blocks + 1) ** 2 * 4;
  const poles = new THREE.InstancedMesh(pole, new THREE.MeshStandardMaterial({ color: 0x2a2d31, roughness: 0.6, metalness: 0.6 }), n);
  const heads = new THREE.InstancedMesh(head, headMat, n);
  const m = new THREE.Matrix4();
  const off = CITY.street / 2 + 1.2;
  let k = 0;
  for (let i = 0; i <= CITY.blocks; i++) {
    for (let j = 0; j <= CITY.blocks; j++) {
      for (const [dx, dz] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) {
        m.makeTranslation(streetLine(i) + dx * off, 0, streetLine(j) + dz * off);
        poles.setMatrixAt(k, m);
        heads.setMatrixAt(k, m);
        k++;
      }
    }
  }
  const g = new THREE.Group();
  g.add(poles, heads);
  return g;
}

function makeRoofProps(layout, rng, beaconMat) {
  const tankGeo = mergeGeometries([
    new THREE.CylinderGeometry(2.2, 2.2, 3.6, 12).translate(0, 3.8, 0),
    new THREE.ConeGeometry(2.4, 1.4, 12).translate(0, 6.3, 0),
    new THREE.BoxGeometry(3.6, 2, 0.3).translate(0, 1, 0),
    new THREE.BoxGeometry(0.3, 2, 3.6).translate(0, 1, 0),
  ]);
  const acGeo = new THREE.BoxGeometry(3, 1.6, 2.2).translate(0, 0.8, 0);
  const mastGeo = new THREE.CylinderGeometry(0.2, 0.45, 1, 6).translate(0, 0.5, 0);
  const beaconGeo = new THREE.SphereGeometry(0.7, 8, 6);
  const tanks = new THREE.InstancedMesh(tankGeo, new THREE.MeshStandardMaterial({ color: 0x6b4a33, roughness: 0.85 }), 900);
  const acs = new THREE.InstancedMesh(acGeo, new THREE.MeshStandardMaterial({ color: 0x9a9da0, roughness: 0.5, metalness: 0.4 }), 5000);
  const masts = new THREE.InstancedMesh(mastGeo, new THREE.MeshStandardMaterial({ color: 0x8a8d90, roughness: 0.4, metalness: 0.8 }), 400);
  const beacons = new THREE.InstancedMesh(beaconGeo, beaconMat, 400);
  const counts = { t: 0, a: 0, m: 0 };
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const v = new THREE.Vector3();
  const s = new THREE.Vector3(1, 1, 1);
  const spot = (t, margin) => v.set(t.x + rng.range(-1, 1) * (t.w / 2 - margin), t.y1, t.z + rng.range(-1, 1) * (t.d / 2 - margin));
  for (const b of layout.buildings) {
    if (b.landmark) continue;
    const top = b.tiers.at(-1);
    if (top.w < 10 || top.d < 10) continue;
    if (b.h < 110 && (b.style === 'tijolo' || b.style === 'concreto') && rng.chance(0.45) && counts.t < tanks.count) {
      tanks.setMatrixAt(counts.t++, m.makeTranslation(spot(top, 4)));
    }
    for (let k = rng.int(0, 3); k > 0 && counts.a < acs.count; k--) {
      q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, rng.int(0, 1) * Math.PI / 2);
      acs.setMatrixAt(counts.a++, m.compose(spot(top, 3), q, s));
    }
    if (b.h > 120 && rng.chance(0.6) && counts.m < masts.count) {
      const h = rng.range(8, 28);
      spot(top, 4);
      masts.setMatrixAt(counts.m, m.compose(v, q.identity(), s.set(1, h, 1)));
      beacons.setMatrixAt(counts.m++, m.makeTranslation(v.x, v.y + h, v.z));
      s.set(1, 1, 1);
    }
  }
  tanks.count = counts.t;
  acs.count = counts.a;
  masts.count = beacons.count = counts.m;
  const g = new THREE.Group();
  g.add(shadowed(tanks), shadowed(acs), shadowed(masts), beacons);
  return g;
}

function makeLandmark(b, signMat) {
  const g = new THREE.Group();
  const t0 = b.tiers[0];
  const signW = t0.w * 0.8;
  const signGeo = new THREE.PlaneGeometry(signW, signW / 8);
  const y = t0.y1 - 9;
  const o = t0.w / 2 + 0.25;
  for (let k = 0; k < 4; k++) {
    const s = new THREE.Mesh(signGeo, signMat);
    const a = (k * Math.PI) / 2;
    s.position.set(b.x + Math.sin(a) * o, y, b.z + Math.cos(a) * o);
    s.rotation.y = a;
    g.add(s);
  }
  const gold = new THREE.MeshStandardMaterial({ color: 0xd9a834, metalness: 1, roughness: 0.28, emissive: 0x3a2400, emissiveIntensity: 0.4 });
  const gl = b.globe;
  const pedestal = new THREE.Mesh(new THREE.CylinderGeometry(6, 8, 6, 24), new THREE.MeshStandardMaterial({ color: 0xb9ad96, roughness: 0.7 }));
  pedestal.position.set(gl.x, b.h + 3, gl.z);
  const globe = new THREE.Mesh(new THREE.SphereGeometry(gl.r, 48, 32), gold);
  globe.position.set(gl.x, gl.y, gl.z);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(gl.r * 1.28, 0.9, 10, 64), gold);
  ring.position.copy(globe.position);
  ring.rotation.set(Math.PI / 2 - 0.35, 0, 0.25);
  // Meridianos e paralelos em relevo: linhas finas em volta do globo.
  const lines = new THREE.Group();
  for (let k = 0; k < 6; k++) {
    const mer = new THREE.Mesh(new THREE.TorusGeometry(gl.r * 1.005, 0.18, 6, 48), gold);
    mer.rotation.y = (k * Math.PI) / 6;
    lines.add(mer);
  }
  for (const lat of [-0.5, 0, 0.5]) {
    const r = gl.r * Math.cos(lat) * 1.005;
    const par = new THREE.Mesh(new THREE.TorusGeometry(r, 0.18, 6, 48), gold);
    par.rotation.x = Math.PI / 2;
    par.position.y = gl.r * Math.sin(lat);
    lines.add(par);
  }
  lines.position.copy(globe.position);
  g.add(shadowed(pedestal), shadowed(globe), shadowed(ring), lines);
  return g;
}
