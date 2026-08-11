export type DemoSourceId = 'living-koi' | 'drifting-cloud' | 'blooming-flower';

export interface SourceMotion {
  kind: 'none' | 'drift' | 'flow';
  amount?: number;
  speed?: number;
}

export type SourceEffectKind = 'motion-cells' | 'edge-echo' | 'tracked-grid';

export interface SourceEffectParams {
  /** Display-space size of each sampled cell. */
  cellSize: number;
  /** Seconds for detected structure to decay. */
  trail: number;
  /** Additive halo strength. */
  glow: number;
  /** Fraction of eligible samples that are drawn. */
  density: number;
  /** Sensitivity to frame difference / edges. */
  response: number;
  /** Hex tint applied to the reconstruction. */
  color: string;
  /** Amount of the clean source retained underneath the reconstruction. */
  sourceVisibility: number;
}

/**
 * A compact, AI-friendly recipe. It contains intent-level parameters rather
 * than shader source, so an orchestrator can compose and edit it cheaply.
 */
export interface SourceEffectRecipe {
  id: string;
  kind: SourceEffectKind;
  name: string;
  notes: string;
  enabled: boolean;
  params: SourceEffectParams;
}

export function sourceEffect(
  kind: SourceEffectKind,
  name: string,
  color: string,
  values: Partial<SourceEffectParams> = {},
): SourceEffectRecipe {
  return {
    id: `source_${kind}_${name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')}`,
    kind,
    name,
    notes: kind === 'motion-cells'
      ? 'Cells appear where the source itself moves, then dissolve into a short trail.'
      : kind === 'edge-echo'
        ? 'A luminous reconstruction follows changing contours and source edges.'
        : 'A detailed field of pluses, squares and pixels tracks the source silhouette and motion.',
    enabled: true,
    params: {
      cellSize: 12,
      trail: 0.8,
      glow: 0.75,
      density: 0.72,
      response: 1.1,
      color,
      sourceVisibility: 0.82,
      ...values,
    },
  };
}
