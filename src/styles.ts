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
              styleSources[prop] = findStyleSources(element, prop, styles[prop]);
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

          function findStyleSources(element: Element, property: string, computedValue: string): Array<{ type: "inline" | "rule"; href?: string; selectorText?: string; value: string }> {
            const targets = inheritedProperty(property) ? ancestorChain(element) : [element];
            const candidateProperties = sourceProperties(property);

            for (const target of targets) {
              const declarations: Array<{
                type: "inline" | "rule";
                href?: string;
                selectorText?: string;
                declaredProperty: string;
                value: string;
                important: boolean;
                specificity: [number, number, number];
                order: number;
              }> = [];
              let order = 0;

              if (target instanceof HTMLElement || target instanceof SVGElement) {
                const inlineValue = firstDeclaredValue(target.style, candidateProperties);
                if (inlineValue) {
                  declarations.push({
                    type: "inline",
                    declaredProperty: inlineValue.property,
                    value: inlineValue.value,
                    important: inlineValue.important,
                    specificity: [1, 0, 0],
                    order: Number.MAX_SAFE_INTEGER
                  });
                }
              }

              for (const sheet of Array.from(document.styleSheets)) {
                let rules: CSSRuleList;
                try {
                  rules = sheet.cssRules;
                } catch {
                  continue;
                }
                order = collectRuleSources(target, candidateProperties, sheet.href ?? undefined, Array.from(rules), declarations, order);
              }

              const matchingDeclarations = declarations.filter((declaration) =>
                declarationMatchesComputed(target, property, computedValue, declaration.declaredProperty, declaration.value)
              );
              const winner = pickWinningDeclaration(matchingDeclarations);
              if (winner) return [toSource(winner)];
            }

            return [];
          }

          function collectRuleSources(
            element: Element,
            properties: string[],
            href: string | undefined,
            rules: CSSRule[],
            declarations: Array<{
              type: "inline" | "rule";
              href?: string;
              selectorText?: string;
              declaredProperty: string;
              value: string;
              important: boolean;
              specificity: [number, number, number];
              order: number;
            }>,
            startOrder: number
          ): number {
            let order = startOrder;
            for (const rule of rules) {
              if ("cssRules" in rule && !("selectorText" in rule && "style" in rule)) {
                order = collectRuleSources(element, properties, href, Array.from((rule as CSSGroupingRule).cssRules), declarations, order);
                continue;
              }
              order += 1;
              if (!("selectorText" in rule) || !("style" in rule)) continue;
              const styleRule = rule as CSSStyleRule;
              const value = firstDeclaredValue(styleRule.style, properties);
              if (!value) continue;
              try {
                const matchingSelector = bestMatchingSelector(element, styleRule.selectorText);
                if (matchingSelector) {
                  declarations.push({
                    type: "rule",
                    href,
                    selectorText: matchingSelector,
                    declaredProperty: value.property,
                    value: value.value,
                    important: value.important,
                    specificity: selectorSpecificity(matchingSelector),
                    order
                  });
                }
              } catch {
                continue;
              }
            }
            return order;
          }

          function firstDeclaredValue(style: CSSStyleDeclaration, properties: string[]): { property: string; value: string; important: boolean } | undefined {
            for (const property of properties) {
              const value = style.getPropertyValue(property);
              if (value) return { property, value, important: style.getPropertyPriority(property) === "important" };
            }
            return undefined;
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

          function pickWinningDeclaration(
            declarations: Array<{
              type: "inline" | "rule";
              href?: string;
              selectorText?: string;
              declaredProperty: string;
              value: string;
              important: boolean;
              specificity: [number, number, number];
              order: number;
            }>
          ):
            | {
                type: "inline" | "rule";
                href?: string;
                selectorText?: string;
                declaredProperty: string;
                value: string;
                important: boolean;
                specificity: [number, number, number];
                order: number;
              }
            | undefined {
            return declarations
              .slice()
              .sort((a, b) => {
                if (a.important !== b.important) return Number(a.important) - Number(b.important);
                if (a.type !== b.type) return a.type === "inline" ? 1 : -1;
                const specificityDelta = compareSpecificity(a.specificity, b.specificity);
                if (specificityDelta !== 0) return specificityDelta;
                return a.order - b.order;
              })
              .at(-1);
          }

          function toSource(declaration: {
            type: "inline" | "rule";
            href?: string;
            selectorText?: string;
            declaredProperty?: string;
            value: string;
          }): { type: "inline" | "rule"; href?: string; selectorText?: string; value: string } {
            return {
              type: declaration.type,
              href: declaration.href,
              selectorText: declaration.selectorText,
              value: declaration.value
            };
          }

          function bestMatchingSelector(element: Element, selectorText: string): string | undefined {
            const selectors = splitSelectorList(selectorText);
            return selectors
              .filter((selector) => {
                try {
                  return element.matches(selector);
                } catch {
                  return false;
                }
              })
              .sort((a, b) => compareSpecificity(selectorSpecificity(a), selectorSpecificity(b)))
              .at(-1);
          }

          function splitSelectorList(selectorText: string): string[] {
            const selectors: string[] = [];
            let current = "";
            let depth = 0;
            for (const char of selectorText) {
              if (char === "(") depth += 1;
              if (char === ")") depth = Math.max(0, depth - 1);
              if (char === "," && depth === 0) {
                if (current.trim()) selectors.push(current.trim());
                current = "";
                continue;
              }
              current += char;
            }
            if (current.trim()) selectors.push(current.trim());
            return selectors;
          }

          function declarationMatchesComputed(
            target: Element,
            computedProperty: string,
            computedValue: string,
            declaredProperty: string,
            declaredValue: string
          ): boolean {
            const resolved = resolveDeclaredValue(target, computedProperty, declaredProperty, declaredValue);
            return normalizeBrowserValue(resolved, computedProperty) === normalizeBrowserValue(computedValue, computedProperty);
          }

          function resolveDeclaredValue(target: Element, computedProperty: string, declaredProperty: string, declaredValue: string): string {
            const probe = document.createElement("span");
            probe.style.all = "initial";
            probe.style.position = "absolute";
            probe.style.visibility = "hidden";
            probe.style.pointerEvents = "none";
            probe.style.setProperty(declaredProperty, declaredValue);
            const parent = target instanceof HTMLElement ? target : document.body;
            parent.appendChild(probe);
            try {
              return window.getComputedStyle(probe).getPropertyValue(computedProperty);
            } finally {
              probe.remove();
            }
          }

          function normalizeBrowserValue(value: string, property: string): string {
            const normalized = value.replace(/\s+/g, " ").trim();
            if (property === "font-family") {
              return normalized
                .split(",")
                .map((part) => part.trim())
                .filter((part) => !/^["']?[A-Za-z0-9 _-]+ Fallback["']?$/i.test(part))
                .join(", ");
            }
            return normalized;
          }

          function selectorSpecificity(selector: string): [number, number, number] {
            const normalized = selector.replace(/:where\([^)]*\)/g, "");
            const ids = normalized.match(/#[\w-]+/g)?.length ?? 0;
            const classes =
              (normalized.match(/\.[\w-]+/g)?.length ?? 0) +
              (normalized.match(/\[[^\]]+\]/g)?.length ?? 0) +
              (normalized.match(/:(?!:)[\w-]+(?:\([^)]*\))?/g)?.length ?? 0);
            const elements =
              normalized
                .replace(/#[\w-]+/g, " ")
                .replace(/\.[\w-]+/g, " ")
                .replace(/\[[^\]]+\]/g, " ")
                .replace(/::?[\w-]+(?:\([^)]*\))?/g, " ")
                .split(/[\s>+~]+/)
                .filter((part) => part && part !== "*").length + (normalized.match(/::[\w-]+/g)?.length ?? 0);
            return [ids, classes, elements];
          }

          function compareSpecificity(a: [number, number, number], b: [number, number, number]): number {
            if (a[0] !== b[0]) return a[0] - b[0];
            if (a[1] !== b[1]) return a[1] - b[1];
            return a[2] - b[2];
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
    if (normalizeCssValue(live, property) !== normalizeCssValue(local, property)) {
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

function normalizeCssValue(value: string, property?: string): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (property === "font-family") {
    return normalized
      .split(",")
      .map((part) => part.trim())
      .filter((part) => !/^["']?[A-Za-z0-9 _-]+ Fallback["']?$/i.test(part))
      .join(", ");
  }
  return normalized;
}
