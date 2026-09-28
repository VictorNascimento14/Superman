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
  if (errors.length) { console.error('Erros no console:\n' + errors.join('\n')); failed = true; }
  const missing = Object.entries(state?.doneBy ?? { aneis: 0, resgate: 0, drones: 0 }).filter(([, n]) => !n).map(([k]) => k);
  if (missing.length) { console.error(`Sem vitória em ${LIMIT_S} s: ${missing.join(', ')}.`); failed = true; }
  if (!failed) console.log(`OK — anéis, resgate e drones cumpridos, ${state.score} pontos. Screenshots em ${OUT}/.`);
} finally {
  await browser.close();
  await new Promise((r) => server.httpServer.close(r));
}
process.exit(failed ? 1 : 0);
