/**
 * Dynamic Matrix Engine types — V_topic ⊗ V_style + 3-layer composition.
 */

export type TopicVector = {
  name: string;
  /** Core conflict engine */
  conflict: string;
  /** Character motive drive */
  motive: string;
  /** Reward / progression loop */
  reward: string;
  /** Trope subversion seeds (L2) */
  subvertHints: string[];
  /** CTR / SEO motif tokens (VI) */
  scoreMotifs: string[];
  /** True when catalog exact match; false = free-text soft vector */
  fromCatalog: boolean;
};

export type StyleVector = {
  name: string;
  /** World / setting frame */
  world: string;
  /** Domain jargon (VI/EN mix for AI) */
  jargon: string;
  /** Visual DNA EN for image/video */
  visualDnaEn: string;
  colorGrade: string;
  /** Suggested spoken WPM bias (soft) */
  wpmBias: number;
  /** Shot duration band seconds */
  shotSecMin: number;
  shotSecMax: number;
  ttsTone: {
    narrator: string;
    rolesHint: string;
  };
  fromCatalog: boolean;
};

export type MatrixLayerFlags = {
  hasUserOverride: boolean;
  hasLoreOverride: boolean;
  topicFromCatalog: boolean;
  styleFromCatalog: boolean;
  /** Natural | mutant | contrast | freeform heuristic */
  pairGroup: 'natural' | 'mutant' | 'contrast' | 'freeform';
};

export type MatrixComposition = {
  genreLabel: string;
  topic: TopicVector;
  style: StyleVector;
  layers: MatrixLayerFlags;
  /** Short merge of conflict⊗world for logs */
  payloadSummary: string;
  mo_ta: string;
  lorebook: string;
};
