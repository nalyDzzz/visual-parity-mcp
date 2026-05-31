import path from "node:path";
import type { Page } from "playwright";
import { analyzeStyleDiffs } from "./analysis.js";
import { createBrowserSession, normalizeViewport, preparePage, screenshotFirstMatch } from "./browser.js";
import { diffScreenshots } from "./compare.js";
import { loadVisualParityConfig, mergeAcceptedDeviations } from "./config.js";
import { DEFAULT_STYLE_PROPERTIES } from "./defaults.js";
import { applyPresets } from "./presets.js";
import { writeSectionReport, writeSectionsSummary } from "./report.js";
import { diffStyleSnapshots } from "./styles.js";
import type {
  CompareSectionOptions,
  CompareSectionsOptions,
  CompareSectionsReport,
  DiscoverSectionsOptions,
  DiscoverSectionsReport,
  DiscoveredSection,
  SectionCandidate,
  SectionComparisonReport,
  StyleSelectorSnapshot
} from "./types.js";
import { DEFAULT_OUTPUT_DIR, ensureDir, makeRunDir, slugify, uniqueNonEmpty } from "./utils.js";

const DEFAULT_SECTION_SELECTORS = [":scope", "h1", "h2", "h3", "p", "a", "button", "img", "form", "[class*='card' i]", "[class*='cta' i]"];

export async function discoverSections(rawOptions: DiscoverSectionsOptions): Promise<DiscoverSectionsReport> {
  const options = applyPresets(rawOptions);
  const viewport = normalizeViewport(options.viewport);
  const maxSections = options.maxSections ?? 12;
  const outputDir = options.outputDir ?? DEFAULT_OUTPUT_DIR;
  const runDir = makeRunDir(outputDir, options.name, `sections-${slugify(options.localUrl)}-${Date.now()}`);
  if (options.includeCrops) await ensureDir(runDir);

  const session = await createBrowserSession(options);
  try {
    const context = session.context;
    const livePage = await context.newPage();
    const localPage = await context.newPage();

    await preparePage(livePage, options.liveUrl, options);
    await preparePage(localPage, options.localUrl, options);

    const live = await collectSectionCandidates(livePage, maxSections);
    const local = await collectSectionCandidates(localPage, maxSections);
    const sections = matchSections(live, local).slice(0, maxSections);

    if (options.includeCrops) {
      for (const [index, section] of sections.entries()) {
        section.screenshots = {};
        try {
          section.screenshots.reference = await screenshotFirstMatch(livePage, section.reference.selector, path.join(runDir, `${index + 1}-reference.png`));
        } catch {
          section.screenshots.reference = undefined;
        }
        if (section.candidate) {
          try {
            section.screenshots.candidate = await screenshotFirstMatch(localPage, section.candidate.selector, path.join(runDir, `${index + 1}-candidate.png`));
          } catch {
            section.screenshots.candidate = undefined;
          }
        }
      }
    }

    const report: DiscoverSectionsReport = {
      liveUrl: options.liveUrl,
      localUrl: options.localUrl,
      runDir: options.includeCrops ? runDir : undefined,
      createdAt: new Date().toISOString(),
      viewport,
      sections
    };
    return report;
  } finally {
    await session.close();
  }
}

export async function compareSection(rawOptions: CompareSectionOptions): Promise<SectionComparisonReport> {
  const options = applyPresets(rawOptions);
  const config = await loadVisualParityConfig(options.configPath);
  const acceptedDeviations = mergeAcceptedDeviations(config.acceptedDeviations, options.acceptedDeviations);
  const viewport = normalizeViewport(options.viewport);
  const threshold = options.threshold ?? 0.1;
  const maxDiffPercent = options.maxDiffPercent ?? 1;
  const localSelector = options.localSelector ?? options.referenceSelector;
  const outputDir = options.outputDir ?? DEFAULT_OUTPUT_DIR;
  const label = options.sectionLabel ?? options.referenceSelector;
  const runDir = makeRunDir(outputDir, options.name, `section-${slugify(label)}-${Date.now()}`);
  await ensureDir(runDir);

  const liveCrop = path.join(runDir, "reference-section.png");
  const localCrop = path.join(runDir, "candidate-section.png");
  const diffCrop = path.join(runDir, "section-diff.png");

  const session = await createBrowserSession(options);
  try {
    const context = session.context;
    const livePage = await context.newPage();
    const localPage = await context.newPage();

    await preparePage(livePage, options.liveUrl, options);
    await preparePage(localPage, options.localUrl, options);
    await screenshotFirstMatch(livePage, options.referenceSelector, liveCrop);
    await screenshotFirstMatch(localPage, localSelector, localCrop);

    const visual = await diffScreenshots(liveCrop, localCrop, diffCrop, threshold, maxDiffPercent);
    const properties = uniqueNonEmpty(options.styleProperties).length > 0 ? uniqueNonEmpty(options.styleProperties) : DEFAULT_STYLE_PROPERTIES;
    const sectionSelectors = uniqueNonEmpty(options.sectionSelectors).length > 0 ? uniqueNonEmpty(options.sectionSelectors) : DEFAULT_SECTION_SELECTORS;
    const maxElements = options.maxElementsPerSelector ?? 5;
    const liveStyles = await captureScopedStyleSnapshots(livePage, options.referenceSelector, sectionSelectors, properties, maxElements);
    const localStyles = await captureScopedStyleSnapshots(localPage, localSelector, sectionSelectors, properties, maxElements);
    const rawDiffs = diffStyleSnapshots(liveStyles, localStyles);
    const { diffs, analysis } = analyzeStyleDiffs(rawDiffs, acceptedDeviations, visual.effectiveDiffPercent);

    const report: SectionComparisonReport = {
      liveUrl: options.liveUrl,
      localUrl: options.localUrl,
      runDir,
      createdAt: new Date().toISOString(),
      viewport,
      section: {
        label,
        referenceSelector: options.referenceSelector,
        candidateSelector: localSelector
      },
      screenshots: {
        reference: liveCrop,
        candidate: localCrop,
        diff: diffCrop
      },
      visual,
      styles: {
        comparedSelectors: sectionSelectors.length,
        rawDiffCount: rawDiffs.length,
        diffCount: diffs.length,
        diffs,
        analysis,
        live: liveStyles,
        local: localStyles
      },
      reportJson: path.join(runDir, "section.json"),
      reportHtml: path.join(runDir, "section.html")
    };
    return writeSectionReport(report);
  } finally {
    await session.close();
  }
}

export async function compareSections(options: CompareSectionsOptions): Promise<CompareSectionsReport> {
  const discovered = await discoverSections({ ...options, includeCrops: false });
  const outputDir = path.resolve(process.cwd(), options.outputDir ?? DEFAULT_OUTPUT_DIR);
  await ensureDir(outputDir);
  const sections = await mapWithConcurrency(discovered.sections.slice(0, options.maxSections ?? 12), options.concurrency ?? 1, async (section) => {
    if (!section.candidate) {
      return {
        label: section.label,
        referenceSelector: section.reference.selector,
        candidateSelector: undefined,
        passed: false,
        diffPercent: 100,
        effectiveDiffPercent: 100,
        reportJson: undefined,
        reportHtml: undefined,
        diffImage: undefined,
        nextAction: "Create or locate the matching candidate section before tuning styles."
      };
    }
    const report = await compareSection({
      ...options,
      referenceSelector: section.reference.selector,
      localSelector: section.candidate.selector,
      sectionLabel: section.label,
      outputDir,
      name: slugify(section.label)
    });
    return {
      label: section.label,
      referenceSelector: section.reference.selector,
      candidateSelector: section.candidate.selector,
      passed: report.visual.passed,
      diffPercent: Number(report.visual.diffPercent.toFixed(4)),
      effectiveDiffPercent: Number(report.visual.effectiveDiffPercent.toFixed(4)),
      reportJson: report.reportJson,
      reportHtml: report.reportHtml,
      diffImage: report.screenshots.diff,
      nextAction: nextActionForSection(report)
    };
  });

  const recommendedOrder = sections
    .filter((section) => !section.passed)
    .slice()
    .sort((a, b) => b.effectiveDiffPercent - a.effectiveDiffPercent)
    .map((section) => section.label);

  const report: CompareSectionsReport = {
    liveUrl: options.liveUrl,
    localUrl: options.localUrl,
    createdAt: new Date().toISOString(),
    outputDir,
    total: sections.length,
    passed: sections.filter((section) => section.passed).length,
    failed: sections.filter((section) => !section.passed).length,
    recommendedOrder,
    sections,
    summaryJson: path.join(outputDir, "sections-summary.json"),
    summaryHtml: path.join(outputDir, "sections-summary.html")
  };
  return writeSectionsSummary(report);
}

async function mapWithConcurrency<T, R>(items: T[], concurrency: number, mapper: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  const workerCount = Math.max(1, Math.min(items.length, Math.floor(concurrency)));
  let nextIndex = 0;

  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (nextIndex < items.length) {
        const index = nextIndex;
        nextIndex += 1;
        results[index] = await mapper(items[index], index);
      }
    })
  );

  return results;
}

async function collectSectionCandidates(page: Page, maxSections: number): Promise<SectionCandidate[]> {
  return page.evaluate((limit) => {
    const candidates = Array.from(document.querySelectorAll("header, nav, main > section, main > article, main > div, section, article, footer"))
      .filter((element) => !element.closest("[data-visual-parity-hidden='true']"))
      .map((element) => sectionCandidate(element))
      .filter((section): section is SectionCandidate => Boolean(section))
      .sort((a, b) => {
        const yDelta = a.rect.y - b.rect.y;
        if (Math.abs(yDelta) > 8) return yDelta;
        return b.rect.width * b.rect.height - a.rect.width * a.rect.height;
      });

    const deduped: SectionCandidate[] = [];
    for (const candidate of candidates) {
      if (deduped.some((existing) => Math.abs(existing.rect.y - candidate.rect.y) < 8 && Math.abs(existing.rect.height - candidate.rect.height) < 8)) continue;
      deduped.push(candidate);
      if (deduped.length >= limit) break;
    }
    return deduped;

    function sectionCandidate(element: Element): SectionCandidate | undefined {
      if (!(element instanceof HTMLElement || element instanceof SVGElement)) return undefined;
      const rect = element.getBoundingClientRect();
      const tag = element.tagName.toLowerCase();
      const isLandmark = ["header", "nav", "footer", "main"].includes(tag) || element.getAttribute("role") !== null;
      if (!isLandmark && (rect.width < window.innerWidth * 0.35 || rect.height < 40)) return undefined;
      if (isLandmark && (rect.width < window.innerWidth * 0.2 || rect.height < 20)) return undefined;
      const text = (element.textContent || "").replace(/\s+/g, " ").trim().slice(0, 240);
      const heading = element.querySelector("h1, h2, h3, [role='heading']");
      const headingText = (heading?.textContent || "").replace(/\s+/g, " ").trim();
      const label = labelFor(element, headingText || text);
      return {
        label,
        selector: selectorFor(element),
        tagName: element.tagName.toLowerCase(),
        id: element.id || undefined,
        classNames: Array.from(element.classList),
        heading: headingText || undefined,
        text,
        rect: {
          x: Number((rect.x + window.scrollX).toFixed(2)),
          y: Number((rect.y + window.scrollY).toFixed(2)),
          width: Number(rect.width.toFixed(2)),
          height: Number(rect.height.toFixed(2))
        }
      };
    }

    function labelFor(element: Element, text: string): string {
      const tag = element.tagName.toLowerCase();
      if (tag === "header") return "Header";
      if (tag === "nav") return "Navigation";
      if (tag === "footer") return "Footer";
      const clean = text.replace(/\s+/g, " ").trim();
      if (clean) return clean.slice(0, 64);
      return `${tag} section`;
    }

    function selectorFor(element: Element): string {
      if (element.id) return `#${CSS.escape(element.id)}`;
      const tag = element.tagName.toLowerCase();
      if (["header", "nav", "main", "footer"].includes(tag) && document.querySelectorAll(tag).length === 1) return tag;
      const className = Array.from(element.classList).find((name) => !/^(active|open|selected|loaded|visible)$/i.test(name));
      if (className && document.querySelectorAll(`${tag}.${CSS.escape(className)}`).length === 1) return `${tag}.${CSS.escape(className)}`;
      const parent = element.parentElement;
      if (!parent) return tag;
      const siblings = Array.from(parent.children).filter((sibling) => sibling.tagName === element.tagName);
      const index = siblings.indexOf(element) + 1;
      const parentSelector = parent.id ? `#${CSS.escape(parent.id)}` : parent.tagName.toLowerCase();
      return `${parentSelector} > ${tag}:nth-of-type(${index})`;
    }
  }, maxSections);
}

function matchSections(reference: SectionCandidate[], candidate: SectionCandidate[]): DiscoveredSection[] {
  const used = new Set<number>();
  return reference.map((section, index) => {
    let best: SectionMatch | undefined;
    for (const [candidateIndex, candidateSection] of candidate.entries()) {
      if (used.has(candidateIndex)) continue;
      const match = scoreSectionMatch(section, candidateSection, index, candidateIndex);
      if (!best || match.score > best.score) best = match;
    }

    const matched = best && best.score >= 0.34 ? best.section : undefined;
    if (matched && typeof best?.candidateIndex === "number") used.add(best.candidateIndex);
    return {
      label: section.label,
      reference: section,
      candidate: matched,
      matchConfidence: best ? Number(best.score.toFixed(2)) : 0,
      matchReason: best?.reason
    };
  });
}

interface SectionMatch {
  section: SectionCandidate;
  candidateIndex: number;
  score: number;
  reason: string;
}

function scoreSectionMatch(reference: SectionCandidate, candidate: SectionCandidate, referenceIndex: number, candidateIndex: number): SectionMatch {
  const selectorScore = reference.selector === candidate.selector ? 1 : 0;
  const tagScore = reference.tagName === candidate.tagName ? 1 : sameLandmarkKind(reference, candidate) ? 0.75 : 0;
  const idScore = reference.id && candidate.id ? similarity(words(reference.id), words(candidate.id)) : 0;
  const classScore = similarity(reference.classNames.flatMap(words), candidate.classNames.flatMap(words));
  const headingScore = similarity(words(reference.heading ?? ""), words(candidate.heading ?? ""));
  const textScore = similarity(words(reference.text), words(candidate.text));
  const verticalScore = 1 - Math.min(1, Math.abs(referenceIndex - candidateIndex) / 4);
  const sizeScore = sizeSimilarity(reference, candidate);

  const score =
    selectorScore * 0.3 +
    tagScore * 0.14 +
    Math.max(idScore, classScore) * 0.14 +
    headingScore * 0.18 +
    textScore * 0.14 +
    verticalScore * 0.06 +
    sizeScore * 0.04;

  const reasons = [
    selectorScore >= 1 ? "same selector" : undefined,
    headingScore >= 0.5 ? "similar heading" : undefined,
    textScore >= 0.35 ? "similar text" : undefined,
    Math.max(idScore, classScore) >= 0.35 ? "similar id/class" : undefined,
    tagScore >= 0.75 ? "same landmark/tag" : undefined,
    verticalScore >= 0.75 ? "similar page order" : undefined,
    sizeScore >= 0.75 ? "similar size" : undefined
  ].filter(Boolean);

  return {
    section: candidate,
    candidateIndex,
    score,
    reason: reasons.join(", ") || "weak heuristic match"
  };
}

function words(text: string): string[] {
  return text.toLowerCase().match(/[a-z0-9]{2,}/g)?.slice(0, 40) ?? [];
}

function similarity(left: string[], right: string[]): number {
  if (left.length === 0 || right.length === 0) return 0;
  const rightSet = new Set(right);
  const overlap = left.filter((token) => rightSet.has(token)).length;
  return overlap / Math.max(left.length, right.length);
}

function sameLandmarkKind(reference: SectionCandidate, candidate: SectionCandidate): boolean {
  const landmarks = new Set(["header", "nav", "main", "footer", "section", "article"]);
  return landmarks.has(reference.tagName) && reference.tagName === candidate.tagName;
}

function sizeSimilarity(reference: SectionCandidate, candidate: SectionCandidate): number {
  const widthRatio = ratioSimilarity(reference.rect.width, candidate.rect.width);
  const heightRatio = ratioSimilarity(reference.rect.height, candidate.rect.height);
  return (widthRatio + heightRatio) / 2;
}

function ratioSimilarity(left: number, right: number): number {
  if (left <= 0 || right <= 0) return 0;
  return Math.min(left, right) / Math.max(left, right);
}

async function captureScopedStyleSnapshots(
  page: Page,
  rootSelector: string,
  selectors: string[],
  properties: string[],
  maxElementsPerSelector: number
): Promise<StyleSelectorSnapshot[]> {
  return page.evaluate(
    ({ rootSelector: root, selectors: scopedSelectors, properties: props, maxElements }) => {
      const rootElement = document.querySelector(root);
      if (!rootElement) {
        return scopedSelectors.map((selector) => ({ selector, count: 0, elements: [], error: `Root selector not found: ${root}` }));
      }
      return scopedSelectors.map((selector) => {
        try {
          const elements = (selector === ":scope" ? [rootElement] : Array.from(rootElement.querySelectorAll(selector))).filter(isComparableElement).slice(0, maxElements);
          return {
            selector,
            count: selector === ":scope" ? 1 : rootElement.querySelectorAll(selector).length,
            elements: elements.map((element, index) => {
              const style = window.getComputedStyle(element);
              const rect = element.getBoundingClientRect();
              const styles: Record<string, string> = {};
              for (const prop of props) styles[prop] = style.getPropertyValue(prop);
              return {
                selector,
                index,
                text: (element.textContent || "").replace(/\s+/g, " ").trim().slice(0, 240),
                tagName: element.tagName.toLowerCase(),
                rect: {
                  x: Number(rect.x.toFixed(2)),
                  y: Number(rect.y.toFixed(2)),
                  width: Number(rect.width.toFixed(2)),
                  height: Number(rect.height.toFixed(2))
                },
                styles
              };
            })
          };
        } catch (error) {
          return { selector, count: 0, elements: [], error: error instanceof Error ? error.message : String(error) };
        }
      });

      function isComparableElement(element: Element): boolean {
        if (element.closest("[data-visual-parity-hidden='true']")) return false;
        const style = window.getComputedStyle(element);
        if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") return false;
        const rect = element.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      }
    },
    { rootSelector, selectors, properties, maxElements: maxElementsPerSelector }
  );
}

function nextActionForSection(report: SectionComparisonReport): string {
  const plan = report.styles.analysis?.fixPlan;
  const action = plan && [...plan.globalCssFixes, ...plan.componentStyleFixes, ...plan.contentMismatches, ...plan.needsReview][0];
  if (action?.suggestedFix) return action.suggestedFix;
  if (action?.reason) return action.reason;
  if (!report.visual.passed) return "Inspect the section diff image and fix the largest visible layout or style drift.";
  return "Section is within the configured visual threshold.";
}
