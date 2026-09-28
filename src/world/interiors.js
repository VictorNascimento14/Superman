import * as THREE from 'three';
import { interiorBand, piecesInSphere, KINDS } from './interior.js';
import { CITY } from './layout.js';

// Interior dos prédios que o herói atravessa: as peças de interior.js em InstancedMesh (um
// por tipo), só nos últimos ACTIVE prédios e só na faixa de andares em volta de onde ele
// entrou. O que o herói toca quebra e vira entulho; o que quebrou continua quebrado.
const CAP = { slab: 5000, column: 2000, core: 600, wall: 1500, desk: 6000, cabinet: 300, light: 3600, inner: 96 };
const ACTIVE = 3;
const BAND = 3; // andares acima e abaixo de onde o herói entrou
const SOLID = new Set(['slab', 'inner']); // não quebram: a laje fica, e a fachada abre pelo furo
export const PIECE_COLOR = { slab: 0x8c877f, column: 0x9d988f, core: 0x86817a, wall: 0xe0dcd2, desk: 0x7a6552, cabinet: 0x5b5f64, light: 0xf2efe6, inner: 0xcdc8bd };

// Lá dentro o céu não chega por cima: a luz do hemisfério (o azul do céu, sem sombra) cai a um
// quarto. Sem isso o carpete saía azul-claro, como se o andar não tivesse teto.
const INDOOR = THREE.ShaderChunk.lights_fragment_begin.replace(
  'irradiance += getHemisphereLightIrradiance( hemisphereLights[ i ], geometryNormal );',
  'irradiance += 0.25 * getHemisphereLightIrradiance( hemisphereLights[ i ], geometryNormal );',
);
const indoor = (shader) => {
  shader.fragmentShader = shader.fragmentShader.replace('#include <lights_fragment_begin>', INDOOR);
};

// Laje: piso de carpete em cima, forro claro embaixo, concreto nas bordas.
function slabGeometry() {
  const g = new THREE.BoxGeometry(1, 1, 1);
  const n = g.attributes.normal;
  const colors = new Float32Array(n.count * 3);
  const top = new THREE.Color(0x4d525a);
  const bottom = new THREE.Color(0xdcd9d2);
  const side = new THREE.Color(PIECE_COLOR.slab);
  for (let i = 0; i < n.count; i++) {
    let c = side;
    if (n.getY(i) > 0.5) c = top;
    else if (n.getY(i) < -0.5) c = bottom;
    colors.set([c.r, c.g, c.b], i * 3);
  }
  g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return g;
}

// Lado de dentro da fachada: parede clara com as janelas (vãos de 4 m, peitoril a 0,9 m) e o
// céu lá fora — de dia claro, de noite quase escuro. Recorta os furos como a fachada.
function innerMaterial(openings, sky) {
  const m = new THREE.MeshStandardMaterial({ color: PIECE_COLOR.inner, roughness: 0.9 });
  openings.patch(m, 'always', (shader) => {
    shader.uniforms.uSky = sky;
    shader.vertexShader = shader.vertexShader
      .replace('varying vec3 vCity;', 'varying vec3 vCity;\nvarying vec3 vCityN;')
      .replace('vOpen = 1.0;', 'vOpen = 1.0;\nvCityN = normal;');
    shader.fragmentShader = shader.fragmentShader
      .replace('varying vec3 vCity;', 'varying vec3 vCity;\nvarying vec3 vCityN;\nuniform vec3 uSky;')
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        float along = abs(vCityN.x) > 0.5 ? vCity.z : vCity.x;
        float u = fract(along / 4.0);
        float h = mod(vCity.y, ${CITY.floor.toFixed(1)});
        float win = step(0.07, u) * step(u, 0.93) * step(0.9, h) * step(h, 2.75);
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.02, 0.025, 0.03), win);
        totalEmissiveRadiance += win * uSky;`);
    indoor(shader);
  }, '-janelas');
  return m;
}

export function createInteriors(parent, layout, openings, city) {
  const sky = { value: new THREE.Color(0.6, 0.72, 0.9) };
  const mats = {
    slab: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92 }),
    light: new THREE.MeshStandardMaterial({ color: PIECE_COLOR.light, emissive: 0xfff2dc, emissiveIntensity: 2.2 }),
    inner: innerMaterial(openings, sky),
  };
  for (const k of ['column', 'core', 'wall', 'desk', 'cabinet']) {
    mats[k] = new THREE.MeshStandardMaterial({ color: PIECE_COLOR[k], roughness: k === 'cabinet' ? 0.45 : 0.85, metalness: k === 'cabinet' ? 0.5 : 0 });
  }
  // Lá dentro o céu chega só pelas janelas: o reflexo do ambiente e a luz de cima caem, e o
  // interior fica mais escuro que a rua, com as luminárias e as janelas se destacando.
  for (const k of KINDS) {
    mats[k].envMapIntensity = 0.3;
    if (k !== 'inner') {
      mats[k].onBeforeCompile = indoor;
      mats[k].customProgramCacheKey = () => 'interior';
    }
  }
  const unit = new THREE.BoxGeometry(1, 1, 1);
  const meshes = {};
  for (const k of KINDS) {
    const mesh = new THREE.InstancedMesh(k === 'slab' ? slabGeometry() : unit, mats[k], CAP[k]);
    mesh.count = 0;
    mesh.visible = false;
    mesh.receiveShadow = true; // a fachada faz sombra aqui dentro
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    parent.add(mesh);
    meshes[k] = mesh;
  }

  const active = []; // { bi, yLo, yHi, pieces, alive, slot } — o primeiro é o mais recente
  const broken = new Map(); // prédio → Set(id) do que já quebrou
  const m4 = new THREE.Matrix4();
  const pos = new THREE.Vector3();
  const size = new THREE.Vector3();
  const one = new THREE.Quaternion();
  const zero = new THREE.Matrix4().makeScale(0, 0, 0);
  let brokenCount = 0;

  // Reescreve todas as instâncias a partir dos prédios ativos (só quando a lista muda).
  function rebuild() {
    const count = Object.fromEntries(KINDS.map((k) => [k, 0]));
    for (const a of active) {
      for (let i = 0; i < a.pieces.length; i++) {
        const c = a.pieces[i];
        a.slot[i] = -1;
        if (!a.alive[i] || count[c.kind] >= CAP[c.kind]) continue;
        pos.set((c.minX + c.maxX) / 2, (c.minY + c.maxY) / 2, (c.minZ + c.maxZ) / 2);
        size.set(c.maxX - c.minX, c.maxY - c.minY, c.maxZ - c.minZ);
        meshes[c.kind].setMatrixAt(count[c.kind], m4.compose(pos, one, size));
        a.slot[i] = count[c.kind]++;
      }
    }
    for (const k of KINDS) {
      const mesh = meshes[k];
      mesh.count = count[k];
      mesh.visible = count[k] > 0;
      mesh.instanceMatrix.clearUpdateRanges();
      mesh.instanceMatrix.needsUpdate = true;
      if (count[k]) mesh.computeBoundingSphere();
    }
  }

  function drop(a) {
    city.setOpen(a.bi, false);
    openings.removeBuilding(a.bi);
  }

  // Monta o interior do prédio `bi` em volta da altura y (o herói entrou ali, ou seguiu andando
  // lá dentro para fora da faixa). O mais antigo sai quando passa de ACTIVE.
  function activate(bi, y) {
    const F = CITY.floor;
    const i = active.findIndex((e) => e.bi === bi);
    const a = i >= 0 ? active[i] : null;
    if (a && y >= a.yLo + F && y <= a.yHi) {
      if (i > 0) active.unshift(...active.splice(i, 1));
      return false;
    }
    const f = Math.floor(y / F);
    const yLo = (f - BAND) * F;
    const yHi = (f + BAND) * F;
    if (a) active.splice(i, 1);
    const pieces = interiorBand(layout.buildings[bi], yLo, yHi);
    const gone = broken.get(bi);
    const alive = new Uint8Array(pieces.length);
    for (let k = 0; k < pieces.length; k++) alive[k] = gone?.has(pieces[k].id) ? 0 : 1;
    active.unshift({ bi, yLo, yHi, pieces, alive, slot: new Int32Array(pieces.length) });
    if (!a) city.setOpen(bi, true);
    if (active.length > ACTIVE) drop(active.pop());
    rebuild();
    return true;
  }

  // O prédio desabou (ou sumiu): o interior dele sai, e os furos fecham.
  function remove(bi) {
    const i = active.findIndex((e) => e.bi === bi);
    if (i < 0) return;
    drop(active.splice(i, 1)[0]);
    rebuild();
  }

  // Quebra a peça i do prédio ativo a: some da tela (só aquela instância sobe) e fica marcada.
  function breakPiece(a, i) {
    const c = a.pieces[i];
    a.alive[i] = 0;
    if (!broken.has(a.bi)) broken.set(a.bi, new Set());
    broken.get(a.bi).add(c.id);
    brokenCount++;
    const slot = a.slot[i];
    if (slot >= 0) {
      const mesh = meshes[c.kind];
      mesh.setMatrixAt(slot, zero);
      mesh.instanceMatrix.addUpdateRange(slot * 16, 16);
      mesh.instanceMatrix.needsUpdate = true;
    }
    return c;
  }

  // Os andares em volta de um furo cedem: tudo do prédio `bi` na esfera (p, r) cai, laje
  // incluída — só a fachada fica (ela abre pelo furo maior). Devolve o que caiu.
  const fallen = [];
  function collapseRegion(bi, p, r) {
    fallen.length = 0;
    const a = active.find((e) => e.bi === bi);
    if (!a) return fallen;
    piecesInSphere(a.pieces, p, r, hit);
    for (let h = 0; h < hit.length; h++) {
      const i = hit[h];
      if (a.alive[i] && a.pieces[i].kind !== 'inner') fallen.push(breakPiece(a, i));
    }
    return fallen;
  }

  // O herói (esfera de raio r) foi de `from` a `to` neste quadro: o que ele tocou quebra.
  // Devolve as peças quebradas (para o entulho), num array reaproveitado.
  const hit = [];
  const smashed = [];
  const sample = new THREE.Vector3();
  function smash(from, to, r) {
    smashed.length = 0;
    if (!active.length) return smashed;
    const steps = Math.max(1, Math.ceil(from.distanceTo(to) / r));
    for (let s = 1; s <= steps; s++) {
      sample.lerpVectors(from, to, s / steps);
      for (let n = 0; n < active.length; n++) {
        const a = active[n];
        piecesInSphere(a.pieces, sample, r, hit);
        for (let h = 0; h < hit.length; h++) {
          const i = hit[h];
          if (!a.alive[i] || SOLID.has(a.pieces[i].kind)) continue;
          smashed.push(breakPiece(a, i));
        }
      }
    }
    return smashed;
  }

  // night: 0 de dia, 1 de noite — o céu nas janelas de dentro e o brilho das luminárias.
  function update(night) {
    // Abaixo de 1 no HDR: acima disso o bloom espalhava as janelas num véu pela tela.
    sky.value.setRGB(0.6, 0.72, 0.9).multiplyScalar(0.95 * (1 - night) + 0.05);
    mats.light.emissiveIntensity = 1.6 + 1.2 * night;
  }

  return {
    activate, remove, smash, collapseRegion, update, meshes,
    isActive: (bi) => active.some((a) => a.bi === bi),
    stats: () => ({ active: active.map((a) => a.bi), pieces: active.reduce((n, a) => n + a.pieces.length, 0), broken: brokenCount }),
  };
}
