// Ponta a ponta: builda, serve o dist, abre o Chrome headless e deixa o autopiloto
// cumprir as três missões. Falha se o console tiver erro ou se algum dos três tipos
// (anéis, resgate, drones) não tiver ao menos uma vitória.
//   npm run e2e                       (Chrome em /usr/bin/google-chrome)
//   CHROME_PATH=/caminho npm run e2e
import { readFile, mkdir } from 'node:fs/promises';
import { build, preview } from 'vite';
import puppeteer from 'puppeteer-core';

const CHROME = process.env.CHROME_PATH || '/usr/bin/google-chrome';
const LIMIT_S = 240;
const OUT = 'e2e-out';

await build({ logLevel: 'warn' });
const server = await preview({ preview: { port: 4174, host: '127.0.0.1' }, logLevel: 'warn' });
const url = server.resolvedUrls.local[0];
const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: ['--use-angle=vulkan', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader', '--window-size=1280,720'],
});
let failed = false;
try {
  await mkdir(OUT, { recursive: true });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 720 });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__game, { timeout: 30000 });
  await page.evaluate(await readFile(new URL('./autopilot.js', import.meta.url), 'utf8'));

  const seen = new Set();
  const t0 = Date.now();
  let state;
  while ((Date.now() - t0) / 1000 < LIMIT_S) {
    await new Promise((r) => setTimeout(r, 2000));
    state = await page.evaluate(() => ({ type: window.__game.missions.current?.type ?? null, doneBy: window.__game.missions.doneBy, score: window.__game.missions.score }));
    if (state.type && !seen.has(state.type)) {
      seen.add(state.type);
      await new Promise((r) => setTimeout(r, 1500));
      await page.screenshot({ path: `${OUT}/${state.type}.png` });
    }
    const { aneis, resgate, drones } = state.doneBy;
    console.log(`${Math.round((Date.now() - t0) / 1000)}s  missão=${state.type ?? '—'}  cumpridas: anéis ${aneis} · resgate ${resgate} · drones ${drones}  pontos=${state.score}`);
    // Três vitórias de qualquer tipo não bastam: um resgate quebrado passaria com anéis de novo.
    if (aneis && resgate && drones) break;
  }
  // Cenários de destruição. O alvo: uma face de prédio com rua livre a 12 m e o raio de volta
  // batendo nela (a 40 m o ponto já cai no quarteirão vizinho).
  await page.evaluate(() => {
    window.__autopilotStop();
    // Prédio intacto (sem desabar e sem dano na altura do voo), com a largura atravessada
    // entre minWidth e maxWidth.
    window.__launch = (maxWidth, speed, minWidth = 0) => {
      const g = window.__game;
      const hit = {};
      for (const [bi, b] of g.layout.buildings.entries()) {
        if (b.landmark || b.h < 60 || g.collapses.isCollapsed(bi) || g.collapses.damageAt(bi, 30) > 0) continue;
        const t = b.tiers[0];
        for (const [nx, nz, yaw] of [[0, -1, 0], [0, 1, Math.PI], [-1, 0, Math.PI / 2], [1, 0, -Math.PI / 2]]) {
          const width = nx ? t.d : t.w;
          if (width > maxWidth || width < minWidth) continue;
          const start = nx ? { x: t.x + nx * (t.w / 2 + 12), y: 30, z: t.z } : { x: t.x, y: 30, z: t.z + nz * (t.d / 2 + 12) };
          if (g.collision.heightAt(start.x, start.z) > 0.01) continue;
          if (!g.collision.raycast(start, { x: -nx, y: 0, z: -nz }, 20, hit) || g.collision.boxes[hit.box].building !== bi) continue;
          g.flight.mode = 'air';
          g.flight.pos.set(start.x, start.y, start.z);
          g.flight.yaw = yaw;
          g.flight.pitch = 0;
          g.flight.vel.set(-nx * speed, 0, -nz * speed);
          g.autopilot({ forward: 1, boost: speed > 150 });
          // "Do outro lado": além da face oposta, na direção do voo.
          const far = nx ? t.x - nx * t.w / 2 : t.z - nz * t.d / 2;
          return { bi, width, passed: () => (nx ? (far - g.flight.pos.x) * nx : (far - g.flight.pos.z) * nz) > 0 };
        }
      }
      return null;
    };
  });
  // Atravessar: a 150 m/s contra a fachada, o herói fura, sai do outro lado e deixa entrada,
  // saída e entulho.
  const smash = await page.evaluate(() => new Promise((resolve) => {
    const g = window.__game;
    const before = g.destruction.stats();
    const blasts = g.explosions.stats().blasts;
    const shot = window.__launch(Infinity, 150);
    let fire = 0;
    setTimeout(() => { fire = g.explosions.stats().fire; }, 250);
    setTimeout(() => {
      const after = g.destruction.stats();
      const inside = g.interiors.stats();
      const boom = g.explosions.stats();
      resolve({
        bi: shot.bi, breaches: after.breaches - before.breaches, debris: after.debris - before.debris, passed: shot.passed(),
        interior: inside.active.includes(shot.bi), broken: inside.broken, open: g.openings.list.filter((o) => o.building === shot.bi).length,
        blasts: boom.blasts - blasts, fire, smoke: boom.smoke,
      });
    }, 1200);
  }));
  console.log(`atravessar: ${smash.breaches} rupturas, ${smash.debris} pedaços de entulho, passou: ${smash.passed}; interior montado: ${smash.interior}, ${smash.broken} peças quebradas lá dentro, ${smash.open} furos abertos`);
  if (smash.breaches < 2 || smash.debris < 10 || !smash.passed) { console.error('Atravessar prédio falhou.'); failed = true; }
  if (!smash.interior || smash.broken < 1 || smash.open < 2) { console.error('Interior do prédio falhou.'); failed = true; }
  console.log(`explosão: ${smash.blasts} explosões, ${smash.fire} partículas de fogo no ar logo depois, ${smash.smoke} de fumaça depois de 1,2 s`);
  if (smash.blasts < 2 || smash.fire < 10 || smash.smoke < 10) { console.error('Explosão falhou.'); failed = true; }
  // Desabar: supersônico num prédio estreito, uma passada basta; a parte de cima cai e sobra
  // o toco (teto da colisão na altura dos escombros).
  const fall = await page.evaluate(() => new Promise((resolve) => {
    const g = window.__game;
    const shot = window.__launch(34, 420);
    setTimeout(() => {
      const tops = g.collision.boxes.filter((b) => b.building === shot.bi).map((b) => b.maxY);
      resolve({ collapsed: g.collapses.isCollapsed(shot.bi), active: g.collapses.active, top: Math.max(...tops) });
    }, 12000);
  }));
  console.log(`desabar: desabou ${fall.collapsed}, em andamento ${fall.active}, teto ${fall.top.toFixed(1)} m`);
  if (!fall.collapsed || fall.active || fall.top > 3.01) { console.error('Desabamento falhou.'); failed = true; }
  // Supersônico derruba qualquer prédio, mesmo largo, e a parte de cima se parte em segmentos
  // no ar; a 150 m/s, um prédio largo não cai, mas os andares em volta do furo cedem.
  const wide = await page.evaluate(() => new Promise((resolve) => {
    const g = window.__game;
    const shot = window.__launch(Infinity, 420, 60);
    setTimeout(() => resolve({ width: shot.width, collapsed: g.collapses.isCollapsed(shot.bi), segments: g.collapses.segments }), 1800);
  }));
  console.log(`derrubar largo: prédio de ${wide.width.toFixed(0)} m a 420 m/s desabou ${wide.collapsed}, ${wide.segments} segmentos caindo`);
  if (!wide.collapsed || wide.segments < 2) { console.error('Derrubar prédio largo falhou.'); failed = true; }
  const cede = await page.evaluate(() => new Promise((resolve) => {
    const g = window.__game;
    const before = g.collapses.ceded;
    const shot = window.__launch(Infinity, 150, 60);
    setTimeout(() => resolve({ width: shot.width, collapsed: g.collapses.isCollapsed(shot.bi), ceded: g.collapses.ceded - before }), 2000);
  }));
  await page.screenshot({ path: `${OUT}/ceder.png` });
  console.log(`ceder: prédio de ${cede.width.toFixed(0)} m a 150 m/s desabou ${cede.collapsed}; andares cederam em ${cede.ceded} furos`);
  if (cede.collapsed || cede.ceded < 1) { console.error('Ceder em volta do furo falhou.'); failed = true; }
  // Origem flutuante: a 5·10⁸ m da cidade, a câmera fica perto da origem de render (a GPU
  // trabalha em float32) e nada quebra.
  const far = await page.evaluate(() => new Promise((resolve) => {
    const g = window.__game;
    g.autopilot({});
    g.heat(true);
    g.flight.mode = 'air';
    g.flight.vel.set(0, 0, 0);
    g.flight.pos.set(5e8, 300, -2e8);
    setTimeout(() => resolve(g.camera.getWorldPosition(g.flight.pos.clone()).length()), 1000);
  }));
  await page.screenshot({ path: `${OUT}/longe.png` });
  console.log(`origem flutuante: câmera a ${far.toFixed(1)} m da origem de render, a 5·10⁸ m da cidade`);
  if (far > 100) { console.error('Origem flutuante falhou.'); failed = true; }
  // Espaço: de 25 km, subindo na vertical com boost, em 8 s passa de 1.000 km (hipervelocidade)
  // e a Terra aparece; descendo na vertical (C + boost), em 15 s volta para perto da cidade.
  const up = await page.evaluate(() => new Promise((resolve) => {
    const g = window.__game;
    g.heat(false);
    g.flight.mode = 'air';
    g.flight.vel.set(0, 0, 0);
    g.flight.pos.set(0, 25e3, 0);
    g.flight.pitch = -1.2; // olhando para a Terra
    g.autopilot({ up: 1, boost: true });
    setTimeout(() => resolve(g.flight.altitude), 8000);
  }));
  await page.screenshot({ path: `${OUT}/espaco.png` });
  const down = await page.evaluate(() => new Promise((resolve) => {
    window.__game.autopilot({ up: -1, boost: true });
    setTimeout(() => resolve(window.__game.flight.altitude), 15000);
  }));
  console.log(`espaço: subiu a ${Math.round(up / 1000)} km em 8 s; desceu a ${Math.round(down)} m em 15 s`);
  if (up < 1e6 || down > 5000) { console.error('Ida e volta ao espaço falhou.'); failed = true; }
  // Sistema solar: de 20.000 km, mirando o Sol com boost, chega a menos de 100.000 km da
  // superfície dele (a velocidade acompanha a distância do corpo mais perto).
  const trip = await page.evaluate(() => new Promise((resolve) => {
    const g = window.__game;
    const sun = g.flight.bodies[1];
    g.flight.mode = 'air';
    g.flight.vel.set(0, 0, 0);
    g.flight.pos.set(0, 2e7, 0);
    const dx = sun.x - g.flight.pos.x;
    const dy = sun.y - g.flight.pos.y;
    const dz = sun.z - g.flight.pos.z;
    g.flight.yaw = Math.atan2(dx, dz);
    g.flight.pitch = Math.asin(dy / Math.hypot(dx, dy, dz));
    g.autopilot({ forward: 1, boost: true });
    const t0 = performance.now();
    const check = setInterval(() => {
      const near = g.flight.nearest;
      const s = (performance.now() - t0) / 1000;
      if ((near.i === 1 && near.d < 1e8) || s > 45) {
        clearInterval(check);
        g.autopilot({});
        resolve({ s, body: g.flight.bodies[near.i].name, d: near.d });
      }
    }, 100);
  }));
  await page.screenshot({ path: `${OUT}/sol.png` });
  console.log(`sistema solar: ${trip.body} a ${Math.round(trip.d / 1000)} km da superfície em ${trip.s.toFixed(1)} s`);
  if (trip.body !== 'SOL' || trip.d > 1e8) { console.error('Viagem ao Sol falhou.'); failed = true; }
  // Saturno de perto: os anéis e o planeta desenhados sem erro.
  await page.evaluate(() => new Promise((resolve) => {
    const g = window.__game;
    const b = g.flight.bodies.find((x) => x.name === 'SATURNO');
    g.flight.vel.set(0, 0, 0);
    g.flight.pos.set(b.x - 3.6e8, b.y, b.z);
    g.flight.yaw = Math.PI / 2;
    g.flight.pitch = 0;
    setTimeout(resolve, 1500);
  }));
  await page.screenshot({ path: `${OUT}/saturno.png` });
  // Carga solar: rente ao Sol ela enche; de volta à cidade continua cheia, e a 150 m/s um
  // prédio de 24–34 m cai de uma vez — sem carga, esse golpe só o furaria (dano < 0,5).
  const charge = await page.evaluate(() => new Promise((resolve) => {
    const g = window.__game;
    const sun = g.flight.bodies[1];
    const d = sun.radius + 8e7;
    g.flight.vel.set(0, 0, 0);
    g.flight.pos.set(sun.x, sun.y + d, sun.z);
    g.flight.pitch = -1.2;
    const t0 = performance.now();
    const check = setInterval(() => {
      const s = (performance.now() - t0) / 1000;
      if (g.solar.charge >= 1 || s > 20) { clearInterval(check); resolve({ s, charge: g.solar.charge }); }
    }, 100);
  }));
  await page.screenshot({ path: `${OUT}/carga.png` });
  const charged = await page.evaluate(() => new Promise((resolve) => {
    const g = window.__game;
    const before = g.solar.charge;
    const shot = window.__launch(34, 150, 24);
    setTimeout(() => resolve({ before, bi: shot.bi, width: shot.width, collapsed: g.collapses.isCollapsed(shot.bi) }), 8000);
  }));
  await page.screenshot({ path: `${OUT}/carga-desabar.png` });
  const plain = (6 / charged.width) * (1 + 150 / 200);
  console.log(`carga solar: cheia em ${charge.s.toFixed(1)} s rente ao Sol; na cidade ${Math.round(charged.before * 100)}%, a 150 m/s derrubou o prédio de ${charged.width.toFixed(0)} m: ${charged.collapsed} (sem carga, dano ${plain.toFixed(2)})`);
  if (charge.charge < 1 || charged.before < 0.9 || !charged.collapsed) { console.error('Carga solar falhou.'); failed = true; }
  // Visão de calor carregada atravessa a Terra: do Sol, com a mira 1,5° ao lado da Terra (a
  // assistência leva ao centro), 2,5 s de disparo abrem um buraco que entra de um lado e sai nos
  // antípodas. Mirando Metrópolis, o raio para na superfície e não abre buraco.
  await page.evaluate(() => {
    const g = window.__game;
    // Mira pela câmera (a mira do HUD): a câmera de ombro olha uns graus abaixo do rumo.
    window.__aimCam = (q, offDeg = 0) => {
      const d = g.camera.getWorldDirection(g.camera.position.clone());
      const p = g.flight.pos;
      const dx = q.x - p.x;
      const dy = q.y - p.y;
      const dz = q.z - p.z;
      g.flight.yaw += Math.atan2(dx, dz) + (offDeg * Math.PI) / 180 - Math.atan2(d.x, d.z);
      g.flight.pitch += Math.asin(dy / Math.hypot(dx, dy, dz)) - Math.asin(d.y);
    };
  });
  const aimSteady = async (q, offDeg) => {
    for (let k = 0; k < 3; k++) {
      await new Promise((r) => setTimeout(r, 400));
      await page.evaluate((q, offDeg) => window.__aimCam(q, offDeg), q, offDeg);
    }
  };
  const earthC = { x: 0, y: -6.371e6, z: 0 };
  await page.evaluate(() => {
    const g = window.__game;
    const sun = g.flight.bodies[1];
    const e = { x: 0, y: -6.371e6, z: 0 };
    const u = { x: e.x - sun.x, y: e.y - sun.y, z: e.z - sun.z };
    const l = Math.hypot(u.x, u.y, u.z);
    const k = sun.radius + 8e7;
    g.autopilot({}); // parado: o lançamento do cenário anterior ainda voava para a frente
    g.flight.mode = 'air';
    g.flight.vel.set(0, 0, 0);
    g.flight.pos.set(sun.x + (u.x / l) * k, sun.y + (u.y / l) * k, sun.z + (u.z / l) * k);
  });
  await aimSteady(earthC, 1.5);
  const pierced = await page.evaluate(() => new Promise((resolve) => {
    const g = window.__game;
    g.heat(true);
    setTimeout(() => {
      g.heat(false);
      const h = g.pierce.holes[0];
      resolve({ holes: g.pierce.holes.length, radius: h?.radius ?? 0, dot: h ? h.entry.x * h.exit.x + h.entry.y * h.exit.y + h.entry.z * h.exit.z : 1, charge: g.solar.charge });
    }, 2500);
  }));
  await page.screenshot({ path: `${OUT}/atravessa-sol.png` });
  await page.evaluate(() => new Promise((resolve) => {
    const g = window.__game;
    const x = g.pierce.holes[0].exit;
    const R = 6.371e6;
    const r = R + 2.5e6;
    g.flight.vel.set(0, 0, 0);
    g.flight.pos.set(x.x * r + 1.5e6, -R + x.y * r, x.z * r);
    const d = { x: x.x * R - g.flight.pos.x, y: -R + x.y * R - g.flight.pos.y, z: x.z * R - g.flight.pos.z };
    g.flight.yaw = Math.atan2(d.x, d.z);
    g.flight.pitch = Math.asin(d.y / Math.hypot(d.x, d.y, d.z));
    setTimeout(resolve, 1500);
  }));
  await page.screenshot({ path: `${OUT}/buraco-saida.png` });
  // A 1.000 km de Metrópolis, a 45° da vertical dela. O pitch do voo vai só até 83° (de cima da
  // cidade a mira não chega nela), e ao começar a disparar a câmera vai para o ombro e a mira
  // gira ~1°: de 14.000 km isso anda 300 km no chão, para fora do raio protegido; daqui, 30 km.
  await page.evaluate(() => {
    const g = window.__game;
    g.flight.vel.set(0, 0, 0);
    g.flight.pos.set(1e6, 1e6, 0);
  });
  await aimSteady({ x: 0, y: 0, z: 0 }, 0);
  const city = await page.evaluate(() => new Promise((resolve) => {
    const g = window.__game;
    g.heat(true);
    setTimeout(() => { g.heat(false); resolve({ holes: g.pierce.holes.length }); }, 1000);
  }));
  console.log(`atravessar a Terra: ${pierced.holes} buraco de ${Math.round(pierced.radius / 1000)} km, entrada·saída ${pierced.dot.toFixed(3)} (antípodas = −1); mirando Metrópolis, buracos ${city.holes}`);
  if (pierced.holes !== 1 || pierced.radius < 100e3 || pierced.dot > -0.99 || city.holes !== 1) { console.error('Atravessar a Terra falhou.'); failed = true; }
  if (errors.length) { console.error('Erros no console:\n' + errors.join('\n')); failed = true; }
  const missing = Object.entries(state?.doneBy ?? { aneis: 0, resgate: 0, drones: 0 }).filter(([, n]) => !n).map(([k]) => k);
  if (missing.length) { console.error(`Sem vitória em ${LIMIT_S} s: ${missing.join(', ')}.`); failed = true; }
  if (!failed) console.log(`OK — anéis, resgate e drones cumpridos (${state.score} pontos); prédio atravessado e derrubado; espaço, Sol, carga solar e a Terra atravessada. Screenshots em ${OUT}/.`);
} finally {
  await browser.close();
  await new Promise((r) => server.httpServer.close(r));
}
process.exit(failed ? 1 : 0);
