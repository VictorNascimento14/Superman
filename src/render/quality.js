// Presets de qualidade. O médio é o alvo de 60 fps em GPU integrada (invariante 1).
export const QUALITY = {
  baixa: { pixelRatio: 0.75, shadowMapSize: 1024, shadows: true, bloom: false, smaa: false, viewDistance: 1400 },
  media: { pixelRatio: 1, shadowMapSize: 2048, shadows: true, bloom: true, smaa: true, viewDistance: 2200 },
  alta: { pixelRatio: 1.5, shadowMapSize: 4096, shadows: true, bloom: true, smaa: true, viewDistance: 3200 },
};

const ORDER = ['baixa', 'media', 'alta'];

// ?q=baixa|media|alta força o preset; senão, média (ou baixa em tela de toque).
export function pickQuality(search = globalThis.location?.search ?? '') {
  const q = new URLSearchParams(search).get('q');
  if (q && QUALITY[q]) return q;
  const touch = globalThis.matchMedia?.('(pointer: coarse)').matches;
  return touch ? 'baixa' : 'media';
}

export function nextQuality(name) {
  return ORDER[(ORDER.indexOf(name) + 1) % ORDER.length];
}
