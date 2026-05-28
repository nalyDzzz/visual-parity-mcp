import type { Page } from "playwright";
import type { StyleDiff, StyleElementSnapshot, StyleSelectorSnapshot } from "./types.js";
import { trimText } from "./utils.js";

export async function captureStyleSnapshots(
  page: Page,
  selectors: string[],
  properties: string[],
  maxElementsPerSelector = 5
): Promise<StyleSelectorSnapshot[]> {
  const snapshots: StyleSelectorSnapshot[] = [];

  for (const selector of selectors) {
    try {
      const snapshot = await page.evaluate(
        ({ selector: selectorArg, properties: props, maxElements }) => {
          const elements = Array.from(document.querySelectorAll(selectorArg));
          const capped = elements.slice(0, maxElements);
          const result = capped.map((element, index) => {
            const style = window.getComputedStyle(element);
            const rect = element.getBoundingClientRect();
            const styles: Record<string, string> = {};
            const styleSources: Record<string, Array<{ type: "inline" | "rule"; href?: string; selectorText?: string; value: string }>> = {};
            for (const prop of props) {
              styles[prop] = style.getPropertyValue(prop);
              styleSources[prop] = findStyleSources(element, prop).slice(-5);
            }
            return {
              selector: selectorArg,
              index,
              text: (element.textContent || "").replace(/\s+/g, " ").trim().slice(0, 240),
              tagName: element.tagName.toLowerCase(),
              rect: {
                x: Number(rect.x.toFixed(2)),
                y: Number(rect.y.toFixed(2)),
                width: Number(rect.width.toFixed(2)),
                height: Number(rect.height.toFixed(2))
              },
              styles,
              styleSources
            };
          });

          function findStyleSources(element: Element, property: string): Array<{ type: "inline" | "rule"; href?: string; selectorText?: string; value: string }> {
            const sources: Array<{ type: "inline" | "rule"; href?: string; selectorText?: string; value: string }> = [];
            const targets = inheritedProperty(property) ? ancestorChain(element) : [element];
            const candidateProperties = sourceProperties(property);

            for (const target of targets) {
              if (target instanceof HTMLElement || target instanceof SVGElement) {
                const inlineValue = firstDeclaredValue(target.style, candidateProperties);
                if (inlineValue) sources.push({ type: "inline", value: inlineValue });
              }

              for (const sheet of Array.from(document.styleSheets)) {
                let rules: CSSRuleList;
                try {
                  rules = sheet.cssRules;
                } catch {
                  continue;
                }
                collectRuleSources(target, candidateProperties, sheet.href ?? undefined, Array.from(rules), sources);
              }
            }

            return sources;
          }

          function collectRuleSources(
            element: Element,
            properties: string[],
            href: string | undefined,
            rules: CSSRule[],
            sources: Array<{ type: "inline" | "rule"; href?: string; selectorText?: string; value: string }>
          ): void {
            for (const rule of rules) {
              if ("cssRules" in rule && !("selectorText" in rule && "style" in rule)) {
                collectRuleSources(element, properties, href, Array.from((rule as CSSGroupingRule).cssRules), sources);
                continue;
              }
              if (!("selectorText" in rule) || !("style" in rule)) continue;
              const styleRule = rule as CSSStyleRule;
              const value = firstDeclaredValue(styleRule.style, properties);
              if (!value) continue;
              try {
                if (element.matches(styleRule.selectorText)) {
                  sources.push({ type: "rule", href, selectorText: styleRule.selectorText, value });
                }
              } catch {
                continue;
              }
            }
          }

          function firstDeclaredValue(style: CSSStyleDeclaration, properties: string[]): string {
            for (const property of properties) {
              const value = style.getPropertyValue(property);
              if (value) return value;
            }
            return "";
          }

          function sourceProperties(property: string): string[] {
            const properties = [property];
            if (property.startsWith("padding-")) properties.push("padding");
            if (property.startsWith("margin-")) properties.push("margin");
            if (property.startsWith("border-") && property.endsWith("-color")) properties.push("border-color", "border");
            if (property === "background-color" || property === "background-image" || property === "background-size" || property === "background-position") properties.push("background");
            if (property === "row-gap" || property === "column-gap") properties.push("gap");
            return properties;
          }

          function inheritedProperty(property: string): boolean {
            return ["font-family", "font-size", "font-weight", "font-style", "line-height", "letter-spacing", "text-align", "text-transform", "color"].includes(property);
          }

          function ancestorChain(element: Element): Element[] {
            const elements: Element[] = [];
            let current: Element | null = element;
            while (current) {
              elements.push(current);
              current = current.parentElement;
            }
            return elements;
          }

          return {
            selector: selectorArg,
            count: elements.length,
            elements: result
          };
        },
        { selector, properties, maxElements: maxElementsPerSelector }
      );
      snapshots.push(snapshot as StyleSelectorSnapshot);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      snapshots.push({ selector, count: 0, elements: [], error: message });
    }
  }

  return snapshots;
}

export function diffStyleSnapshots(
  liveSnapshots: StyleSelectorSnapshot[],
  localSnapshots: StyleSelectorSnapshot[],
  rectTolerancePx = 1
): StyleDiff[] {
  const diffs: StyleDiff[] = [];
  const selectors = Array.from(
    new Set([...liveSnapshots.map((item) => item.selector), ...localSnapshots.map((item) => item.selector)])
  );

  for (const selector of selectors) {
    const live = liveSnapshots.find((item) => item.selector === selector);
    const local = localSnapshots.find((item) => item.selector === selector);

    if (!live || !local) {
      diffs.push({ selector, kind: "count", live: live?.count ?? 0, local: local?.count ?? 0 });
      continue;
    }

    if (live.error || local.error) {
      diffs.push({ selector, kind: "count", live: live.error || live.count, local: local.error || local.count });
      continue;
    }

    if (live.count !== local.count) {
      diffs.push({ selector, kind: "count", live: live.count, local: local.count, delta: local.count - live.count });
    }

    const compareCount = Math.min(live.elements.length, local.elements.length);
    for (let index = 0; index < compareCount; index += 1) {
      const liveElement = live.elements[index] as StyleElementSnapshot;
      const localElement = local.elements[index] as StyleElementSnapshot;

      diffRects(diffs, selector, index, liveElement, localElement, rectTolerancePx);
      diffText(diffs, selector, index, liveElement.text, localElement.text);
      diffStyles(diffs, selector, index, liveElement.styles, localElement.styles, liveElement.styleSources, localElement.styleSources);
    }
  }

  return diffs;
}

function diffRects(
  diffs: StyleDiff[],
  selector: string,
  index: number,
  live: StyleElementSnapshot,
  local: StyleElementSnapshot,
  tolerance: number
): void {
  for (const property of ["x", "y", "width", "height"] as const) {
    const liveValue = live.rect[property];
    const localValue = local.rect[property];
    const delta = Number((localValue - liveValue).toFixed(2));
    if (Math.abs(delta) > tolerance) {
      diffs.push({ selector, index, kind: "rect", property, live: liveValue, local: localValue, delta });
    }
  }
}

function diffText(diffs: StyleDiff[], selector: string, index: number, liveText: string, localText: string): void {
  const live = trimText(liveText, 100);
  const local = trimText(localText, 100);
  if (live && local && live !== local && live.length <= 100 && local.length <= 100) {
    diffs.push({ selector, index, kind: "text", property: "text", live, local });
  }
}

function diffStyles(
  diffs: StyleDiff[],
  selector: string,
  index: number,
  liveStyles: Record<string, string>,
  localStyles: Record<string, string>,
  liveSources?: StyleElementSnapshot["styleSources"],
  localSources?: StyleElementSnapshot["styleSources"]
): void {
  const properties = Array.from(new Set([...Object.keys(liveStyles), ...Object.keys(localStyles)]));
  for (const property of properties) {
    const live = liveStyles[property] ?? "";
    const local = localStyles[property] ?? "";
    if (normalizeCssValue(live) !== normalizeCssValue(local)) {
      diffs.push({
        selector,
        index,
        kind: "style",
        property,
        live,
        local,
        liveSources: liveSources?.[property],
        localSources: localSources?.[property]
      });
    }
  }
}

function normalizeCssValue(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}
