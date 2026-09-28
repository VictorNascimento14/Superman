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
  // Atravessar prédio: da rua, a 150 m/s contra a fachada, o herói fura, sai do outro lado e
  // deixa entrada, saída e entulho.
  const smash = await page.evaluate(() => new Promise((resolve) => {
    const g = window.__game;
    window.__autopilotStop();
    const hit = {};
    const b = g.layout.buildings.find((x) => {
      if (x.landmark || x.h < 60 || x.w < 24 || x.tiers.length > 1) return false;
      const t = x.tiers[0];
      const start = { x: t.x, y: 25, z: t.z - t.d / 2 - 30 };
      return g.collision.heightAt(start.x, start.z) < 0.01
        && g.collision.raycast(start, { x: 0, y: 0, z: 1 }, 40, hit) && Math.abs(hit.z - (t.z - t.d / 2)) < 0.01;
    });
    const t = b.tiers[0];
    const before = g.destruction.stats();
    g.flight.mode = 'air';
    g.flight.pos.set(t.x, 25, t.z - t.d / 2 - 30);
    g.flight.yaw = 0;
    g.flight.pitch = 0;
    g.flight.vel.set(0, 0, 150);
    g.autopilot({ forward: 1 });
    setTimeout(() => {
      const after = g.destruction.stats();
      resolve({ breaches: after.breaches - before.breaches, debris: after.debris - before.debris, passed: g.flight.pos.z > t.z + t.d / 2 });
    }, 1200);
  }));
  console.log(`atravessar: ${smash.breaches} rupturas, ${smash.debris} pedaços de entulho, passou: ${smash.passed}`);
  if (smash.breaches < 2 || smash.debris < 10 || !smash.passed) { console.error('Atravessar prédio falhou.'); failed = true; }
  if (errors.length) { console.error('Erros no console:\n' + errors.join('\n')); failed = true; }
  const missing = Object.entries(state?.doneBy ?? { aneis: 0, resgate: 0, drones: 0 }).filter(([, n]) => !n).map(([k]) => k);
  if (missing.length) { console.error(`Sem vitória em ${LIMIT_S} s: ${missing.join(', ')}.`); failed = true; }
  if (!failed) console.log(`OK — anéis, resgate e drones cumpridos (${state.score} pontos) e prédio atravessado. Screenshots em ${OUT}/.`);
} finally {
  await browser.close();
  await new Promise((r) => server.httpServer.close(r));
}
process.exit(failed ? 1 : 0);
