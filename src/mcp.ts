#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { comparePages, inspectSelector } from "./compare.js";
import { formatDiff } from "./report.js";
import { compareRoutes } from "./routes.js";
import type { ComparePagesOptions, CompareRoutesOptions, InspectSelectorOptions, PageComparisonReport, RoutesComparisonReport } from "./types.js";

const waitUntilSchema = z
  .enum(["commit", "domcontentloaded", "load", "networkidle"])
  .default("networkidle")
  .describe("Playwright navigation readiness state. Use 'domcontentloaded' for dev servers with persistent HMR/websocket connections.");

const viewportSchema = z
  .object({
    width: z.number().int().positive().default(1440),
    height: z.number().int().positive().default(1200),
    deviceScaleFactor: z.number().positive().default(1)
  })
  .default({ width: 1440, height: 1200, deviceScaleFactor: 1 });

const comparePagesSchema = {
  referenceUrl: z.string().url().optional().describe("Reference/source page URL"),
  candidateUrl: z.string().url().optional().describe("Candidate/target page URL"),
  liveUrl: z.string().url().optional().describe("Alias for referenceUrl"),
  localUrl: z.string().url().optional().describe("Alias for candidateUrl"),
  outputDir: z.string().optional().describe("Output directory for artifacts"),
  name: z.string().optional().describe("Run name / artifact subdirectory"),
  viewport: viewportSchema.optional(),
  fullPage: z.boolean().default(false),
  waitUntil: waitUntilSchema,
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
  referenceBaseUrl: z.string().url().optional().describe("Reference/source base URL"),
  candidateBaseUrl: z.string().url().optional().describe("Candidate/target base URL"),
  liveBaseUrl: z.string().url().optional().describe("Alias for referenceBaseUrl"),
  localBaseUrl: z.string().url().optional().describe("Alias for candidateBaseUrl"),
  paths: z.array(z.string()).min(1).describe("Route paths to compare"),
  outputDir: z.string().optional().describe("Output directory for artifacts"),
  viewport: viewportSchema.optional(),
  fullPage: z.boolean().default(false),
  waitUntil: waitUntilSchema,
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
  referenceUrl: z.string().url().optional().describe("Reference/source page URL"),
  candidateUrl: z.string().url().optional().describe("Candidate/target page URL"),
  liveUrl: z.string().url().optional().describe("Alias for referenceUrl"),
  localUrl: z.string().url().optional().describe("Alias for candidateUrl"),
  selector: z.string().min(1).describe("CSS selector to inspect"),
  outputDir: z.string().optional().describe("Output directory for artifacts"),
  name: z.string().optional().describe("Run name / artifact subdirectory"),
  viewport: viewportSchema.optional(),
  waitUntil: waitUntilSchema,
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

server.tool("compare_pages", "Compare one reference URL against one candidate URL and write visual parity artifacts", comparePagesSchema, async (input) => {
  const options = normalizePageInput(input as PageInput);
  const report = await comparePages(options);
  return textResult(compactPageSummary(report, input.diffLimit ?? 25));
});

server.tool("compare_routes", "Compare multiple route paths under reference/candidate base URLs", compareRoutesSchema, async (input) => {
  const options = normalizeRoutesInput(input as RoutesInput);
  const report = await compareRoutes(options);
  return textResult(compactRoutesSummary(report, input.diffLimit ?? 25));
});

server.tool("inspect_selector", "Deep inspect one selector between a reference and candidate page", inspectSelectorSchema, async (input) => {
  const options = normalizeInspectInput(input as InspectInput);
  const report = await inspectSelector(options);
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

type PageInput = Omit<ComparePagesOptions, "liveUrl" | "localUrl"> & {
  referenceUrl?: string;
  candidateUrl?: string;
  liveUrl?: string;
  localUrl?: string;
};

type RoutesInput = Omit<CompareRoutesOptions, "liveBaseUrl" | "localBaseUrl"> & {
  referenceBaseUrl?: string;
  candidateBaseUrl?: string;
  liveBaseUrl?: string;
  localBaseUrl?: string;
};

type InspectInput = Omit<InspectSelectorOptions, "liveUrl" | "localUrl"> & {
  referenceUrl?: string;
  candidateUrl?: string;
  liveUrl?: string;
  localUrl?: string;
};

function normalizePageInput(input: PageInput): ComparePagesOptions {
  return {
    ...input,
    liveUrl: resolveUrlPair(input.referenceUrl, input.liveUrl, "referenceUrl", "liveUrl"),
    localUrl: resolveUrlPair(input.candidateUrl, input.localUrl, "candidateUrl", "localUrl")
  };
}

function normalizeRoutesInput(input: RoutesInput): CompareRoutesOptions {
  return {
    ...input,
    liveBaseUrl: resolveUrlPair(input.referenceBaseUrl, input.liveBaseUrl, "referenceBaseUrl", "liveBaseUrl"),
    localBaseUrl: resolveUrlPair(input.candidateBaseUrl, input.localBaseUrl, "candidateBaseUrl", "localBaseUrl")
  };
}

function normalizeInspectInput(input: InspectInput): InspectSelectorOptions {
  return {
    ...input,
    liveUrl: resolveUrlPair(input.referenceUrl, input.liveUrl, "referenceUrl", "liveUrl"),
    localUrl: resolveUrlPair(input.candidateUrl, input.localUrl, "candidateUrl", "localUrl")
  };
}

function resolveUrlPair(primary: string | undefined, alias: string | undefined, primaryName: string, aliasName: string): string {
  if (primary && alias && primary !== alias) {
    throw new Error(`Provide either ${primaryName} or ${aliasName}, not conflicting values for both.`);
  }
  const value = primary ?? alias;
  if (!value) {
    throw new Error(`Provide ${primaryName} (or legacy ${aliasName}).`);
  }
  return value;
}

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
