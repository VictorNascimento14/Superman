import { EARTH } from '../space/nav.js';

// A visão de calor carregada de Sol atravessa a Terra (lógica pura, testada). Com carga de
// sobra, o raio que acerta o globo entra, passa pelo miolo e sai do outro lado, deixando um
// buraco em brasa na entrada e outro na saída, que crescem enquanto o raio fica no mesmo
// lugar. De longe (do Sol, a Terra tem 9 px), a mira assistida leva o raio ao centro dela
// quando a mira passa perto do disco. Metrópolis é protegida: a cidade de verdade é plana e
// não teria como mostrar o buraco — ali o raio para na superfície.
export const PIERCE = {
  min: 0.35, // carga solar mínima
  assist: 0.05, // rad (~3°, ~50 px na tela) além da borda do disco: a mira vai ao centro da Terra
  start: 25e3, // m: raio do buraco ao abrir
  grow: 40e3, // m/s enquanto o raio fica nele
  max: 400e3, // m
  count: 8, // buracos guardados; ao abrir o nono, o mais antigo fecha
  merge: 250e3, // m: a mira que anda até isto (ou 2 raios) continua no mesmo buraco…
  follow: 4, // /s: …e o buraco desliza atrás do raio, em vez de abrir outro a cada tremida
  city: 150e3, // m pela superfície: Metrópolis protegida
};

// Centro da Terra no referencial da cidade.
const CX = 0;
const CY = -EARTH.radius;
const CZ = 0;

// Direção do raio com a mira assistida: no disco da Terra, vai onde o jogador mira; a até
// PIERCE.assist da borda, vai ao centro dela. Grava em `out` e diz se acerta a Terra.
export function assistAim(o, dir, out) {
  const cx = CX - o.x;
  const cy = CY - o.y;
  const cz = CZ - o.z;
  const dist = Math.sqrt(cx * cx + cy * cy + cz * cz);
  const along = cx * dir.x + cy * dir.y + cz * dir.z;
  const ax = cy * dir.z - cz * dir.y;
  const ay = cz * dir.x - cx * dir.z;
  const az = cx * dir.y - cy * dir.x;
  const angle = Math.atan2(Math.sqrt(ax * ax + ay * ay + az * az), along); // mira ↔ centro
  const disc = Math.asin(Math.min(1, EARTH.radius / dist));
  if (angle <= disc) {
    out.x = dir.x;
    out.y = dir.y;
    out.z = dir.z;
    return true;
  }
  if (angle > disc + PIERCE.assist) return false;
  out.x = cx / dist;
  out.y = cy / dist;
  out.z = cz / dist;
  return true;
}

// Corda do raio (origem o, direção unitária d) pela Terra: distâncias de entrada e de saída
// em `out`. Falso se não acerta (ou se a origem está dentro dela). A distância de passagem é
// medida direto, não por b² − c: do Sol, b² e c têm 22 casas e a diferença sumiria.
export function chord(o, d, out) {
  const ox = o.x - CX;
  const oy = o.y - CY;
  const oz = o.z - CZ;
  const b = ox * d.x + oy * d.y + oz * d.z;
  const mx = ox - d.x * b;
  const my = oy - d.y * b;
  const mz = oz - d.z * b;
  const miss2 = mx * mx + my * my + mz * mz;
  const r2 = EARTH.radius * EARTH.radius;
  if (miss2 > r2 || b > 0) return false; // passa longe, ou a Terra está atrás
  const h = Math.sqrt(r2 - miss2);
  out.tIn = -b - h;
  out.tOut = -b + h;
  return out.tIn > 0;
}

export function createPierce() {
  const holes = []; // { entry, exit: direções unitárias do centro da Terra; radius (m) }
  const aim = { x: 0, y: 0, z: 0 };
  const hit = { tIn: 0, tOut: 0 };
  const en = { x: 0, y: 0, z: 0 };
  const ex = { x: 0, y: 0, z: 0 };
  // O disparo do quadro: direção (com a assistência), pontos de entrada e saída (referencial da
  // cidade), se Metrópolis bloqueou, e o buraco que ele abriu ou alargou.
  const shot = { dir: aim, entry: { x: 0, y: 0, z: 0 }, exit: { x: 0, y: 0, z: 0 }, blocked: false, hole: null, opened: false };
  const unitFromCenter = (p, out) => {
    const x = p.x - CX;
    const y = p.y - CY;
    const z = p.z - CZ;
    const l = Math.sqrt(x * x + y * y + z * z);
    out.x = x / l;
    out.y = y / l;
    out.z = z / l;
  };
  const arc = (a, b) => Math.acos(Math.min(1, Math.max(-1, a.x * b.x + a.y * b.y + a.z * b.z))) * EARTH.radius;
  // Anda a direção a uma fração k do caminho até b (e volta para a esfera unitária).
  const slide = (a, b, k) => {
    a.x += (b.x - a.x) * k;
    a.y += (b.y - a.y) * k;
    a.z += (b.z - a.z) * k;
    const l = Math.sqrt(a.x * a.x + a.y * a.y + a.z * a.z);
    a.x /= l;
    a.y /= l;
    a.z /= l;
  };

  // o: de onde o raio sai (a câmera, como a mira); dir: a mira. Devolve o disparo ou null.
  function update(dt, o, dir, charge, firing) {
    if (!firing || charge < PIERCE.min) return null;
    if (!assistAim(o, dir, aim) || !chord(o, aim, hit)) return null;
    shot.entry.x = o.x + aim.x * hit.tIn;
    shot.entry.y = o.y + aim.y * hit.tIn;
    shot.entry.z = o.z + aim.z * hit.tIn;
    shot.exit.x = o.x + aim.x * hit.tOut;
    shot.exit.y = o.y + aim.y * hit.tOut;
    shot.exit.z = o.z + aim.z * hit.tOut;
    unitFromCenter(shot.entry, en);
    unitFromCenter(shot.exit, ex);
    shot.opened = false;
    // Metrópolis fica em cima do centro da Terra: (0, 1, 0).
    shot.blocked = Math.acos(Math.min(1, en.y)) * EARTH.radius < PIERCE.city;
    if (shot.blocked) {
      shot.hole = null;
      return shot;
    }
    let h = null;
    for (let i = 0; i < holes.length; i++) if (arc(holes[i].entry, en) < Math.max(2 * holes[i].radius, PIERCE.merge)) h = holes[i];
    if (h) {
      h.radius = Math.min(PIERCE.max, h.radius + PIERCE.grow * dt);
      const k = 1 - Math.exp(-dt * PIERCE.follow);
      slide(h.entry, en, k);
      slide(h.exit, ex, k);
    } else {
      h = { entry: { ...en }, exit: { ...ex }, radius: PIERCE.start };
      holes.push(h);
      if (holes.length > PIERCE.count) holes.shift();
      shot.opened = true;
    }
    shot.hole = h;
    return shot;
  }

  return { holes, update };
}
