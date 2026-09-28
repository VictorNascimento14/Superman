import { Vector3, Quaternion, Matrix4 } from 'three';

// Queda da parte de cima de um prédio (lógica pura, testada). O bloco é uma pilha de
// segmentos. Primeiro ele desce inteiro, esmagando os andares de baixo, e tomba para o lado
// do golpe (gira sobre a borda da base daquele lado). No instante da quebra os segmentos se
// soltam, cada um com a velocidade que tinha e um giro a mais, e caem como corpos rígidos até
// o chão (ou o telhado de um vizinho), onde se desfazem.
export const FALL = {
  crushG: 6, // m/s² da descida do bloco inteiro: os andares de baixo freiam a queda livre
  g: 7, // depois de solto: o ar, a poeira e os pedaços freiam um pouco (e a queda pesa mais)
  tiltAccel: 0.45, // rad/s² do tombo (cresce com o próprio ângulo, como uma árvore)
  maxTilt: 0.9, // rad
  breakAt: 1.4, // s até os segmentos se soltarem
  sink: 0.25, // fração da altura que um segmento afunda no que atingiu antes de se desfazer
  spin: 0.5, // rad/s de giro extra por segmento solto
  push: 3, // m/s de afastamento entre segmentos soltos
};

const UP = new Vector3(0, 1, 0);

// block: { x, z, base (altura do corte), width, depth, dir (unitário, horizontal),
// segments: [{ y0, y1 }] em altura absoluta, de baixo para cima }. `opts` troca a descida e o
// tombo: num corte limpo (a visão de calor), os andares de baixo estão inteiros — o bloco não
// desce esmagando, só tomba sobre a borda do corte e escorrega para fora.
export function createFall(block, rnd = Math.random, { crushG = FALL.crushG, tiltAccel = FALL.tiltAccel } = {}) {
  const dir = new Vector3(block.dir.x, 0, block.dir.z).normalize();
  const axis = new Vector3().crossVectors(UP, dir).normalize(); // tombar para `dir`
  // Borda da base do lado do golpe: a dobradiça do tombo.
  const reach = Math.abs(dir.x) * block.width / 2 + Math.abs(dir.z) * block.depth / 2;
  const hinge = new Vector3(block.x + dir.x * reach, block.base, block.z + dir.z * reach);
  const q = new Quaternion();
  const segs = block.segments.map((s) => ({
    y0: s.y0,
    y1: s.y1,
    half: new Vector3(block.width / 2, (s.y1 - s.y0) / 2, block.depth / 2),
    // Centro do segmento em relação à dobradiça, com o bloco em pé.
    local: new Vector3(block.x - hinge.x, (s.y0 + s.y1) / 2 - block.base, block.z - hinge.z),
    pos: new Vector3(),
    prev: new Vector3(),
    quat: new Quaternion(),
    vel: new Vector3(),
    spin: new Vector3(),
    free: false,
    gone: false,
  }));
  // crushY: até onde o toco já foi esmagado — a base do bloco que desce e, depois da quebra, o
  // ponto mais baixo do segmento de baixo, que continua afundando nele.
  const f = { t: 0, tilt: 0, tiltV: 0, drop: 0, dropV: 0, broken: false, crushY: block.base, segs, events: [] };
  const w = new Vector3();
  const m = new Matrix4();
  const dq = new Quaternion();

  // Transformação rígida do bloco inteiro: gira `tilt` sobre a dobradiça e desce `drop`.
  function rigid() {
    q.setFromAxisAngle(axis, f.tilt);
    for (const s of segs) {
      s.pos.copy(s.local).applyQuaternion(q).add(hinge);
      s.pos.y -= f.drop;
      s.quat.copy(q);
    }
  }
  rigid();

  // Ponto mais baixo de um segmento (caixa girada).
  const lowest = (s) => {
    m.makeRotationFromQuaternion(s.quat);
    const e = m.elements;
    return s.pos.y - (Math.abs(e[1]) * s.half.x + Math.abs(e[5]) * s.half.y + Math.abs(e[9]) * s.half.z);
  };

  // groundAt(x, z): altura do chão ali (rua ou telhado de vizinho). Devolve true enquanto cai.
  f.step = (dt, groundAt) => {
    f.t += dt;
    if (!f.broken) {
      f.tiltV += tiltAccel * (1 + f.tilt * 2) * dt;
      f.tilt = Math.min(FALL.maxTilt, f.tilt + f.tiltV * dt);
      f.dropV += crushG * dt;
      f.drop += f.dropV * dt;
      for (const s of segs) s.prev.copy(s.pos);
      rigid();
      f.crushY = block.base - f.drop;
      if (f.t >= FALL.breakAt) {
        // Solta: cada segmento sai com a velocidade que tinha, afasta-se dos vizinhos e gira.
        f.broken = true;
        segs.forEach((s, i) => {
          s.free = true;
          s.vel.subVectors(s.pos, s.prev).divideScalar(dt);
          const k = segs.length > 1 ? i / (segs.length - 1) : 0;
          s.vel.addScaledVector(dir, FALL.push * k).addScaledVector(axis, (rnd() - 0.5) * FALL.push);
          s.spin.set(rnd() - 0.5, rnd() - 0.5, rnd() - 0.5).multiplyScalar(FALL.spin).addScaledVector(axis, FALL.spin * (0.5 + k));
        });
        f.events.push({ type: 'break' });
      }
    } else {
      for (const s of segs) {
        if (s.gone) continue;
        s.vel.y -= FALL.g * dt;
        s.pos.addScaledVector(s.vel, dt);
        w.copy(s.spin).multiplyScalar(dt);
        const a = w.length();
        if (a > 0) s.quat.premultiply(dq.setFromAxisAngle(w.divideScalar(a), a));
      }
    }
    // Segmento que chegou ao chão (ou ao telhado de um vizinho) se desfaz ali.
    let falling = false;
    for (const s of segs) {
      if (s.gone) continue;
      const floor = groundAt(s.pos.x, s.pos.z);
      if (s.free && lowest(s) <= floor - FALL.sink * s.half.y * 2) {
        s.gone = true;
        f.events.push({ type: 'ground', segment: segs.indexOf(s), at: s.pos.clone(), vel: s.vel.clone(), size: s.half.clone(), floor });
      } else falling = true;
    }
    if (f.broken) f.crushY = segs[0].gone ? -Infinity : Math.min(f.crushY, lowest(segs[0]));
    return falling;
  };

  return f;
}
