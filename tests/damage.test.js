import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDamage, DAMAGE } from '../src/world/damage.js';

test('dano: uma passada supersônica derruba um prédio estreito', () => {
  const d = createDamage();
  assert.equal(d.hit(7, 30, 24, 420), 24); // corta na base da faixa de 24–32 m
  assert.ok(d.isCollapsed(7));
});

test('dano: em cruzeiro, uma passada não derruba; a segunda na mesma altura sim', () => {
  const d = createDamage();
  assert.equal(d.hit(1, 20, 24, 48), null);
  assert.ok(d.at(1, 20) > 0.25 && d.at(1, 20) < DAMAGE.collapseAt);
  assert.equal(d.hit(1, 22, 24, 48), 16);
});

test('dano: passadas em alturas diferentes não somam', () => {
  const d = createDamage();
  for (const y of [5, 20, 35, 50, 65]) assert.equal(d.hit(2, y, 24, 48), null);
  assert.ok(!d.isCollapsed(2));
});

test('dano: prédio largo aguenta mais passadas', () => {
  const d = createDamage();
  assert.equal(d.hit(3, 10, 60, 150), null);
  assert.equal(d.hit(3, 10, 60, 150), null);
  assert.equal(d.hit(3, 10, 60, 150), 8);
});

test('dano: prédio desabado não desaba de novo', () => {
  const d = createDamage();
  d.hit(4, 40, 20, 420);
  assert.equal(d.hit(4, 40, 20, 420), null);
});

test('dano: com força de supersônico (ou carregado) cai qualquer prédio, de uma vez', () => {
  const d = createDamage();
  assert.equal(d.hit(4, 50, 90, 420), 48); // 90 m de largura: a regra do dano sozinha não derrubaria
  assert.equal(d.hit(5, 12, 90, 150 * 3), 8); // 150 m/s com a carga solar cheia (força 3×)
  assert.equal(d.hit(6, 12, 90, 339), null);
});
