// Tela de início / pausa. O clique é obrigatório: pointer lock só vem de gesto do usuário.
export function createOverlay(onStart) {
  const el = document.createElement('div');
  el.id = 'overlay';
  el.innerHTML = `
    <div class="card">
      <h1>METROPOLIS <span>FLIGHT</span></h1>
      <p class="sub">Um jogo de fã, feito em Three.js</p>
      <button type="button">Clique para voar</button>
      <dl>
        <dt>Mouse</dt><dd>olhar / direção do voo</dd>
        <dt>W A S D</dt><dd>voar / andar</dd>
        <dt>Espaço · C</dt><dd>subir (decolar) · descer</dd>
        <dt>Shift</dt><dd>acelerar — segure para supervelocidade</dd>
        <dt>Botão direito · F</dt><dd>visão de calor</dd>
        <dt>N</dt><dd>pular missão</dd>
        <dt>M</dt><dd>som liga/desliga</dd>
        <dt>T</dt><dd>hora do dia</dd>
        <dt>Esc</dt><dd>pausa</dd>
      </dl>
      <p class="legal">Projeto de fã, sem fins comerciais, sem vínculo com a DC Comics ou a Warner Bros. Discovery.</p>
    </div>`;
  const style = document.createElement('style');
  style.textContent = `
    #overlay { position: fixed; inset: 0; display: grid; place-items: center; background: radial-gradient(ellipse at center, rgba(8,14,30,.55), rgba(3,5,12,.88)); color: #e8ecf5; font: 15px/1.5 system-ui, sans-serif; z-index: 10; }
    #overlay.hidden { display: none; }
    #overlay .card { max-width: 440px; margin: 16px; padding: 28px 32px; background: rgba(12,20,42,.72); border: 1px solid rgba(255,255,255,.12); border-radius: 14px; backdrop-filter: blur(6px); }
    #overlay h1 { margin: 0; font: 800 34px/1 Georgia, serif; letter-spacing: .06em; color: #fff; }
    #overlay h1 span { color: #e23b3b; }
    #overlay .sub { margin: 6px 0 18px; color: #9fb0d0; }
    #overlay button { width: 100%; padding: 12px; font: 700 16px system-ui; color: #1a1300; background: #f2c230; border: 0; border-radius: 8px; cursor: pointer; }
    #overlay button:hover { background: #ffd24a; }
    #overlay dl { display: grid; grid-template-columns: auto 1fr; gap: 4px 14px; margin: 18px 0; }
    #overlay dt { font-weight: 700; color: #f2c230; }
    #overlay dd { margin: 0; color: #cdd6ea; }
    #overlay .legal { margin: 0; font-size: 11px; color: #7f8aa6; }`;
  document.head.appendChild(style);
  document.body.appendChild(el);
  el.querySelector('button').addEventListener('click', onStart);
  return {
    show: () => el.classList.remove('hidden'),
    hide: () => el.classList.add('hidden'),
  };
}
