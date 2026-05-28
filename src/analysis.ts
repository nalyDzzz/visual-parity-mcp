import type {
  AcceptedDeviation,
  CrossPageFinding,
  PageComparisonReport,
  StyleAnalysis,
  StyleDiff,
  StyleDiffCluster
} from "./types.js";

const BORDER_COLOR_PROPS = [
  "border-top-color",
  "border-right-color",
  "border-bottom-color",
  "border-left-color"
];

export function analyzeStyleDiffs(
  rawDiffs: StyleDiff[],
  acceptedDeviations: AcceptedDeviation[] = [],
  diffPercent?: number
): { diffs: StyleDiff[]; analysis: StyleAnalysis } {
  const collapsed = collapseBorderColorDiffs(rawDiffs);
  const diffs = collapsed.filter((diff) => !isAcceptedDeviation(diff, acceptedDeviations));
  const clusters = clusterStyleDiffs(diffs, diffPercent);

  return {
    diffs,
    analysis: {
      rawDiffCount: rawDiffs.length,
      ignoredDiffCount: rawDiffs.length - diffs.length,
      diffCount: diffs.length,
      clusters
    }
  };
}

export function aggregateCrossPageFindings(results: PageComparisonReport[]): CrossPageFinding[] {
  const byKey = new Map<string, CrossPageFinding>();
  const totalPages = results.length;

  for (const result of results) {
    for (const cluster of result.styles?.analysis?.clusters ?? []) {
      const key = clusterKey(cluster.kind, cluster.property, cluster.live, cluster.local);
      const existing = byKey.get(key);
      const diffPercent = cluster.estimatedResolution?.diffPercent ?? 0;
      if (!existing) {
        byKey.set(key, {
          id: cluster.id,
          kind: cluster.kind,
          property: cluster.property,
          live: cluster.live,
          local: cluster.local,
          pageCount: 1,
          totalPages,
          totalDiffs: cluster.count,
          estimatedDiffPercent: diffPercent,
          selectors: cluster.selectors,
          pages: [
            {
              liveUrl: result.liveUrl,
              localUrl: result.localUrl,
              diffCount: cluster.count,
              reportHtml: result.reportHtml
            }
          ],
          suggestedFix: cluster.suggestedFix
        });
        continue;
      }

      existing.pageCount += 1;
      existing.totalDiffs += cluster.count;
      existing.estimatedDiffPercent = Number((existing.estimatedDiffPercent + diffPercent).toFixed(4));
      existing.selectors = unique([...existing.selectors, ...cluster.selectors]);
      existing.pages.push({
        liveUrl: result.liveUrl,
        localUrl: result.localUrl,
        diffCount: cluster.count,
        reportHtml: result.reportHtml
      });
      if (!existing.suggestedFix && cluster.suggestedFix) existing.suggestedFix = cluster.suggestedFix;
    }
  }

  return Array.from(byKey.values()).sort((a, b) => {
    const impactA = a.totalDiffs * a.pageCount;
    const impactB = b.totalDiffs * b.pageCount;
    if (impactB !== impactA) return impactB - impactA;
    return b.estimatedDiffPercent - a.estimatedDiffPercent;
  });
}

function collapseBorderColorDiffs(diffs: StyleDiff[]): StyleDiff[] {
  const output: StyleDiff[] = [];
  const groups = new Map<string, StyleDiff[]>();

  for (const diff of diffs) {
    if (diff.kind !== "style" || !diff.property || !BORDER_COLOR_PROPS.includes(diff.property)) {
      output.push(diff);
      continue;
    }

    const key = `${diff.selector}\u0000${diff.index ?? ""}\u0000${diff.live ?? ""}\u0000${diff.local ?? ""}`;
    const group = groups.get(key) ?? [];
    group.push(diff);
    groups.set(key, group);
  }

  for (const group of groups.values()) {
    const props = new Set(group.map((diff) => diff.property));
    if (BORDER_COLOR_PROPS.every((prop) => props.has(prop))) {
      output.push({
        selector: group[0].selector,
        index: group[0].index,
        kind: "style",
        property: "border-color",
        live: group[0].live,
        local: group[0].local,
        liveSources: group[0].liveSources,
        localSources: group[0].localSources
      });
    } else {
      output.push(...group);
    }
  }

  return output;
}

function clusterStyleDiffs(diffs: StyleDiff[], pageDiffPercent = 0): StyleDiffCluster[] {
  const byKey = new Map<string, StyleDiffCluster>();

  for (const diff of diffs) {
    const key = clusterKey(diff.kind, diff.property, diff.live, diff.local);
    const existing = byKey.get(key);
    if (existing) {
      existing.count += 1;
      existing.selectors = unique([...existing.selectors, diff.selector]);
      if (existing.examples.length < 5) existing.examples.push(diff);
      continue;
    }

    byKey.set(key, {
      id: key,
      kind: diff.kind,
      property: diff.property,
      live: diff.live,
      local: diff.local,
      count: 1,
      selectors: [diff.selector],
      examples: [diff],
      priority: priorityFor(diff),
      suggestedFix: suggestedFixFor(diff)
    });
  }

  const clusters = Array.from(byKey.values());
  for (const cluster of clusters) {
    cluster.estimatedResolution = {
      diffs: cluster.count,
      diffPercent: diffs.length === 0 ? 0 : Number(((pageDiffPercent * cluster.count) / diffs.length).toFixed(4))
    };
  }

  return clusters.sort((a, b) => {
    const priorityDelta = priorityRank(b.priority) - priorityRank(a.priority);
    if (priorityDelta !== 0) return priorityDelta;
    return b.count - a.count;
  });
}

function isAcceptedDeviation(diff: StyleDiff, acceptedDeviations: AcceptedDeviation[]): boolean {
  return acceptedDeviations.some((deviation) => {
    if (deviation.kind && deviation.kind !== diff.kind) return false;
    if (deviation.property && deviation.property !== diff.property) return false;
    if (deviation.selector && !selectorMatches(deviation.selector, diff.selector)) return false;
    if (!deviation.pattern) return true;

    const pattern = new RegExp(deviation.pattern, "i");
    return pattern.test(String(diff.live ?? "")) || pattern.test(String(diff.local ?? ""));
  });
}

function selectorMatches(pattern: string, selector: string): boolean {
  if (pattern === "*" || pattern === selector) return true;
  if (pattern.includes("*")) {
    const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
    return new RegExp(`^${escaped}$`, "i").test(selector);
  }
  return false;
}

function priorityFor(diff: StyleDiff): StyleDiffCluster["priority"] {
  if (diff.kind === "count" || diff.property === "box-sizing" || diff.property === "font-family") return "high";
  if (diff.kind === "rect" && (diff.property === "width" || diff.property === "height")) return "low";
  if (diff.property?.startsWith("border-") || diff.property === "color" || diff.property === "background-color") return "medium";
  return diff.kind === "rect" ? "medium" : "low";
}

function suggestedFixFor(diff: StyleDiff): string | undefined {
  if (diff.kind !== "style") return undefined;
  if (diff.property === "box-sizing" && diff.live === "border-box" && diff.local === "content-box") {
    return "Add `*, *::before, *::after { box-sizing: border-box; }` to the candidate global CSS.";
  }
  if (diff.property === "font-family") {
    return `Set the candidate font-family for affected selectors to \`${diff.live}\`.`;
  }
  if (diff.property === "border-color") {
    return `Set the candidate border-color for affected selectors to \`${diff.live}\`.`;
  }
  return undefined;
}

function clusterKey(kind: StyleDiff["kind"], property?: string, live?: string | number, local?: string | number): string {
  return `${kind}:${property ?? ""}:${normalizeValue(live)}:${normalizeValue(local)}`;
}

function normalizeValue(value: unknown): string {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function priorityRank(priority: StyleDiffCluster["priority"]): number {
  if (priority === "high") return 3;
  if (priority === "medium") return 2;
  return 1;
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values));
}
