export type MusicPipeline = 'v1' | 'v2';

export interface MusicPipelineCapabilityInputs {
  elevenLabsConfigured: boolean;
  openAiConfigured: boolean;
  anthropicConfigured: boolean;
  musicEnabled: boolean;
  directionEnabled: boolean;
}

/** Keeps capability reporting aligned with each pipeline's required translator. */
export function musicPipelineCapabilities(
  pipeline: MusicPipeline,
  inputs: MusicPipelineCapabilityInputs,
): {
  musicGeneration: boolean;
  musicPromptAdaptation: boolean;
  elevenMusicConfigured: boolean;
  musicPromptTranslatorConfigured: boolean;
} {
  const promptTranslatorConfigured = pipeline === 'v1'
    ? inputs.anthropicConfigured
    : inputs.openAiConfigured;
  return {
    musicGeneration: inputs.musicEnabled && inputs.elevenLabsConfigured && promptTranslatorConfigured,
    musicPromptAdaptation: inputs.directionEnabled && promptTranslatorConfigured,
    elevenMusicConfigured: inputs.elevenLabsConfigured,
    musicPromptTranslatorConfigured: promptTranslatorConfigured,
  };
}
