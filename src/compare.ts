import fs from "node:fs/promises";
import path from "node:path";
import pixelmatch from "pixelmatch";
import { PNG } from "pngjs";
import sharp from "sharp";
import { analyzeStyleDiffs } from "./analysis.js";
import { collectHiddenRects, createBrowserSession, normalizeViewport, preparePage, screenshotFirstMatch, screenshotPage, scrollToPosition } from "./browser.js";
import { loadVisualParityConfig, mergeAcceptedDeviations } from "./config.js";
import { DEFAULT_SELECTORS, DEFAULT_STYLE_PROPERTIES } from "./defaults.js";
import { applyPresets } from "./presets.js";
import { writeInspectReport, writePageReport } from "./report.js";
import { captureStyleSnapshots, diffStyleSnapshots, enrichStyleDiffSources } from "./styles.js";
import type { ComparePagesOptions, InspectSelectorOptions, InspectSelectorReport, PageComparisonReport, PageMaskRect, ScrollStateComparison, StyleAnalysis, StyleDiff } from "./types.js";
import { DEFAULT_OUTPUT_DIR, ensureDir, makeRunDir, slugify, uniqueNonEmpty } from "./utils.js";

export async function comparePages(rawOptions: ComparePagesOptions): Promise<PageComparisonReport> {
  const options = applyPresets(rawOptions);
  const config = await loadVisualParityConfig(options.configPath);
  const acceptedDeviations = mergeAcceptedDeviations(config.acceptedDeviations, options.acceptedDeviations);
  const viewport = normalizeViewport(options.viewport);
  const threshold = options.threshold ?? 0.1;
  const maxDiffPercent = options.maxDiffPercent ?? 1;
  const outputDir = options.outputDir ?? DEFAULT_OUTPUT_DIR;
  const runDir = makeRunDir(outputDir, options.name, `${slugify(options.localUrl)}-${Date.now()}`);
  await ensureDir(runDir);

  const liveScreenshot = path.join(runDir, "live.png");
  const localScreenshot = path.join(runDir, "local.png");
  const diffScreenshot = path.join(runDir, "diff.png");

  const session = await createBrowserSession(options);
  try {
    const context = session.context;
    const livePage = await context.newPage();
    const localPage = await context.newPage();

    const liveHealth = await preparePage(livePage, options.liveUrl, options);
    const liveMasks = await collectHiddenRects(livePage);
    await screenshotPage(livePage, liveScreenshot, { fullPage: options.fullPage });

    const localHealth = await preparePage(localPage, options.localUrl, options);
    const localMasks = await collectHiddenRects(localPage);
    await screenshotPage(localPage, localScreenshot, { fullPage: options.fullPage });

    const visual = await diffScreenshots(liveScreenshot, localScreenshot, diffScreenshot, threshold, maxDiffPercent, [...liveMasks, ...localMasks]);
    const scrollStates = await captureScrollStates({
      livePage,
      localPage,
      runDir,
      positions: options.scrollPositions ?? [],
      threshold,
      maxDiffPercent
    });
    if (scrollStates.length > 0) {
      visual.passed = visual.passed && scrollStates.every((state) => state.visual.passed);
    }

    const report: PageComparisonReport = {
      liveUrl: options.liveUrl,
      localUrl: options.localUrl,
      runDir,
      createdAt: new Date().toISOString(),
      viewport,
      screenshots: {
        live: liveScreenshot,
        local: localScreenshot,
        diff: diffScreenshot
      },
      visual,
      scrollStates: scrollStates.length > 0 ? scrollStates : undefined,
      health: {
        live: liveHealth,
        local: localHealth
      },
      reportJson: path.join(runDir, "report.json"),
      reportHtml: path.join(runDir, "report.html")
    };

    if (options.compareStyles !== false) {
      const selectors = uniqueNonEmpty(options.selectors).length > 0 ? uniqueNonEmpty(options.selectors) : DEFAULT_SELECTORS;
      const properties = uniqueNonEmpty(options.styleProperties).length > 0 ? uniqueNonEmpty(options.styleProperties) : DEFAULT_STYLE_PROPERTIES;
      const maxElements = options.maxElementsPerSelector ?? 5;
      const liveStyles = await captureStyleSnapshots(livePage, selectors, properties, maxElements);
      const localStyles = await captureStyleSnapshots(localPage, selectors, properties, maxElements);
      const rawDiffs = diffStyleSnapshots(liveStyles, localStyles);
      let { diffs, analysis } = analyzeStyleDiffs(rawDiffs, acceptedDeviations, visual.effectiveDiffPercent);
      const sourceDiffs = sourceDiffsForReport(diffs, analysis, options.diffLimit ?? 25);
      await enrichStyleDiffSources(livePage, sourceDiffs, "live", sourceDiffs.length);
      await enrichStyleDiffSources(localPage, sourceDiffs, "local", sourceDiffs.length);
      ({ diffs, analysis } = analyzeStyleDiffs(rawDiffs, acceptedDeviations, visual.effectiveDiffPercent));
      report.styles = {
        comparedSelectors: selectors.length,
        rawDiffCount: rawDiffs.length,
        diffCount: diffs.length,
        diffs,
        analysis,
        live: liveStyles,
        local: localStyles
      };
    }

    return writePageReport(report);
  } finally {
    await session.close();
  }
}

async function captureScrollStates(options: {
  livePage: import("playwright").Page;
  localPage: import("playwright").Page;
  runDir: string;
  positions: number[];
  threshold: number;
  maxDiffPercent: number;
}): Promise<ScrollStateComparison[]> {
  const states: ScrollStateComparison[] = [];
  const positions = Array.from(new Set(options.positions)).filter((position) => Number.isFinite(position) && position >= 0);
  for (const position of positions) {
    const slug = String(position).replace(/[^0-9.]+/g, "-").replace(/\./g, "p");
    const liveScrollY = await scrollToPosition(options.livePage, position);
    const localScrollY = await scrollToPosition(options.localPage, position);
    const livePath = path.join(options.runDir, `scroll-${slug}-live.png`);
    const localPath = path.join(options.runDir, `scroll-${slug}-local.png`);
    const diffPath = path.join(options.runDir, `scroll-${slug}-diff.png`);
    const liveMasks = await collectHiddenRects(options.livePage, "viewport");
    const localMasks = await collectHiddenRects(options.localPage, "viewport");
    await screenshotPage(options.livePage, livePath, { fullPage: false });
    await screenshotPage(options.localPage, localPath, { fullPage: false });
    const visual = await diffScreenshots(livePath, localPath, diffPath, options.threshold, options.maxDiffPercent, [...liveMasks, ...localMasks]);
    states.push({
      position,
      liveScrollY,
      localScrollY,
      screenshots: {
        live: livePath,
        local: localPath,
        diff: diffPath
      },
      visual
    });
  }
  await scrollToPosition(options.livePage, 0);
  await scrollToPosition(options.localPage, 0);
  return states;
}

export async function inspectSelector(rawOptions: InspectSelectorOptions): Promise<InspectSelectorReport> {
  const options = applyPresets(rawOptions);
  const config = await loadVisualParityConfig(options.configPath);
  const acceptedDeviations = mergeAcceptedDeviations(config.acceptedDeviations, options.acceptedDeviations);
  const viewport = normalizeViewport(options.viewport);
  const outputDir = options.outputDir ?? DEFAULT_OUTPUT_DIR;
  const runDir = makeRunDir(outputDir, options.name, `inspect-${slugify(options.selector)}-${Date.now()}`);
  await ensureDir(runDir);

  const session = await createBrowserSession(options);
  try {
    const context = session.context;
    const livePage = await context.newPage();
    const localPage = await context.newPage();

    await preparePage(livePage, options.liveUrl, options);
    await preparePage(localPage, options.localUrl, options);

    const properties = uniqueNonEmpty(options.styleProperties).length > 0 ? uniqueNonEmpty(options.styleProperties) : DEFAULT_STYLE_PROPERTIES;
    const maxElements = options.maxElementsPerSelector ?? 10;
    const live = await captureStyleSnapshots(livePage, [options.selector], properties, maxElements);
    const local = await captureStyleSnapshots(localPage, [options.selector], properties, maxElements);
    const rawDiffs = diffStyleSnapshots(live, local);
    let { diffs, analysis } = analyzeStyleDiffs(rawDiffs, acceptedDeviations);
    const sourceDiffs = sourceDiffsForReport(diffs, analysis, options.diffLimit ?? 25);
    await enrichStyleDiffSources(livePage, sourceDiffs, "live", sourceDiffs.length);
    await enrichStyleDiffSources(localPage, sourceDiffs, "local", sourceDiffs.length);
    ({ diffs, analysis } = analyzeStyleDiffs(rawDiffs, acceptedDeviations));

    let liveCrop: string | undefined;
    let localCrop: string | undefined;
    try {
      liveCrop = await screenshotFirstMatch(livePage, options.selector, path.join(runDir, "live-crop.png"));
    } catch {
      liveCrop = undefined;
    }
    try {
      localCrop = await screenshotFirstMatch(localPage, options.selector, path.join(runDir, "local-crop.png"));
    } catch {
      localCrop = undefined;
    }

    const report: InspectSelectorReport = {
      liveUrl: options.liveUrl,
      localUrl: options.localUrl,
      selector: options.selector,
      runDir,
      createdAt: new Date().toISOString(),
      viewport,
      screenshots: { liveCrop, localCrop },
      styles: {
        rawDiffCount: rawDiffs.length,
        diffCount: diffs.length,
        diffs,
        analysis,
        live,
        local
      },
      reportJson: path.join(runDir, "inspect.json"),
      reportHtml: path.join(runDir, "inspect.html")
    };

    return writeInspectReport(report);
  } finally {
    await session.close();
  }
}

function sourceDiffsForReport(diffs: StyleDiff[], analysis: StyleAnalysis, limit: number): StyleDiff[] {
  const selected = new Set<StyleDiff>();
  for (const cluster of analysis.clusters.slice(0, Math.max(10, limit))) {
    for (const example of cluster.examples.slice(0, 2)) selected.add(example);
  }
  for (const diff of diffs.slice(0, limit)) selected.add(diff);
  return Array.from(selected).filter((diff) => diff.kind === "style" && diff.property).slice(0, Math.max(40, limit * 2));
}

export async function diffScreenshots(
  livePath: string,
  localPath: string,
  diffPath: string,
  threshold: number,
  maxDiffPercent: number,
  maskRects: PageMaskRect[] = []
): Promise<PageComparisonReport["visual"]> {
  const liveMeta = await sharp(livePath).metadata();
  const localMeta = await sharp(localPath).metadata();
  const width = Math.max(liveMeta.width ?? 0, localMeta.width ?? 0);
  const height = Math.max(liveMeta.height ?? 0, localMeta.height ?? 0);

  if (width <= 0 || height <= 0) {
    throw new Error(`Invalid screenshot dimensions: live=${liveMeta.width}x${liveMeta.height}, local=${localMeta.width}x${localMeta.height}`);
  }

  const liveRaw = await normalizeImageToRaw(livePath, width, height);
  const localRaw = await normalizeImageToRaw(localPath, width, height);
  const diff = new PNG({ width, height });
  const mismatchedPixels = pixelmatch(liveRaw, localRaw, diff.data, width, height, { threshold });
  await fs.writeFile(diffPath, PNG.sync.write(diff));

  const totalPixels = width * height;
  const diffPercent = totalPixels === 0 ? 0 : (mismatchedPixels / totalPixels) * 100;
  const mask = buildPixelMask(width, height, maskRects);
  const maskedPixels = mask.maskedPixels;
  const effectiveMismatchedPixels = diffMaskedPixels(liveRaw, localRaw, width, height, threshold, mask.masked);
  const effectiveDiffPercent = totalPixels === 0 ? 0 : (effectiveMismatchedPixels / totalPixels) * 100;

  return {
    width,
    height,
    mismatchedPixels,
    totalPixels,
    diffPercent,
    effectiveDiffPercent,
    effectiveMismatchedPixels,
    maskedPixels,
    threshold,
    maxDiffPercent,
    passed: effectiveDiffPercent <= maxDiffPercent
  };
}

function buildPixelMask(width: number, height: number, rects: PageMaskRect[]): { masked: Uint8Array; maskedPixels: number } {
  const masked = new Uint8Array(width * height);
  let maskedPixels = 0;
  for (const rect of rects) {
    const left = Math.max(0, Math.floor(rect.x));
    const top = Math.max(0, Math.floor(rect.y));
    const right = Math.min(width, Math.ceil(rect.x + rect.width));
    const bottom = Math.min(height, Math.ceil(rect.y + rect.height));
    for (let y = top; y < bottom; y += 1) {
      for (let x = left; x < right; x += 1) {
        const index = y * width + x;
        if (masked[index] === 0) {
          masked[index] = 1;
          maskedPixels += 1;
        }
      }
    }
  }
  return { masked, maskedPixels };
}

function diffMaskedPixels(liveRaw: Buffer, localRaw: Buffer, width: number, height: number, threshold: number, masked: Uint8Array): number {
  if (!masked.includes(1)) {
    const scratch = new PNG({ width, height });
    return pixelmatch(liveRaw, localRaw, scratch.data, width, height, { threshold });
  }
  const effectiveLive = Buffer.from(liveRaw);
  const effectiveLocal = Buffer.from(localRaw);
  for (let pixel = 0; pixel < width * height; pixel += 1) {
    if (!masked[pixel]) continue;
    const offset = pixel * 4;
    effectiveLive[offset] = 255;
    effectiveLive[offset + 1] = 255;
    effectiveLive[offset + 2] = 255;
    effectiveLive[offset + 3] = 255;
    effectiveLocal[offset] = 255;
    effectiveLocal[offset + 1] = 255;
    effectiveLocal[offset + 2] = 255;
    effectiveLocal[offset + 3] = 255;
  }
  const scratch = new PNG({ width, height });
  return pixelmatch(effectiveLive, effectiveLocal, scratch.data, width, height, { threshold });
}

async function normalizeImageToRaw(inputPath: string, width: number, height: number): Promise<Buffer> {
  return sharp({
    create: {
      width,
      height,
      channels: 4,
      background: { r: 255, g: 255, b: 255, alpha: 1 }
    }
  })
    .composite([{ input: inputPath, left: 0, top: 0 }])
    .raw()
    .toBuffer();
}
