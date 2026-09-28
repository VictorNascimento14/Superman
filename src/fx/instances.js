// Esconde (escala zero) as instâncias cuja posição cai dentro da caixa: furos e marcas de
// queimado que ficariam no ar quando o prédio em que estavam desaba.
export function hideInstancesIn(mesh, box) {
  const e = mesh.instanceMatrix.array;
  let hidden = 0;
  for (let i = 0; i < mesh.count; i++) {
    const o = i * 16;
    const x = e[o + 12];
    const y = e[o + 13];
    const z = e[o + 14];
    if (x < box.minX || x > box.maxX || y < box.minY || y > box.maxY || z < box.minZ || z > box.maxZ) continue;
    for (let k = 0; k < 12; k++) e[o + k] = 0; // base zerada: a instância some, a posição fica
    hidden++;
  }
  if (hidden) mesh.instanceMatrix.needsUpdate = true;
  return hidden;
}
