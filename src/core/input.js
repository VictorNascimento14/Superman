// Teclado + mouse com pointer lock. Ctrl fica de fora de propósito: Ctrl+W fecha a aba.
const BIND = {
  forward: ['KeyW', 'ArrowUp'],
  back: ['KeyS', 'ArrowDown'],
  left: ['KeyA'],
  right: ['KeyD'],
  up: ['Space'],
  down: ['KeyC', 'KeyQ'],
  boost: ['ShiftLeft', 'ShiftRight'],
  lookLeft: ['ArrowLeft'],
  lookRight: ['ArrowRight'],
};

export function createInput(target) {
  const down = new Set();
  const handlers = new Map();
  let jump = false;
  let dx = 0;
  let dy = 0;
  const any = (list) => list.some((k) => down.has(k));

  window.addEventListener('keydown', (e) => {
    if (e.repeat) return;
    down.add(e.code);
    if (e.code === 'Space') jump = true;
    handlers.get(e.code)?.forEach((fn) => fn(e));
    if (e.code === 'Space' || e.code.startsWith('Arrow')) e.preventDefault();
  });
  window.addEventListener('keyup', (e) => down.delete(e.code));
  window.addEventListener('blur', () => down.clear()); // tecla presa ao trocar de janela
  document.addEventListener('mousemove', (e) => {
    if (document.pointerLockElement !== target) return;
    dx += e.movementX;
    dy += e.movementY;
  });
  const mouse = new Set();
  target.addEventListener('mousedown', (e) => mouse.add(e.button));
  window.addEventListener('mouseup', (e) => mouse.delete(e.button));
  target.addEventListener('contextmenu', (e) => e.preventDefault());

  return {
    locked: () => document.pointerLockElement === target,
    lock: () => target.requestPointerLock?.(),
    onKey(code, fn) {
      if (!handlers.has(code)) handlers.set(code, []);
      handlers.get(code).push(fn);
    },
    mouseDown: (b) => mouse.has(b),
    isDown: (code) => down.has(code),
    // Estado de movimento do quadro; `jump` é borda (verdadeiro uma vez por toque).
    read(out) {
      out.forward = (any(BIND.forward) ? 1 : 0) - (any(BIND.back) ? 1 : 0);
      out.right = (any(BIND.right) ? 1 : 0) - (any(BIND.left) ? 1 : 0);
      out.up = (any(BIND.up) ? 1 : 0) - (any(BIND.down) ? 1 : 0);
      out.boost = any(BIND.boost);
      out.jump = jump;
      jump = false;
      return out;
    },
    consumeLook(dt) {
      const keyYaw = ((any(BIND.lookLeft) ? 1 : 0) - (any(BIND.lookRight) ? 1 : 0)) * 900 * dt;
      const r = { dx: dx - keyYaw, dy };
      dx = dy = 0;
      return r;
    },
  };
}
