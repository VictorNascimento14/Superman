import { Vector3, Quaternion, Matrix4, MathUtils } from 'three';

// Física de voo. Só usa as classes de matemática do three (rodam no Node sem DOM),
// por isso é testada em tests/flight.test.js.
export const FLIGHT = {
  radius: 0.9,
  walk: 8,
  cruise: 48,
  boost: 150,
  supersonic: 420,
  sound: 340, // velocidade do som: cruzar dispara o estrondo
  steer: { cruise: 2.2, boost: 1.4, supersonic: 0.9 },
  hoverDamp: 2.8,
  supersonicAfter: 1.2, // segundos segurando boost em linha reta
  impactSpeed: 70,
  footDepth: 1.04, // pélvis → sola do modelo em pé (hero.js monta as pernas para bater com isto)
};

// Atravessar prédio, voando: bater com pelo menos `speed` m/s para dentro da parede fura em
// vez de parar. Quebrar a fachada custa `entry`; cada metro de prédio, `perMeter` por m/s.
// Lá dentro a velocidade não cai abaixo de `min`: quem entrou sai do outro lado.
export const SMASH = { speed: 30, entry: 6, perMeter: 0.012, min: 10 };

const UP = new Vector3(0, 1, 0);

export function viewDirection(yaw, pitch, out = new Vector3()) {
  return out.set(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch));
}

export function createFlight(collision, spawn) {
  const s = {
    pos: new Vector3(spawn.x, spawn.y, spawn.z),
    vel: new Vector3(),
    yaw: spawn.yaw ?? 0,
    pitch: 0,
    mode: 'ground', // 'ground' | 'air'
    boostTime: 0,
    supersonic: false,
    speed: 0,
    pose: 'idle',
    walk: 0,
    events: [], // { type: 'sonicboom' | 'impact' | 'takeoff' | 'land', ... } — consumidos por quem desenha
    orientation: new Quaternion(),
  };
  // Vetores de trabalho: nada aloca no update (invariante 2).
  const dir = new Vector3();
  const right = new Vector3();
  const wish = new Vector3();
  const step = new Vector3();
  const n = new Vector3();
  const qUp = new Quaternion();
  const qFly = new Quaternion();
  const qBank = new Quaternion();
  const qTarget = new Quaternion();
  const m = new Matrix4();
  const bx = new Vector3();
  const by = new Vector3();
  const bz = new Vector3();
  let bank = 0;
  let lastYaw = s.yaw;

  const feetClearance = () => (s.mode === 'ground' ? FLIGHT.footDepth : FLIGHT.radius);

  // Caixas que o herói está atravessando agora (−1 = vaga): a colisão não as empurra até ele
  // sair do outro lado. Quatro vagas bastam: um nível e os vizinhos que ele pegar de raspão.
  const smashing = [-1, -1, -1, -1];
  let smashCount = 0;

  const setSpeed = (v) => {
    const sp = s.vel.length();
    if (sp > 1e-6) s.vel.multiplyScalar(v / sp);
  };

  function enterBuilding(idx, nx, ny, nz) {
    smashing[smashing.indexOf(-1)] = idx;
    smashCount++;
    const speed = s.vel.length();
    const b = collision.boxes[idx];
    s.events.push({
      type: 'breach', entry: true, box: idx, speed,
      // Ponto da caixa mais perto do centro: está na fachada (centro − normal·raio ficaria
      // dentro da parede quando a esfera já entrou um pouco).
      at: new Vector3(MathUtils.clamp(s.pos.x, b.minX, b.maxX), MathUtils.clamp(s.pos.y, b.minY, b.maxY), MathUtils.clamp(s.pos.z, b.minZ, b.maxZ)),
      normal: new Vector3(nx, ny, nz), dir: s.vel.clone().divideScalar(speed),
    });
    setSpeed(Math.max(SMASH.min, speed - SMASH.entry));
  }

  // A cada subpasso: quem ainda está dentro perde velocidade pelo caminho; quem saiu deixa o
  // furo de saída no ponto da caixa mais perto do centro — a face por onde passou.
  function traverse(h) {
    for (let k = 0; k < smashing.length; k++) {
      const idx = smashing[k];
      if (idx < 0) continue;
      const b = collision.boxes[idx];
      const cx = MathUtils.clamp(s.pos.x, b.minX, b.maxX);
      const cy = MathUtils.clamp(s.pos.y, b.minY, b.maxY);
      const cz = MathUtils.clamp(s.pos.z, b.minZ, b.maxZ);
      const dx = s.pos.x - cx;
      const dy = s.pos.y - cy;
      const dz = s.pos.z - cz;
      const d2 = dx * dx + dy * dy + dz * dz;
      const speed = s.vel.length();
      if (d2 < FLIGHT.radius * FLIGHT.radius) {
        // Cada metro custa perMeter × v: a 420 m/s o prédio freia mais que a 50.
        setSpeed(Math.max(SMASH.min, speed - SMASH.perMeter * speed * speed * h));
        continue;
      }
      smashing[k] = -1;
      smashCount--;
      const d = Math.sqrt(d2);
      s.events.push({
        type: 'breach', entry: false, box: idx, speed,
        at: new Vector3(cx, cy, cz), normal: new Vector3(dx / d, dy / d, dz / d), dir: s.vel.clone().divideScalar(speed || 1),
      });
    }
  }

  // Tira a componente da velocidade que entra em cada superfície tocada, uma de cada vez
  // (ver resolveSphere): cortar contra a soma normalizada de chão + parede convertia
  // metade da velocidade horizontal em subida. Voando rápido contra um prédio, fura.
  let hitSpeed = 0;
  const clip = (nx, ny, nz, idx) => {
    const into = s.vel.x * nx + s.vel.y * ny + s.vel.z * nz;
    if (into >= 0) return;
    if (-into >= SMASH.speed && s.mode === 'air' && idx >= 0 && collision.boxes[idx].breakable && smashCount < smashing.length) {
      enterBuilding(idx, nx, ny, nz);
      return true; // atravessável: a colisão não empurra
    }
    hitSpeed = Math.max(hitSpeed, -into);
    s.vel.x -= nx * into;
    s.vel.y -= ny * into;
    s.vel.z -= nz * into;
  };

  function move(dt) {
    // Subdivide o passo para a esfera nunca andar mais que ~0,8 m sem checar parede.
    const dist = s.vel.length() * dt;
    const steps = Math.min(60, Math.max(1, Math.ceil(dist / 0.8)));
    step.copy(s.vel).multiplyScalar(dt / steps);
    hitSpeed = 0;
    for (let i = 0; i < steps; i++) {
      s.pos.add(step);
      // Colide como esfera centrada na pélvis; em pé, a esfera "desce" até os pés.
      const lift = feetClearance() - FLIGHT.radius;
      s.pos.y -= lift;
      collision.resolveSphere(s.pos, FLIGHT.radius, n, clip, smashing);
      s.pos.y += lift;
      if (smashCount) traverse(dt / steps);
      step.copy(s.vel).multiplyScalar(dt / steps);
    }
    if (hitSpeed > FLIGHT.impactSpeed) s.events.push({ type: 'impact', speed: hitSpeed, at: s.pos.clone() });
  }

  function groundHeight() {
    return collision.heightAt(s.pos.x, s.pos.z);
  }

  // input: { forward, right, up: -1..1, boost: bool, jump: bool (borda) }
  function update(dt, input) {
    const before = s.vel.length();
    viewDirection(s.yaw, s.pitch, dir);
    right.set(-Math.cos(s.yaw), 0, Math.sin(s.yaw));

    if (s.mode === 'ground') {
      // Anda em relação ao yaw da câmera; pular decola.
      wish.set(Math.sin(s.yaw), 0, Math.cos(s.yaw)).multiplyScalar(input.forward).addScaledVector(right, input.right);
      if (wish.lengthSq() > 1) wish.normalize();
      wish.multiplyScalar(FLIGHT.walk * (input.boost ? 1.8 : 1));
      const k = 1 - Math.exp(-dt * 10);
      s.vel.x += (wish.x - s.vel.x) * k;
      s.vel.z += (wish.z - s.vel.z) * k;
      s.vel.y = 0;
      if (input.jump || input.up > 0) {
        s.mode = 'air';
        s.vel.y = 14;
        s.events.push({ type: 'takeoff' });
      }
      move(dt);
      const g = groundHeight();
      if (s.mode === 'ground') {
        // Saiu da beirada do telhado: começa a voar em vez de cair.
        if (s.pos.y - FLIGHT.footDepth > g + 0.5) s.mode = 'air';
        else s.pos.y = g + FLIGHT.footDepth;
      }
    } else {
      const thrust = Math.abs(input.forward) + Math.abs(input.right) + Math.abs(input.up) > 0;
      s.boostTime = input.boost && input.forward > 0 ? s.boostTime + dt : 0;
      const wasSuper = s.supersonic;
      s.supersonic = s.boostTime > FLIGHT.supersonicAfter;
      const tier = s.supersonic ? 'supersonic' : input.boost ? 'boost' : 'cruise';
      if (thrust) {
        wish.copy(dir).multiplyScalar(input.forward).addScaledVector(right, input.right).addScaledVector(UP, input.up);
        if (wish.lengthSq() > 1) wish.normalize();
        wish.multiplyScalar(FLIGHT[tier]);
        const k = 1 - Math.exp(-dt * FLIGHT.steer[tier]);
        s.vel.lerp(wish, k);
      } else {
        s.vel.multiplyScalar(Math.exp(-dt * FLIGHT.hoverDamp)); // pairar: o herói freia sozinho
      }
      move(dt);
      if (!wasSuper && s.supersonic) s.events.push({ type: 'supersonic' });
      if (before < FLIGHT.sound && s.vel.length() >= FLIGHT.sound) s.events.push({ type: 'sonicboom', at: s.pos.clone() });
      // Pouso: encostou no chão/telhado devagar, sem estar subindo.
      const g = groundHeight();
      // Dentro de um prédio o "chão" de heightAt é o telhado dele: pousar ali teleportava.
      if (smashCount === 0 && s.pos.y - FLIGHT.radius <= g + 0.15 && s.vel.length() < 18 && input.up <= 0 && s.vel.y <= 0.5) {
        s.mode = 'ground';
        s.pos.y = g + FLIGHT.footDepth;
        s.vel.y = 0;
        s.supersonic = false;
        s.events.push({ type: 'land' });
      }
    }
    s.speed = s.vel.length();
    updatePose(dt);
    updateOrientation(dt);
  }

  function updatePose() {
    if (s.mode === 'ground') {
      const horiz = Math.hypot(s.vel.x, s.vel.z);
      s.walk = Math.min(1, horiz / FLIGHT.walk);
      s.pose = 'idle';
    } else {
      s.walk = 0;
      s.pose = s.speed < 10 ? 'hover' : s.speed > FLIGHT.cruise * 1.3 ? 'flyFast' : 'fly';
    }
  }

  function updateOrientation(dt) {
    // De pé: cabeça para cima, peito para onde anda (ou para onde a câmera olha).
    const horiz = Math.hypot(s.vel.x, s.vel.z);
    const faceYaw = s.mode === 'ground' && horiz > 0.5 ? Math.atan2(s.vel.x, s.vel.z) : s.yaw;
    by.copy(UP);
    bz.set(Math.sin(faceYaw), 0, Math.cos(faceYaw));
    bx.crossVectors(by, bz);
    qUp.setFromRotationMatrix(m.makeBasis(bx, by, bz));
    // Voando rápido: cabeça na direção da velocidade, peito para baixo, inclinado na curva.
    const yawRate = MathUtils.euclideanModulo(s.yaw - lastYaw + Math.PI, Math.PI * 2) - Math.PI;
    lastYaw = s.yaw;
    bank += (MathUtils.clamp((yawRate / Math.max(dt, 1e-4)) * 0.35, -1.1, 1.1) - bank) * (1 - Math.exp(-dt * 4));
    let f = 0;
    if (s.mode === 'air' && s.speed > 1e-3) {
      f = MathUtils.smoothstep(s.speed, 8, 24);
      by.copy(s.vel).divideScalar(s.speed);
      bz.set(0, -1, 0).addScaledVector(by, by.y); // "para baixo" perpendicular ao voo
      if (bz.lengthSq() < 1e-4) bz.set(Math.sin(s.yaw), 0, Math.cos(s.yaw)).multiplyScalar(by.y > 0 ? 1 : -1);
      bz.normalize();
      bx.crossVectors(by, bz);
      qFly.setFromRotationMatrix(m.makeBasis(bx, by, bz));
      qFly.multiply(qBank.setFromAxisAngle(UP, -bank)); // rolagem em torno do eixo do corpo
    }
    qTarget.copy(qUp);
    if (f > 0) qTarget.slerp(qFly, f);
    s.orientation.slerp(qTarget, 1 - Math.exp(-dt * 8));
  }

  updateOrientation(10); // já nasce virado para o yaw inicial, mesmo com o jogo pausado
  return Object.assign(s, { update });
}
