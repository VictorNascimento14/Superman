import { SUN } from '../space/bodies.js';

// Carga solar (lógica pura, testada). O Sol enche o herói pela lei do inverso do quadrado:
// rente à superfície, cheia em ~5 s; a ~7 raios do centro, o que entra só empata com o que
// sai. Longe dele a carga cai devagar — cheia, dura 4 minutos —, e a visão de calor carregada
// gasta mais. Com ela o herói voa mais rápido, fura prédios com mais força e a visão de calor
// vai mais longe e queima mais.
export const SOLAR = {
  fill: 0.2, // por segundo, com o fluxo da superfície do Sol
  drain: 1 / 240, // por segundo, sempre
  beam: 1 / 45, // por segundo a mais, disparando a visão de calor
  speed: 1.5, // voo: velocidade × (1 + 1,5 × carga)
  force: 2, // contra prédio: força × (1 + 2 × carga)
  range: 5, // visão de calor: alcance × (1 + 5 × carga)
  power: 4, // visão de calor: dano × (1 + 4 × carga)
};

// Fluxo do Sol a `dist` m do centro dele, em "superfícies do Sol" (1 rente a ela, 2·10⁻⁵ na
// Terra), vezes a parte do disco que chega (`lit`, do eclipse).
export const solarFlux = (dist, lit) => Math.min(1, (SUN.radius / dist) ** 2) * lit;

export function createSolar() {
  const s = { charge: 0 };
  // Devolve 'full' ao encher e 'empty' ao acabar (para o aviso na tela), senão null.
  s.update = (dt, flux, firing) => {
    const was = s.charge;
    const rate = SOLAR.fill * flux - SOLAR.drain - (firing ? SOLAR.beam : 0);
    s.charge = Math.min(1, Math.max(0, s.charge + rate * dt));
    if (was < 1 && s.charge === 1) return 'full';
    if (was > 0 && s.charge === 0) return 'empty';
    return null;
  };
  return s;
}
