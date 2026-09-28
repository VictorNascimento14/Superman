import { HALF } from '../world/layout.js';

// HUD em DOM por cima do canvas. Atualiza texto só quando muda (escrever no DOM
// todo quadro custa layout) e o minimapa num canvas próprio.
const CSS = `
#hud { position: fixed; inset: 0; pointer-events: none; color: #eef2fb; font: 600 14px/1.2 system-ui, sans-serif; text-shadow: 0 1px 3px rgba(0,0,0,.7); z-index: 5; }
#hud.hidden { display: none; }
#hud .speed { position: absolute; left: 24px; bottom: 22px; }
#hud .speed b { display: block; font: 800 44px/1 system-ui; letter-spacing: -.02em; font-variant-numeric: tabular-nums; }
#hud .speed small { color: #b9c4dc; font-weight: 600; }
#hud .bar { width: 220px; height: 6px; margin: 8px 0 6px; background: rgba(255,255,255,.18); border-radius: 3px; overflow: hidden; }
#hud .bar i { display: block; height: 100%; width: 0; background: linear-gradient(90deg, #4da3ff, #f2c230 70%, #ff4a3d); }
#hud .mode { display: inline-block; margin-top: 4px; padding: 2px 8px; font-size: 11px; letter-spacing: .12em; background: rgba(10,20,45,.6); border: 1px solid rgba(255,255,255,.2); border-radius: 4px; }
#hud .mode.super { color: #1a1300; background: #f2c230; border-color: #f2c230; }
#hud .map { position: absolute; right: 22px; bottom: 22px; width: 200px; height: 200px; border-radius: 50%; border: 2px solid rgba(255,255,255,.35); box-shadow: 0 4px 18px rgba(0,0,0,.45); }
#hud .objective { position: absolute; top: 18px; left: 50%; transform: translateX(-50%); padding: 8px 16px; background: rgba(10,20,45,.55); border-radius: 8px; text-align: center; max-width: 70vw; }
#hud .objective:empty { display: none; }
#hud .toast { position: absolute; top: 28%; left: 50%; transform: translateX(-50%); font: 800 30px/1.1 Georgia, serif; letter-spacing: .04em; color: #fff; opacity: 0; transition: opacity .25s; text-align: center; text-shadow: 0 2px 12px rgba(0,0,0,.9), 0 0 3px rgba(0,0,0,.9); -webkit-text-stroke: 1px rgba(0,0,0,.35); }
#hud .toast.on { opacity: 1; }
#hud .cross { position: absolute; left: 50%; top: 50%; width: 6px; height: 6px; margin: -3px 0 0 -3px; border-radius: 50%; background: rgba(255,255,255,.8); box-shadow: 0 0 0 2px rgba(0,0,0,.25); }
#hud .energy { position: absolute; left: 50%; bottom: 26px; width: 180px; height: 5px; margin-left: -90px; background: rgba(255,255,255,.15); border-radius: 3px; overflow: hidden; }
#hud .energy i { display: block; height: 100%; width: 100%; background: #ff3b24; box-shadow: 0 0 8px #ff3b24; }
#hud .help { position: absolute; top: 18px; right: 22px; padding: 12px 16px; background: rgba(10,20,45,.72); border-radius: 10px; font-weight: 500; line-height: 1.6; display: none; }
#hud .help.on { display: block; }
#hud .help b { color: #f2c230; }
#hud .hint { position: absolute; left: 24px; top: 18px; font-size: 12px; font-weight: 500; color: #b9c4dc; }
@media (max-width: 640px) { #hud .map { width: 130px; height: 130px; } #hud .speed b { font-size: 32px; } #hud .bar { width: 150px; } }
`;

const MODE_LABEL = { idle: 'EM PÉ', hover: 'PAIRANDO', fly: 'VOO', flyFast: 'VELOCIDADE', super: 'SUPERSÔNICO' };
const MAP_PX = 512;
const MAP_EXT = HALF + 200; // metros do centro até a borda do mapa

export function createHud(layout) {
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);
  const el = document.createElement('div');
  el.id = 'hud';
  el.className = 'hidden';
  el.innerHTML = `
    <div class="hint">H — controles</div>
    <div class="objective"></div>
    <div class="toast"></div>
    <div class="cross"></div>
    <div class="energy"><i></i></div>
    <div class="speed"><b>0</b><small>km/h</small><div class="bar"><i></i></div><small class="alt">0 m</small><br><span class="mode">EM PÉ</span></div>
    <canvas class="map" width="400" height="400"></canvas>
    <div class="help">
      <b>Mouse</b> olhar e mirar<br><b>W A S D</b> voar / andar<br><b>Espaço · C</b> subir · descer<br>
      <b>Shift</b> acelerar (segure: supersônico)<br><b>Botão direito · F</b> visão de calor<br>
      <b>N</b> pular missão · <b>T</b> hora do dia · <b>Esc</b> pausa</div>`;
  document.body.appendChild(el);
  const $ = (s) => el.querySelector(s);
  const ui = {
    speed: $('.speed b'), bar: $('.bar i'), alt: $('.alt'), mode: $('.mode'),
    objective: $('.objective'), toast: $('.toast'), energy: $('.energy i'), help: $('.help'), map: $('.map'),
  };
  const ctx = ui.map.getContext('2d');
  const base = drawBaseMap(layout);
  const last = {};
  let toastTimer = 0;
  let markers = [];

  const set = (key, node, value, prop = 'textContent') => {
    if (last[key] === value) return;
    last[key] = value;
    node[prop] = value;
  };

  function drawMap(flight) {
    const S = ui.map.width;
    const px = ((flight.pos.x + MAP_EXT) / (MAP_EXT * 2)) * MAP_PX;
    const py = ((flight.pos.z + MAP_EXT) / (MAP_EXT * 2)) * MAP_PX;
    // Zoom abre com a velocidade: devagar vê o quarteirão, rápido vê a ilha.
    const zoom = 3.2 - Math.min(flight.speed, 300) / 300 * 2.2;
    // Mapa "frente para cima": a direção do olhar vira o topo do círculo.
    const theta = -Math.PI / 2 - Math.atan2(Math.cos(flight.yaw), Math.sin(flight.yaw));
    ctx.save();
    ctx.clearRect(0, 0, S, S);
    ctx.beginPath();
    ctx.arc(S / 2, S / 2, S / 2, 0, Math.PI * 2);
    ctx.clip();
    ctx.fillStyle = '#123a5c';
    ctx.fillRect(0, 0, S, S);
    ctx.translate(S / 2, S / 2);
    ctx.rotate(theta);
    ctx.scale(zoom, zoom);
    ctx.translate(-px, -py);
    ctx.drawImage(base, 0, 0);
    ctx.restore();
    // Marcadores: presos na borda quando estão fora do círculo.
    for (const m of markers) {
      const mx = ((m.x + MAP_EXT) / (MAP_EXT * 2)) * MAP_PX - px;
      const my = ((m.z + MAP_EXT) / (MAP_EXT * 2)) * MAP_PX - py;
      const c = Math.cos(theta);
      const s = Math.sin(theta);
      let x = (mx * c - my * s) * zoom;
      let y = (mx * s + my * c) * zoom;
      const r = Math.hypot(x, y);
      const lim = S / 2 - 12;
      if (r > lim) { x *= lim / r; y *= lim / r; }
      ctx.beginPath();
      ctx.arc(S / 2 + x, S / 2 + y, 9, 0, Math.PI * 2);
      ctx.fillStyle = m.color;
      ctx.fill();
      ctx.lineWidth = 3;
      ctx.strokeStyle = '#fff';
      ctx.stroke();
    }
    // O herói: seta sempre apontando para cima.
    ctx.save();
    ctx.translate(S / 2, S / 2);
    ctx.beginPath();
    ctx.moveTo(0, -16); ctx.lineTo(11, 12); ctx.lineTo(0, 6); ctx.lineTo(-11, 12);
    ctx.closePath();
    ctx.fillStyle = '#e23b3b';
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = '#fff';
    ctx.stroke();
    ctx.restore();
  }

  return {
    show: () => el.classList.remove('hidden'),
    hide: () => el.classList.add('hidden'),
    toggleHelp: () => ui.help.classList.toggle('on'),
    setObjective: (text) => set('obj', ui.objective, text ?? ''),
    setMarkers: (list) => { markers = list; },
    setEnergy: (k) => set('energy', ui.energy.style, `${Math.round(k * 100)}%`, 'width'),
    toast(text, seconds = 2) {
      ui.toast.textContent = text;
      ui.toast.classList.add('on');
      toastTimer = seconds;
    },
    update(dt, flight, groundY) {
      set('speed', ui.speed, String(Math.round(flight.speed * 3.6)));
      set('bar', ui.bar.style, `${Math.min(100, (flight.speed / 420) * 100).toFixed(0)}%`, 'width');
      set('alt', ui.alt, `${Math.max(0, Math.round(flight.pos.y - groundY))} m acima do solo · ${Math.round(flight.pos.y)} m`);
      const mode = flight.supersonic ? 'super' : flight.pose;
      set('mode', ui.mode, MODE_LABEL[mode]);
      set('modeCls', ui.mode, mode === 'super' ? 'mode super' : 'mode', 'className');
      if (toastTimer > 0 && (toastTimer -= dt) <= 0) ui.toast.classList.remove('on');
      drawMap(flight);
    },
  };
}

// Mapa-base desenhado uma vez: água, ilha, parque, prédios por altura, o marco em ouro.
function drawBaseMap(layout) {
  const c = document.createElement('canvas');
  c.width = c.height = MAP_PX;
  const g = c.getContext('2d');
  const k = MAP_PX / (MAP_EXT * 2);
  const X = (x) => (x + MAP_EXT) * k;
  g.fillStyle = '#123a5c';
  g.fillRect(0, 0, MAP_PX, MAP_PX);
  g.fillStyle = '#3a3d44';
  g.fillRect(X(-HALF - 30), X(-HALF - 30), (HALF * 2 + 60) * k, (HALF * 2 + 60) * k);
  const p = layout.park;
  g.fillStyle = '#3f7a35';
  g.fillRect(X(p.x0), X(p.z0), (p.x1 - p.x0) * k, (p.z1 - p.z0) * k);
  for (const b of layout.buildings) {
    const l = Math.min(88, 42 + b.h / 6);
    g.fillStyle = b.landmark ? '#f2c230' : `hsl(215, 12%, ${l}%)`;
    g.fillRect(X(b.x - b.w / 2), X(b.z - b.d / 2), Math.max(1, b.w * k), Math.max(1, b.d * k));
  }
  return c;
}
