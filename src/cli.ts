#!/usr/bin/env node
import { Command } from "commander";
import { comparePages, inspectSelector } from "./compare.js";
import { formatCluster, formatCrossPageFinding, formatDiff } from "./report.js";
import { compareRoutes, readPathsFile } from "./routes.js";
import { compareSection, compareSections, discoverSections } from "./sections.js";
import type {
  ComparePagesOptions,
  CompareRoutesOptions,
  CompareSectionOptions,
  CompareSectionsOptions,
  CompareSectionsReport,
  DiscoverSectionsOptions,
  DiscoverSectionsReport,
  InspectSelectorOptions,
  PageComparisonReport,
  RoutesComparisonReport,
  SectionComparisonReport,
  WaitUntil
} from "./types.js";
import { DEFAULT_OUTPUT_DIR, toNumber, uniqueNonEmpty } from "./utils.js";
import { VERSION } from "./version.js";

const program = new Command();

program
  .name("visual-parity")
  .description("Visual parity QA between a reference page and a candidate page")
  .version(VERSION);

program
  .command("compare")
  .description("Compare one reference URL against one candidate URL")
  .option("--reference <url>", "Reference/source URL")
  .option("--candidate <url>", "Candidate/target URL")
  .option("--live <url>", "Alias for --reference")
  .option("--local <url>", "Alias for --candidate")
  .option("--out <dir>", "Output directory", DEFAULT_OUTPUT_DIR)
  .option("--name <slug>", "Run name")
  .option("--config <file>", "Visual parity config file, default .visual-parity.json")
  .option("--width <px>", "Viewport width", "1440")
  .option("--height <px>", "Viewport height", "1200")
  .option("--dpr <number>", "Device scale factor", "1")
  .option("--full-page", "Capture full-page screenshots", false)
  .option("--wait-until <state>", "Navigation readiness state: commit, domcontentloaded, load, networkidle", "networkidle")
  .option("--wait-ms <ms>", "Extra wait after page load", "1000")
  .option("--timeout-ms <ms>", "Navigation timeout", "30000")
  .option("--load-retries <count>", "Retry count for blocked or transiently empty page loads", "1")
  .option("--retry-delay-ms <ms>", "Delay between page load retries", "1000")
  .option("--user-agent <value>", "Override browser user agent")
  .option("--persistent-context-dir <dir>", "Reuse cookies/storage from a persistent Playwright profile directory")
  .option("--soft-page-health", "Warn instead of failing on broken-page health checks", false)
  .option("--threshold <number>", "pixelmatch threshold", "0.1")
  .option("--max-diff-percent <number>", "Maximum allowed diff percent", "1")
  .option("--selector <css>", "Selector to compare styles/layout for", collect, [])
  .option("--hide <css>", "Selector to hide before screenshot", collect, [])
  .option("--preset <name>", "Preset selector/noise mask bundle, e.g. hubspot, nextjs-fonts", collect, [])
  .option("--scroll-position <value>", "Repeatable viewport scroll state to compare after the base screenshot; 0..1 = page progress, >1 = pixels", collect, [])
  .option("--no-styles", "Disable computed style extraction")
  .option("--json", "Print compact JSON only", false)
  .action(async (opts) => {
    await runCommand(async () => {
      const options: ComparePagesOptions = makeCompareOptions(opts);
      const report = await comparePages(options);
      if (opts.json) {
        console.log(JSON.stringify(compactPageSummary(report), null, 2));
      } else {
        printPageReport(report);
      }
      if (!report.visual.passed) process.exitCode = 2;
    });
  });

program
  .command("routes")
  .description("Compare multiple paths under two base URLs")
  .option("--reference-base <url>", "Reference/source base URL")
  .option("--candidate-base <url>", "Candidate/target base URL")
  .option("--live-base <url>", "Alias for --reference-base")
  .option("--local-base <url>", "Alias for --candidate-base")
  .option("--path <path>", "Route path to compare", collect, [])
  .option("--paths-file <file>", "Newline-separated route paths")
  .option("--concurrency <count>", "Number of route comparisons to run at once", "1")
  .option("--out <dir>", "Output directory", DEFAULT_OUTPUT_DIR)
  .option("--config <file>", "Visual parity config file, default .visual-parity.json")
  .option("--width <px>", "Viewport width", "1440")
  .option("--height <px>", "Viewport height", "1200")
  .option("--dpr <number>", "Device scale factor", "1")
  .option("--full-page", "Capture full-page screenshots", false)
  .option("--wait-until <state>", "Navigation readiness state: commit, domcontentloaded, load, networkidle", "networkidle")
  .option("--wait-ms <ms>", "Extra wait after page load", "1000")
  .option("--timeout-ms <ms>", "Navigation timeout", "30000")
  .option("--load-retries <count>", "Retry count for blocked or transiently empty page loads", "1")
  .option("--retry-delay-ms <ms>", "Delay between page load retries", "1000")
  .option("--user-agent <value>", "Override browser user agent")
  .option("--persistent-context-dir <dir>", "Reuse cookies/storage from a persistent Playwright profile directory")
  .option("--soft-page-health", "Warn instead of failing on broken-page health checks", false)
  .option("--threshold <number>", "pixelmatch threshold", "0.1")
  .option("--max-diff-percent <number>", "Maximum allowed diff percent", "1")
  .option("--selector <css>", "Selector to compare styles/layout for", collect, [])
  .option("--hide <css>", "Selector to hide before screenshot", collect, [])
  .option("--preset <name>", "Preset selector/noise mask bundle, e.g. hubspot, nextjs-fonts", collect, [])
  .option("--scroll-position <value>", "Repeatable viewport scroll state to compare after the base screenshot; 0..1 = page progress, >1 = pixels", collect, [])
  .option("--no-styles", "Disable computed style extraction")
  .option("--json", "Print compact JSON only", false)
  .action(async (opts) => {
    await runCommand(async () => {
      const pathsFromFile = opts.pathsFile ? await readPathsFile(opts.pathsFile) : [];
      const paths = uniqueNonEmpty([...(opts.path ?? []), ...pathsFromFile]);
      if (paths.length === 0) {
        throw new Error("Provide at least one --path or --paths-file entry.");
      }
      const referenceBaseUrl = resolveUrlOption(opts.referenceBase, opts.liveBase, "--reference-base", "--live-base");
      const candidateBaseUrl = resolveUrlOption(opts.candidateBase, opts.localBase, "--candidate-base", "--local-base");
      const options: CompareRoutesOptions = {
        ...makeCompareOptions({ ...opts, reference: "http://placeholder", candidate: "http://placeholder" }),
        liveBaseUrl: referenceBaseUrl,
        localBaseUrl: candidateBaseUrl,
        paths,
        concurrency: Math.max(1, Math.floor(toNumber(opts.concurrency, 1)))
      };
      const report = await compareRoutes(options);
      if (opts.json) {
        console.log(JSON.stringify(compactRoutesSummary(report), null, 2));
      } else {
        printRoutesReport(report);
      }
      if (report.failed > 0) process.exitCode = 2;
    });
  });

program
  .command("inspect")
  .description("Inspect one selector on reference and candidate pages")
  .option("--reference <url>", "Reference/source URL")
  .option("--candidate <url>", "Candidate/target URL")
  .option("--live <url>", "Alias for --reference")
  .option("--local <url>", "Alias for --candidate")
  .requiredOption("--selector <css>", "CSS selector to inspect")
  .option("--out <dir>", "Output directory", DEFAULT_OUTPUT_DIR)
  .option("--name <slug>", "Run name")
  .option("--config <file>", "Visual parity config file, default .visual-parity.json")
  .option("--width <px>", "Viewport width", "1440")
  .option("--height <px>", "Viewport height", "1200")
  .option("--dpr <number>", "Device scale factor", "1")
  .option("--wait-until <state>", "Navigation readiness state: commit, domcontentloaded, load, networkidle", "networkidle")
  .option("--wait-ms <ms>", "Extra wait after page load", "1000")
  .option("--timeout-ms <ms>", "Navigation timeout", "30000")
  .option("--load-retries <count>", "Retry count for blocked or transiently empty page loads", "1")
  .option("--retry-delay-ms <ms>", "Delay between page load retries", "1000")
  .option("--user-agent <value>", "Override browser user agent")
  .option("--persistent-context-dir <dir>", "Reuse cookies/storage from a persistent Playwright profile directory")
  .option("--soft-page-health", "Warn instead of failing on broken-page health checks", false)
  .option("--hide <css>", "Selector to hide before screenshot", collect, [])
  .option("--preset <name>", "Preset selector/noise mask bundle, e.g. hubspot, nextjs-fonts", collect, [])
  .option("--json", "Print compact JSON only", false)
  .action(async (opts) => {
    await runCommand(async () => {
      const options: InspectSelectorOptions = {
        liveUrl: resolveUrlOption(opts.reference, opts.live, "--reference", "--live"),
        localUrl: resolveUrlOption(opts.candidate, opts.local, "--candidate", "--local"),
        selector: opts.selector,
        outputDir: opts.out,
        name: opts.name,
        configPath: opts.config,
        viewport: {
          width: toNumber(opts.width, 1440),
          height: toNumber(opts.height, 1200),
          deviceScaleFactor: toNumber(opts.dpr, 1)
        },
        waitUntil: parseWaitUntil(opts.waitUntil),
        waitMs: toNumber(opts.waitMs, 1000),
        timeoutMs: toNumber(opts.timeoutMs, 30000),
        loadRetries: toNumber(opts.loadRetries, 1),
        retryDelayMs: toNumber(opts.retryDelayMs, 1000),
        userAgent: stringOption(opts.userAgent),
        persistentContextDir: stringOption(opts.persistentContextDir),
        softPageHealth: Boolean(opts.softPageHealth),
        hideSelectors: uniqueNonEmpty(opts.hide),
        presets: uniqueNonEmpty(opts.preset)
      };
      const report = await inspectSelector(options);
      const summary = {
        selector: report.selector,
        diffCount: report.styles.diffCount,
        reportJson: report.reportJson,
        reportHtml: report.reportHtml,
        screenshots: report.screenshots,
        topDiffs: report.styles.diffs.slice(0, 25).map(formatDiff),
        topRootCauses: prioritizedRootCauses(report.styles.analysis?.clusters ?? [], 10).map(formatCluster),
        remainingRootCauses: remainingRootCauseCount(report.styles.analysis?.clusters ?? [], 10)
      };
      console.log(opts.json ? JSON.stringify(summary, null, 2) : humanInspectSummary(summary));
    });
  });

program
  .command("discover-sections")
  .description("Discover likely sections and candidate matches for section-by-section parity work")
  .option("--reference <url>", "Reference/source URL")
  .option("--candidate <url>", "Candidate/target URL")
  .option("--live <url>", "Alias for --reference")
  .option("--local <url>", "Alias for --candidate")
  .option("--out <dir>", "Output directory for optional crops", DEFAULT_OUTPUT_DIR)
  .option("--name <slug>", "Run name")
  .option("--width <px>", "Viewport width", "1440")
  .option("--height <px>", "Viewport height", "1200")
  .option("--dpr <number>", "Device scale factor", "1")
  .option("--wait-until <state>", "Navigation readiness state: commit, domcontentloaded, load, networkidle", "networkidle")
  .option("--wait-ms <ms>", "Extra wait after page load", "1000")
  .option("--timeout-ms <ms>", "Navigation timeout", "30000")
  .option("--load-retries <count>", "Retry count for blocked or transiently empty page loads", "1")
  .option("--retry-delay-ms <ms>", "Delay between page load retries", "1000")
  .option("--user-agent <value>", "Override browser user agent")
  .option("--persistent-context-dir <dir>", "Reuse cookies/storage from a persistent Playwright profile directory")
  .option("--soft-page-health", "Warn instead of failing on broken-page health checks", false)
  .option("--hide <css>", "Selector to hide before screenshot", collect, [])
  .option("--preset <name>", "Preset selector/noise mask bundle, e.g. hubspot, nextjs-fonts", collect, [])
  .option("--max-sections <count>", "Maximum sections to discover", "12")
  .option("--include-crops", "Capture reference/candidate crop images for discovered sections", false)
  .option("--json", "Print compact JSON only", false)
  .action(async (opts) => {
    await runCommand(async () => {
      const report = await discoverSections(makeDiscoverSectionsOptions(opts));
      console.log(opts.json ? JSON.stringify(compactDiscoverSectionsSummary(report), null, 2) : humanDiscoverSectionsSummary(report));
    });
  });

program
  .command("section")
  .description("Compare one reference section against one candidate section")
  .option("--reference <url>", "Reference/source URL")
  .option("--candidate <url>", "Candidate/target URL")
  .option("--live <url>", "Alias for --reference")
  .option("--local <url>", "Alias for --candidate")
  .requiredOption("--reference-selector <css>", "Reference section selector")
  .option("--candidate-selector <css>", "Candidate section selector, defaults to --reference-selector")
  .option("--local-selector <css>", "Alias for --candidate-selector")
  .option("--section-label <label>", "Human-readable section label")
  .option("--section-selector <css>", "Selector to inspect inside the section; repeatable", collect, [])
  .option("--out <dir>", "Output directory", DEFAULT_OUTPUT_DIR)
  .option("--name <slug>", "Run name")
  .option("--config <file>", "Visual parity config file, default .visual-parity.json")
  .option("--width <px>", "Viewport width", "1440")
  .option("--height <px>", "Viewport height", "1200")
  .option("--dpr <number>", "Device scale factor", "1")
  .option("--wait-until <state>", "Navigation readiness state: commit, domcontentloaded, load, networkidle", "networkidle")
  .option("--wait-ms <ms>", "Extra wait after page load", "1000")
  .option("--timeout-ms <ms>", "Navigation timeout", "30000")
  .option("--load-retries <count>", "Retry count for blocked or transiently empty page loads", "1")
  .option("--retry-delay-ms <ms>", "Delay between page load retries", "1000")
  .option("--user-agent <value>", "Override browser user agent")
  .option("--persistent-context-dir <dir>", "Reuse cookies/storage from a persistent Playwright profile directory")
  .option("--soft-page-health", "Warn instead of failing on broken-page health checks", false)
  .option("--threshold <number>", "pixelmatch threshold", "0.1")
  .option("--max-diff-percent <number>", "Maximum allowed diff percent", "1")
  .option("--hide <css>", "Selector to hide before screenshot", collect, [])
  .option("--preset <name>", "Preset selector/noise mask bundle, e.g. hubspot, nextjs-fonts", collect, [])
  .option("--json", "Print compact JSON only", false)
  .action(async (opts) => {
    await runCommand(async () => {
      const report = await compareSection(makeCompareSectionOptions(opts));
      console.log(opts.json ? JSON.stringify(compactSectionSummary(report), null, 2) : humanSectionSummary(report));
      if (!report.visual.passed) process.exitCode = 2;
    });
  });

program
  .command("sections")
  .description("Discover and compare page sections as a parity checklist")
  .option("--reference <url>", "Reference/source URL")
  .option("--candidate <url>", "Candidate/target URL")
  .option("--live <url>", "Alias for --reference")
  .option("--local <url>", "Alias for --candidate")
  .option("--section-selector <css>", "Selector to inspect inside each section; repeatable", collect, [])
  .option("--out <dir>", "Output directory", DEFAULT_OUTPUT_DIR)
  .option("--name <slug>", "Run name")
  .option("--config <file>", "Visual parity config file, default .visual-parity.json")
  .option("--width <px>", "Viewport width", "1440")
  .option("--height <px>", "Viewport height", "1200")
  .option("--dpr <number>", "Device scale factor", "1")
  .option("--wait-until <state>", "Navigation readiness state: commit, domcontentloaded, load, networkidle", "networkidle")
  .option("--wait-ms <ms>", "Extra wait after page load", "1000")
  .option("--timeout-ms <ms>", "Navigation timeout", "30000")
  .option("--load-retries <count>", "Retry count for blocked or transiently empty page loads", "1")
  .option("--retry-delay-ms <ms>", "Delay between page load retries", "1000")
  .option("--user-agent <value>", "Override browser user agent")
  .option("--persistent-context-dir <dir>", "Reuse cookies/storage from a persistent Playwright profile directory")
  .option("--soft-page-health", "Warn instead of failing on broken-page health checks", false)
  .option("--threshold <number>", "pixelmatch threshold", "0.1")
  .option("--max-diff-percent <number>", "Maximum allowed diff percent", "1")
  .option("--hide <css>", "Selector to hide before screenshot", collect, [])
  .option("--preset <name>", "Preset selector/noise mask bundle, e.g. hubspot, nextjs-fonts", collect, [])
  .option("--max-sections <count>", "Maximum sections to compare", "12")
  .option("--json", "Print compact JSON only", false)
  .action(async (opts) => {
    await runCommand(async () => {
      const report = await compareSections(makeCompareSectionsOptions(opts));
      console.log(opts.json ? JSON.stringify(report, null, 2) : humanSectionsSummary(report));
      if (report.failed > 0) process.exitCode = 2;
    });
  });

program.parseAsync(process.argv).catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exitCode = 1;
});

function collect(value: string, previous: string[]): string[] {
  previous.push(value);
  return previous;
}

function makeBrowserOptions(opts: Record<string, any>) {
  return {
    outputDir: opts.out,
    name: opts.name,
    viewport: {
      width: toNumber(opts.width, 1440),
      height: toNumber(opts.height, 1200),
      deviceScaleFactor: toNumber(opts.dpr, 1)
    },
    waitUntil: parseWaitUntil(opts.waitUntil),
    waitMs: toNumber(opts.waitMs, 1000),
    timeoutMs: toNumber(opts.timeoutMs, 30000),
    loadRetries: toNumber(opts.loadRetries, 1),
    retryDelayMs: toNumber(opts.retryDelayMs, 1000),
    userAgent: stringOption(opts.userAgent),
    persistentContextDir: stringOption(opts.persistentContextDir),
    softPageHealth: Boolean(opts.softPageHealth),
    hideSelectors: uniqueNonEmpty(opts.hide),
    presets: uniqueNonEmpty(opts.preset)
  };
}

function makeCompareOptions(opts: Record<string, any>): ComparePagesOptions {
  return {
    liveUrl: resolveUrlOption(opts.reference, opts.live, "--reference", "--live"),
    localUrl: resolveUrlOption(opts.candidate, opts.local, "--candidate", "--local"),
    ...makeBrowserOptions(opts),
    configPath: opts.config,
    fullPage: Boolean(opts.fullPage),
    threshold: toNumber(opts.threshold, 0.1),
    maxDiffPercent: toNumber(opts.maxDiffPercent, 1),
    selectors: uniqueNonEmpty(opts.selector),
    scrollPositions: parseNumberList(opts.scrollPosition),
    compareStyles: opts.styles !== false
  };
}

function makeDiscoverSectionsOptions(opts: Record<string, any>): DiscoverSectionsOptions {
  return {
    liveUrl: resolveUrlOption(opts.reference, opts.live, "--reference", "--live"),
    localUrl: resolveUrlOption(opts.candidate, opts.local, "--candidate", "--local"),
    ...makeBrowserOptions(opts),
    maxSections: Math.max(1, Math.floor(toNumber(opts.maxSections, 12))),
    includeCrops: Boolean(opts.includeCrops)
  };
}

function makeCompareSectionOptions(opts: Record<string, any>): CompareSectionOptions {
  const candidateSelector = stringOption(opts.candidateSelector) ?? stringOption(opts.localSelector);
  return {
    liveUrl: resolveUrlOption(opts.reference, opts.live, "--reference", "--live"),
    localUrl: resolveUrlOption(opts.candidate, opts.local, "--candidate", "--local"),
    ...makeBrowserOptions(opts),
    configPath: opts.config,
    threshold: toNumber(opts.threshold, 0.1),
    maxDiffPercent: toNumber(opts.maxDiffPercent, 1),
    referenceSelector: opts.referenceSelector,
    localSelector: candidateSelector,
    sectionLabel: stringOption(opts.sectionLabel),
    sectionSelectors: uniqueNonEmpty(opts.sectionSelector)
  };
}

function makeCompareSectionsOptions(opts: Record<string, any>): CompareSectionsOptions {
  return {
    liveUrl: resolveUrlOption(opts.reference, opts.live, "--reference", "--live"),
    localUrl: resolveUrlOption(opts.candidate, opts.local, "--candidate", "--local"),
    ...makeBrowserOptions(opts),
    configPath: opts.config,
    threshold: toNumber(opts.threshold, 0.1),
    maxDiffPercent: toNumber(opts.maxDiffPercent, 1),
    maxSections: Math.max(1, Math.floor(toNumber(opts.maxSections, 12))),
    sectionSelectors: uniqueNonEmpty(opts.sectionSelector)
  };
}

function resolveUrlOption(primary: unknown, alias: unknown, primaryFlag: string, aliasFlag: string): string {
  const primaryValue = stringOption(primary);
  const aliasValue = stringOption(alias);
  if (primaryValue && aliasValue && primaryValue !== aliasValue) {
    throw new Error(`Provide either ${primaryFlag} or ${aliasFlag}, not conflicting values for both.`);
  }
  const value = primaryValue ?? aliasValue;
  if (!value) {
    throw new Error(`Provide ${primaryFlag} (or legacy ${aliasFlag}).`);
  }
  return value;
}

function stringOption(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function parseWaitUntil(value: unknown): WaitUntil {
  if (value === "commit" || value === "domcontentloaded" || value === "load" || value === "networkidle") {
    return value;
  }
  throw new Error("Invalid --wait-until value. Expected one of: commit, domcontentloaded, load, networkidle.");
}

function parseNumberList(values: unknown): number[] {
  if (!Array.isArray(values)) return [];
  return values.map((value) => toNumber(value, Number.NaN)).filter((value) => Number.isFinite(value) && value >= 0);
}

async function runCommand(fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`visual-parity error: ${message}`);
    process.exitCode = 1;
  }
}

function compactPageSummary(report: PageComparisonReport) {
  return {
    passed: report.visual.passed,
    diffPercent: report.visual.diffPercent,
    effectiveDiffPercent: report.visual.effectiveDiffPercent,
    maskedPixels: report.visual.maskedPixels,
    maxDiffPercent: report.visual.maxDiffPercent,
    screenshots: report.screenshots,
    reportJson: report.reportJson,
    reportHtml: report.reportHtml,
    health: report.health
      ? {
          live: { status: report.health.live.status, hiddenElementCount: report.health.live.hiddenElementCount, warnings: report.health.live.warnings },
          local: { status: report.health.local.status, hiddenElementCount: report.health.local.hiddenElementCount, warnings: report.health.local.warnings }
        }
      : undefined,
    topDiffs: report.styles?.diffs.slice(0, 25).map(formatDiff) ?? [],
    topRootCauses: prioritizedRootCauses(report.styles?.analysis?.clusters ?? [], 10).map(formatCluster),
    fixPlan: report.styles?.analysis?.fixPlan,
    remainingRootCauses: remainingRootCauseCount(report.styles?.analysis?.clusters ?? [], 10),
    scrollStates: report.scrollStates?.map((state) => ({
      position: state.position,
      effectiveDiffPercent: state.visual.effectiveDiffPercent,
      passed: state.visual.passed,
      screenshots: state.screenshots
    })) ?? []
  };
}

function compactRoutesSummary(report: RoutesComparisonReport) {
  return {
    total: report.total,
    passed: report.passed,
    failed: report.failed,
    averageDiffPercent: report.averageDiffPercent,
    summaryJson: report.summaryJson,
    summaryHtml: report.summaryHtml,
    crossPageFindings: report.crossPageFindings?.slice(0, 10).map(formatCrossPageFinding) ?? [],
    results: report.results.map((result) => ({
      passed: result.visual.passed,
      localUrl: result.localUrl,
      diffPercent: result.visual.diffPercent,
      effectiveDiffPercent: result.visual.effectiveDiffPercent,
      scrollStates: result.scrollStates?.map((state) => ({
        position: state.position,
        effectiveDiffPercent: state.visual.effectiveDiffPercent,
        passed: state.visual.passed,
        diff: state.screenshots.diff
      })) ?? [],
      reportHtml: result.reportHtml
    }))
  };
}

function compactDiscoverSectionsSummary(report: DiscoverSectionsReport) {
  return {
    liveUrl: report.liveUrl,
    localUrl: report.localUrl,
    runDir: report.runDir,
    sections: report.sections.map((section) => ({
      label: section.label,
      referenceSelector: section.reference.selector,
      candidateSelector: section.candidate?.selector,
      matchConfidence: section.matchConfidence,
      matchReason: section.matchReason,
      referenceRect: section.reference.rect,
      candidateRect: section.candidate?.rect,
      textSample: section.reference.text.slice(0, 160),
      screenshots: section.screenshots
    }))
  };
}

function compactSectionSummary(report: SectionComparisonReport) {
  return {
    passed: report.visual.passed,
    label: report.section.label,
    referenceSelector: report.section.referenceSelector,
    candidateSelector: report.section.candidateSelector,
    diffPercent: report.visual.diffPercent,
    effectiveDiffPercent: report.visual.effectiveDiffPercent,
    maxDiffPercent: report.visual.maxDiffPercent,
    screenshots: report.screenshots,
    reportJson: report.reportJson,
    reportHtml: report.reportHtml,
    styleDiffCount: report.styles.diffCount,
    topRootCauses: prioritizedRootCauses(report.styles.analysis?.clusters ?? [], 10).map(formatCluster),
    fixPlan: report.styles.analysis?.fixPlan,
    topDiffs: report.styles.diffs.slice(0, 25).map(formatDiff)
  };
}

function printPageReport(report: PageComparisonReport): void {
  console.log(`Visual parity: ${report.visual.passed ? "PASS" : "FAIL"}`);
  console.log(`Reference: ${report.liveUrl}`);
  console.log(`Candidate: ${report.localUrl}`);
  console.log(`Diff:  ${report.visual.diffPercent.toFixed(3)}% (max ${report.visual.maxDiffPercent.toFixed(3)}%)`);
  if (report.visual.effectiveDiffPercent !== report.visual.diffPercent || report.visual.maskedPixels > 0) {
    console.log(`Effective diff: ${report.visual.effectiveDiffPercent.toFixed(3)}% (${report.visual.maskedPixels.toLocaleString()} masked px)`);
  }
  console.log("Artifacts:");
  console.log(`  report: ${report.reportHtml}`);
  console.log(`  json:   ${report.reportJson}`);
  console.log(`  diff:   ${report.screenshots.diff}`);
  if (report.scrollStates && report.scrollStates.length > 0) {
    console.log("Scroll states:");
    for (const state of report.scrollStates) {
      console.log(`  ${state.visual.passed ? "PASS" : "FAIL"} ${state.position}: ${state.visual.effectiveDiffPercent.toFixed(3)}% (${state.screenshots.diff})`);
    }
  }
  const diffs = report.styles?.diffs.slice(0, 10) ?? [];
  const allClusters = report.styles?.analysis?.clusters ?? [];
  const clusters = prioritizedRootCauses(allClusters, 10);
  if (clusters.length > 0) {
    console.log("Top root causes:");
    for (const cluster of clusters) {
      console.log(`  ${formatCluster(cluster)} (${cluster.severity}, ${cluster.fixability ?? "unknown"}, ${cluster.count} diffs)`);
      if (cluster.suggestedFix) console.log(`    fix: ${cluster.suggestedFix}`);
    }
    const hiddenCount = remainingRootCauseCount(allClusters, 10);
    if (hiddenCount > 0) console.log(`  ${hiddenCount} minor one-off root causes hidden`);
    const plan = report.styles?.analysis?.fixPlan;
    const firstAction = plan && [...plan.globalCssFixes, ...plan.componentStyleFixes, ...plan.contentMismatches, ...plan.needsReview][0];
    if (firstAction) {
      console.log("Recommended next action:");
      console.log(`  ${firstAction.title}`);
      console.log(`  ${firstAction.suggestedFix ?? firstAction.reason}`);
    }
  } else if (diffs.length > 0) {
    console.log("Top diffs:");
    for (const diff of diffs) console.log(`  ${formatDiff(diff)}`);
  }
}

function printRoutesReport(report: RoutesComparisonReport): void {
  console.log(`Visual parity routes: ${report.failed === 0 ? "PASS" : "FAIL"}`);
  console.log(`Reference base: ${report.liveBaseUrl}`);
  console.log(`Candidate base: ${report.localBaseUrl}`);
  console.log(`Routes: ${report.total} total, ${report.passed} passed, ${report.failed} failed`);
  console.log(`Average diff: ${report.averageDiffPercent.toFixed(3)}%`);
  console.log(`Summary: ${report.summaryHtml}`);
  const findings = report.crossPageFindings?.slice(0, 10) ?? [];
  if (findings.length > 0) {
    console.log("Cross-page findings:");
    for (const finding of findings) {
      console.log(`  ${formatCrossPageFinding(finding)} (${finding.totalDiffs} diffs on ${finding.pageCount}/${finding.totalPages} pages)`);
      if (finding.suggestedFix) console.log(`    fix: ${finding.suggestedFix}`);
    }
  }
  for (const result of report.results) {
    console.log(`  ${result.visual.passed ? "PASS" : "FAIL"} ${result.localUrl} ${result.visual.diffPercent.toFixed(3)}%`);
  }
}

function humanInspectSummary(summary: { selector: string; diffCount: number; reportJson: string; reportHtml: string; screenshots: unknown; topDiffs: string[]; topRootCauses: string[]; remainingRootCauses: number }): string {
  const lines = [
    `Selector inspect: ${summary.selector}`,
    `Diffs: ${summary.diffCount}`,
    `Report: ${summary.reportHtml}`,
    `JSON: ${summary.reportJson}`,
    `Screenshots: ${JSON.stringify(summary.screenshots)}`
  ];
  if (summary.topRootCauses.length > 0) {
    lines.push("Top root causes:");
    for (const cluster of summary.topRootCauses.slice(0, 10)) lines.push(`  ${cluster}`);
    if (summary.remainingRootCauses > 0) lines.push(`  ${summary.remainingRootCauses} minor one-off root causes hidden`);
  } else if (summary.topDiffs.length > 0) {
    lines.push("Top diffs:");
    for (const diff of summary.topDiffs.slice(0, 10)) lines.push(`  ${diff}`);
  }
  return lines.join("\n");
}

function humanDiscoverSectionsSummary(report: DiscoverSectionsReport): string {
  const lines = [
    "Discovered sections:",
    `Reference: ${report.liveUrl}`,
    `Candidate: ${report.localUrl}`
  ];
  if (report.runDir) lines.push(`Crops: ${report.runDir}`);
  for (const [index, section] of report.sections.entries()) {
    lines.push(
      `  ${index + 1}. ${section.label}`,
      `     reference: ${section.reference.selector}`,
      `     candidate: ${section.candidate?.selector ?? "<no match>"} (${Math.round(section.matchConfidence * 100)}%, ${section.matchReason ?? "no match reason"})`
    );
    if (section.screenshots?.reference || section.screenshots?.candidate) {
      lines.push(`     crops: ${section.screenshots.reference ?? "<none>"} | ${section.screenshots.candidate ?? "<none>"}`);
    }
  }
  return lines.join("\n");
}

function humanSectionSummary(report: SectionComparisonReport): string {
  const lines = [
    `Section parity: ${report.visual.passed ? "PASS" : "FAIL"}`,
    `Section: ${report.section.label}`,
    `Reference selector: ${report.section.referenceSelector}`,
    `Candidate selector: ${report.section.candidateSelector}`,
    `Diff: ${report.visual.diffPercent.toFixed(3)}% (effective ${report.visual.effectiveDiffPercent.toFixed(3)}%, max ${report.visual.maxDiffPercent.toFixed(3)}%)`,
    "Artifacts:",
    `  report: ${report.reportHtml}`,
    `  json: ${report.reportJson}`,
    `  reference: ${report.screenshots.reference}`,
    `  candidate: ${report.screenshots.candidate}`,
    `  diff: ${report.screenshots.diff}`
  ];
  const clusters = prioritizedRootCauses(report.styles.analysis?.clusters ?? [], 8);
  if (clusters.length > 0) {
    lines.push("Top root causes:");
    for (const cluster of clusters) {
      lines.push(`  ${formatCluster(cluster)} (${cluster.severity}, ${cluster.fixability ?? "unknown"}, ${cluster.count} diffs)`);
      if (cluster.suggestedFix) lines.push(`    fix: ${cluster.suggestedFix}`);
    }
  }
  const plan = report.styles.analysis?.fixPlan;
  const firstAction = plan && [...plan.globalCssFixes, ...plan.componentStyleFixes, ...plan.contentMismatches, ...plan.needsReview][0];
  if (firstAction) {
    lines.push("Recommended next action:", `  ${firstAction.suggestedFix ?? firstAction.reason}`);
  }
  return lines.join("\n");
}

function humanSectionsSummary(report: CompareSectionsReport): string {
  const lines = [
    `Section checklist: ${report.failed === 0 ? "PASS" : "FAIL"}`,
    `Reference: ${report.liveUrl}`,
    `Candidate: ${report.localUrl}`,
    `Sections: ${report.total} total, ${report.passed} passed, ${report.failed} failed`,
    `Report: ${report.summaryHtml}`,
    `Summary: ${report.summaryJson}`
  ];
  if (report.recommendedOrder.length > 0) {
    lines.push(`Recommended order: ${report.recommendedOrder.join(" -> ")}`);
  }
  for (const section of report.sections) {
    lines.push(
      `  ${section.passed ? "PASS" : "FAIL"} ${section.label} ${section.effectiveDiffPercent.toFixed(3)}%`,
      `    reference: ${section.referenceSelector}`,
      `    candidate: ${section.candidateSelector ?? "<no match>"}`
    );
    if (section.reportHtml) lines.push(`    report: ${section.reportHtml}`);
    if (section.diffImage) lines.push(`    diff: ${section.diffImage}`);
    lines.push(`    next: ${section.nextAction}`);
  }
  return lines.join("\n");
}

function prioritizedRootCauses<T extends { count: number }>(clusters: T[], limit: number): T[] {
  const repeated = clusters.filter((cluster) => cluster.count >= 2);
  return (repeated.length > 0 ? repeated : clusters).slice(0, limit);
}

function remainingRootCauseCount<T extends { count: number }>(clusters: T[], limit: number): number {
  return Math.max(0, clusters.length - prioritizedRootCauses(clusters, limit).length);
}
