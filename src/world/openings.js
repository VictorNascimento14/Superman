import * as THREE from 'three';

// Aberturas de verdade nas fachadas: dentro de um furo a parede não é desenhada, e o
// interior do prédio aparece. São até OPEN furos ao mesmo tempo (os dos prédios com interior
// montado), compartilhados pelos materiais das paredes, do lado de dentro da fachada e do
// decalque do furo — todos recortam no mesmo lugar, com a mesma borda recortada.
export const OPEN = 24;

const GLSL = /* glsl */ `
  uniform vec4 uCut[${OPEN}];  // centro (referencial da cidade) e raio
  uniform vec4 uCutN[${OPEN}]; // normal da face e semente da borda
  uniform int uCutCount;
  varying float vOpen;
  varying vec3 vCity;
  bool inOpening(vec3 p) {
    for (int i = 0; i < ${OPEN}; i++) {
      if (i >= uCutCount) break;
      vec3 d = p - uCut[i].xyz;
      vec3 n = uCutN[i].xyz;
      float off = dot(d, n);
      if (abs(off) > 0.8) continue; // fora do plano: a parede e o lado de dentro dela contam
      vec3 q = d - n * off;
      vec3 t1 = normalize(cross(n, abs(n.y) < 0.9 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0)));
      float a = atan(dot(q, cross(n, t1)), dot(q, t1));
      float s = uCutN[i].w;
      // Borda de concreto quebrado: o raio varia com o ângulo em volta do centro.
      float jag = 1.0 + 0.16 * sin(a * 5.0 + s) + 0.09 * sin(a * 11.0 + s * 2.3) + 0.05 * sin(a * 23.0 + s * 3.1);
      if (length(q) < uCut[i].w * jag) return true;
    }
    return false;
  }
`;

export function createOpenings() {
  const uniforms = {
    uCut: { value: Array.from({ length: OPEN }, () => new THREE.Vector4()) },
    uCutN: { value: Array.from({ length: OPEN }, () => new THREE.Vector4()) },
    uCutCount: { value: 0 },
  };
  const list = []; // { building, x, y, z, nx, ny, nz, r, seed }

  function sync() {
    list.forEach((o, i) => {
      uniforms.uCut.value[i].set(o.x, o.y, o.z, o.r);
      uniforms.uCutN.value[i].set(o.nx, o.ny, o.nz, o.seed);
    });
    uniforms.uCutCount.value = list.length;
  }

  // Furo no prédio `building`: h = { x, y, z (centro), nx, ny, nz (normal da face), r }. O mais
  // antigo fecha quando passa de OPEN.
  function add(building, h) {
    list.push({ building, x: h.x, y: h.y, z: h.z, nx: h.nx, ny: h.ny, nz: h.nz, r: h.r, seed: Math.random() * 6.283 });
    if (list.length > OPEN) list.shift();
    sync();
  }

  function removeBuilding(building) {
    for (let i = list.length - 1; i >= 0; i--) if (list[i].building === building) list.splice(i, 1);
    sync();
  }

  // Ensina um material a recortar os furos. `mode`: 'attr' lê o atributo por vértice `open`
  // (paredes mescladas: só os prédios com interior testam os furos); 'always' testa sempre
  // (decalque do furo e lado de dentro da fachada, que só existem onde há furo ou interior).
  // `more(shader)` mexe no shader depois (e `key` separa o programa dele no cache).
  function patch(material, mode, more = null, key = '') {
    material.customProgramCacheKey = () => `aberturas-${mode}${key}`;
    material.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, uniforms);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>\n${mode === 'attr' ? 'attribute float open;' : ''}\nvarying float vOpen;\nvarying vec3 vCity;`)
        .replace('#include <begin_vertex>', `#include <begin_vertex>
          vOpen = ${mode === 'attr' ? 'open' : '1.0'};
          #ifdef USE_INSTANCING
            vCity = (instanceMatrix * vec4(position, 1.0)).xyz;
          #else
            vCity = position;
          #endif`);
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>\n${GLSL}`)
        .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
          if (vOpen > 0.5 && uCutCount > 0 && inOpening(vCity)) discard;`);
      more?.(shader);
    };
    material.needsUpdate = true;
  }

  return { uniforms, list, add, removeBuilding, patch };
}
