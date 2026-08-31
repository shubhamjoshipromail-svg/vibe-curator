export type MusicPipeline = 'v1' | 'v2';

export interface MusicPipelineCapabilityInputs {
  lyriaConfigured: boolean;
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
  lyriaMusicConfigured: boolean;
  defaultMusicProvider: 'lyria';
  musicProviders: {
    lyria: { available: boolean; enabled: boolean; premiumOnly: false; model: 'lyria-3-clip-preview'; costUsd: 0.04; durationSeconds: 30 };
    elevenlabs: { available: boolean; enabled: false; premiumOnly: true; model: 'music_v2'; costUsd: 0.30; durationSeconds: 120 };
  };
} {
  const promptTranslatorConfigured = pipeline === 'v1'
    ? inputs.anthropicConfigured
    : inputs.openAiConfigured;
  const lyriaGenerationEnabled = inputs.musicEnabled
    && inputs.lyriaConfigured
    && (pipeline !== 'v1' || inputs.anthropicConfigured);
  return {
    musicGeneration: lyriaGenerationEnabled,
    musicPromptAdaptation: inputs.directionEnabled && promptTranslatorConfigured,
    elevenMusicConfigured: inputs.elevenLabsConfigured,
    lyriaMusicConfigured: inputs.lyriaConfigured,
    musicPromptTranslatorConfigured: promptTranslatorConfigured,
    defaultMusicProvider: 'lyria',
    musicProviders: {
      lyria: {
        available: inputs.lyriaConfigured,
        enabled: lyriaGenerationEnabled,
        premiumOnly: false,
        model: 'lyria-3-clip-preview',
        costUsd: 0.04,
        durationSeconds: 30,
      },
      elevenlabs: {
        available: inputs.elevenLabsConfigured,
        enabled: false,
        premiumOnly: true,
        model: 'music_v2',
        costUsd: 0.30,
        durationSeconds: 120,
      },
    },
  };
}
