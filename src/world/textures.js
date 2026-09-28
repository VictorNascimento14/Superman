import * as THREE from 'three';
import { createRng } from '../core/rng.js';
import { CITY, CELL } from './layout.js';

// Texturas desenhadas em canvas (ADR-001: nenhum asset baixado).
// Uma fachada = 8 vãos × 8 andares; o UV das paredes é em metros / FACADE_TILE,
// então as janelas têm o mesmo tamanho em qualquer prédio. Com 4×4 a repetição das
// janelas acesas aparecia de perto à noite (colunas iguais a cada 16 m).
export const TILE_N = 8;
export const FACADE_TILE = { w: CITY.bay * TILE_N, h: CITY.floor * TILE_N };
const PX = 96; // pixels por vão/andar

const FACADES = {
  vidro: { wall: '#3d4a57', frame: '#39434d', glass: ['#56646e', '#4c5963', '#5d6c77', '#46535c'], ww: 0.96, wh: 0.86, wallR: 0.4, wallM: 0.7, glassR: 0.06, glassM: 0.95, spandrel: '#2c3a48' },
  artdeco: { wall: '#bfae8c', frame: '#8b7d62', glass: ['#1f2630', '#28303b', '#1b2129'], ww: 0.46, wh: 0.66, wallR: 0.85, wallM: 0, glassR: 0.12, glassM: 0.6, pier: '#bfae8b' },
  concreto: { wall: '#8e8a83', frame: '#6d6a64', glass: ['#232a33', '#2b333d', '#1e242c'], ww: 0.62, wh: 0.56, wallR: 0.9, wallM: 0, glassR: 0.12, glassM: 0.6 },
  tijolo: { wall: '#8a4a38', frame: '#d8ccb6', glass: ['#1f2226', '#272b30'], ww: 0.44, wh: 0.6, wallR: 0.92, wallM: 0, glassR: 0.14, glassM: 0.5, brick: true },
};

const LIT = ['#ffd9a0', '#ffe8c2', '#fff4dc', '#cfe0ff', '#ffc98a'];

function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')];
}

function speckle(ctx, w, h, rng, n, alpha, light = '#fff', dark = '#000') {
  for (let i = 0; i < n; i++) {
    ctx.globalAlpha = rng.range(0, alpha);
    ctx.fillStyle = rng.chance(0.5) ? light : dark;
    const s = rng.range(1, 3);
    ctx.fillRect(rng.range(0, w), rng.range(0, h), s, s);
  }
  ctx.globalAlpha = 1;
}

// roughnessMap lê o canal G, metalnessMap lê o B: uma textura serve para os dois.
const rmColor = (r, m) => `rgb(0,${Math.round(r * 255)},${Math.round(m * 255)})`;

function makeFacade(name, def, rng, aniso) {
  const W = PX * TILE_N;
  const [cMap, map] = makeCanvas(W, W);
  const [cEm, em] = makeCanvas(W, W);
  const [cRm, rm] = makeCanvas(W, W);
  map.fillStyle = def.wall;
  map.fillRect(0, 0, W, W);
  speckle(map, W, W, rng, 9000, 0.08);
  if (def.brick) {
    map.strokeStyle = 'rgba(40,20,15,0.35)';
    map.lineWidth = 1;
    for (let y = 0; y < W; y += 6) {
      map.beginPath(); map.moveTo(0, y); map.lineTo(W, y); map.stroke();
      for (let x = (y / 6) % 2 ? 0 : 7; x < W; x += 14) { map.beginPath(); map.moveTo(x, y); map.lineTo(x, y + 6); map.stroke(); }
    }
  }
  em.fillStyle = '#000';
  em.fillRect(0, 0, W, W);
  rm.fillStyle = rmColor(def.wallR, def.wallM);
  rm.fillRect(0, 0, W, W);

  const ww = PX * def.ww;
  const wh = PX * def.wh;
  for (let fy = 0; fy < TILE_N; fy++) {
    // Linha de laje entre andares.
    map.fillStyle = def.spandrel ?? 'rgba(0,0,0,0.12)';
    if (def.spandrel) map.fillRect(0, fy * PX + wh + (PX - wh) / 2, W, (PX - wh) / 2);
    for (let bx = 0; bx < TILE_N; bx++) {
      const x = bx * PX + (PX - ww) / 2;
      const y = fy * PX + (PX - wh) / 2;
      map.fillStyle = def.frame;
      map.fillRect(x - 3, y - 3, ww + 6, wh + 6);
      const g = map.createLinearGradient(x, y, x, y + wh);
      const base = rng.pick(def.glass);
      g.addColorStop(0, base);
      g.addColorStop(1, shade(base, -18));
      map.fillStyle = g;
      map.fillRect(x, y, ww, wh);
      if (def.ww > 0.8) {
        // Montante no meio do pano de vidro.
        map.fillStyle = def.frame;
        map.fillRect(x + ww / 2 - 1.5, y, 3, wh);
      }
      rm.fillStyle = rmColor(def.glassR, def.glassM);
      rm.fillRect(x, y, ww, wh);
      if (rng.chance(0.3)) {
        const c = rng.pick(LIT);
        const blind = rng.chance(0.35) ? rng.range(0.2, 0.6) : 0;
        em.fillStyle = c;
        em.globalAlpha = rng.range(0.55, 1);
        em.fillRect(x, y + wh * blind, ww, wh * (1 - blind));
        em.globalAlpha = 1;
        // Janela acesa tem cortina/interior visível de dia também.
        map.fillStyle = 'rgba(255,230,190,0.08)';
        map.fillRect(x, y + wh * blind, ww, wh * (1 - blind));
      }
    }
  }
  if (def.pier) {
    // Pilastras verticais do art déco, entre os vãos.
    for (let bx = 0; bx <= TILE_N; bx++) {
      map.fillStyle = def.pier;
      map.fillRect(bx * PX - 8, 0, 16, W);
      em.fillStyle = '#000';
      em.fillRect(bx * PX - 8, 0, 16, W);
    }
  }
  const tex = (c, srgb) => {
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = aniso;
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    return t;
  };
  return { name, map: tex(cMap, true), emissiveMap: tex(cEm, true), rmMap: tex(cRm, false) };
}

function shade(hex, amt) {
  const n = parseInt(hex.slice(1), 16);
  const c = (s) => Math.max(0, Math.min(255, ((n >> s) & 255) + amt));
  return `rgb(${c(16)},${c(8)},${c(0)})`;
}

// Uma célula da grade (quarteirão + meia rua de cada lado). O eixo da rua cai nas bordas
// da textura, então as linhas centrais são desenhadas metade em cada borda.
function makeGround(rng, aniso) {
  const W = 1024;
  const m = W / CELL; // px por metro
  const [c, g] = makeCanvas(W, W);
  const s = (CITY.street / 2) * m;
  const sw = CITY.sidewalk * m;
  g.fillStyle = '#2e3033';
  g.fillRect(0, 0, W, W);
  speckle(g, W, W, rng, 9000, 0.12, '#8a8a8a', '#000');
  // Calçada + interior do quarteirão.
  g.fillStyle = '#8f8b84';
  g.fillRect(s, s, W - 2 * s, W - 2 * s);
  g.fillStyle = '#7b7771';
  g.fillRect(s + sw, s + sw, W - 2 * (s + sw), W - 2 * (s + sw));
  speckle(g, W, W, rng, 4000, 0.06);
  g.fillStyle = '#5c5953'; // meio-fio
  g.fillRect(s, s, W - 2 * s, 3);
  g.fillRect(s, W - s - 3, W - 2 * s, 3);
  g.fillRect(s, s, 3, W - 2 * s);
  g.fillRect(W - s - 3, s, 3, W - 2 * s);
  g.strokeStyle = 'rgba(0,0,0,0.18)';
  for (let k = s; k < W - s; k += 2 * m) {
    g.beginPath(); g.moveTo(k, s); g.lineTo(k, s + sw); g.moveTo(k, W - s - sw); g.lineTo(k, W - s); g.stroke();
    g.beginPath(); g.moveTo(s, k); g.lineTo(s + sw, k); g.moveTo(W - s - sw, k); g.lineTo(W - s, k); g.stroke();
  }
  // Faixa dupla amarela no eixo (bordas da textura) e tracejado das faixas.
  g.fillStyle = '#c9a227';
  for (const e of [0, W]) {
    g.fillRect(s + 2, e - 3, W - 2 * s - 4, 2); g.fillRect(s + 2, e + 1, W - 2 * s - 4, 2);
    g.fillRect(e - 3, s + 2, 2, W - 2 * s - 4); g.fillRect(e + 1, s + 2, 2, W - 2 * s - 4);
  }
  g.fillStyle = 'rgba(230,230,230,0.8)';
  const lane = 5.5 * m;
  for (let k = s + 8; k < W - s - 8; k += 6 * m) {
    for (const e of [lane, W - lane]) {
      g.fillRect(k, e - 1, 3 * m, 2);
      g.fillRect(e - 1, k, 2, 3 * m);
    }
  }
  // Faixas de pedestre na saída de cada cruzamento.
  g.fillStyle = 'rgba(235,235,235,0.85)';
  for (let k = -s + 4; k < s - 4; k += 1.2 * m) {
    for (const e of [0, W]) {
      g.fillRect(s + 2, e + k, 3 * m, 0.6 * m);
      g.fillRect(W - s - 2 - 3 * m, e + k, 3 * m, 0.6 * m);
      g.fillRect(e + k, s + 2, 0.6 * m, 3 * m);
      g.fillRect(e + k, W - s - 2 - 3 * m, 0.6 * m, 3 * m);
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = aniso;
  return t;
}

function makeNoiseTex(rng, base, n, alpha, size = 256, aniso = 4) {
  const [c, g] = makeCanvas(size, size);
  g.fillStyle = base;
  g.fillRect(0, 0, size, size);
  speckle(g, size, size, rng, n, alpha);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = aniso;
  return t;
}

// Normal map de ondas: soma de senoides com períodos que dividem a textura (tileável).
function makeWaterNormals(size = 512) {
  const [c, g] = makeCanvas(size, size);
  const img = g.createImageData(size, size);
  // Frequências inteiras mantêm a textura tileável; muitas direções diferentes (e não
  // só múltiplos da grade) evitam o "papel de bolinhas" que o brilho do sol revelava.
  const waves = [
    [3, 1, 0.8], [-2, 5, 0.6], [5, -3, 0.45], [-7, -4, 0.35], [1, -8, 0.3], [9, 5, 0.22], [-11, 3, 0.18],
    [6, 11, 0.15], [-13, -7, 0.12], [15, -2, 0.1], [4, 17, 0.08], [-19, 9, 0.07], [21, 13, 0.05], [-8, -23, 0.05],
  ];
  const hgt = (x, y) => waves.reduce((s, [a, b, amp]) => s + amp * Math.sin((2 * Math.PI * (a * x + b * y)) / size), 0);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = hgt(x + 1, y) - hgt(x - 1, y);
      const dy = hgt(x, y + 1) - hgt(x, y - 1);
      const nx = -dx * 1.6;
      const ny = -dy * 1.6;
      const l = Math.hypot(nx, ny, 1);
      const o = (y * size + x) * 4;
      img.data[o] = ((nx / l) * 0.5 + 0.5) * 255;
      img.data[o + 1] = ((ny / l) * 0.5 + 0.5) * 255;
      img.data[o + 2] = ((1 / l) * 0.5 + 0.5) * 255;
      img.data[o + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

function makeSign(text) {
  const [c, g] = makeCanvas(1024, 128);
  g.fillStyle = '#000';
  g.fillRect(0, 0, 1024, 128);
  g.font = 'bold 84px Georgia, "Times New Roman", serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillStyle = '#ffd36b';
  g.fillText(text, 512, 68);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function createTextures(renderer) {
  const rng = createRng(4242);
  const aniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  const facades = {};
  for (const [name, def] of Object.entries(FACADES)) facades[name] = makeFacade(name, def, rng, aniso);
  return {
    facades,
    ground: makeGround(rng, aniso),
    roof: makeNoiseTex(rng, '#4f4d4a', 5000, 0.25, 256, aniso),
    grass: makeNoiseTex(rng, '#3f6b2f', 6000, 0.25, 256, aniso),
    waterNormals: makeWaterNormals(),
    sign: makeSign('PLANETA DIÁRIO'),
  };
}
