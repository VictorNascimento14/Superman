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
    window.__launch = (maxWidth, speed, skip = -1) => {
      const g = window.__game;
      const hit = {};
      for (const [bi, b] of g.layout.buildings.entries()) {
        if (b.landmark || bi === skip || b.h < 60) continue;
        const t = b.tiers[0];
        for (const [nx, nz, yaw] of [[0, -1, 0], [0, 1, Math.PI], [-1, 0, Math.PI / 2], [1, 0, -Math.PI / 2]]) {
          if ((nx ? t.d : t.w) > maxWidth) continue;
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
          return { bi, passed: () => (nx ? (far - g.flight.pos.x) * nx : (far - g.flight.pos.z) * nz) > 0 };
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
    const shot = window.__launch(Infinity, 150);
    setTimeout(() => {
      const after = g.destruction.stats();
      resolve({ bi: shot.bi, breaches: after.breaches - before.breaches, debris: after.debris - before.debris, passed: shot.passed() });
    }, 1200);
  }));
  console.log(`atravessar: ${smash.breaches} rupturas, ${smash.debris} pedaços de entulho, passou: ${smash.passed}`);
  if (smash.breaches < 2 || smash.debris < 10 || !smash.passed) { console.error('Atravessar prédio falhou.'); failed = true; }
  // Desabar: supersônico num prédio estreito, uma passada basta; a parte de cima cai e sobra
  // o toco (teto da colisão na altura dos escombros).
  const fall = await page.evaluate((skip) => new Promise((resolve) => {
    const g = window.__game;
    const shot = window.__launch(34, 420, skip);
    setTimeout(() => {
      const tops = g.collision.boxes.filter((b) => b.building === shot.bi).map((b) => b.maxY);
      resolve({ collapsed: g.collapses.isCollapsed(shot.bi), active: g.collapses.active, top: Math.max(...tops) });
    }, 8000);
  }), smash.bi);
  console.log(`desabar: desabou ${fall.collapsed}, em andamento ${fall.active}, teto ${fall.top.toFixed(1)} m`);
  if (!fall.collapsed || fall.active || fall.top > 3.01) { console.error('Desabamento falhou.'); failed = true; }
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
  if (errors.length) { console.error('Erros no console:\n' + errors.join('\n')); failed = true; }
  const missing = Object.entries(state?.doneBy ?? { aneis: 0, resgate: 0, drones: 0 }).filter(([, n]) => !n).map(([k]) => k);
  if (missing.length) { console.error(`Sem vitória em ${LIMIT_S} s: ${missing.join(', ')}.`); failed = true; }
  if (!failed) console.log(`OK — anéis, resgate e drones cumpridos (${state.score} pontos); prédio atravessado e derrubado. Screenshots em ${OUT}/.`);
} finally {
  await browser.close();
  await new Promise((r) => server.httpServer.close(r));
}
process.exit(failed ? 1 : 0);
