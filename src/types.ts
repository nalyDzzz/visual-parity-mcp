export type WaitUntil = "commit" | "domcontentloaded" | "load" | "networkidle";

export interface ViewportOptions {
  width: number;
  height: number;
  deviceScaleFactor?: number;
}

export interface PageHealth {
  url: string;
  status?: number;
  ok: boolean;
  title: string;
  bodyTextLength: number;
  bodyChildCount: number;
  landmarkCount: number;
  imageCount: number;
  decodedImageCount: number;
  hiddenElementCount: number;
  errors: string[];
  warnings: string[];
}

export interface PageMaskRect {
  selector?: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ComparePagesOptions {
  liveUrl: string;
  localUrl: string;
  outputDir?: string;
  name?: string;
  configPath?: string;
  viewport?: ViewportOptions;
  fullPage?: boolean;
  waitUntil?: WaitUntil;
  waitMs?: number;
  timeoutMs?: number;
  loadRetries?: number;
  retryDelayMs?: number;
  userAgent?: string;
  persistentContextDir?: string;
  softPageHealth?: boolean;
  threshold?: number;
  maxDiffPercent?: number;
  selectors?: string[];
  styleProperties?: string[];
  compareStyles?: boolean;
  hideSelectors?: string[];
  presets?: string[];
  acceptedDeviations?: AcceptedDeviation[];
  maxElementsPerSelector?: number;
  diffLimit?: number;
  scrollPositions?: number[];
}

export interface CompareRoutesOptions extends Omit<ComparePagesOptions, "liveUrl" | "localUrl" | "name"> {
  liveBaseUrl: string;
  localBaseUrl: string;
  paths: string[];
}

export interface InspectSelectorOptions {
  liveUrl: string;
  localUrl: string;
  selector: string;
  outputDir?: string;
  name?: string;
  configPath?: string;
  viewport?: ViewportOptions;
  waitUntil?: WaitUntil;
  waitMs?: number;
  timeoutMs?: number;
  loadRetries?: number;
  retryDelayMs?: number;
  userAgent?: string;
  persistentContextDir?: string;
  softPageHealth?: boolean;
  threshold?: number;
  styleProperties?: string[];
  hideSelectors?: string[];
  presets?: string[];
  acceptedDeviations?: AcceptedDeviation[];
  maxElementsPerSelector?: number;
  diffLimit?: number;
}

export interface AcceptedDeviation {
  selector?: string;
  property?: string;
  kind?: StyleDiff["kind"];
  pattern?: string;
  reason?: string;
}

export interface VisualParityConfig {
  acceptedDeviations?: AcceptedDeviation[];
}

export interface StyleElementSnapshot {
  selector: string;
  index: number;
  text: string;
  tagName: string;
  rect: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  styles: Record<string, string>;
  styleSources?: Record<string, StyleRuleSource[]>;
}

export interface StyleRuleSource {
  type: "inline" | "rule";
  href?: string;
  selectorText?: string;
  value: string;
}

export interface StyleSelectorSnapshot {
  selector: string;
  count: number;
  elements: StyleElementSnapshot[];
  error?: string;
}

export interface StyleDiff {
  selector: string;
  index?: number;
  kind: "count" | "style" | "rect" | "text";
  property?: string;
  live?: string | number;
  local?: string | number;
  delta?: number;
  liveSources?: StyleRuleSource[];
  localSources?: StyleRuleSource[];
}

export interface StyleDiffCluster {
  id: string;
  kind: StyleDiff["kind"];
  property?: string;
  live?: string | number;
  local?: string | number;
  count: number;
  selectors: string[];
  examples: StyleDiff[];
  priority: "high" | "medium" | "low";
  severity: "critical" | "major" | "minor";
  suggestedFix?: string;
  fixability?: "candidate" | "reference" | "mixed" | "unknown";
  estimatedResolution?: {
    diffs: number;
    diffPercent?: number;
  };
}

export interface StyleAnalysis {
  rawDiffCount: number;
  ignoredDiffCount: number;
  diffCount: number;
  clusters: StyleDiffCluster[];
}

export interface CrossPageFinding {
  id: string;
  kind: StyleDiff["kind"];
  property?: string;
  live?: string | number;
  local?: string | number;
  pageCount: number;
  totalPages: number;
  totalDiffs: number;
  estimatedDiffPercent: number;
  selectors: string[];
  pages: Array<{
    liveUrl: string;
    localUrl: string;
    diffCount: number;
    reportHtml: string;
  }>;
  suggestedFix?: string;
}

export interface PageComparisonReport {
  liveUrl: string;
  localUrl: string;
  runDir: string;
  createdAt: string;
  viewport: ViewportOptions;
  screenshots: {
    live: string;
    local: string;
    diff: string;
  };
  visual: {
    width: number;
    height: number;
    mismatchedPixels: number;
    totalPixels: number;
    diffPercent: number;
    effectiveDiffPercent: number;
    effectiveMismatchedPixels: number;
    maskedPixels: number;
    threshold: number;
    maxDiffPercent: number;
    passed: boolean;
  };
  scrollStates?: ScrollStateComparison[];
  health?: {
    live: PageHealth;
    local: PageHealth;
  };
  styles?: {
    comparedSelectors: number;
    rawDiffCount?: number;
    diffCount: number;
    diffs: StyleDiff[];
    analysis?: StyleAnalysis;
    live: StyleSelectorSnapshot[];
    local: StyleSelectorSnapshot[];
  };
  reportJson: string;
  reportHtml: string;
}

export interface ScrollStateComparison {
  position: number;
  liveScrollY: number;
  localScrollY: number;
  screenshots: {
    live: string;
    local: string;
    diff: string;
  };
  visual: PageComparisonReport["visual"];
}

export interface RoutesComparisonReport {
  createdAt: string;
  liveBaseUrl: string;
  localBaseUrl: string;
  outputDir: string;
  total: number;
  passed: number;
  failed: number;
  averageDiffPercent: number;
  crossPageFindings?: CrossPageFinding[];
  results: PageComparisonReport[];
  summaryJson: string;
  summaryHtml: string;
}

export interface InspectSelectorReport {
  liveUrl: string;
  localUrl: string;
  selector: string;
  runDir: string;
  createdAt: string;
  viewport: ViewportOptions;
  screenshots: {
    liveCrop?: string;
    localCrop?: string;
  };
  styles: {
    rawDiffCount?: number;
    diffCount: number;
    diffs: StyleDiff[];
    analysis?: StyleAnalysis;
    live: StyleSelectorSnapshot[];
    local: StyleSelectorSnapshot[];
  };
  reportJson: string;
  reportHtml: string;
}
