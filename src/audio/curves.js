// Curvas do som (puras, testadas): quanto de vento e de cidade para cada estado.
const clamp01 = (v) => Math.max(0, Math.min(1, v));

// Vento: quase mudo parado, sobe com a velocidade; o filtro abre (fica mais agudo).
export function windFor(speed) {
  const k = clamp01(speed / 160);
  return { gain: 0.015 + 0.3 * k ** 1.4, freq: 250 + 1900 * k, q: 0.6 + k * 0.8 };
}

// Cidade: ruído grave que some com a altura (60 m já é outro mundo).
export function cityFor(heightAboveGround) {
  return { gain: 0.09 * (1 - clamp01(heightAboveGround / 60)) };
}
