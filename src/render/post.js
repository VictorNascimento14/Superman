import * as THREE from 'three';
import {
  EffectComposer, RenderPass, EffectPass, BloomEffect, SMAAEffect, SMAAPreset,
  VignetteEffect, ToneMappingEffect, ToneMappingMode,
} from 'postprocessing';

export function createPost(renderer, scene, camera, preset) {
  const composer = new EffectComposer(renderer, { frameBufferType: THREE.HalfFloatType });
  composer.addPass(new RenderPass(scene, camera));

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
    setSize: (w, h) => composer.setSize(w, h),
    // A exposição vive no renderer, mas é aplicada pelo ToneMappingEffect.
    setExposure: (e) => { renderer.toneMappingExposure = e; },
  };
}
