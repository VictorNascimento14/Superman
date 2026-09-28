// Autopiloto injetado na página: joga como um jogador — mira, voa, desvia subindo,
// pega quem cai, pousa e mira os drones PELO CENTRO DA TELA (a mira de verdade).
// Roda no navegador; não importa nada.
(() => {
  const g = window.__game;
  const hit = {};
  const head = (t) => {
    const p = g.flight.pos;
    const dx = t.x - p.x;
    const dy = t.y - p.y;
    const dz = t.z - p.z;
    const L = Math.hypot(dx, dy, dz);
    g.flight.yaw = Math.atan2(dx, dz);
    g.flight.pitch = Math.atan2(dy, Math.hypot(dx, dz));
    // Parede no caminho: sobe (o anel/alvo está acima dos telhados).
    if (g.collision.raycast(p, { x: dx / L, y: dy / L, z: dz / L }, Math.min(L, 80), hit)) g.flight.pitch = 1.2;
    return L;
  };
  const takeoff = () => g.flight.mode === 'ground';
  g.start();
  const loop = setInterval(() => {
    const m = g.missions.current;
    g.heat(false);
    if (!m) return g.autopilot({ jump: takeoff() });
    if (m.type === 'aneis') {
      head(m.course[m.next]);
      return g.autopilot({ forward: 1, jump: takeoff() });
    }
    if (m.type === 'resgate') {
      if (m.f.state === 'caught') {
        g.flight.pitch = -1.3;
        return g.autopilot({ forward: 1, up: -1 });
      }
      const L = head(m.f);
      return g.autopilot({ forward: 1, boost: L > 150, jump: takeoff() });
    }
    const alive = m.drones.filter((d) => d.hp > 0);
    alive.sort((a, b) => a.pos.distanceTo(g.flight.pos) - b.pos.distanceTo(g.flight.pos));
    const d = alive[0];
    if (!d) return undefined;
    const L = d.pos.distanceTo(g.flight.pos);
    if (L > 50) {
      head(d.pos);
      return g.autopilot({ forward: 1, boost: L > 150, jump: takeoff() });
    }
    // Controle proporcional sobre o erro entre o centro da câmera e o drone.
    const c = g.camera.position;
    const f = g.camera.getWorldDirection(c.clone());
    const to = d.pos.clone().sub(c).normalize();
    const yawErr = Math.atan2(to.x, to.z) - Math.atan2(f.x, f.z);
    g.flight.yaw += Math.atan2(Math.sin(yawErr), Math.cos(yawErr)) * 0.8;
    g.flight.pitch = Math.max(-1.4, Math.min(1.4, g.flight.pitch + (Math.asin(to.y) - Math.asin(f.y)) * 0.8));
    g.autopilot({});
    g.heat(true);
    return undefined;
  }, 40);
  window.__autopilotStop = () => clearInterval(loop); // cenários depois das missões
})();
