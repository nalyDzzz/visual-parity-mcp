import fs from "node:fs/promises";
import path from "node:path";
import type { CrossPageFinding, InspectSelectorReport, PageComparisonReport, RoutesComparisonReport, StyleDiff, StyleDiffCluster, StyleRuleSource } from "./types.js";
import { ensureDir, escapeHtml, relativeForHtml } from "./utils.js";

export async function writePageReport(report: PageComparisonReport): Promise<PageComparisonReport> {
  await ensureDir(report.runDir);
  report.reportJson = path.join(report.runDir, "report.json");
  report.reportHtml = path.join(report.runDir, "report.html");
  await fs.writeFile(report.reportJson, JSON.stringify(report, null, 2));
  await fs.writeFile(report.reportHtml, renderPageReport(report));
  return report;
}

export async function writeInspectReport(report: InspectSelectorReport): Promise<InspectSelectorReport> {
  await ensureDir(report.runDir);
  report.reportJson = path.join(report.runDir, "inspect.json");
  report.reportHtml = path.join(report.runDir, "inspect.html");
  await fs.writeFile(report.reportJson, JSON.stringify(report, null, 2));
  await fs.writeFile(report.reportHtml, renderInspectReport(report));
  return report;
}

export async function writeRoutesSummary(report: RoutesComparisonReport): Promise<RoutesComparisonReport> {
  await ensureDir(report.outputDir);
  report.summaryJson = path.join(report.outputDir, "summary.json");
  report.summaryHtml = path.join(report.outputDir, "summary.html");
  await fs.writeFile(report.summaryJson, JSON.stringify(report, null, 2));
  await fs.writeFile(report.summaryHtml, renderRoutesSummary(report));
  return report;
}

function renderPageReport(report: PageComparisonReport): string {
  const topDiffs = report.styles?.diffs.slice(0, 80) ?? [];
  const liveImg = relativeForHtml(report.screenshots.live, report.runDir);
  const localImg = relativeForHtml(report.screenshots.local, report.runDir);
  const diffImg = relativeForHtml(report.screenshots.diff, report.runDir);
  const status = report.visual.passed ? "PASS" : "FAIL";

  return htmlShell(
    `Visual Parity ${status}`,
    `<section class="hero ${report.visual.passed ? "pass" : "fail"}">
      <div>
        <p class="eyebrow">Visual parity</p>
        <h1>${status}</h1>
        <p>${escapeHtml(report.liveUrl)} <span>vs</span> ${escapeHtml(report.localUrl)}</p>
      </div>
      <dl>
        <div><dt>Diff</dt><dd>${report.visual.diffPercent.toFixed(3)}%</dd></div>
        <div><dt>Max</dt><dd>${report.visual.maxDiffPercent.toFixed(3)}%</dd></div>
        <div><dt>Pixels</dt><dd>${report.visual.mismatchedPixels.toLocaleString()} / ${report.visual.totalPixels.toLocaleString()}</dd></div>
        <div><dt>Viewport</dt><dd>${report.viewport.width}×${report.viewport.height}@${report.viewport.deviceScaleFactor ?? 1}</dd></div>
        ${report.health ? `<div><dt>Hidden</dt><dd>${(report.health.live.hiddenElementCount + report.health.local.hiddenElementCount).toLocaleString()}</dd></div>` : ""}
      </dl>
    </section>
    <section>
      <h2>Screenshots</h2>
      <div class="grid three">
        ${imageCard("Reference", liveImg)}
        ${imageCard("Candidate", localImg)}
        ${imageCard("Diff", diffImg)}
      </div>
    </section>
    <section>
      <h2>Root-cause clusters</h2>
      ${clusterList(report.styles?.analysis?.clusters ?? [], 20)}
    </section>
    <section>
      <h2>Top remaining style/layout diffs</h2>
      ${diffList(topDiffs)}
    </section>
    <section>
      <h2>Artifacts</h2>
      <ul>
        <li>JSON: <code>${escapeHtml(report.reportJson)}</code></li>
        <li>HTML: <code>${escapeHtml(report.reportHtml)}</code></li>
        <li>Diff: <code>${escapeHtml(report.screenshots.diff)}</code></li>
      </ul>
    </section>`
  );
}

function renderInspectReport(report: InspectSelectorReport): string {
  const liveCrop = report.screenshots.liveCrop ? relativeForHtml(report.screenshots.liveCrop, report.runDir) : undefined;
  const localCrop = report.screenshots.localCrop ? relativeForHtml(report.screenshots.localCrop, report.runDir) : undefined;

  return htmlShell(
    `Inspect ${report.selector}`,
    `<section class="hero">
      <div>
        <p class="eyebrow">Selector inspect</p>
        <h1>${escapeHtml(report.selector)}</h1>
        <p>${escapeHtml(report.liveUrl)} <span>vs</span> ${escapeHtml(report.localUrl)}</p>
      </div>
      <dl>
        <div><dt>Diffs</dt><dd>${report.styles.diffCount}</dd></div>
        <div><dt>Reference count</dt><dd>${report.styles.live[0]?.count ?? 0}</dd></div>
        <div><dt>Candidate count</dt><dd>${report.styles.local[0]?.count ?? 0}</dd></div>
      </dl>
    </section>
    <section>
      <h2>First match crops</h2>
      <div class="grid two">
        ${liveCrop ? imageCard("Reference crop", liveCrop) : "<p>No reference crop.</p>"}
        ${localCrop ? imageCard("Candidate crop", localCrop) : "<p>No candidate crop.</p>"}
      </div>
    </section>
    <section>
      <h2>Root-cause clusters</h2>
      ${clusterList(report.styles.analysis?.clusters ?? [], 20)}
    </section>
    <section>
      <h2>Diffs</h2>
      ${diffList(report.styles.diffs.slice(0, 120))}
    </section>`
  );
}

function renderRoutesSummary(report: RoutesComparisonReport): string {
  const rows = report.results
    .map((result) => {
      const status = result.visual.passed ? "PASS" : "FAIL";
      const href = path.relative(report.outputDir, result.reportHtml).split(path.sep).join("/");
      return `<tr><td class="${result.visual.passed ? "ok" : "bad"}">${status}</td><td>${escapeHtml(result.localUrl)}</td><td>${result.visual.diffPercent.toFixed(3)}%</td><td><a href="${escapeHtml(href)}">report</a></td></tr>`;
    })
    .join("\n");

  return htmlShell(
    "Visual Parity Route Summary",
    `<section class="hero ${report.failed === 0 ? "pass" : "fail"}">
      <div>
        <p class="eyebrow">Route summary</p>
        <h1>${report.failed === 0 ? "PASS" : "FAIL"}</h1>
        <p>${escapeHtml(report.liveBaseUrl)} <span>vs</span> ${escapeHtml(report.localBaseUrl)}</p>
      </div>
      <dl>
        <div><dt>Total</dt><dd>${report.total}</dd></div>
        <div><dt>Passed</dt><dd>${report.passed}</dd></div>
        <div><dt>Failed</dt><dd>${report.failed}</dd></div>
        <div><dt>Avg diff</dt><dd>${report.averageDiffPercent.toFixed(3)}%</dd></div>
      </dl>
    </section>
    <section>
      <h2>Cross-page findings</h2>
      ${crossPageFindingList(report.crossPageFindings?.slice(0, 30) ?? [], report.outputDir)}
    </section>
    <section>
      <h2>Routes</h2>
      <table><thead><tr><th>Status</th><th>Candidate URL</th><th>Diff</th><th>Report</th></tr></thead><tbody>${rows}</tbody></table>
    </section>`
  );
}

function imageCard(label: string, src: string): string {
  return `<figure><figcaption>${escapeHtml(label)}</figcaption><img src="${escapeHtml(src)}" alt="${escapeHtml(label)}" loading="lazy" /></figure>`;
}

function diffList(diffs: StyleDiff[]): string {
  if (diffs.length === 0) return "<p>No style/layout diffs captured.</p>";
  return `<ol class="diffs">${diffs.map((diff) => `<li><code>${escapeHtml(formatDiff(diff))}</code></li>`).join("\n")}</ol>`;
}

function clusterList(clusters: StyleDiffCluster[], limit: number): string {
  if (clusters.length === 0) return "<p>No root-cause clusters found.</p>";
  const visible = prioritizedClusters(clusters, limit);
  const hiddenCount = Math.max(0, clusters.length - visible.length);
  return `<ol class="clusters">${visible.map((cluster) => `<li>
    <div class="cluster-title">${escapeHtml(formatCluster(cluster))}</div>
    <div class="cluster-meta">${escapeHtml(cluster.severity)} · ${cluster.count.toLocaleString()} diffs across ${cluster.selectors.length.toLocaleString()} selectors${cluster.estimatedResolution?.diffPercent ? `, approx ${cluster.estimatedResolution.diffPercent.toFixed(3)}% pixel delta` : ""}</div>
    ${cluster.suggestedFix ? `<div class="suggestion">${escapeHtml(cluster.suggestedFix)}</div>` : ""}
    <ul>${cluster.examples.slice(0, 3).map((diff) => `<li><code>${escapeHtml(formatDiff(diff))}</code></li>`).join("")}</ul>
  </li>`).join("\n")}</ol>${hiddenCount > 0 ? `<p class="cluster-meta">${hiddenCount.toLocaleString()} minor one-off findings hidden from this view.</p>` : ""}`;
}

function prioritizedClusters(clusters: StyleDiffCluster[], limit: number): StyleDiffCluster[] {
  const repeated = clusters.filter((cluster) => cluster.count >= 2);
  return (repeated.length > 0 ? repeated : clusters).slice(0, limit);
}

function crossPageFindingList(findings: CrossPageFinding[], outputDir: string): string {
  if (findings.length === 0) return "<p>No cross-page findings found.</p>";
  return `<ol class="clusters">${findings.map((finding) => `<li>
    <div class="cluster-title">${escapeHtml(formatCrossPageFinding(finding))}</div>
    <div class="cluster-meta">${finding.totalDiffs.toLocaleString()} diffs on ${finding.pageCount}/${finding.totalPages} pages, approx ${finding.estimatedDiffPercent.toFixed(3)}% cumulative pixel delta</div>
    ${finding.suggestedFix ? `<div class="suggestion">${escapeHtml(finding.suggestedFix)}</div>` : ""}
    <ul>${finding.pages.slice(0, 5).map((page) => {
      const href = path.relative(outputDir, page.reportHtml).split(path.sep).join("/");
      return `<li><a href="${escapeHtml(href)}">${escapeHtml(page.localUrl)}</a> (${page.diffCount.toLocaleString()} diffs)</li>`;
    }).join("")}</ul>
  </li>`).join("\n")}</ol>`;
}

export function formatDiff(diff: StyleDiff): string {
  const index = typeof diff.index === "number" ? `[${diff.index}]` : "";
  const prop = diff.property ? ` ${diff.property}` : "";
  const delta = typeof diff.delta === "number" ? ` delta=${diff.delta}` : "";
  const liveSource = formatSource(diff.liveSources);
  const localSource = formatSource(diff.localSources);
  const sources = liveSource || localSource ? ` source=${liveSource || "unknown"} candidateSource=${localSource || "unknown"}` : "";
  return `${diff.selector}${index} ${diff.kind}${prop} reference=${diff.live ?? ""} candidate=${diff.local ?? ""}${delta}${sources}`;
}

export function formatCluster(cluster: StyleDiffCluster): string {
  const prop = cluster.property ? ` ${cluster.property}` : "";
  return `${cluster.kind}${prop}: reference=${cluster.live ?? ""} candidate=${cluster.local ?? ""}`;
}

export function formatCrossPageFinding(finding: CrossPageFinding): string {
  const prop = finding.property ? ` ${finding.property}` : "";
  return `${finding.kind}${prop}: reference=${finding.live ?? ""} candidate=${finding.local ?? ""}`;
}

function htmlShell(title: string, body: string): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(title)}</title>
  <style>
    :root { color-scheme: dark; --bg: #09090b; --panel: #141419; --muted: #a1a1aa; --text: #f4f4f5; --line: #27272a; --good: #22c55e; --bad: #ef4444; --accent: #a78bfa; }
    * { box-sizing: border-box; }
    body { margin: 0; padding: 32px; background: radial-gradient(circle at top left, #20113d, var(--bg) 36rem); color: var(--text); font: 14px/1.5 ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    section { margin: 0 0 28px; padding: 22px; background: rgba(20, 20, 25, 0.88); border: 1px solid var(--line); border-radius: 18px; box-shadow: 0 18px 60px rgba(0,0,0,0.28); }
    .hero { display: flex; justify-content: space-between; gap: 24px; align-items: flex-start; border-top: 5px solid var(--accent); }
    .hero.pass { border-top-color: var(--good); }
    .hero.fail { border-top-color: var(--bad); }
    .eyebrow { margin: 0; color: var(--muted); text-transform: uppercase; letter-spacing: .16em; font-size: 12px; }
    h1 { margin: 4px 0 8px; font-size: clamp(32px, 5vw, 64px); line-height: 1; }
    h2 { margin-top: 0; }
    a { color: #c4b5fd; }
    code { color: #e9d5ff; white-space: pre-wrap; overflow-wrap: anywhere; }
    dl { display: grid; grid-template-columns: repeat(2, minmax(120px, 1fr)); gap: 12px; min-width: 360px; }
    dt { color: var(--muted); font-size: 12px; text-transform: uppercase; letter-spacing: .08em; }
    dd { margin: 0; font-size: 20px; font-weight: 800; }
    .grid { display: grid; gap: 16px; }
    .grid.two { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    .grid.three { grid-template-columns: repeat(3, minmax(0, 1fr)); }
    figure { margin: 0; border: 1px solid var(--line); border-radius: 14px; overflow: hidden; background: #050507; }
    figcaption { padding: 10px 12px; color: var(--muted); border-bottom: 1px solid var(--line); }
    img { display: block; max-width: 100%; height: auto; }
    .diffs { padding-left: 22px; }
    .diffs li { margin: 7px 0; }
    .clusters { padding-left: 22px; }
    .clusters > li { margin: 0 0 18px; }
    .cluster-title { font-weight: 800; font-size: 16px; }
    .cluster-meta { color: var(--muted); margin: 3px 0 8px; }
    .suggestion { padding: 10px 12px; border: 1px solid var(--line); background: rgba(167, 139, 250, 0.1); border-radius: 8px; margin: 8px 0; }
    table { width: 100%; border-collapse: collapse; }
    th, td { text-align: left; padding: 10px 12px; border-bottom: 1px solid var(--line); }
    th { color: var(--muted); }
    .ok { color: var(--good); font-weight: 800; }
    .bad { color: var(--bad); font-weight: 800; }
    @media (max-width: 1000px) { body { padding: 16px; } .hero { flex-direction: column; } dl { min-width: 0; width: 100%; } .grid.two, .grid.three { grid-template-columns: 1fr; } }
  </style>
</head>
<body>
${body}
</body>
</html>`;
}

function formatSource(sources?: StyleRuleSource[]): string | undefined {
  const source = sources?.[sources.length - 1];
  if (!source) return undefined;
  if (source.type === "inline") return "<inline style>";
  const href = source.href ? source.href.replace(/^https?:\/\/[^/]+/i, "") : "<inline stylesheet>";
  return `${href}${source.selectorText ? ` (${source.selectorText})` : ""}`;
}
