import * as THREE from 'three';
import {
  EffectComposer, RenderPass, EffectPass, BloomEffect, SMAAEffect, SMAAPreset,
  VignetteEffect, ToneMappingEffect, ToneMappingMode,
} from 'postprocessing';

export function createPost(renderer, scene, camera, preset, space) {
  const composer = new EffectComposer(renderer, { frameBufferType: THREE.HalfFloatType });
  // O espaço (Terra, estrelas) vem antes, e só no alto: o shader do globo é caro e, perto do
  // chão, ficaria inteiro atrás do céu. Ligado, a cidade limpa só a profundidade.
  const spacePass = new RenderPass(space.scene, space.camera);
  spacePass.skipShadowMapUpdate = true;
  spacePass.enabled = false;
  const cityPass = new RenderPass(scene, camera);
  composer.addPass(spacePass);
  composer.addPass(cityPass);

  const bloom = new BloomEffect({ intensity: 0.9, luminanceThreshold: 1.0, luminanceSmoothing: 0.2, mipmapBlur: true, radius: 0.7 });
  const tone = new ToneMappingEffect({ mode: ToneMappingMode.ACES_FILMIC });
  const vignette = new VignetteEffect({ offset: 0.3, darkness: 0.45 });
  const effects = [];
  if (preset.bloom) effects.push(bloom);
  effects.push(tone, vignette);
  if (preset.smaa) effects.push(new SMAAEffect({ preset: SMAAPreset.MEDIUM }));
  composer.addPass(new EffectPass(camera, ...effects));

  return {
    bloom,
    render: (dt) => composer.render(dt),
    setSpace(on) {
      if (spacePass.enabled === on) return;
      spacePass.enabled = on;
      cityPass.clearPass.setClearFlags(!on, true, false);
    },
    setSize: (w, h) => composer.setSize(w, h),
    // A exposição vive no renderer, mas é aplicada pelo ToneMappingEffect.
    setExposure: (e) => { renderer.toneMappingExposure = e; },
  };
}
