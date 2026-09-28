import * as THREE from 'three';

export function createRenderer(container, preset) {
  const renderer = new THREE.WebGLRenderer({
    antialias: false, // o SMAA do pós faz o antialias; MSAA aqui só custaria banda
    powerPreference: 'high-performance',
    stencil: false,
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2) * preset.pixelRatio);
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  // O tone mapping fica no pós (ToneMappingEffect); aplicar aqui também dobraria a curva.
  renderer.toneMapping = THREE.NoToneMapping;
  renderer.shadowMap.enabled = preset.shadows;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  container.appendChild(renderer.domElement);
  return renderer;
}
