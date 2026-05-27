#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { comparePages, inspectSelector } from "./compare.js";
import { formatDiff } from "./report.js";
import { compareRoutes } from "./routes.js";
import type { ComparePagesOptions, CompareRoutesOptions, InspectSelectorOptions, PageComparisonReport, RoutesComparisonReport } from "./types.js";

const viewportSchema = z
  .object({
    width: z.number().int().positive().default(1440),
    height: z.number().int().positive().default(1200),
    deviceScaleFactor: z.number().positive().default(1)
  })
  .default({ width: 1440, height: 1200, deviceScaleFactor: 1 });

const comparePagesSchema = {
  liveUrl: z.string().url().describe("Live/source page URL"),
  localUrl: z.string().url().describe("Local/migrated page URL"),
  outputDir: z.string().optional().describe("Output directory for artifacts"),
  name: z.string().optional().describe("Run name / artifact subdirectory"),
  viewport: viewportSchema.optional(),
  fullPage: z.boolean().default(false),
  waitMs: z.number().int().nonnegative().default(1000),
  timeoutMs: z.number().int().positive().default(30000),
  threshold: z.number().min(0).max(1).default(0.1),
  maxDiffPercent: z.number().min(0).default(1),
  selectors: z.array(z.string()).optional(),
  styleProperties: z.array(z.string()).optional(),
  hideSelectors: z.array(z.string()).optional(),
  presets: z.array(z.string()).optional().describe("Preset selector/noise mask bundles, e.g. ['hubspot']"),
  maxElementsPerSelector: z.number().int().positive().default(5),
  diffLimit: z.number().int().positive().default(25),
  compareStyles: z.boolean().default(true)
};

const compareRoutesSchema = {
  liveBaseUrl: z.string().url().describe("Live/source base URL"),
  localBaseUrl: z.string().url().describe("Local/migrated base URL"),
  paths: z.array(z.string()).min(1).describe("Route paths to compare"),
  outputDir: z.string().optional().describe("Output directory for artifacts"),
  viewport: viewportSchema.optional(),
  fullPage: z.boolean().default(false),
  waitMs: z.number().int().nonnegative().default(1000),
  timeoutMs: z.number().int().positive().default(30000),
  threshold: z.number().min(0).max(1).default(0.1),
  maxDiffPercent: z.number().min(0).default(1),
  selectors: z.array(z.string()).optional(),
  styleProperties: z.array(z.string()).optional(),
  hideSelectors: z.array(z.string()).optional(),
  presets: z.array(z.string()).optional().describe("Preset selector/noise mask bundles, e.g. ['hubspot']"),
  maxElementsPerSelector: z.number().int().positive().default(5),
  diffLimit: z.number().int().positive().default(25),
  compareStyles: z.boolean().default(true)
};

const inspectSelectorSchema = {
  liveUrl: z.string().url().describe("Live/source page URL"),
  localUrl: z.string().url().describe("Local/migrated page URL"),
  selector: z.string().min(1).describe("CSS selector to inspect"),
  outputDir: z.string().optional().describe("Output directory for artifacts"),
  name: z.string().optional().describe("Run name / artifact subdirectory"),
  viewport: viewportSchema.optional(),
  waitMs: z.number().int().nonnegative().default(1000),
  timeoutMs: z.number().int().positive().default(30000),
  styleProperties: z.array(z.string()).optional(),
  hideSelectors: z.array(z.string()).optional(),
  presets: z.array(z.string()).optional().describe("Preset selector/noise mask bundles, e.g. ['hubspot']"),
  maxElementsPerSelector: z.number().int().positive().default(10),
  diffLimit: z.number().int().positive().default(25)
};

const server = new McpServer({
  name: "visual-parity-mcp",
  version: "0.1.0"
});

server.tool("compare_pages", "Compare one live URL against one local URL and write visual parity artifacts", comparePagesSchema, async (input) => {
  const report = await comparePages(input as ComparePagesOptions);
  return textResult(compactPageSummary(report, input.diffLimit ?? 25));
});

server.tool("compare_routes", "Compare multiple route paths under live/local base URLs", compareRoutesSchema, async (input) => {
  const report = await compareRoutes(input as CompareRoutesOptions);
  return textResult(compactRoutesSummary(report, input.diffLimit ?? 25));
});

server.tool("inspect_selector", "Deep inspect one selector between a live and local page", inspectSelectorSchema, async (input) => {
  const report = await inspectSelector(input as InspectSelectorOptions);
  return textResult({
    selector: report.selector,
    diffCount: report.styles.diffCount,
    reportJson: report.reportJson,
    reportHtml: report.reportHtml,
    screenshots: report.screenshots,
    liveCount: report.styles.live[0]?.count ?? 0,
    localCount: report.styles.local[0]?.count ?? 0,
    topDiffs: report.styles.diffs.slice(0, input.diffLimit ?? 25).map(formatDiff)
  });
});

const transport = new StdioServerTransport();
await server.connect(transport);

function textResult(value: unknown) {
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(value, null, 2)
      }
    ]
  };
}

function compactPageSummary(report: PageComparisonReport, limit: number) {
  return {
    passed: report.visual.passed,
    diffPercent: Number(report.visual.diffPercent.toFixed(4)),
    maxDiffPercent: report.visual.maxDiffPercent,
    liveUrl: report.liveUrl,
    localUrl: report.localUrl,
    screenshots: report.screenshots,
    reportJson: report.reportJson,
    reportHtml: report.reportHtml,
    styleDiffCount: report.styles?.diffCount ?? 0,
    topDiffs: report.styles?.diffs.slice(0, limit).map(formatDiff) ?? []
  };
}

function compactRoutesSummary(report: RoutesComparisonReport, limit: number) {
  return {
    total: report.total,
    passed: report.passed,
    failed: report.failed,
    averageDiffPercent: Number(report.averageDiffPercent.toFixed(4)),
    summaryJson: report.summaryJson,
    summaryHtml: report.summaryHtml,
    results: report.results.map((result) => ({
      passed: result.visual.passed,
      diffPercent: Number(result.visual.diffPercent.toFixed(4)),
      liveUrl: result.liveUrl,
      localUrl: result.localUrl,
      reportHtml: result.reportHtml,
      diffImage: result.screenshots.diff,
      topDiffs: result.styles?.diffs.slice(0, Math.min(limit, 10)).map(formatDiff) ?? []
    }))
  };
}
