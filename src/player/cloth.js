// Pano por dinâmica baseada em posição (PBD): integra velocidade, resolve restrições de
// distância e deriva a velocidade nova da posição. Estável com arrasto alto e passo
// grande, que é o que uma capa em supervelocidade exige. Lógica pura, sem three.

export function createCloth({ cols, rows, topWidth, bottomWidth, length }) {
  const n = cols * rows;
  const pos = new Float32Array(n * 3);
  const prev = new Float32Array(n * 3);
  const vel = new Float32Array(n * 3);
  const pinned = new Uint8Array(n);
  const cons = [];
  const at = (c, r) => r * cols + c;

  // Forma de repouso: trapézio pendurado (largura cresce de cima para baixo).
  const rest = new Float32Array(n * 3);
  for (let r = 0; r < rows; r++) {
    const w = topWidth + (bottomWidth - topWidth) * (r / (rows - 1));
    for (let c = 0; c < cols; c++) {
      const i = at(c, r) * 3;
      rest[i] = (c / (cols - 1) - 0.5) * w;
      rest[i + 1] = -(r / (rows - 1)) * length;
      rest[i + 2] = 0;
    }
  }
  const dist = (a, b) => Math.hypot(rest[a * 3] - rest[b * 3], rest[a * 3 + 1] - rest[b * 3 + 1], rest[a * 3 + 2] - rest[b * 3 + 2]);
  const link = (a, b, stiff) => cons.push([a, b, dist(a, b), stiff]);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (c + 1 < cols) link(at(c, r), at(c + 1, r), 1);
      if (r + 1 < rows) link(at(c, r), at(c, r + 1), 1);
      if (c + 1 < cols && r + 1 < rows) {
        link(at(c, r), at(c + 1, r + 1), 0.6);
        link(at(c + 1, r), at(c, r + 1), 0.6);
      }
      if (r + 2 < rows) link(at(c, r), at(c, r + 2), 0.25); // flexão: segura o caimento
    }
  }
  for (let c = 0; c < cols; c++) pinned[at(c, 0)] = 1;

  // Coloca o pano inteiro na forma de repouso, transladado para `origin`.
  function reset(origin) {
    for (let i = 0; i < n; i++) {
      pos[i * 3] = rest[i * 3] + origin.x;
      pos[i * 3 + 1] = rest[i * 3 + 1] + origin.y;
      pos[i * 3 + 2] = rest[i * 3 + 2] + origin.z;
      vel[i * 3] = vel[i * 3 + 1] = vel[i * 3 + 2] = 0;
    }
    prev.set(pos);
  }

  function setPin(c, x, y, z) {
    const i = at(c, 0) * 3;
    pos[i] = x; pos[i + 1] = y; pos[i + 2] = z;
  }

  // air = velocidade do ar (m/s); drag = 1/s; collide(p3, i) empurra partícula para fora do corpo.
  function step(dt, gravity, air, drag, iterations, collide) {
    const k = Math.exp(-drag * dt);
    for (let i = 0; i < n; i++) {
      if (pinned[i]) continue;
      const o = i * 3;
      for (let a = 0; a < 3; a++) {
        let v = vel[o + a] + gravity[a] * dt;
        v = air[a] + (v - air[a]) * k;
        prev[o + a] = pos[o + a];
        pos[o + a] += v * dt;
      }
    }
    for (let it = 0; it < iterations; it++) {
      for (const [a, b, len, stiff] of cons) {
        const ia = a * 3;
        const ib = b * 3;
        const dx = pos[ib] - pos[ia];
        const dy = pos[ib + 1] - pos[ia + 1];
        const dz = pos[ib + 2] - pos[ia + 2];
        const d = Math.hypot(dx, dy, dz) || 1e-9;
        const wa = pinned[a] ? 0 : 1;
        const wb = pinned[b] ? 0 : 1;
        if (wa + wb === 0) continue;
        const diff = ((d - len) / d / (wa + wb)) * stiff;
        pos[ia] += dx * diff * wa; pos[ia + 1] += dy * diff * wa; pos[ia + 2] += dz * diff * wa;
        pos[ib] -= dx * diff * wb; pos[ib + 1] -= dy * diff * wb; pos[ib + 2] -= dz * diff * wb;
      }
      if (collide) for (let i = 0; i < n; i++) if (!pinned[i]) collide(pos, i * 3);
    }
    for (let i = 0; i < n; i++) {
      if (pinned[i]) continue;
      const o = i * 3;
      vel[o] = (pos[o] - prev[o]) / dt;
      vel[o + 1] = (pos[o + 1] - prev[o + 1]) / dt;
      vel[o + 2] = (pos[o + 2] - prev[o + 2]) / dt;
    }
  }

  return { cols, rows, pos, vel, pinned, reset, setPin, step, at };
}
