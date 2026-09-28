import { test } from 'node:test';
import assert from 'node:assert/strict';
import { windFor, cityFor } from '../src/audio/curves.js';

test('vento cresce com a velocidade e satura', () => {
  const a = windFor(0);
  const b = windFor(50);
  const c = windFor(160);
  assert.ok(a.gain < b.gain && b.gain < c.gain);
  assert.ok(a.freq < b.freq && b.freq < c.freq);
  assert.deepEqual(windFor(400), c);
  assert.ok(c.gain <= 0.4);
});

test('cidade some com a altura', () => {
  assert.ok(cityFor(0).gain > cityFor(30).gain);
  assert.equal(cityFor(60).gain, 0);
  assert.equal(cityFor(500).gain, 0);
});
