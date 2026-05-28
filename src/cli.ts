#!/usr/bin/env node
import { Command } from "commander";
import { comparePages, inspectSelector } from "./compare.js";
import { formatCluster, formatCrossPageFinding, formatDiff } from "./report.js";
import { compareRoutes, readPathsFile } from "./routes.js";
import type { ComparePagesOptions, CompareRoutesOptions, InspectSelectorOptions, PageComparisonReport, RoutesComparisonReport, WaitUntil } from "./types.js";
import { DEFAULT_OUTPUT_DIR, toNumber, uniqueNonEmpty } from "./utils.js";

const program = new Command();

program
  .name("visual-parity")
  .description("Visual parity QA between a reference page and a candidate page")
  .version("0.1.0");

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
  .option("--threshold <number>", "pixelmatch threshold", "0.1")
  .option("--max-diff-percent <number>", "Maximum allowed diff percent", "1")
  .option("--selector <css>", "Selector to compare styles/layout for", collect, [])
  .option("--hide <css>", "Selector to hide before screenshot", collect, [])
  .option("--preset <name>", "Preset selector/noise mask bundle, e.g. hubspot, nextjs-fonts", collect, [])
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
  .option("--out <dir>", "Output directory", DEFAULT_OUTPUT_DIR)
  .option("--config <file>", "Visual parity config file, default .visual-parity.json")
  .option("--width <px>", "Viewport width", "1440")
  .option("--height <px>", "Viewport height", "1200")
  .option("--dpr <number>", "Device scale factor", "1")
  .option("--full-page", "Capture full-page screenshots", false)
  .option("--wait-until <state>", "Navigation readiness state: commit, domcontentloaded, load, networkidle", "networkidle")
  .option("--wait-ms <ms>", "Extra wait after page load", "1000")
  .option("--timeout-ms <ms>", "Navigation timeout", "30000")
  .option("--threshold <number>", "pixelmatch threshold", "0.1")
  .option("--max-diff-percent <number>", "Maximum allowed diff percent", "1")
  .option("--selector <css>", "Selector to compare styles/layout for", collect, [])
  .option("--hide <css>", "Selector to hide before screenshot", collect, [])
  .option("--preset <name>", "Preset selector/noise mask bundle, e.g. hubspot, nextjs-fonts", collect, [])
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
        paths
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

program.parseAsync(process.argv).catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exitCode = 1;
});

function collect(value: string, previous: string[]): string[] {
  previous.push(value);
  return previous;
}

function makeCompareOptions(opts: Record<string, any>): ComparePagesOptions {
  return {
    liveUrl: resolveUrlOption(opts.reference, opts.live, "--reference", "--live"),
    localUrl: resolveUrlOption(opts.candidate, opts.local, "--candidate", "--local"),
    outputDir: opts.out,
    name: opts.name,
    configPath: opts.config,
    viewport: {
      width: toNumber(opts.width, 1440),
      height: toNumber(opts.height, 1200),
      deviceScaleFactor: toNumber(opts.dpr, 1)
    },
    fullPage: Boolean(opts.fullPage),
    waitUntil: parseWaitUntil(opts.waitUntil),
    waitMs: toNumber(opts.waitMs, 1000),
    timeoutMs: toNumber(opts.timeoutMs, 30000),
    threshold: toNumber(opts.threshold, 0.1),
    maxDiffPercent: toNumber(opts.maxDiffPercent, 1),
    selectors: uniqueNonEmpty(opts.selector),
    hideSelectors: uniqueNonEmpty(opts.hide),
    presets: uniqueNonEmpty(opts.preset),
    compareStyles: opts.styles !== false
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
    remainingRootCauses: remainingRootCauseCount(report.styles?.analysis?.clusters ?? [], 10)
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
      reportHtml: result.reportHtml
    }))
  };
}

function printPageReport(report: PageComparisonReport): void {
  console.log(`Visual parity: ${report.visual.passed ? "PASS" : "FAIL"}`);
  console.log(`Reference: ${report.liveUrl}`);
  console.log(`Candidate: ${report.localUrl}`);
  console.log(`Diff:  ${report.visual.diffPercent.toFixed(3)}% (max ${report.visual.maxDiffPercent.toFixed(3)}%)`);
  console.log("Artifacts:");
  console.log(`  report: ${report.reportHtml}`);
  console.log(`  json:   ${report.reportJson}`);
  console.log(`  diff:   ${report.screenshots.diff}`);
  const diffs = report.styles?.diffs.slice(0, 10) ?? [];
  const allClusters = report.styles?.analysis?.clusters ?? [];
  const clusters = prioritizedRootCauses(allClusters, 10);
  if (clusters.length > 0) {
    console.log("Top root causes:");
    for (const cluster of clusters) {
      console.log(`  ${formatCluster(cluster)} (${cluster.severity}, ${cluster.count} diffs)`);
      if (cluster.suggestedFix) console.log(`    fix: ${cluster.suggestedFix}`);
    }
    const hiddenCount = remainingRootCauseCount(allClusters, 10);
    if (hiddenCount > 0) console.log(`  ${hiddenCount} minor one-off root causes hidden`);
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

function prioritizedRootCauses<T extends { count: number }>(clusters: T[], limit: number): T[] {
  const repeated = clusters.filter((cluster) => cluster.count >= 2);
  return (repeated.length > 0 ? repeated : clusters).slice(0, limit);
}

function remainingRootCauseCount<T extends { count: number }>(clusters: T[], limit: number): number {
  return Math.max(0, clusters.length - prioritizedRootCauses(clusters, limit).length);
}
