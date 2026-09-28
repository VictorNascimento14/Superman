// Dano estrutural dos prédios (lógica pura, testada). Cada travessia tira uma fração do
// andar na altura em que passou: o rombo (~6 m) sobre a largura do prédio atravessada, e
// mais quanto mais rápido. Quando a soma numa faixa de altura chega ao limite, tudo acima
// dela desaba. Passadas em alturas diferentes não somam: é o mesmo andar que precisa ceder.
// Golpe com força de supersônico (a velocidade vezes a carga solar) derruba de uma vez, em
// qualquer largura: escolha do jogador na fase 3.
export const DAMAGE = { hole: 6, band: 8, collapseAt: 0.5, speedRef: 200, topple: 340 };

export function createDamage() {
  const bands = new Map(); // prédio → Map(faixa → fração destruída)
  const collapsed = new Set();

  // width: largura do prédio perpendicular ao caminho. Devolve a altura do corte (base da
  // faixa que cedeu) quando o prédio desaba, senão null.
  function hit(building, y, width, speed) {
    if (collapsed.has(building)) return null;
    const frac = (DAMAGE.hole / Math.max(width, DAMAGE.hole)) * (1 + speed / DAMAGE.speedRef);
    const band = Math.max(0, Math.floor(y / DAMAGE.band));
    if (!bands.has(building)) bands.set(building, new Map());
    const b = bands.get(building);
    const total = (b.get(band) ?? 0) + frac;
    b.set(band, total);
    if (total < DAMAGE.collapseAt && speed < DAMAGE.topple) return null;
    collapsed.add(building);
    return band * DAMAGE.band;
  }

  return {
    hit,
    isCollapsed: (building) => collapsed.has(building),
    at: (building, y) => bands.get(building)?.get(Math.max(0, Math.floor(y / DAMAGE.band))) ?? 0,
  };
}
