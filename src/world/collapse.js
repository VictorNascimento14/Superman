import * as THREE from 'three';
import { createDamage } from './damage.js';
import { createFall } from './fall.js';

// Desabamento. Quando o dano de um andar passa do limite — ou o golpe tem força de
// supersônico (damage.js) —, a parte de cima despenca: primeiro inteira, esmagando os andares
// de baixo e tombando para o lado do golpe; depois se parte em segmentos que caem cada um por
// si e se desfazem no chão (ou no telhado de um vizinho), levantando a poeira que corre pelas
// ruas (fall.js). Cada segmento é uma cópia idêntica do trecho do prédio (city.makePart); a
// parte de baixo é encurtada no lugar (city.setTop). No fim sobra um toco com escombros.
// Golpe mais fraco não derruba: os andares em volta do furo cedem (evento 'cede').
const RUBBLE = 3; // altura do toco que sobra (m)
const GONE = -1e4; // caixa de nível que sumiu: debaixo da terra (altura zero seria uma placa no ar)
const SEG = 30; // m por segmento (até MAX_SEG)
const MAX_SEG = 5;
const SIDES = [[1, 0], [-1, 0], [0, 1], [0, -1]];

export function createCollapses({ scene, city, layout, collision, fx, clearMarks }) {
  const damage = createDamage();
  const active = [];
  const cedes = []; // furos cujos andares em volta vão ceder daqui a pouco
  const events = []; // { type: 'collapse' | 'break' | 'rubble' | 'cede', ... }: jogo, áudio, câmera
  let ceded = 0;
  const m = new THREE.Matrix4();
  const delta = new THREE.Matrix4();
  const zero = new THREE.Matrix4().makeScale(0, 0, 0);
  const off = new THREE.Vector3();
  const region = { minX: 0, minY: 0, minZ: 0, maxX: 0, maxY: 0, maxZ: 0 };
  // Caixas de colisão de cada prédio: o teto delas desce com o esmagamento.
  const boxesOf = layout.buildings.map(() => []);
  collision.boxes.forEach((b, i) => { if (b.breakable) boxesOf[b.building].push(i); });

  // Cada entrada de travessia é dano no andar em que o herói passou. O Planeta Diário fura,
  // mas não cai: o globo e o letreiro não acompanhariam. Furo que não derruba faz ceder.
  function onBreach(e) {
    const box = collision.boxes[e.box];
    const bi = box.building;
    if (bi === undefined || layout.buildings[bi].landmark) return;
    if (e.entry) {
      // Largura atravessada: a extensão do nível perpendicular ao caminho, na horizontal.
      const width = Math.abs(e.dir.x) > Math.abs(e.dir.z) ? box.maxZ - box.minZ : box.maxX - box.minX;
      const cut = damage.hit(bi, e.at.y, width, e.force ?? e.speed); // força: com a carga solar, maior
      if (cut !== null) {
        start(bi, Math.max(cut, RUBBLE), e.dir);
        return;
      }
    }
    if (damage.isCollapsed(bi)) return;
    cedes.push({ bi, at: e.at.clone(), normal: e.normal.clone(), dir: e.dir.clone(), speed: e.speed, t: 0.3 + Math.random() * 0.35 });
  }

  // A visão de calor cortou o prédio de lado a lado na altura y: a parte de cima cai dali, para
  // o lado para onde o raio ia.
  function slice(bi, y, dir) {
    if (damage.isCollapsed(bi) || layout.buildings[bi].landmark) return false;
    damage.hit(bi, y, 1, Infinity); // marca como desabado
    start(bi, Math.max(y, RUBBLE), dir, true);
    return true;
  }

  // Pegada do prédio (todos os níveis, com folga para as marcas coladas na fachada).
  function footprint(bi, minY) {
    const b = layout.buildings[bi];
    region.minX = region.minZ = Infinity;
    region.maxX = region.maxZ = -Infinity;
    for (const t of b.tiers) {
      region.minX = Math.min(region.minX, t.x - t.w / 2 - 1.5);
      region.maxX = Math.max(region.maxX, t.x + t.w / 2 + 1.5);
      region.minZ = Math.min(region.minZ, t.z - t.d / 2 - 1.5);
      region.maxZ = Math.max(region.maxZ, t.z + t.d / 2 + 1.5);
    }
    region.minY = minY;
    region.maxY = b.h + 12;
    return region;
  }

  function lowerBoxes(bi, y) {
    for (const i of boxesOf[bi]) {
      const box = collision.boxes[i];
      if (y <= box.minY) box.minY = box.maxY = GONE;
      else box.maxY = Math.min(box.maxY, y);
    }
  }

  // sliced: corte limpo da visão de calor — a parte de cima só tomba sobre a borda do corte e
  // escorrega para fora; o toco fica na altura do corte, sem esmagar.
  function start(bi, cut, dir, sliced = false) {
    const b = layout.buildings[bi];
    const t0 = b.tiers[0];
    const n = Math.min(MAX_SEG, Math.max(1, Math.round((b.h - cut) / SEG)));
    const segments = Array.from({ length: n }, (_, i) => ({ y0: cut + ((b.h - cut) * i) / n, y1: cut + ((b.h - cut) * (i + 1)) / n }));
    const parts = segments.map((s) => {
      const part = city.makePart(bi, s.y0, s.y1);
      scene.add(part);
      return part;
    });
    const fall = createFall(
      { x: b.x, z: b.z, base: cut, width: t0.w, depth: t0.d, dir: dir ?? { x: Math.random() - 0.5, z: Math.random() - 0.5 }, segments },
      Math.random,
      sliced ? { crushG: 0, tiltAccel: 1.1 } : {},
    );
    city.setTop(bi, cut);
    lowerBoxes(bi, cut);
    // Os objetos de telhado caem com o segmento de cima: guarda a matriz original de cada um.
    const top = parts[n - 1];
    top.updateMatrixWorld();
    const props = (city.roofProps(bi) ?? []).map(({ mesh, i }) => {
      const m0 = new THREE.Matrix4();
      mesh.getMatrixAt(i, m0);
      return { mesh, i, m0 };
    });
    clearMarks(footprint(bi, cut));
    const inside = { minX: t0.x - t0.w / 2 - 2, maxX: t0.x + t0.w / 2 + 2, minZ: t0.z - t0.d / 2 - 2, maxZ: t0.z + t0.d / 2 + 2 };
    // O chão de um segmento: dentro da pegada do prédio é o toco (no corte limpo, o topo dele);
    // fora, a rua ou um vizinho.
    const stump = sliced ? cut : RUBBLE;
    const groundAt = (x, z) => (x > inside.minX && x < inside.maxX && z > inside.minZ && z < inside.maxZ ? stump : collision.heightAt(x, z));
    active.push({ bi, cut, stump, fall, parts, props, topInv: top.matrixWorld.clone().invert(), groundAt, puff: 0 });
    events.push({ type: 'collapse', building: bi, at: new THREE.Vector3(b.x, cut, b.z), height: b.h - cut });
  }

  // Poeira e entulho saindo pelos lados na linha de esmagamento.
  function crushFx(c, y) {
    const t = layout.buildings[c.bi].tiers[0];
    for (let k = 0; k < 2; k++) {
      const [nx, nz] = SIDES[(Math.random() * 4) | 0];
      const u = Math.random() - 0.5;
      const x = t.x + nx * (t.w / 2 + 1) + (nz !== 0 ? u * t.w : 0);
      const z = t.z + nz * (t.d / 2 + 1) + (nx !== 0 ? u * t.d : 0);
      fx.puff(x, y, z, nx * 5, 1, nz * 5, 24 + Math.random() * 14, 7, 0.75);
      fx.burst(x, y, z, nx * 9, -2, nz * 9, 5, 3, 1.6);
    }
  }

  // Um segmento chegou ao chão: vira pedaços grandes e uma nuvem de poeira em anel, que corre
  // pelas ruas e fica no ar.
  function shatter(c, e) {
    const part = c.parts[e.segment];
    scene.remove(part);
    part.traverse((o) => o.geometry?.dispose());
    if (e.segment === c.parts.length - 1) {
      for (const p of c.props) {
        p.mesh.setMatrixAt(p.i, zero);
        p.mesh.instanceMatrix.needsUpdate = true;
      }
    }
    const span = Math.max(e.size.x, e.size.z);
    const vol = e.size.x * e.size.y * e.size.z * 8;
    fx.burst(e.at.x, e.floor + 2, e.at.z, e.vel.x * 0.25, 3, e.vel.z * 0.25, Math.min(110, 30 + vol / 800), span * 1.2, 3.4);
    for (let k = 0; k < 12; k++) {
      const a = (k / 12) * Math.PI * 2 + Math.random() * 0.4;
      const v = 9 + Math.random() * 7;
      fx.puff(e.at.x + Math.cos(a) * span * 0.6, e.floor + 3, e.at.z + Math.sin(a) * span * 0.6, Math.cos(a) * v, 0.8, Math.sin(a) * v, 36 + Math.random() * 18, 14 + Math.random() * 6, 0.8);
    }
    events.push({ type: 'rubble', at: new THREE.Vector3(e.at.x, e.floor, e.at.z), height: e.size.y * 2 });
  }

  function update(dt) {
    for (let k = cedes.length - 1; k >= 0; k--) {
      const c = cedes[k];
      if ((c.t -= dt) > 0) continue;
      cedes.splice(k, 1);
      if (damage.isCollapsed(c.bi)) continue;
      // Os andares em volta do furo cedem: blocos grandes caindo para fora e poeira.
      const r = 4 + 3 * Math.min(1, c.speed / 200);
      fx.burst(c.at.x + c.normal.x * 1.5, c.at.y - 1, c.at.z + c.normal.z * 1.5, c.normal.x * 3, -1, c.normal.z * 3, Math.round(18 + 8 * r), r, 2.4);
      for (let i = 0; i < 4; i++) fx.puff(c.at.x + c.normal.x * 3, c.at.y - 2 - i * 2, c.at.z + c.normal.z * 3, c.normal.x * 3, -0.5, c.normal.z * 3, 18 + Math.random() * 10, 7, 0.7);
      ceded++;
      events.push({ type: 'cede', building: c.bi, at: c.at, normal: c.normal, dir: c.dir, radius: r });
    }
    for (let k = active.length - 1; k >= 0; k--) {
      const c = active[k];
      const falling = c.fall.step(dt, c.groundAt);
      for (let i = 0; i < c.parts.length; i++) {
        const s = c.fall.segs[i];
        if (s.gone) continue;
        // A origem da parte é o centro da base do segmento; a queda anda com o centro dele.
        c.parts[i].position.copy(s.pos).add(off.set(0, -s.half.y, 0).applyQuaternion(s.quat));
        c.parts[i].quaternion.copy(s.quat);
        c.parts[i].updateMatrixWorld();
      }
      const top = c.fall.segs[c.parts.length - 1];
      if (!top.gone) {
        delta.multiplyMatrices(c.parts[c.parts.length - 1].matrixWorld, c.topInv);
        for (const p of c.props) {
          p.mesh.setMatrixAt(p.i, m.multiplyMatrices(delta, p.m0));
          p.mesh.instanceMatrix.needsUpdate = true;
        }
      }
      for (const e of c.fall.events) {
        if (e.type === 'ground') shatter(c, e);
        else if (e.type === 'break') events.push({ type: 'break', building: c.bi, at: c.fall.segs[0].pos.clone() });
      }
      c.fall.events.length = 0;
      const crush = Math.max(c.stump, Math.min(c.cut, c.fall.crushY));
      city.setTop(c.bi, crush);
      lowerBoxes(c.bi, crush);
      if ((c.puff -= dt) <= 0 && crush > c.stump + 0.5) {
        c.puff = 0.12;
        crushFx(c, crush);
      }
      if (!falling && crush <= c.stump) {
        finish(c);
        active.splice(k, 1);
      }
    }
  }

  function finish(c) {
    city.setTop(c.bi, c.stump);
    lowerBoxes(c.bi, c.stump);
    clearMarks(footprint(c.bi, c.stump));
    // Escombros sobre o toco, e a poeira que fica pairando.
    const t = layout.buildings[c.bi].tiers[0];
    fx.burst(t.x, c.stump + 2, t.z, 0, -1, 0, 70, Math.min(t.w, t.d) * 0.8, 2.6);
    for (let i = 0; i < 6; i++) fx.puff(t.x + (Math.random() - 0.5) * t.w, c.stump + 1, t.z + (Math.random() - 0.5) * t.d, 0, 0.5, 0, 35, 12, 0.75);
    events.push({ type: 'rubble', at: new THREE.Vector3(t.x, c.stump, t.z), height: 0 });
  }

  return {
    onBreach,
    slice,
    update,
    events,
    isCollapsed: damage.isCollapsed,
    damageAt: damage.at,
    get active() { return active.length; },
    get ceded() { return ceded; },
    get segments() { return active.reduce((n, c) => n + c.fall.segs.filter((s) => !s.gone).length, 0); },
  };
}
