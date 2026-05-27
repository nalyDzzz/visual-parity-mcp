#!/usr/bin/env node
import { Command } from "commander";
import { comparePages, inspectSelector } from "./compare.js";
import { formatDiff } from "./report.js";
import { compareRoutes, readPathsFile } from "./routes.js";
import type { ComparePagesOptions, CompareRoutesOptions, InspectSelectorOptions, PageComparisonReport, RoutesComparisonReport } from "./types.js";
import { toNumber, uniqueNonEmpty } from "./utils.js";

const program = new Command();

program
  .name("visual-parity")
  .description("Visual parity QA between a live site and local migration")
  .version("0.1.0");

program
  .command("compare")
  .description("Compare one live URL against one local URL")
  .requiredOption("--live <url>", "Live/source URL")
  .requiredOption("--local <url>", "Local/migrated URL")
  .option("--out <dir>", "Output directory", "reports/visual-parity")
  .option("--name <slug>", "Run name")
  .option("--width <px>", "Viewport width", "1440")
  .option("--height <px>", "Viewport height", "1200")
  .option("--dpr <number>", "Device scale factor", "1")
  .option("--full-page", "Capture full-page screenshots", false)
  .option("--wait-ms <ms>", "Extra wait after page load", "1000")
  .option("--timeout-ms <ms>", "Navigation timeout", "30000")
  .option("--threshold <number>", "pixelmatch threshold", "0.1")
  .option("--max-diff-percent <number>", "Maximum allowed diff percent", "1")
  .option("--selector <css>", "Selector to compare styles/layout for", collect, [])
  .option("--hide <css>", "Selector to hide before screenshot", collect, [])
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
  .requiredOption("--live-base <url>", "Live/source base URL")
  .requiredOption("--local-base <url>", "Local/migrated base URL")
  .option("--path <path>", "Route path to compare", collect, [])
  .option("--paths-file <file>", "Newline-separated route paths")
  .option("--out <dir>", "Output directory", "reports/visual-parity")
  .option("--width <px>", "Viewport width", "1440")
  .option("--height <px>", "Viewport height", "1200")
  .option("--dpr <number>", "Device scale factor", "1")
  .option("--full-page", "Capture full-page screenshots", false)
  .option("--wait-ms <ms>", "Extra wait after page load", "1000")
  .option("--timeout-ms <ms>", "Navigation timeout", "30000")
  .option("--threshold <number>", "pixelmatch threshold", "0.1")
  .option("--max-diff-percent <number>", "Maximum allowed diff percent", "1")
  .option("--selector <css>", "Selector to compare styles/layout for", collect, [])
  .option("--hide <css>", "Selector to hide before screenshot", collect, [])
  .option("--no-styles", "Disable computed style extraction")
  .option("--json", "Print compact JSON only", false)
  .action(async (opts) => {
    await runCommand(async () => {
      const pathsFromFile = opts.pathsFile ? await readPathsFile(opts.pathsFile) : [];
      const paths = uniqueNonEmpty([...(opts.path ?? []), ...pathsFromFile]);
      if (paths.length === 0) {
        throw new Error("Provide at least one --path or --paths-file entry.");
      }
      const options: CompareRoutesOptions = {
        ...makeCompareOptions({ ...opts, live: "http://placeholder", local: "http://placeholder" }),
        liveBaseUrl: opts.liveBase,
        localBaseUrl: opts.localBase,
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
  .description("Inspect one selector on live and local pages")
  .requiredOption("--live <url>", "Live/source URL")
  .requiredOption("--local <url>", "Local/migrated URL")
  .requiredOption("--selector <css>", "CSS selector to inspect")
  .option("--out <dir>", "Output directory", "reports/visual-parity")
  .option("--name <slug>", "Run name")
  .option("--width <px>", "Viewport width", "1440")
  .option("--height <px>", "Viewport height", "1200")
  .option("--dpr <number>", "Device scale factor", "1")
  .option("--wait-ms <ms>", "Extra wait after page load", "1000")
  .option("--timeout-ms <ms>", "Navigation timeout", "30000")
  .option("--hide <css>", "Selector to hide before screenshot", collect, [])
  .option("--json", "Print compact JSON only", false)
  .action(async (opts) => {
    await runCommand(async () => {
      const options: InspectSelectorOptions = {
        liveUrl: opts.live,
        localUrl: opts.local,
        selector: opts.selector,
        outputDir: opts.out,
        name: opts.name,
        viewport: {
          width: toNumber(opts.width, 1440),
          height: toNumber(opts.height, 1200),
          deviceScaleFactor: toNumber(opts.dpr, 1)
        },
        waitMs: toNumber(opts.waitMs, 1000),
        timeoutMs: toNumber(opts.timeoutMs, 30000),
        hideSelectors: uniqueNonEmpty(opts.hide)
      };
      const report = await inspectSelector(options);
      const summary = {
        selector: report.selector,
        diffCount: report.styles.diffCount,
        reportJson: report.reportJson,
        reportHtml: report.reportHtml,
        screenshots: report.screenshots,
        topDiffs: report.styles.diffs.slice(0, 25).map(formatDiff)
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
    liveUrl: opts.live,
    localUrl: opts.local,
    outputDir: opts.out,
    name: opts.name,
    viewport: {
      width: toNumber(opts.width, 1440),
      height: toNumber(opts.height, 1200),
      deviceScaleFactor: toNumber(opts.dpr, 1)
    },
    fullPage: Boolean(opts.fullPage),
    waitMs: toNumber(opts.waitMs, 1000),
    timeoutMs: toNumber(opts.timeoutMs, 30000),
    threshold: toNumber(opts.threshold, 0.1),
    maxDiffPercent: toNumber(opts.maxDiffPercent, 1),
    selectors: uniqueNonEmpty(opts.selector),
    hideSelectors: uniqueNonEmpty(opts.hide),
    compareStyles: opts.styles !== false
  };
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
    topDiffs: report.styles?.diffs.slice(0, 25).map(formatDiff) ?? []
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
  console.log(`Live:  ${report.liveUrl}`);
  console.log(`Local: ${report.localUrl}`);
  console.log(`Diff:  ${report.visual.diffPercent.toFixed(3)}% (max ${report.visual.maxDiffPercent.toFixed(3)}%)`);
  console.log("Artifacts:");
  console.log(`  report: ${report.reportHtml}`);
  console.log(`  json:   ${report.reportJson}`);
  console.log(`  diff:   ${report.screenshots.diff}`);
  const diffs = report.styles?.diffs.slice(0, 10) ?? [];
  if (diffs.length > 0) {
    console.log("Top diffs:");
    for (const diff of diffs) console.log(`  ${formatDiff(diff)}`);
  }
}

function printRoutesReport(report: RoutesComparisonReport): void {
  console.log(`Visual parity routes: ${report.failed === 0 ? "PASS" : "FAIL"}`);
  console.log(`Routes: ${report.total} total, ${report.passed} passed, ${report.failed} failed`);
  console.log(`Average diff: ${report.averageDiffPercent.toFixed(3)}%`);
  console.log(`Summary: ${report.summaryHtml}`);
  for (const result of report.results) {
    console.log(`  ${result.visual.passed ? "PASS" : "FAIL"} ${result.localUrl} ${result.visual.diffPercent.toFixed(3)}%`);
  }
}

function humanInspectSummary(summary: { selector: string; diffCount: number; reportJson: string; reportHtml: string; screenshots: unknown; topDiffs: string[] }): string {
  const lines = [
    `Selector inspect: ${summary.selector}`,
    `Diffs: ${summary.diffCount}`,
    `Report: ${summary.reportHtml}`,
    `JSON: ${summary.reportJson}`,
    `Screenshots: ${JSON.stringify(summary.screenshots)}`
  ];
  if (summary.topDiffs.length > 0) {
    lines.push("Top diffs:");
    for (const diff of summary.topDiffs.slice(0, 10)) lines.push(`  ${diff}`);
  }
  return lines.join("\n");
}
