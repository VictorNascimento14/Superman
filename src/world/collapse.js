import * as THREE from 'three';
import { createDamage } from './damage.js';

// Desabamento. Quando o dano de um andar passa do limite (damage.js), a parte de cima
// despenca sobre a de baixo e a esmaga até o chão, numa nuvem de poeira — como numa
// demolição. O bloco que cai é uma cópia idêntica (city.makePart) e afunda sob a laje da rua,
// que é opaca e o esconde; a parte de baixo é encurtada no lugar (city.setTop). No fim sobra
// um toco com escombros.
const FALL_G = 7; // m/s² efetivos: o esmagamento dos andares freia a queda livre
const TILT_RATE = 0.035; // rad/s: o bloco tomba de leve enquanto cai...
const MAX_TILT = 0.14; // ...até ~8°
const RUBBLE = 3; // altura do toco que sobra (m)
const GONE = -1e4; // caixa de nível que sumiu: debaixo da terra (altura zero seria uma placa no ar)
const SIDES = [[1, 0], [-1, 0], [0, 1], [0, -1]];

export function createCollapses({ scene, city, layout, collision, fx, clearMarks }) {
  const damage = createDamage();
  const active = [];
  const events = []; // { type: 'collapse' | 'rubble', at, height }: áudio, câmera e aviso
  const m = new THREE.Matrix4();
  const delta = new THREE.Matrix4();
  const zero = new THREE.Matrix4().makeScale(0, 0, 0);
  const region = { minX: 0, minY: 0, minZ: 0, maxX: 0, maxY: 0, maxZ: 0 };
  // Caixas de colisão de cada prédio: o teto delas desce com o esmagamento.
  const boxesOf = layout.buildings.map(() => []);
  collision.boxes.forEach((b, i) => { if (b.breakable) boxesOf[b.building].push(i); });

  // Cada entrada de travessia é dano no andar em que o herói passou. O Planeta Diário fura,
  // mas não cai: o globo e o letreiro não acompanhariam.
  function onBreach(e) {
    if (!e.entry) return;
    const box = collision.boxes[e.box];
    const bi = box.building;
    if (bi === undefined || layout.buildings[bi].landmark) return;
    // Largura atravessada: a extensão do nível perpendicular ao caminho, na horizontal.
    const width = Math.abs(e.dir.x) > Math.abs(e.dir.z) ? box.maxZ - box.minZ : box.maxX - box.minX;
    const cut = damage.hit(bi, e.at.y, width, e.speed);
    if (cut !== null) start(bi, Math.max(cut, RUBBLE));
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

  function start(bi, cut) {
    const b = layout.buildings[bi];
    const part = city.makePart(bi, cut);
    scene.add(part);
    part.updateMatrixWorld();
    city.setTop(bi, cut);
    lowerBoxes(bi, cut);
    // Os objetos de telhado caem junto com o bloco: guarda a matriz original de cada um.
    const props = (city.roofProps(bi) ?? []).map(({ mesh, i }) => {
      const m0 = new THREE.Matrix4();
      mesh.getMatrixAt(i, m0);
      return { mesh, i, m0 };
    });
    clearMarks(footprint(bi, cut));
    const axis = new THREE.Vector3(Math.random() - 0.5, 0, Math.random() - 0.5).normalize();
    active.push({ bi, cut, part, props, axis, baseInv: part.matrixWorld.clone().invert(), height: b.h - cut, v: 0, drop: 0, t: 0, puff: 0 });
    events.push({ type: 'collapse', at: new THREE.Vector3(b.x, cut, b.z), height: b.h - cut });
  }

  // Poeira e entulho saindo pelos lados na linha de esmagamento, mais forte quanto mais rápido.
  function crushFx(c, y) {
    const t = layout.buildings[c.bi].tiers[0];
    for (let k = 0; k < 2; k++) {
      const [nx, nz] = SIDES[(Math.random() * 4) | 0];
      const u = Math.random() - 0.5;
      const x = t.x + nx * (t.w / 2 + 1) + (nz !== 0 ? u * t.w : 0);
      const z = t.z + nz * (t.d / 2 + 1) + (nx !== 0 ? u * t.d : 0);
      fx.puff(x, y, z, nx * 4, 1, nz * 4, 22 + Math.random() * 14, 6, 0.7);
      fx.burst(x, y, z, nx * (6 + c.v * 0.3), -2, nz * (6 + c.v * 0.3), 4, 3, 1.4);
    }
  }

  function update(dt) {
    for (let k = active.length - 1; k >= 0; k--) {
      const c = active[k];
      c.t += dt;
      c.v += FALL_G * dt;
      c.drop += c.v * dt;
      const bottom = c.cut - c.drop; // base do bloco que cai
      const crush = Math.max(RUBBLE, Math.min(c.cut, bottom));
      city.setTop(c.bi, crush);
      lowerBoxes(c.bi, crush);
      c.part.position.y = bottom;
      c.part.quaternion.setFromAxisAngle(c.axis, Math.min(MAX_TILT, c.t * TILT_RATE));
      c.part.updateMatrixWorld();
      delta.multiplyMatrices(c.part.matrixWorld, c.baseInv);
      for (const p of c.props) {
        p.mesh.setMatrixAt(p.i, m.multiplyMatrices(delta, p.m0));
        p.mesh.instanceMatrix.needsUpdate = true;
      }
      if ((c.puff -= dt) <= 0 && bottom > RUBBLE - 2) {
        c.puff = 0.12;
        crushFx(c, crush);
      }
      // Fim quando o topo do bloco passou da rua: a laje opaca já o esconde.
      if (bottom + c.height < 0) {
        finish(c);
        active.splice(k, 1);
      }
    }
  }

  function finish(c) {
    scene.remove(c.part);
    c.part.traverse((o) => o.geometry?.dispose());
    for (const p of c.props) {
      p.mesh.setMatrixAt(p.i, zero);
      p.mesh.instanceMatrix.needsUpdate = true;
    }
    city.setTop(c.bi, RUBBLE);
    lowerBoxes(c.bi, RUBBLE);
    clearMarks(footprint(c.bi, RUBBLE));
    // Escombros: pedaços grandes que assentam sobre o toco, e a poeira que fica pairando.
    const t = layout.buildings[c.bi].tiers[0];
    fx.burst(t.x, RUBBLE + 2, t.z, 0, -1, 0, 70, Math.min(t.w, t.d) * 0.8, 2.6);
    for (let i = 0; i < 6; i++) fx.puff(t.x + (Math.random() - 0.5) * t.w, 4, t.z + (Math.random() - 0.5) * t.d, 0, 0.5, 0, 35, 9, 0.75);
    events.push({ type: 'rubble', at: new THREE.Vector3(t.x, RUBBLE, t.z), height: 0 });
  }

  return {
    onBreach,
    update,
    events,
    isCollapsed: damage.isCollapsed,
    get active() { return active.length; },
  };
}
