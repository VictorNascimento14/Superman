// Corte da visão de calor nos prédios (lógica pura, testada). O raio que acerta uma fachada
// queima as células de 1 m em volta do ponto, na faixa de 8 m de altura em que bateu (mais
// largo com a carga solar). Quando o corte numa faixa cobre quase toda a largura da face, o
// prédio está fatiado ali: a parte de cima cai. E o raio parado num ponto por um tempo estoura
// um furo — uma ruptura, como a do herói passando.
export const CUT = {
  cell: 1, // m
  band: 8, // m de altura por faixa
  slice: 0.7, // fração da largura da face cortada que fatia o prédio (o resto não segura)
  edge: 2.5, // m: perto da divisa de duas faixas, o raio queima as duas (a mira sobe e desce)
  width: 0.9, // m queimados de cada lado do ponto, por quadro (× 1 + 2 × carga)
  dwell: 0.6, // s parado no mesmo ponto para estourar um furo...
  dwellCharged: 0.15, // ...ou isto com a carga solar cheia
  dwellRadius: 1.8, // m: mexer menos que isso ainda é "parado"
};

export function createCuts() {
  const faces = new Map(); // `${prédio}:${face}:${faixa}` → { cells, marked, done }
  let anchor = null; // { building, x, y, z, t }: onde o raio está parado
  const out = { slice: null, blast: null };

  // Queima as células em volta de u na faixa `band`; devolve true se ela acabou de ser fatiada.
  function burn(building, face, band, u, len, w) {
    const key = `${building}:${face}:${band}`;
    let f = faces.get(key);
    if (!f) {
      f = { cells: new Uint8Array(Math.max(1, Math.ceil(len / CUT.cell))), marked: 0, done: false };
      faces.set(key, f);
    }
    const a = Math.max(0, Math.floor((u - w) / CUT.cell));
    const b = Math.min(f.cells.length - 1, Math.floor((u + w) / CUT.cell));
    for (let i = a; i <= b; i++) {
      if (f.cells[i]) continue;
      f.cells[i] = 1;
      f.marked++;
    }
    if (f.done || f.marked < f.cells.length * CUT.slice) return false;
    f.done = true;
    return true;
  }

  // Um quadro de raio na face `face` (0..3) do prédio `building`: u metros a partir da borda
  // da face (que tem `len` m), no ponto p (referencial da cidade). Devolve { slice, blast }:
  // slice = a altura do corte quando a faixa acabou de ser fatiada; blast = o ponto em que um
  // furo estourou. Cada um vem uma vez só.
  function hit(dt, building, face, u, len, p, charge) {
    out.slice = null;
    out.blast = null;
    const w = CUT.width * (1 + 2 * charge);
    const band = Math.floor(p.y / CUT.band);
    const within = p.y - band * CUT.band;
    let sliced = burn(building, face, band, u, len, w);
    if (within < CUT.edge && band > 0) sliced = burn(building, face, band - 1, u, len, w) || sliced;
    if (within > CUT.band - CUT.edge) sliced = burn(building, face, band + 1, u, len, w) || sliced;
    if (sliced) out.slice = p.y;
    // Parado: o mesmo prédio, a menos de dwellRadius do ponto de antes.
    if (anchor && anchor.building === building && Math.hypot(p.x - anchor.x, p.y - anchor.y, p.z - anchor.z) < CUT.dwellRadius) {
      anchor.t += dt;
      const need = CUT.dwell + (CUT.dwellCharged - CUT.dwell) * Math.min(1, charge);
      if (anchor.t >= need) {
        out.blast = { x: anchor.x, y: anchor.y, z: anchor.z };
        anchor = null;
      }
    } else {
      anchor = { building, x: p.x, y: p.y, z: p.z, t: 0 };
    }
    return out;
  }

  // O raio largou o prédio (ou parou de disparar): o "parado" recomeça.
  const release = () => { anchor = null; };
  const coverage = (building, face, y) => {
    const f = faces.get(`${building}:${face}:${Math.floor(y / CUT.band)}`);
    return f ? f.marked / f.cells.length : 0;
  };
  return { hit, release, coverage };
}

// Face de uma caixa (0: +x, 1: −x, 2: +z, 3: −z) pela normal do acerto, com a coordenada ao longo
// dela a partir da borda e a largura dela. Grava em `out`.
export function faceOf(box, nx, nz, p, out) {
  if (Math.abs(nx) > Math.abs(nz)) {
    out.face = nx > 0 ? 0 : 1;
    out.u = p.z - box.minZ;
    out.len = box.maxZ - box.minZ;
  } else {
    out.face = nz > 0 ? 2 : 3;
    out.u = p.x - box.minX;
    out.len = box.maxX - box.minX;
  }
  return out;
}
