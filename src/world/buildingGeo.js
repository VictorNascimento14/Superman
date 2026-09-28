import * as THREE from 'three';
import { FACADE_TILE } from './textures.js';

// Geometria dos prédios: montar (paredes, telhado, cornija em malhas mescladas) e cortar
// (desabamento). Sem DOM: os testes montam e cortam de verdade.

export class GeoBuilder {
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
export function addWalls(gb, x0, y0, z0, x1, y1, z1, uo, vo) {
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

export function addTop(gb, x0, y, z0, x1, z1, scale) {
  gb.quad([x0, y, z1], [x1, y, z1], [x1, y, z0], [x0, y, z0], [0, 1, 0],
    [x0 / scale, z1 / scale, x1 / scale, z1 / scale, x1 / scale, z0 / scale, x0 / scale, z0 / scale]);
}

export function addBox(gb, x0, y0, z0, x1, y1, z1, scale = 4, top = true) {
  const u = (a) => a / scale;
  gb.quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], [0, 0, 1], [u(x0), u(y0), u(x1), u(y0), u(x1), u(y1), u(x0), u(y1)]);
  gb.quad([x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [0, 0, -1], [u(x1), u(y0), u(x0), u(y0), u(x0), u(y1), u(x1), u(y1)]);
  gb.quad([x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [1, 0, 0], [u(z1), u(y0), u(z0), u(y0), u(z0), u(y1), u(z1), u(y1)]);
  gb.quad([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], [-1, 0, 0], [u(z0), u(y0), u(z1), u(y0), u(z1), u(y1), u(z0), u(y1)]);
  if (top) addTop(gb, x0, y1, z0, x1, z1, scale);
}

// Corta um nível de prédio já montado numa malha mesclada (lógica pura, testada). As
// paredes são 4 quadriláteros do chão ao topo do nível (vértices BL, BR, TR, TL, como em
// addWalls), com o v da textura proporcional à altura: cortar é baixar TR/TL e o v deles
// juntos, e as janelas não esticam. O telhado desce para o corte; a cornija some. Com o
// corte na base ou abaixo, o nível inteiro vira um ponto (triângulo de área zero não
// desenha).
// ref: { wall, roof, trim } = primeiro vértice de cada parte (trim −1 = sem cornija).
// Devolve false se o corte está acima do nível (nada mudou).
export function cutTier(arr, ref, tier, y, vo) {
  if (y >= tier.y1) return false;
  if (y <= tier.y0) {
    toPoint(arr.wallPos, ref.wall, 16, tier.x, tier.y0, tier.z);
    toPoint(arr.roofPos, ref.roof, 4, tier.x, tier.y0, tier.z);
    if (ref.trim >= 0) toPoint(arr.trimPos, ref.trim, 16, tier.x, tier.y0, tier.z);
    return true;
  }
  for (let f = 0; f < 4; f++) {
    for (let k = 2; k < 4; k++) {
      const i = ref.wall + f * 4 + k;
      arr.wallPos[i * 3 + 1] = y;
      arr.wallUv[i * 2 + 1] = y / FACADE_TILE.h + vo;
    }
  }
  for (let k = 0; k < 4; k++) arr.roofPos[(ref.roof + k) * 3 + 1] = y;
  if (ref.trim >= 0) toPoint(arr.trimPos, ref.trim, 16, tier.x, y, tier.z);
  return true;
}

function toPoint(pos, start, n, x, y, z) {
  for (let i = start; i < start + n; i++) {
    pos[i * 3] = x;
    pos[i * 3 + 1] = y;
    pos[i * 3 + 2] = z;
  }
}
