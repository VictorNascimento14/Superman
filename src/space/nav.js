// Navegação em escala real (lógica pura, testada). A cidade é um recorte plano sobre a Terra:
// o referencial da cidade (metros, y para cima, origem no centro da ilha) é o geocêntrico
// transladado, e o centro da Terra fica em (0, −R, 0). Voar reto para longe já é física
// certa; só a altitude precisa ser medida até a esfera.
export const EARTH = { radius: 6.371e6 };

export const SPACE = {
  from: 20e3, // acima desta altitude, o boost vira hipervelocidade
  hyper: 1.2, // hipervelocidade: alvo = hyper × altitude (1/s)
  cap: 2.5, // teto duro em qualquer altitude: v ≤ cap × altitude — chega sem atravessar
  flatRadius: 60e3, // o mundo plano (a cidade e o mar em volta), medido na superfície...
  floor: 30e3, // ...fora dele não se desce abaixo desta altitude: só Metrópolis tem chão
  near: 3e3, // abaixo desta altitude, perto da cidade, vale a colisão com a cidade
};

export function altitude(p) {
  const dy = p.y + EARTH.radius;
  return Math.sqrt(p.x * p.x + dy * dy + p.z * p.z) - EARTH.radius;
}

// Distância da cidade medida sobre a superfície (arco de círculo máximo).
export function fromCity(p) {
  return Math.atan2(Math.sqrt(p.x * p.x + p.z * p.z), p.y + EARTH.radius) * EARTH.radius;
}

// Perto da cidade vale o mundo plano: colisão com prédios e chão, pouso.
export function nearCity(p) {
  return altitude(p) < SPACE.near && fromCity(p) < SPACE.flatRadius;
}

// Vertical local (radial) no ponto p, gravada em `out`.
export function upAt(p, out) {
  const dy = p.y + EARTH.radius;
  const l = Math.sqrt(p.x * p.x + dy * dy + p.z * p.z) || 1;
  out.x = p.x / l;
  out.y = dy / l;
  out.z = p.z / l;
  return out;
}

// Teto de velocidade: perto do chão vale o voo de sempre (`floorSpeed`); no espaço,
// proporcional à altitude.
export function speedCap(alt, floorSpeed) {
  return Math.max(floorSpeed, SPACE.cap * alt);
}

// Só a Terra: o voo usa isto até o sistema solar ser montado (e nos testes da cidade).
// O piso dela (fora do mundo plano da cidade) é SPACE.floor.
export const EARTH_ONLY = [{ name: 'TERRA', x: 0, y: -EARTH.radius, z: 0, radius: EARTH.radius, floor: SPACE.floor }];

// Corpo com a superfície mais perto de p: grava o índice em out.i e a distância em out.d.
// É ele que comanda a hipervelocidade, o teto e o piso — chegar a qualquer planeta é suave.
export function nearestSurface(bodies, p, out) {
  out.i = -1;
  out.d = Infinity;
  for (let i = 0; i < bodies.length; i++) {
    const b = bodies[i];
    const dx = p.x - b.x;
    const dy = p.y - b.y;
    const dz = p.z - b.z;
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz) - b.radius;
    if (d < out.d) {
      out.d = d;
      out.i = i;
    }
  }
  return out;
}
