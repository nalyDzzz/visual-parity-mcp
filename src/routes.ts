import fs from "node:fs/promises";
import path from "node:path";
import { aggregateCrossPageFindings } from "./analysis.js";
import { comparePages } from "./compare.js";
import { writeRoutesSummary } from "./report.js";
import type { CompareRoutesOptions, RoutesComparisonReport } from "./types.js";
import { DEFAULT_OUTPUT_DIR, ensureDir, joinUrl, resolveOutputDir, slugify } from "./utils.js";

export async function compareRoutes(options: CompareRoutesOptions): Promise<RoutesComparisonReport> {
  const outputDir = resolveOutputDir(options.outputDir ?? DEFAULT_OUTPUT_DIR);
  await ensureDir(outputDir);

  const results = [];
  for (const routePath of options.paths) {
    const liveUrl = joinUrl(options.liveBaseUrl, routePath);
    const localUrl = joinUrl(options.localBaseUrl, routePath);
    const name = routePath === "/" ? "root" : slugify(routePath);
    const result = await comparePages({
      ...options,
      liveUrl,
      localUrl,
      outputDir,
      name
    });
    results.push(result);
  }

  const passed = results.filter((result) => result.visual.passed).length;
  const failed = results.length - passed;
  const averageDiffPercent =
    results.length === 0 ? 0 : results.reduce((sum, result) => sum + result.visual.diffPercent, 0) / results.length;
  const crossPageFindings = aggregateCrossPageFindings(results);

  const report: RoutesComparisonReport = {
    createdAt: new Date().toISOString(),
    liveBaseUrl: options.liveBaseUrl,
    localBaseUrl: options.localBaseUrl,
    outputDir,
    total: results.length,
    passed,
    failed,
    averageDiffPercent,
    crossPageFindings,
    results,
    summaryJson: path.join(outputDir, "summary.json"),
    summaryHtml: path.join(outputDir, "summary.html")
  };

  return writeRoutesSummary(report);
}

export async function readPathsFile(filePath: string): Promise<string[]> {
  const content = await fs.readFile(filePath, "utf8");
  return content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"));
}
