export type WaitUntil = "commit" | "domcontentloaded" | "load" | "networkidle";

export interface ViewportOptions {
  width: number;
  height: number;
  deviceScaleFactor?: number;
}

export interface ComparePagesOptions {
  liveUrl: string;
  localUrl: string;
  outputDir?: string;
  name?: string;
  viewport?: ViewportOptions;
  fullPage?: boolean;
  waitUntil?: WaitUntil;
  waitMs?: number;
  timeoutMs?: number;
  threshold?: number;
  maxDiffPercent?: number;
  selectors?: string[];
  styleProperties?: string[];
  compareStyles?: boolean;
  hideSelectors?: string[];
  presets?: string[];
  maxElementsPerSelector?: number;
  diffLimit?: number;
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
  viewport?: ViewportOptions;
  waitUntil?: WaitUntil;
  waitMs?: number;
  timeoutMs?: number;
  threshold?: number;
  styleProperties?: string[];
  hideSelectors?: string[];
  presets?: string[];
  maxElementsPerSelector?: number;
  diffLimit?: number;
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
    threshold: number;
    maxDiffPercent: number;
    passed: boolean;
  };
  styles?: {
    comparedSelectors: number;
    diffCount: number;
    diffs: StyleDiff[];
    live: StyleSelectorSnapshot[];
    local: StyleSelectorSnapshot[];
  };
  reportJson: string;
  reportHtml: string;
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
    diffCount: number;
    diffs: StyleDiff[];
    live: StyleSelectorSnapshot[];
    local: StyleSelectorSnapshot[];
  };
  reportJson: string;
  reportHtml: string;
}
