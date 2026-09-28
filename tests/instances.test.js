import { test } from 'node:test';
import assert from 'node:assert/strict';
import { InstancedMesh, BoxGeometry, MeshBasicMaterial, Matrix4, Vector3 } from 'three';
import { hideInstancesIn } from '../src/fx/instances.js';

test('marcas dentro da caixa somem; as de fora ficam', () => {
  const mesh = new InstancedMesh(new BoxGeometry(), new MeshBasicMaterial(), 3);
  const m = new Matrix4();
  mesh.setMatrixAt(0, m.makeTranslation(5, 40, 5)); // no prédio, acima do corte
  mesh.setMatrixAt(1, m.makeTranslation(5, 10, 5)); // no prédio, abaixo do corte
  mesh.setMatrixAt(2, m.makeTranslation(50, 40, 5)); // em outro prédio
  assert.equal(hideInstancesIn(mesh, { minX: 0, minY: 20, minZ: 0, maxX: 10, maxY: 100, maxZ: 10 }), 1);
  const s = new Vector3();
  const scaleOf = (i) => { mesh.getMatrixAt(i, m); return s.setFromMatrixScale(m).length(); };
  assert.equal(scaleOf(0), 0);
  assert.ok(scaleOf(1) > 0 && scaleOf(2) > 0);
});
