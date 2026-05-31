#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { CallToolResult, ContentBlock } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { artifactImageContent, artifactResourceLink, fileArtifact, type ArtifactFile } from "./artifacts.js";
import { comparePages, inspectSelector } from "./compare.js";
import { formatCluster, formatCrossPageFinding, formatDiff } from "./report.js";
import { compareRoutes } from "./routes.js";
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
  StyleFixPlan
} from "./types.js";
import { VERSION } from "./version.js";

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

const acceptedDeviationSchema = z.object({
  selector: z.string().optional().describe("Selector to ignore, supports '*' wildcard"),
  property: z.string().optional().describe("CSS/style property to ignore"),
  kind: z.enum(["count", "style", "rect", "text"]).optional(),
  pattern: z.string().optional().describe("Regex matched against reference or candidate value"),
  reason: z.string().optional()
});

const comparePagesSchema = {
  referenceUrl: z.string().url().optional().describe("Reference/source page URL"),
  candidateUrl: z.string().url().optional().describe("Candidate/target page URL"),
  liveUrl: z.string().url().optional().describe("Alias for referenceUrl"),
  localUrl: z.string().url().optional().describe("Alias for candidateUrl"),
  outputDir: z.string().optional().describe("Output directory for artifacts"),
  name: z.string().optional().describe("Run name / artifact subdirectory"),
  configPath: z.string().optional().describe("Visual parity config file, default .visual-parity.json"),
  viewport: viewportSchema.optional(),
  fullPage: z.boolean().default(false),
  waitUntil: waitUntilSchema,
  waitMs: z.number().int().nonnegative().default(1000),
  timeoutMs: z.number().int().positive().default(30000),
  loadRetries: z.number().int().nonnegative().default(1).describe("Retry count for blocked or transiently empty page loads"),
  retryDelayMs: z.number().int().nonnegative().default(1000),
  userAgent: z.string().optional().describe("Override browser user agent"),
  persistentContextDir: z.string().optional().describe("Reuse cookies/storage from a persistent Playwright profile directory"),
  softPageHealth: z.boolean().default(false).describe("Return health warnings instead of failing on broken-page checks"),
  threshold: z.number().min(0).max(1).default(0.1),
  maxDiffPercent: z.number().min(0).default(1),
  selectors: z.array(z.string()).optional(),
  styleProperties: z.array(z.string()).optional(),
  hideSelectors: z.array(z.string()).optional(),
  presets: z.array(z.string()).optional().describe("Preset selector/noise mask bundles, e.g. ['hubspot', 'nextjs-fonts']"),
  acceptedDeviations: z.array(acceptedDeviationSchema).optional(),
  maxElementsPerSelector: z.number().int().positive().default(5),
  diffLimit: z.number().int().positive().default(25),
  compareStyles: z.boolean().default(true),
  scrollPositions: z.array(z.number().nonnegative()).optional().describe("Optional viewport scroll positions to compare after the base screenshot. Values 0..1 are page progress; values >1 are pixels.")
};

const compareRoutesSchema = {
  referenceBaseUrl: z.string().url().optional().describe("Reference/source base URL"),
  candidateBaseUrl: z.string().url().optional().describe("Candidate/target base URL"),
  liveBaseUrl: z.string().url().optional().describe("Alias for referenceBaseUrl"),
  localBaseUrl: z.string().url().optional().describe("Alias for candidateBaseUrl"),
  paths: z.array(z.string()).min(1).describe("Route paths to compare"),
  concurrency: z.number().int().positive().default(1).describe("Number of route comparisons to run at once"),
  outputDir: z.string().optional().describe("Output directory for artifacts"),
  configPath: z.string().optional().describe("Visual parity config file, default .visual-parity.json"),
  viewport: viewportSchema.optional(),
  fullPage: z.boolean().default(false),
  waitUntil: waitUntilSchema,
  waitMs: z.number().int().nonnegative().default(1000),
  timeoutMs: z.number().int().positive().default(30000),
  loadRetries: z.number().int().nonnegative().default(1),
  retryDelayMs: z.number().int().nonnegative().default(1000),
  userAgent: z.string().optional(),
  persistentContextDir: z.string().optional(),
  softPageHealth: z.boolean().default(false),
  threshold: z.number().min(0).max(1).default(0.1),
  maxDiffPercent: z.number().min(0).default(1),
  selectors: z.array(z.string()).optional(),
  styleProperties: z.array(z.string()).optional(),
  hideSelectors: z.array(z.string()).optional(),
  presets: z.array(z.string()).optional().describe("Preset selector/noise mask bundles, e.g. ['hubspot', 'nextjs-fonts']"),
  acceptedDeviations: z.array(acceptedDeviationSchema).optional(),
  maxElementsPerSelector: z.number().int().positive().default(5),
  diffLimit: z.number().int().positive().default(25),
  compareStyles: z.boolean().default(true),
  scrollPositions: z.array(z.number().nonnegative()).optional().describe("Optional viewport scroll positions to compare after the base screenshot. Values 0..1 are page progress; values >1 are pixels.")
};

const inspectSelectorSchema = {
  referenceUrl: z.string().url().optional().describe("Reference/source page URL"),
  candidateUrl: z.string().url().optional().describe("Candidate/target page URL"),
  liveUrl: z.string().url().optional().describe("Alias for referenceUrl"),
  localUrl: z.string().url().optional().describe("Alias for candidateUrl"),
  selector: z.string().min(1).describe("CSS selector to inspect"),
  outputDir: z.string().optional().describe("Output directory for artifacts"),
  name: z.string().optional().describe("Run name / artifact subdirectory"),
  configPath: z.string().optional().describe("Visual parity config file, default .visual-parity.json"),
  viewport: viewportSchema.optional(),
  waitUntil: waitUntilSchema,
  waitMs: z.number().int().nonnegative().default(1000),
  timeoutMs: z.number().int().positive().default(30000),
  loadRetries: z.number().int().nonnegative().default(1),
  retryDelayMs: z.number().int().nonnegative().default(1000),
  userAgent: z.string().optional(),
  persistentContextDir: z.string().optional(),
  softPageHealth: z.boolean().default(false),
  styleProperties: z.array(z.string()).optional(),
  hideSelectors: z.array(z.string()).optional(),
  presets: z.array(z.string()).optional().describe("Preset selector/noise mask bundles, e.g. ['hubspot', 'nextjs-fonts']"),
  acceptedDeviations: z.array(acceptedDeviationSchema).optional(),
  maxElementsPerSelector: z.number().int().positive().default(10),
  diffLimit: z.number().int().positive().default(25)
};

const discoverSectionsSchema = {
  referenceUrl: z.string().url().optional().describe("Reference/source page URL"),
  candidateUrl: z.string().url().optional().describe("Candidate/target page URL"),
  liveUrl: z.string().url().optional().describe("Alias for referenceUrl"),
  localUrl: z.string().url().optional().describe("Alias for candidateUrl"),
  outputDir: z.string().optional().describe("Output directory for optional crop artifacts"),
  name: z.string().optional().describe("Run name / artifact subdirectory"),
  viewport: viewportSchema.optional(),
  waitUntil: waitUntilSchema,
  waitMs: z.number().int().nonnegative().default(1000),
  timeoutMs: z.number().int().positive().default(30000),
  loadRetries: z.number().int().nonnegative().default(1),
  retryDelayMs: z.number().int().nonnegative().default(1000),
  userAgent: z.string().optional(),
  persistentContextDir: z.string().optional(),
  softPageHealth: z.boolean().default(false),
  hideSelectors: z.array(z.string()).optional(),
  presets: z.array(z.string()).optional(),
  maxSections: z.number().int().positive().default(12),
  includeCrops: z.boolean().default(false).describe("Capture reference/candidate section crop images for discovered sections")
};

const compareSectionSchema = {
  ...comparePagesSchema,
  referenceSelector: z.string().min(1).describe("Reference page section selector to crop and compare"),
  localSelector: z.string().min(1).optional().describe("Candidate page section selector; defaults to referenceSelector"),
  sectionLabel: z.string().optional().describe("Human-readable section label"),
  sectionSelectors: z.array(z.string()).optional().describe("Selectors to inspect inside the section; use ':scope' for the root")
};

const compareSectionsSchema = {
  ...discoverSectionsSchema,
  configPath: z.string().optional().describe("Visual parity config file, default .visual-parity.json"),
  threshold: z.number().min(0).max(1).default(0.1),
  maxDiffPercent: z.number().min(0).default(1),
  concurrency: z.number().int().positive().default(1).describe("Number of section comparisons to run at once"),
  styleProperties: z.array(z.string()).optional(),
  sectionSelectors: z.array(z.string()).optional(),
  acceptedDeviations: z.array(acceptedDeviationSchema).optional(),
  maxElementsPerSelector: z.number().int().positive().default(5),
  diffLimit: z.number().int().positive().default(25)
};

const server = new McpServer({
  name: "visual-parity-mcp",
  version: VERSION
});

server.tool("compare_pages", "Compare one reference URL against one candidate URL and write visual parity artifacts", comparePagesSchema, async (input) => {
  const options = normalizePageInput(input as PageInput);
  const report = await comparePages(options);
  return artifactResult(compactPageSummary(report, input.diffLimit ?? 25), pageArtifacts(report), [fileArtifact(report.screenshots.diff, "diff-image", "Pixel diff image", "Pixel-level visual difference image")]);
});

server.tool("compare_routes", "Compare multiple route paths under reference/candidate base URLs", compareRoutesSchema, async (input) => {
  const options = normalizeRoutesInput(input as RoutesInput);
  const report = await compareRoutes(options);
  return artifactResult(compactRoutesSummary(report, input.diffLimit ?? 25), routesArtifacts(report), []);
});

server.tool("inspect_selector", "Deep inspect one selector between a reference and candidate page", inspectSelectorSchema, async (input) => {
  const options = normalizeInspectInput(input as InspectInput);
  const report = await inspectSelector(options);
  return artifactResult({
    selector: report.selector,
    diffCount: report.styles.diffCount,
    reportJson: report.reportJson,
    reportHtml: report.reportHtml,
    screenshots: report.screenshots,
    liveCount: report.styles.live[0]?.count ?? 0,
    localCount: report.styles.local[0]?.count ?? 0,
    topDiffs: report.styles.diffs.slice(0, input.diffLimit ?? 25).map(formatDiff),
    topRootCauses: prioritizedRootCauses(report.styles.analysis?.clusters ?? [], input.diffLimit ?? 25).map(formatCluster),
    remainingRootCauses: remainingRootCauseCount(report.styles.analysis?.clusters ?? [], input.diffLimit ?? 25)
  }, inspectArtifacts(report), inspectImageArtifacts(report));
});

server.tool("discover_sections", "Discover likely page sections and candidate matches for section-by-section parity work", discoverSectionsSchema, async (input) => {
  const options = normalizeDiscoverSectionsInput(input as DiscoverSectionsInput);
  const report = await discoverSections(options);
  return artifactResult(compactDiscoverSectionsSummary(report), discoverSectionArtifacts(report), discoverSectionImageArtifacts(report));
});

server.tool("compare_section", "Compare one reference section against one candidate section with section crops and scoped style diffs", compareSectionSchema, async (input) => {
  const options = normalizeCompareSectionInput(input as CompareSectionInput);
  const report = await compareSection(options);
  return artifactResult(compactSectionSummary(report, input.diffLimit ?? 25), sectionArtifacts(report), [fileArtifact(report.screenshots.diff, "section-diff-image", "Section diff image")]);
});

server.tool("compare_sections", "Discover and compare page sections as an agent-friendly parity checklist", compareSectionsSchema, async (input) => {
  const options = normalizeCompareSectionsInput(input as CompareSectionsInput);
  const report = await compareSections(options);
  return artifactResult(compactSectionsSummary(report), sectionsArtifacts(report), []);
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

type DiscoverSectionsInput = Omit<DiscoverSectionsOptions, "liveUrl" | "localUrl"> & {
  referenceUrl?: string;
  candidateUrl?: string;
  liveUrl?: string;
  localUrl?: string;
};

type CompareSectionInput = Omit<CompareSectionOptions, "liveUrl" | "localUrl"> & {
  referenceUrl?: string;
  candidateUrl?: string;
  liveUrl?: string;
  localUrl?: string;
};

type CompareSectionsInput = Omit<CompareSectionsOptions, "liveUrl" | "localUrl"> & {
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

async function artifactResult(summary: unknown, links: ArtifactFile[], inlineImages: ArtifactFile[]): Promise<CallToolResult> {
  const content: ContentBlock[] = [
    {
      type: "text",
      text: JSON.stringify(summary, null, 2)
    }
  ];

  for (const image of inlineImages) {
    content.push(await artifactImageContent(image));
  }

  for (const link of links) {
    content.push(await artifactResourceLink(link));
  }

  return { content };
}

function normalizeDiscoverSectionsInput(input: DiscoverSectionsInput): DiscoverSectionsOptions {
  return {
    ...input,
    liveUrl: resolveUrlPair(input.referenceUrl, input.liveUrl, "referenceUrl", "liveUrl"),
    localUrl: resolveUrlPair(input.candidateUrl, input.localUrl, "candidateUrl", "localUrl")
  };
}

function normalizeCompareSectionInput(input: CompareSectionInput): CompareSectionOptions {
  return {
    ...input,
    liveUrl: resolveUrlPair(input.referenceUrl, input.liveUrl, "referenceUrl", "liveUrl"),
    localUrl: resolveUrlPair(input.candidateUrl, input.localUrl, "candidateUrl", "localUrl")
  };
}

function normalizeCompareSectionsInput(input: CompareSectionsInput): CompareSectionsOptions {
  return {
    ...input,
    liveUrl: resolveUrlPair(input.referenceUrl, input.liveUrl, "referenceUrl", "liveUrl"),
    localUrl: resolveUrlPair(input.candidateUrl, input.localUrl, "candidateUrl", "localUrl")
  };
}

function pageArtifacts(report: PageComparisonReport): ArtifactFile[] {
  return [
    fileArtifact(report.reportHtml, "page-report-html", "HTML report", "Human-readable visual parity report"),
    fileArtifact(report.reportJson, "page-report-json", "JSON report", "Machine-readable visual parity report"),
    fileArtifact(report.screenshots.live, "reference-screenshot", "Reference screenshot"),
    fileArtifact(report.screenshots.local, "candidate-screenshot", "Candidate screenshot"),
    fileArtifact(report.screenshots.diff, "diff-image", "Pixel diff image")
  ];
}

function routesArtifacts(report: RoutesComparisonReport): ArtifactFile[] {
  const artifacts = [
    fileArtifact(report.summaryHtml, "routes-summary-html", "Routes HTML summary", "Human-readable route comparison summary"),
    fileArtifact(report.summaryJson, "routes-summary-json", "Routes JSON summary", "Machine-readable route comparison summary")
  ];
  for (const [index, result] of report.results.entries()) {
    artifacts.push(fileArtifact(result.reportHtml, `route-${index + 1}-report-html`, `Route ${index + 1} HTML report`, result.localUrl));
    artifacts.push(fileArtifact(result.screenshots.diff, `route-${index + 1}-diff-image`, `Route ${index + 1} diff image`, result.localUrl));
  }
  return artifacts;
}

function inspectArtifacts(report: Awaited<ReturnType<typeof inspectSelector>>): ArtifactFile[] {
  const artifacts = [
    fileArtifact(report.reportHtml, "inspect-report-html", "Selector inspect HTML report"),
    fileArtifact(report.reportJson, "inspect-report-json", "Selector inspect JSON report")
  ];
  if (report.screenshots.liveCrop) artifacts.push(fileArtifact(report.screenshots.liveCrop, "reference-crop", "Reference selector crop"));
  if (report.screenshots.localCrop) artifacts.push(fileArtifact(report.screenshots.localCrop, "candidate-crop", "Candidate selector crop"));
  return artifacts;
}

function inspectImageArtifacts(report: Awaited<ReturnType<typeof inspectSelector>>): ArtifactFile[] {
  return [
    report.screenshots.liveCrop ? fileArtifact(report.screenshots.liveCrop, "reference-crop", "Reference selector crop") : undefined,
    report.screenshots.localCrop ? fileArtifact(report.screenshots.localCrop, "candidate-crop", "Candidate selector crop") : undefined
  ].filter((artifact): artifact is ArtifactFile => Boolean(artifact));
}

function discoverSectionArtifacts(report: DiscoverSectionsReport): ArtifactFile[] {
  return report.sections.flatMap((section, index) => [
    section.screenshots?.reference ? fileArtifact(section.screenshots.reference, `section-${index + 1}-reference-crop`, `${section.label} reference crop`) : undefined,
    section.screenshots?.candidate ? fileArtifact(section.screenshots.candidate, `section-${index + 1}-candidate-crop`, `${section.label} candidate crop`) : undefined
  ]).filter((artifact): artifact is ArtifactFile => Boolean(artifact));
}

function discoverSectionImageArtifacts(report: DiscoverSectionsReport): ArtifactFile[] {
  return discoverSectionArtifacts(report).slice(0, 4);
}

function sectionArtifacts(report: SectionComparisonReport): ArtifactFile[] {
  return [
    fileArtifact(report.reportHtml, "section-report-html", "Section HTML report"),
    fileArtifact(report.reportJson, "section-report-json", "Section JSON report"),
    fileArtifact(report.screenshots.reference, "section-reference-crop", "Section reference crop"),
    fileArtifact(report.screenshots.candidate, "section-candidate-crop", "Section candidate crop"),
    fileArtifact(report.screenshots.diff, "section-diff-image", "Section diff image")
  ];
}

function sectionsArtifacts(report: CompareSectionsReport): ArtifactFile[] {
  const artifacts = [
    fileArtifact(report.summaryHtml, "sections-summary-html", "Sections checklist HTML"),
    fileArtifact(report.summaryJson, "sections-summary-json", "Sections checklist JSON")
  ];
  for (const [index, section] of report.sections.entries()) {
    if (section.reportHtml) artifacts.push(fileArtifact(section.reportHtml, `section-${index + 1}-report-html`, `${section.label} section HTML report`));
    if (section.reportJson) artifacts.push(fileArtifact(section.reportJson, `section-${index + 1}-report-json`, `${section.label} section report`));
    if (section.diffImage) artifacts.push(fileArtifact(section.diffImage, `section-${index + 1}-diff-image`, `${section.label} section diff`));
  }
  return artifacts;
}

function compactPageSummary(report: PageComparisonReport, limit: number) {
  return {
    passed: report.visual.passed,
    diffPercent: Number(report.visual.diffPercent.toFixed(4)),
    effectiveDiffPercent: Number(report.visual.effectiveDiffPercent.toFixed(4)),
    maskedPixels: report.visual.maskedPixels,
    maxDiffPercent: report.visual.maxDiffPercent,
    liveUrl: report.liveUrl,
    localUrl: report.localUrl,
    screenshots: report.screenshots,
    scrollStates: report.scrollStates?.map((state) => ({
      position: state.position,
      liveScrollY: state.liveScrollY,
      localScrollY: state.localScrollY,
      diffPercent: Number(state.visual.diffPercent.toFixed(4)),
      effectiveDiffPercent: Number(state.visual.effectiveDiffPercent.toFixed(4)),
      passed: state.visual.passed,
      screenshots: state.screenshots
    })) ?? [],
    reportJson: report.reportJson,
    reportHtml: report.reportHtml,
    health: report.health
      ? {
          live: { status: report.health.live.status, hiddenElementCount: report.health.live.hiddenElementCount, warnings: report.health.live.warnings },
          local: { status: report.health.local.status, hiddenElementCount: report.health.local.hiddenElementCount, warnings: report.health.local.warnings }
        }
      : undefined,
    styleDiffCount: report.styles?.diffCount ?? 0,
    rawStyleDiffCount: report.styles?.rawDiffCount ?? report.styles?.diffCount ?? 0,
    topRootCauses: prioritizedRootCauses(report.styles?.analysis?.clusters ?? [], limit).map((cluster) => ({
      finding: formatCluster(cluster),
      count: cluster.count,
      severity: cluster.severity,
      fixability: cluster.fixability,
      selectors: cluster.selectors,
      estimatedResolution: cluster.estimatedResolution,
      suggestedFix: cluster.suggestedFix,
      examples: cluster.examples.slice(0, 3).map(formatDiff)
    })) ?? [],
    fixPlan: compactFixPlan(report.styles?.analysis?.fixPlan),
    remainingRootCauses: remainingRootCauseCount(report.styles?.analysis?.clusters ?? [], limit),
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
    crossPageFindings: report.crossPageFindings?.slice(0, limit).map((finding) => ({
      finding: formatCrossPageFinding(finding),
      pageCount: finding.pageCount,
      totalPages: finding.totalPages,
      totalDiffs: finding.totalDiffs,
      estimatedDiffPercent: finding.estimatedDiffPercent,
      selectors: finding.selectors,
      suggestedFix: finding.suggestedFix,
      pages: finding.pages.slice(0, 5)
    })) ?? [],
    results: report.results.map((result) => ({
      passed: result.visual.passed,
      diffPercent: Number(result.visual.diffPercent.toFixed(4)),
      effectiveDiffPercent: Number(result.visual.effectiveDiffPercent.toFixed(4)),
      liveUrl: result.liveUrl,
      localUrl: result.localUrl,
      reportHtml: result.reportHtml,
      diffImage: result.screenshots.diff,
      scrollStates: result.scrollStates?.map((state) => ({
        position: state.position,
        effectiveDiffPercent: Number(state.visual.effectiveDiffPercent.toFixed(4)),
        passed: state.visual.passed,
        diffImage: state.screenshots.diff
      })) ?? [],
      topDiffs: result.styles?.diffs.slice(0, Math.min(limit, 10)).map(formatDiff) ?? []
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

function compactSectionSummary(report: SectionComparisonReport, limit: number) {
  return {
    passed: report.visual.passed,
    label: report.section.label,
    referenceSelector: report.section.referenceSelector,
    candidateSelector: report.section.candidateSelector,
    diffPercent: Number(report.visual.diffPercent.toFixed(4)),
    effectiveDiffPercent: Number(report.visual.effectiveDiffPercent.toFixed(4)),
    maxDiffPercent: report.visual.maxDiffPercent,
    screenshots: report.screenshots,
    reportJson: report.reportJson,
    reportHtml: report.reportHtml,
    styleDiffCount: report.styles.diffCount,
    topRootCauses: prioritizedRootCauses(report.styles.analysis?.clusters ?? [], limit).map((cluster) => ({
      finding: formatCluster(cluster),
      count: cluster.count,
      severity: cluster.severity,
      fixability: cluster.fixability,
      suggestedFix: cluster.suggestedFix,
      examples: cluster.examples.slice(0, 3).map(formatDiff)
    })),
    fixPlan: compactFixPlan(report.styles.analysis?.fixPlan),
    topDiffs: report.styles.diffs.slice(0, limit).map(formatDiff)
  };
}

function compactSectionsSummary(report: CompareSectionsReport) {
  return {
    liveUrl: report.liveUrl,
    localUrl: report.localUrl,
    total: report.total,
    passed: report.passed,
    failed: report.failed,
    recommendedOrder: report.recommendedOrder,
    summaryJson: report.summaryJson,
    summaryHtml: report.summaryHtml,
    sections: report.sections
  };
}

function compactFixPlan(plan?: StyleFixPlan) {
  if (!plan) return undefined;
  const compactItems = (items: Array<{ title: string; reason: string; selectors: string[]; suggestedFix?: string }>) =>
    items.slice(0, 5).map((item) => ({
      title: item.title,
      reason: item.reason,
      selectors: item.selectors,
      suggestedFix: item.suggestedFix
    }));
  return {
    globalCssFixes: compactItems(plan.globalCssFixes),
    componentStyleFixes: compactItems(plan.componentStyleFixes),
    contentMismatches: compactItems(plan.contentMismatches),
    probableNoise: compactItems(plan.probableNoise),
    needsReview: compactItems(plan.needsReview)
  };
}

function prioritizedRootCauses<T extends { count: number }>(clusters: T[], limit: number): T[] {
  const repeated = clusters.filter((cluster) => cluster.count >= 2);
  return (repeated.length > 0 ? repeated : clusters).slice(0, limit);
}

function remainingRootCauseCount<T extends { count: number }>(clusters: T[], limit: number): number {
  return Math.max(0, clusters.length - prioritizedRootCauses(clusters, limit).length);
}
