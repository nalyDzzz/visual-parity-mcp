import fs from "node:fs/promises";
import path from "node:path";
import pixelmatch from "pixelmatch";
import { PNG } from "pngjs";
import sharp from "sharp";
import { createContext, launchChromium, normalizeViewport, preparePage, screenshotFirstMatch, screenshotPage } from "./browser.js";
import { DEFAULT_SELECTORS, DEFAULT_STYLE_PROPERTIES } from "./defaults.js";
import { applyPresets } from "./presets.js";
import { writeInspectReport, writePageReport } from "./report.js";
import { captureStyleSnapshots, diffStyleSnapshots } from "./styles.js";
import type { ComparePagesOptions, InspectSelectorOptions, InspectSelectorReport, PageComparisonReport } from "./types.js";
import { ensureDir, makeRunDir, slugify, uniqueNonEmpty } from "./utils.js";

export async function comparePages(rawOptions: ComparePagesOptions): Promise<PageComparisonReport> {
  const options = applyPresets(rawOptions);
  const viewport = normalizeViewport(options.viewport);
  const threshold = options.threshold ?? 0.1;
  const maxDiffPercent = options.maxDiffPercent ?? 1;
  const outputDir = options.outputDir ?? "reports/visual-parity";
  const runDir = makeRunDir(outputDir, options.name, `${slugify(options.localUrl)}-${Date.now()}`);
  await ensureDir(runDir);

  const liveScreenshot = path.join(runDir, "live.png");
  const localScreenshot = path.join(runDir, "local.png");
  const diffScreenshot = path.join(runDir, "diff.png");

  const browser = await launchChromium();
  try {
    const context = await createContext(browser, viewport);
    const livePage = await context.newPage();
    const localPage = await context.newPage();

    await preparePage(livePage, options.liveUrl, options);
    await screenshotPage(livePage, liveScreenshot, { fullPage: options.fullPage });

    await preparePage(localPage, options.localUrl, options);
    await screenshotPage(localPage, localScreenshot, { fullPage: options.fullPage });

    const visual = await diffScreenshots(liveScreenshot, localScreenshot, diffScreenshot, threshold, maxDiffPercent);

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
      reportJson: path.join(runDir, "report.json"),
      reportHtml: path.join(runDir, "report.html")
    };

    if (options.compareStyles !== false) {
      const selectors = uniqueNonEmpty(options.selectors).length > 0 ? uniqueNonEmpty(options.selectors) : DEFAULT_SELECTORS;
      const properties = uniqueNonEmpty(options.styleProperties).length > 0 ? uniqueNonEmpty(options.styleProperties) : DEFAULT_STYLE_PROPERTIES;
      const maxElements = options.maxElementsPerSelector ?? 5;
      const liveStyles = await captureStyleSnapshots(livePage, selectors, properties, maxElements);
      const localStyles = await captureStyleSnapshots(localPage, selectors, properties, maxElements);
      const diffs = diffStyleSnapshots(liveStyles, localStyles);
      report.styles = {
        comparedSelectors: selectors.length,
        diffCount: diffs.length,
        diffs,
        live: liveStyles,
        local: localStyles
      };
    }

    await context.close();
    return writePageReport(report);
  } finally {
    await browser.close();
  }
}

export async function inspectSelector(rawOptions: InspectSelectorOptions): Promise<InspectSelectorReport> {
  const options = applyPresets(rawOptions);
  const viewport = normalizeViewport(options.viewport);
  const outputDir = options.outputDir ?? "reports/visual-parity";
  const runDir = makeRunDir(outputDir, options.name, `inspect-${slugify(options.selector)}-${Date.now()}`);
  await ensureDir(runDir);

  const browser = await launchChromium();
  try {
    const context = await createContext(browser, viewport);
    const livePage = await context.newPage();
    const localPage = await context.newPage();

    await preparePage(livePage, options.liveUrl, options);
    await preparePage(localPage, options.localUrl, options);

    const properties = uniqueNonEmpty(options.styleProperties).length > 0 ? uniqueNonEmpty(options.styleProperties) : DEFAULT_STYLE_PROPERTIES;
    const maxElements = options.maxElementsPerSelector ?? 10;
    const live = await captureStyleSnapshots(livePage, [options.selector], properties, maxElements);
    const local = await captureStyleSnapshots(localPage, [options.selector], properties, maxElements);
    const diffs = diffStyleSnapshots(live, local);

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
        diffCount: diffs.length,
        diffs,
        live,
        local
      },
      reportJson: path.join(runDir, "inspect.json"),
      reportHtml: path.join(runDir, "inspect.html")
    };

    await context.close();
    return writeInspectReport(report);
  } finally {
    await browser.close();
  }
}

export async function diffScreenshots(
  livePath: string,
  localPath: string,
  diffPath: string,
  threshold: number,
  maxDiffPercent: number
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

  return {
    width,
    height,
    mismatchedPixels,
    totalPixels,
    diffPercent,
    threshold,
    maxDiffPercent,
    passed: diffPercent <= maxDiffPercent
  };
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
