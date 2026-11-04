export interface Message {
  id: string;
  role: 'user' | 'model' | 'system';
  content: string;
  timestamp: number;
  tokens?: number;
  searchGrounding?: boolean;
}

export interface ContextMeta {
  total_tokens_used: number;
  max_budget: number;
  available_budget: number;
  active_turns: number;
  evicted_turns: number;
  summary_length: number;
  has_summary?: boolean;
}

export interface BoundingBox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface OCRWord {
  text: string;
  confidence: number;
  bbox: BoundingBox;
}

export interface TextBlock {
  id: string;
  text: string;
  confidence: number;
  bbox: BoundingBox;
  language?: string;
  translation?: string;
  isTranslating?: boolean;
}

export interface LensMetrics {
  fps: number;
  ocrLatencyMs: number;
  translationLatencyMs: number;
  cacheHitRate: number;
}

export interface PreprocessingOptions {
  grayscale: boolean;
  contrast: boolean;
  threshold: boolean;
  denoise: boolean;
}

export interface BioscienceHit {
  accession: string;
  gene: string;
  organism: string;
  protein: string;
  length: number;
  plddtConfidence?: 'Very High' | 'Confident' | 'Low' | 'Very Low';
  pdbId?: string;
}

export interface BenchmarkSample {
  id: string;
  groundTruth: string;
  rawTokens: OCRWord[];
}

export interface BenchmarkMetricResult {
  sampleId: string;
  groundTruth: string;
  rawText: string;
  pipelineText: string;
  rawCer: number;
  pipeCer: number;
  rawWer: number;
  pipeWer: number;
  latencyMs: number;
}

export interface LensCalibration {
  exposure: number; // -2.0 to +2.0 EV
  whiteBalance: number; // 2500K to 8000K
  tint: number; // -50 (Green) to +50 (Magenta)
  contrast: number; // 0.7x to 1.5x
}
