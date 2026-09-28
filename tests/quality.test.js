import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickQuality } from '../src/render/quality.js';

test('qualidade: ?q= só aceita os presets de verdade', () => {
  assert.equal(pickQuality('?q=alta'), 'alta');
  // Chave herdada de Object passava como preset: o jogo abria com NaN no pixel ratio.
  for (const q of ['constructor', 'toString', '__proto__']) assert.equal(pickQuality(`?q=${q}`), 'media');
});
